"""Mirror of the headset's view (role E).

The web app sends what it draws as JPEG pictures over its own WebSocket (web/src/core/mirror.js);
the hub keeps the newest and streams it to browsers:

  /mirror        WebSocket, headset -> hub: binary JPEG frames; text {"info": {...}}.
                 hub -> headset: {"viewers": n}, so pictures are only made while someone watches;
                 with "tune": {"fovDeg", "tiltDeg"} once the camera lens was set on the monitor page.
  /monitor       the page to open on the Jetson's monitor
  /monitor.mjpg  the pictures as one never-ending multipart response (an <img> shows it as video)
  /monitor.json  state, for the page's status line
  /monitor/tune  POST {"fovDeg", "tiltDeg"} or {"reset": true}: the lens the app draws the virtual
                 things with over the camera picture. The browser does not tell the app the
                 camera's lens, so it is set by eye here (grid against the real floor) and kept
                 in logs/mirror_tune.json for the next start.

No Meta account, no developer mode, no internet: only the hotspot the headset is already on.
The room is in the picture only if the browser gave the app a camera; otherwise the background
is plain.
"""
import asyncio
import json
import logging
import time
from pathlib import Path

from aiohttp import WSMsgType, web

log = logging.getLogger("mirror")

HERE = Path(__file__).resolve().parent
MAX_FRAME = 2 * 1024 * 1024
TUNE_FILE = HERE.parent / "logs" / "mirror_tune.json"
TUNE_RANGE = {"fovDeg": (35.0, 110.0), "tiltDeg": (-25.0, 25.0)}   # as in web/src/core/mirror.js


def clean_tune(raw) -> dict | None:
    """The numbers of a tune request, held to their ranges; None when there is nothing usable."""
    if not isinstance(raw, dict):
        return None
    out = {}
    for key, (lo, hi) in TUNE_RANGE.items():
        v = raw.get(key)
        if isinstance(v, (int, float)) and not isinstance(v, bool) and v == v:
            out[key] = round(min(hi, max(lo, float(v))), 1)
    return out or None
BOUNDARY = "marswalkframe"


class Mirror:
    def __init__(self, tune_file: Path | None = TUNE_FILE):
        self.tune_file = tune_file
        self.tune: dict | None = None    # the camera lens as set on the monitor page
        if tune_file is not None:
            try:
                self.tune = clean_tune(json.loads(tune_file.read_text()))
            except (OSError, json.JSONDecodeError):
                pass
        self.sources: set[web.WebSocketResponse] = set()
        self.viewers = 0
        self.frame: bytes | None = None
        self.seq = 0                 # frames received since the hub started
        self.at = 0.0                # monotonic time of the newest frame
        self.info: dict = {}
        self.source_peer: str | None = None
        self.fresh = asyncio.Condition()
        self.extra = lambda: {}          # more state for /monitor.json (the hub adds the rescue signal)

    def routes(self, app: web.Application):
        app.router.add_get("/mirror", self.source_handler)
        app.router.add_get("/monitor", self.page)
        app.router.add_get("/monitor.mjpg", self.stream)
        app.router.add_get("/monitor.json", self.status)
        app.router.add_post("/monitor/tune", self.set_tune)

    def _hello(self) -> str:
        msg = {"viewers": self.viewers}
        if self.tune:
            msg["tune"] = self.tune
        return json.dumps(msg)

    async def _tell_sources(self):
        msg = self._hello()
        for ws in list(self.sources):
            try:
                await ws.send_str(msg)
            except (ConnectionResetError, RuntimeError):
                self.sources.discard(ws)

    # ---------- headset -> hub ----------
    async def source_handler(self, request: web.Request):
        ws = web.WebSocketResponse(heartbeat=10.0, max_msg_size=MAX_FRAME)
        await ws.prepare(request)
        peer = request.remote
        self.sources.add(ws)
        log.info("mirror source connected %s", peer)
        try:
            await ws.send_str(self._hello())
            async for msg in ws:
                if msg.type == WSMsgType.BINARY:
                    if not msg.data.startswith(b"\xff\xd8"):   # not a JPEG
                        continue
                    self.frame, self.at, self.source_peer = bytes(msg.data), time.monotonic(), peer
                    self.seq += 1
                    async with self.fresh:
                        self.fresh.notify_all()
                elif msg.type == WSMsgType.TEXT:
                    try:
                        info = json.loads(msg.data).get("info")
                    except (json.JSONDecodeError, AttributeError):
                        continue
                    if isinstance(info, dict):
                        self.info = info
                        log.info("mirror from %s: %s", peer, info)
        finally:
            self.sources.discard(ws)
            log.info("mirror source gone %s", peer)
        return ws

    # ---------- hub -> monitor ----------
    async def page(self, _request):
        return web.FileResponse(HERE / "static" / "monitor.html", headers={"Cache-Control": "no-cache"})

    async def status(self, _request):
        age = round(time.monotonic() - self.at, 2) if self.frame else None
        return web.json_response({"sources": len(self.sources), "viewers": self.viewers, "frames": self.seq,
                                  "ageS": age, "bytes": len(self.frame) if self.frame else 0,
                                  "info": self.info, "from": self.source_peer, "tune": self.tune,
                                  **self.extra()},
                                 headers={"Cache-Control": "no-store"})

    async def set_tune(self, request: web.Request):
        try:
            body = await request.json()
        except (json.JSONDecodeError, UnicodeDecodeError):
            return web.json_response({"error": "JSON expected"}, status=400)
        if isinstance(body, dict) and body.get("reset"):
            tune = None
        else:
            tune = clean_tune(body)
            if tune is None:
                return web.json_response({"error": "fovDeg and/or tiltDeg expected"}, status=400)
            tune = {**(self.tune or {}), **tune}
        self.tune = tune
        if self.tune_file is not None:
            try:
                if tune is None:
                    self.tune_file.unlink(missing_ok=True)
                else:
                    self.tune_file.parent.mkdir(parents=True, exist_ok=True)
                    self.tune_file.write_text(json.dumps(tune))
            except OSError as err:
                log.warning("mirror tune not saved: %s", err)
        # A reset has no numbers to send: the app keeps what it has until it is reloaded.
        await self._tell_sources()
        log.info("mirror tune %s by %s", tune, request.remote)
        return web.json_response({"tune": tune})

    async def stream(self, request: web.Request):
        resp = web.StreamResponse(headers={
            "Content-Type": f"multipart/x-mixed-replace; boundary={BOUNDARY}",
            "Cache-Control": "no-store", "Connection": "close"})
        await resp.prepare(request)
        self.viewers += 1
        await self._tell_sources()
        log.info("monitor opened by %s (%d watching)", request.remote, self.viewers)
        seq = -1
        try:
            while request.transport is not None and not request.transport.is_closing():
                async with self.fresh:
                    try:   # wake up now and then to notice a monitor that went away while no frames came
                        await asyncio.wait_for(self.fresh.wait_for(lambda: self.frame is not None and self.seq != seq), 2.0)
                    except asyncio.TimeoutError:
                        continue
                seq, frame = self.seq, self.frame
                await resp.write(f"--{BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: {len(frame)}\r\n\r\n"
                                 .encode() + frame + b"\r\n")
        except (ConnectionResetError, asyncio.CancelledError, RuntimeError):
            pass
        finally:
            self.viewers -= 1
            await self._tell_sources()
            log.info("monitor closed by %s (%d watching)", request.remote, self.viewers)
        return resp
