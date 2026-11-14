"""The field map, kept on disk (role E).

The headset's map has no edge: the floor is cut into square tiles (64 x 64 cells of 10 cm,
web/src/scan/tiles.js), and whenever the map changes the headset sends the tiles that changed
(`map.store`, docs/INTERFACES.md section 4). One file per run in jetson/maps/ holds every tile
the run has sent, the latest version of each, and is rewritten with each change, so the file
is the map as it stood when the run ended. A run is one stretch of scanning in one set of room
coordinates: the headset starts a new one on every page load, AR session and recentre.

The files stay until there are more than `keep` of them; the hub hands the newest one back to
a headset that asks (`map.request` -> `map.stored`), also after a restart of the hub or the
Jetson. Whether that map fits the room the headset is in now is the headset's call
(web/src/scan/memory.js).

A file: { run, cellSizeM, tileCells, tiles: { "x,z": runs }, source, stats, startedAt, savedAt,
updates }. `runs` is a tile's cells row by row as [value, count, value, count, ...].
Files from before the tiles (one grid per file) are not maps to this code and are skipped.
"""
import json
import logging
import os
import re
import threading
import time
from pathlib import Path

log = logging.getLogger("maps")

MAX_TILE_CELLS = 256       # cells per side of a tile the hub accepts
MAX_TILE = 100_000         # a tile number beyond this (640 km from the origin) is not a place
MAX_TILES = 4096           # tiles one run may hold (400 m x 400 m at 6.4 m tiles)
CELL_VALUES = (0, 1, 255)  # passable, obstacle, not seen


def tile_key(x: int, z: int) -> str:
    return f"{x},{z}"


def _check_runs(runs, cells: int):
    """Raises ValueError unless `runs` is exactly `cells` cells of 0, 1 and 255."""
    if not isinstance(runs, list) or len(runs) % 2:
        raise ValueError("runs must be a list of value, count pairs")
    total = 0
    for value, count in zip(runs[::2], runs[1::2]):
        if value not in CELL_VALUES or type(count) is not int or count <= 0:
            raise ValueError("runs must hold cell values 0, 1, 255 and positive counts")
        total += count
    if total != cells:
        raise ValueError(f"runs cover {total} cells, a tile has {cells}")


def check(p: dict) -> dict:
    """The tiles of a `map.store` payload, or ValueError saying what is wrong with it.

    Returns { run, cellSizeM, tileCells, tiles: { "x,z": runs }, source, stats }.
    """
    if not isinstance(p, dict):
        raise ValueError("a map is an object")
    run = p.get("run")
    if not isinstance(run, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,40}", run):
        raise ValueError("run must be 1-40 letters, digits, - or _")
    cell = p.get("cellSizeM")
    if type(cell) not in (int, float) or not 0 < cell < 1000:
        raise ValueError("cellSizeM must be a positive number")
    side = p.get("tileCells")
    if type(side) is not int or not 0 < side <= MAX_TILE_CELLS:
        raise ValueError(f"tileCells must be 1..{MAX_TILE_CELLS}")
    tiles = p.get("tiles")
    if not isinstance(tiles, list) or len(tiles) > MAX_TILES:
        raise ValueError(f"tiles must be a list of at most {MAX_TILES} tiles")
    out = {}
    for t in tiles:
        if not isinstance(t, dict):
            raise ValueError("a tile is { x, z, runs }")
        x, z = t.get("x"), t.get("z")
        if type(x) is not int or type(z) is not int or abs(x) > MAX_TILE or abs(z) > MAX_TILE:
            raise ValueError(f"tile x and z must be whole numbers within {MAX_TILE}")
        _check_runs(t.get("runs"), side * side)
        out[tile_key(x, z)] = t["runs"]
    stats = p.get("stats") if isinstance(p.get("stats"), dict) else {}
    return {"run": run, "cellSizeM": cell, "tileCells": side, "tiles": out,
            "source": str(p.get("source", ""))[:40], "stats": stats}


def _read(path: Path) -> dict:
    """A map file as `check` returns it, with startedAt, savedAt and updates. Raises OSError, ValueError."""
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("tiles"), dict):
        raise ValueError("not a map in tiles")
    tiles = []
    for key, runs in data["tiles"].items():
        found = re.fullmatch(r"(-?\d{1,7}),(-?\d{1,7})", key)
        if not found:
            raise ValueError("tile keys must be x,z")
        tiles.append({"x": int(found[1]), "z": int(found[2]), "runs": runs})
    m = check({**data, "tiles": tiles})
    updates = data.get("updates")
    m.update(startedAt=str(data.get("startedAt", ""))[:40], savedAt=str(data.get("savedAt", ""))[:40],
             updates=updates if type(updates) is int and updates > 0 else 1)
    return m


