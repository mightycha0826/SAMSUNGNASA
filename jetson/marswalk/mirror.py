"""Mirror of the headset's view (role E).

The web app sends what it draws as JPEG pictures over its own WebSocket (web/src/core/mirror.js);
the hub keeps the newest and streams it to browsers:

  /mirror        WebSocket, headset -> hub: binary JPEG frames; text {"info": {...}}.
                 hub -> headset: {"viewers": n}, so pictures are only made while someone watches.
  /monitor       the page to open on the Jetson's monitor
  /monitor.mjpg  the pictures as one never-ending multipart response (an <img> shows it as video)
  /monitor.json  state, for the page's status line

No Meta account, no developer mode, no internet: only the hotspot the headset is already on.
The room is in the picture only if the app was opened with ?mirror=cam and the browser gave it
a camera; otherwise the background is plain.
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
BOUNDARY = "marswalkframe"


class Mirror:
    def __init__(self):
        self.sources: set[web.WebSocketResponse] = set()
        self.viewers = 0
        self.frame: bytes | None = None
        self.seq = 0                 # frames received since the hub started
        self.at = 0.0                # monotonic time of the newest frame
        self.info: dict = {}
        self.source_peer: str | None = None
        self.fresh = asyncio.Condition()

    def routes(self, app: web.Application):
        app.router.add_get("/mirror", self.source_handler)
        app.router.add_get("/monitor", self.page)
        app.router.add_get("/monitor.mjpg", self.stream)
        app.router.add_get("/monitor.json", self.status)

    async def _tell_sources(self):
        msg = json.dumps({"viewers": self.viewers})
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
            await ws.send_str(json.dumps({"viewers": self.viewers}))
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
                                  "info": self.info, "from": self.source_peer},
                                 headers={"Cache-Control": "no-store"})

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
