"""The field map, kept on disk (role E).

The headset sends its obstacle grid whenever it changes (`map.store`, docs/INTERFACES.md
section 4). One file per run in jetson/maps/, rewritten with each change, so the file is the
map as it stood when the run ended. A run is one stretch of scanning in one set of room
coordinates: the headset starts a new one on every page load, AR session and recentre.

The files stay until there are more than `keep` of them; the hub hands the newest one back to
a headset that asks (`map.request` -> `map.stored`), also after a restart of the hub or the
Jetson. Whether that map fits the room the headset is in now is the headset's call
(web/src/scan/memory.js).
"""
import json
import logging
import os
import re
import time
from pathlib import Path

log = logging.getLogger("maps")

MAX_SIDE = 1024           # cells per side the hub accepts
CELL_VALUES = (0, 1, 255)  # passable, obstacle, not seen


def check(p: dict) -> dict:
    """The map from a `map.store` payload, or ValueError saying what is wrong with it."""
    run = str(p.get("run", ""))
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,40}", run):
        raise ValueError("run must be 1-40 letters, digits, - or _")
    cols, rows = p.get("cols"), p.get("rows")
    if not (isinstance(cols, int) and isinstance(rows, int) and 0 < cols <= MAX_SIDE and 0 < rows <= MAX_SIDE):
        raise ValueError(f"cols and rows must be 1..{MAX_SIDE}")
    runs = p.get("runs")
    if not isinstance(runs, list) or len(runs) % 2:
        raise ValueError("runs must be a list of value, count pairs")
    total = 0
    for value, count in zip(runs[::2], runs[1::2]):
        if value not in CELL_VALUES or type(count) is not int or count <= 0:
            raise ValueError("runs must hold cell values 0, 1, 255 and positive counts")
        total += count
    if total != cols * rows:
        raise ValueError(f"runs cover {total} cells, the grid has {cols * rows}")
    origin = p.get("originXZ")
    if not (isinstance(origin, list) and len(origin) == 2 and all(isinstance(v, (int, float)) for v in origin)):
        raise ValueError("originXZ must be [x, z]")
    cell = p.get("cellSizeM")
    if not (isinstance(cell, (int, float)) and cell > 0):
        raise ValueError("cellSizeM must be a positive number")
    stats = p.get("stats") if isinstance(p.get("stats"), dict) else {}
    return {"run": run, "originXZ": origin, "cellSizeM": cell, "cols": cols, "rows": rows,
            "runs": runs, "source": str(p.get("source", ""))[:40], "stats": stats}


def _age_key(path: Path):
    """Newest last. The file system's clock ticks every few ms, so the name settles a tie."""
    return (path.stat().st_mtime_ns, path.name)


class MapStore:
    def __init__(self, directory: Path, keep: int = 200):
        self.dir = Path(directory)
        self.keep = keep
        self.files: dict[str, Path] = {}    # run -> its file, for the runs of this hub process
        self.firsts: dict[str, str] = {}    # run -> when its first map arrived
        self.counts: dict[str, int] = {}
        self.latest: dict | None = self._newest_on_disk()

    def _newest_on_disk(self) -> dict | None:
        try:
            paths = sorted(self.dir.glob("field-*.json"), key=_age_key, reverse=True)
        except OSError:
            return None
        for path in paths:
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                check(data)
                log.info("newest stored field map: %s (%s)", path.name, data.get("savedAt", "?"))
                return data
            except (OSError, ValueError):
                log.warning("skipping unreadable map file %s", path.name)
        return None

    def save(self, payload: dict) -> Path:
        """Write the run's map to its file (whole file replaced at once). Raises ValueError, OSError."""
        m = check(payload)
        run = m["run"]
        now = time.strftime("%Y-%m-%dT%H:%M:%S")
        if run not in self.files:
            self.files[run] = self.dir / f"field-{time.strftime('%Y%m%d-%H%M%S')}-{run}.json"
            self.firsts[run] = now
            self.counts[run] = 0
        self.counts[run] += 1
        m.update(startedAt=self.firsts[run], savedAt=now, updates=self.counts[run])
        path = self.files[run]
        self.dir.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(m, separators=(",", ":")), encoding="utf-8")
        os.replace(tmp, path)   # a crash or power cut leaves the old file or the new one, never half
        self.latest = m
        if self.counts[run] == 1:
            self._prune()
        return path

    def _prune(self):
        try:
            paths = sorted(self.dir.glob("field-*.json"), key=_age_key, reverse=True)
            for old in paths[self.keep:]:
                old.unlink()
        except OSError:
            pass