def _age_key(path: Path):
    """Newest last. The file system's clock ticks every few ms, so the name settles a tie."""
    return (path.stat().st_mtime_ns, path.name)


class MapStore:
    def __init__(self, directory: Path, keep: int = 200):
        self.dir = Path(directory)
        self.keep = keep
        self.files: dict[str, Path] = {}    # run -> its file, for the runs seen by this hub process
        self.runs: dict[str, dict] = {}     # run -> its map as it is on disk, for the last few of them
        self.lock = threading.Lock()        # save runs in a worker thread, one per headset
        self.latest: dict | None = self._newest_on_disk()

    def _paths(self) -> list[Path]:
        """The map files, newest first."""
        return sorted(self.dir.glob("field-*.json"), key=_age_key, reverse=True)

    def _newest_on_disk(self) -> dict | None:
        try:
            paths = self._paths()
        except OSError:
            return None
        for path in paths:
            try:
                data = _read(path)
            except (OSError, ValueError):
                log.warning("skipping unreadable map file %s", path.name)
                continue
            log.info("newest stored field map: %s (%s, %d tiles)", path.name, data["savedAt"] or "?", len(data["tiles"]))
            # The run may go on (a headset that outlived a restart of the hub): in the same file.
            self.files[data["run"]] = path
            self.runs[data["run"]] = data
            return data
        return None

    def _open(self, run: str, now: str) -> dict:
        """The run's map so far: from memory, from its file (a run from before a restart), or new."""
        if run in self.runs:
            return self.runs[run]
        path = self.files.get(run)
        if path is None:
            name = re.compile(r"field-\d{8}-\d{6}-" + re.escape(run) + r"\.json")
            try:
                path = next((p for p in self._paths() if name.fullmatch(p.name)), None)
            except OSError:
                path = None
        if path is not None:
            self.files[run] = path
            try:
                return _read(path)
            except (OSError, ValueError):
                log.warning("map file %s cannot be read: run %s starts over in it", path.name, run)
        else:
            self.files[run] = self.dir / f"field-{time.strftime('%Y%m%d-%H%M%S')}-{run}.json"
        return {"run": run, "tiles": {}, "startedAt": now, "updates": 0}

    def save(self, payload: dict) -> Path:
        """Lay the tiles of a `map.store` into the run's map and write its file (whole file
        replaced at once). A tile the run already has is replaced. Raises ValueError, OSError."""
        new = check(payload)
        with self.lock:
            return self._save(new)

    def _save(self, new: dict) -> Path:
        run = new["run"]
        now = time.strftime("%Y-%m-%dT%H:%M:%S")
        m = self._open(run, now)
        if m["tiles"] and (m["tileCells"], m["cellSizeM"]) != (new["tileCells"], new["cellSizeM"]):
            raise ValueError("tileCells and cellSizeM must stay the same within a run")
        tiles = dict(m["tiles"])
        dropped = 0
        for key, runs in new["tiles"].items():
            if key in tiles or len(tiles) < MAX_TILES:
                tiles[key] = runs
            else:
                dropped += 1
        if dropped:
            log.warning("run %s is full (%d tiles): %d new tiles not stored", run, MAX_TILES, dropped)
        m = {**m, **new, "tiles": tiles, "savedAt": now, "updates": m["updates"] + 1}
        path = self.files[run]
        self.dir.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(m, separators=(",", ":")), encoding="utf-8")
        os.replace(tmp, path)   # a crash or power cut leaves the old file or the new one, never half
        self.runs.pop(run, None)
        self.runs[run] = m      # last in the dict: the one used most recently
        while len(self.runs) > 4:
            self.runs.pop(next(iter(self.runs)))
        self.latest = m
        if m["updates"] == 1:
            self._prune()
        return path

    def stored(self) -> dict | None:
        """The newest map as `map.stored` carries it: the tiles as a list of { x, z, runs }."""
        m = self.latest
        if not m:
            return None
        tiles = []
        for key, runs in m["tiles"].items():
            x, z = key.split(",")
            tiles.append({"x": int(x), "z": int(z), "runs": runs})
        return {"run": m["run"], "cellSizeM": m["cellSizeM"], "tileCells": m["tileCells"], "tiles": tiles,
                "startedAt": m["startedAt"], "savedAt": m["savedAt"], "updates": m["updates"]}

    def _prune(self):
        try:
            for old in self._paths()[self.keep:]:
                old.unlink()
        except OSError:
            pass
