"""Marswalk Jetson hub (role E).

One process, one origin:
  https://<host>:8443/     web app (web/dist, or the built-in connection test page)
  wss://<host>:8443/ws     WebSocket, docs/INTERFACES.md section 4
  https://<host>:8443/monitor   what the headset app is drawing, live (mirror.py)
Optional --http-port serves the same app over plain HTTP for the adb-reverse fallback
(http://localhost:<port> on the headset is a secure context).

Run:  python -m marswalk.hub --help
"""
import argparse
import asyncio
import json
import logging
import ssl
import time
from pathlib import Path

from aiohttp import WSMsgType, web

from . import intents, speech
from .maps import MapStore
from .mirror import Mirror
from .alerts import SUIT_TEMP_MESSAGES, SuitTempAlert, Thresholds
from .sensors import SuitTemp
from .voice import make_segmenter, make_stt, make_tts

log = logging.getLogger("hub")

HERE = Path(__file__).resolve().parent
JETSON_DIR = HERE.parent
REPO_DIR = JETSON_DIR.parent
TTS_CHUNK = 4096  # bytes per binary frame
MUTE_TAIL_S = 0.6  # keep microphones muted this long after the hub's own speech ends
ALERT_SPEECH = [SUIT_TEMP_MESSAGES["critical"]]  # spoken by the hub; synthesized at startup


def envelope(type_: str, payload: dict) -> str:
    return json.dumps({"type": type_, "ts": int(time.time() * 1000), "payload": payload},
                      ensure_ascii=False)


class Hub:
    def __init__(self, args):
        self.args = args
        self.clients: set[web.WebSocketResponse] = set()
        self.suit = SuitTemp(args.serial)
        self.alert = SuitTempAlert(Thresholds(args.warn_c, args.critical_c, args.margin_c))
        self.stt = make_stt(args.stt, args.lang)
        self.tts = make_tts(args.tts, args.lang)
        self.tts.warm(ALERT_SPEECH)
        self.say_epoch = 0          # bumped by every urgent utterance
        self.mute_until = 0.0       # monotonic time until which microphones are ignored
        self.heard_log = (JETSON_DIR / "logs" / "heard.log")
        self.menu_version = -1      # command menu version last sent to the headsets
        self.state = {"mode": "normal", "navStatus": None, "targetId": None}
        self.active_alerts: dict[str, dict] = {}
        self.tts_lock = asyncio.Lock()
        self.maps = MapStore(Path(args.maps_dir))
        self.mirror = Mirror()

    # ---------- broadcast ----------
    async def broadcast(self, type_: str, payload: dict):
        msg = envelope(type_, payload)
        for ws in list(self.clients):
            try:
                await ws.send_str(msg)
            except (ConnectionResetError, RuntimeError):
                self.clients.discard(ws)

    async def broadcast_bytes(self, data: bytes):
        for ws in list(self.clients):
            try:
                await ws.send_bytes(data)
            except (ConnectionResetError, RuntimeError):
                self.clients.discard(ws)

    # ---------- telemetry loop (1 Hz) ----------
    async def telemetry_loop(self):
        while True:
            r = self.suit.reading()
            await self.broadcast("telemetry", r)
            # commands.json changed: give the headsets the new menu
            version, menu = intents.menu()
            if version != self.menu_version:
                self.menu_version = version
                await self.broadcast("voice.commands", {"commands": menu})
            before = self.alert.level
            for type_, payload in self.alert.update(r["suitTempC"]):
                # The reading goes into the log with the alert, so a surprising alarm can be explained.
                log.info("%s %s at %.1f C (%s)", type_, payload, r["suitTempC"], r["source"])
                if type_ == "alert.raise":
                    self.active_alerts[payload["id"]] = payload
                else:
                    self.active_alerts.pop(payload["id"], None)
                await self.broadcast(type_, payload)
                if type_ == "alert.raise" and payload["level"] == "critical" and before != "critical":
                    asyncio.create_task(self.say(payload["message"], "urgent"))
            await asyncio.sleep(1.0)

    # ---------- voice ----------
    async def say(self, text: str, priority: str = "normal"):
        """TTS -> tts.begin, binary PCM frames, tts.end (to every client).

        An urgent utterance drops normal ones that are still waiting or being sent.
        (Audio already delivered is cut by the browser when it sees priority "urgent".)
        """
        text = (text or "").strip()
        if not text:
            return
        if priority == "urgent":
            self.say_epoch += 1
        epoch = self.say_epoch
        log.info("say [%s] %s", priority, text)
        try:
            pcm = await asyncio.to_thread(self.tts.synthesize, text)
        except Exception:
            log.exception("TTS failed for %r", text)
            return
        async with self.tts_lock:
            if epoch != self.say_epoch:
                log.info("dropped (urgent speech came first): %s", text)
                return
            # Do not listen while speaking: the headset microphone hears its own speaker.
            secs = len(pcm) / 2 / self.tts.sample_rate
            self.mute_until = time.monotonic() + secs + MUTE_TAIL_S
            await self.broadcast("tts.begin", {"sampleRate": self.tts.sample_rate,
                                               "priority": priority})
            for i in range(0, len(pcm), TTS_CHUNK):
                if epoch != self.say_epoch:
                    break
                await self.broadcast_bytes(pcm[i:i + TTS_CHUNK])
            await self.broadcast("tts.end", {})

    async def handle_text_command(self, text: str):
        cmd = intents.parse(text, self.args.wake_word)
        self._note_heard(text, cmd)
        if cmd is None:
            log.info("no command in %r", text)
            return
        reply = cmd.pop("reply", None)
        log.info("voice.command %s", cmd)
        await self.broadcast("voice.command", cmd)
        if cmd["intent"] == "status.report":   # the hub answers this one itself
            await self.say(self.status_sentence())
        elif reply:
            await self.say(reply)

    def _note_heard(self, text: str, cmd: dict | None):
        """Everything the recognizer heard, matched or not: the material for tuning commands.json."""
        try:
            self.heard_log.parent.mkdir(exist_ok=True)
            with self.heard_log.open("a", encoding="utf-8") as f:
                f.write(f"{time.strftime('%H:%M:%S')}\t{cmd['intent'] if cmd else '-'}\t{text}\n")
        except OSError:
            pass

    def _note_client(self, peer, kind: str, p: dict):
        """Headset diagnostics (errors, AR session events, a position heartbeat) in logs/headset.log."""
        try:
            path = JETSON_DIR / "logs" / "headset.log"
            path.parent.mkdir(exist_ok=True)
            with path.open("a", encoding="utf-8") as f:
                f.write(f"{time.strftime('%H:%M:%S')}\t{peer}\t{kind}\t{json.dumps(p, ensure_ascii=False)}\n")
        except OSError:
            pass

    async def handle_utterance(self, samples, rate: int):
        try:
            text = await asyncio.to_thread(self.stt.transcribe, samples, rate)
        except Exception:
            log.exception("STT failed")
            return
        await asyncio.to_thread(self._keep_audio, samples, rate, text)
        if text:
            await self.handle_text_command(text)

    def _keep_audio(self, samples, rate: int, text: str):
        """The last --keep-audio utterances as WAV files in logs/utterances/, named by time and by
        what the recogniser made of them: the only way to tell a bad microphone from a bad guess."""
        keep = self.args.keep_audio
        if keep <= 0:
            return
        try:
            import re
            import wave
            import numpy as np
            x = (np.frombuffer(samples, dtype="<i2").astype(np.float32) / 32768.0
                 if isinstance(samples, (bytes, bytearray)) else np.asarray(samples, dtype=np.float32))
            if not len(x):
                return
            peak = float(np.abs(x).max())
            rms = float(np.sqrt(np.mean(x * x)))
            log.info("utterance %.1fs peak %.3f rms %.4f -> %r", len(x) / rate, peak, rms, text)
            folder = JETSON_DIR / "logs" / "utterances"
            folder.mkdir(parents=True, exist_ok=True)
            slug = re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-")[:40] or "nothing"
            with wave.open(str(folder / f"{time.strftime('%Y%m%d-%H%M%S')}_{slug}.wav"), "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(rate)
                w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())
            for old in sorted(folder.glob("*.wav"))[:-keep]:
                old.unlink()
        except Exception:   # never let the bookkeeping break the voice path
            log.exception("could not keep the utterance audio")

    def status_sentence(self) -> str:
        r = self.suit.reading()
        return speech.status_sentence(r["suitTempC"], r["source"], self.active_alerts, self.state)

    # ---------- websocket ----------
    async def ws_handler(self, request: web.Request):
        ws = web.WebSocketResponse(heartbeat=5.0, max_msg_size=8 * 1024 * 1024)
        await ws.prepare(request)
        peer = request.remote
        self.clients.add(ws)
        log.info("client connected %s (%d total)", peer, len(self.clients))
        mic_buf = bytearray()
        mic_rate = 16000
        mic_on = False
        segmenter = None            # set while the client streams its microphone continuously
        try:
            # send current alert state so a reconnecting headset is in sync
            for a in self.active_alerts.values():
                await ws.send_str(envelope("alert.raise", a))
            async for msg in ws:
                if msg.type == WSMsgType.BINARY:
                    if segmenter is not None:
                        if time.monotonic() < self.mute_until:
                            segmenter.reset()        # the hub is speaking: not a command
                            continue
                        for samples in segmenter.feed(msg.data, mic_rate):
                            asyncio.create_task(self.handle_utterance(samples, segmenter.RATE))
                    elif mic_on:
                        mic_buf += msg.data
                    continue
                if msg.type != WSMsgType.TEXT:
                    continue
                try:
                    m = json.loads(msg.data)
                    type_, p = m["type"], m.get("payload") or {}
                except (json.JSONDecodeError, KeyError, TypeError):
                    log.warning("bad message from %s: %.80s", peer, msg.data)
                    continue

                if type_ == "hello":
                    log.info("hello from %s: %s", peer, p)
                    await ws.send_str(envelope("voice.commands", {"commands": intents.menu()[1]}))
                elif type_ == "mic.begin":
                    mic_rate = int(p.get("sampleRate", 16000))
                    if p.get("stream"):
                        # Continuous stream: the hub finds the utterances itself.
                        segmenter = segmenter or make_segmenter()
                        if segmenter is None:
                            log.warning("streaming mic from %s but no VAD model "
                                        "(tools/get_models.sh)", peer)
                        else:
                            segmenter.reset()
                            log.info("mic stream from %s (%d Hz)", peer, mic_rate)
                    else:
                        segmenter = None
                        mic_buf.clear()
                        mic_on = True
                elif type_ == "mic.end":
                    if segmenter is not None:
                        segmenter = None
                        log.info("mic stream from %s ended", peer)
                    elif mic_on:
                        mic_on = False
                        audio = bytes(mic_buf)
                        mic_buf.clear()
                        await self.handle_utterance(audio, mic_rate)
                elif type_ == "voice.text":
                    # A command picked from the headset's menu: same path as a spoken one.
                    asyncio.create_task(self.handle_text_command(str(p.get("text", ""))))
                elif type_ == "client.log":
                    kind = p.pop("kind", "?")
                    (log.debug if kind == "beat" else log.warning if kind in
                     ("error", "rejection", "console.error") else log.info)("headset %s [%s] %s", peer, kind, p)
                    self._note_client(peer, kind, p)
                elif type_ == "voice.status":
                    log.info("voice status from %s: %s", peer, p)
                elif type_ == "voice.say":
                    asyncio.create_task(self.say(p.get("text", ""), p.get("priority", "normal")))
                elif type_ == "state":
                    self.state.update(p)
                elif type_ == "map.store":
                    # The field map as the headset has it now: onto the disk (maps.py).
                    try:
                        path = await asyncio.to_thread(self.maps.save, p)
                    except (ValueError, OSError) as err:
                        log.warning("map from %s not stored: %s", peer, err)
                    else:
                        if self.maps.latest["updates"] == 1:
                            log.info("storing the field map of run %s in %s", p.get("run"), path.name)
                elif type_ == "map.request":
                    if self.maps.latest:
                        await ws.send_str(envelope("map.stored", self.maps.latest))
                elif type_.startswith("dev.") and self.args.dev:
                    await self.handle_dev(type_, p)
                else:
                    log.info("ignored %s from %s", type_, peer)
        finally:
            self.clients.discard(ws)
            log.info("client gone %s (%d left)", peer, len(self.clients))
        return ws

    async def handle_dev(self, type_: str, p: dict):
        """Dev-only messages (enabled with --dev). Not part of INTERFACES.md;
        the browser never sends them. Used by tools/fake_quest.py."""
        if type_ == "dev.text":            # skip STT, test the intent parser
            await self.handle_text_command(p.get("text", ""))
        elif type_ == "dev.temp":          # set the mock suit temperature
            self.suit.mock_c = float(p["suitTempC"])
            log.info("dev: mock temp = %.1f", self.suit.mock_c)


# ---------- web app ----------
def build_app(hub: Hub) -> web.Application:
    app = web.Application()
    app.router.add_get("/ws", hub.ws_handler)
    hub.mirror.routes(app)   # /mirror, /monitor: the headset's view on a monitor

    static_dir = Path(hub.args.static).resolve() if hub.args.static else None
    if static_dir and (static_dir / "index.html").exists():
        log.info("serving web app from %s", static_dir)
    else:
        if static_dir:
            log.warning("%s/index.html not found; serving the connection test page", static_dir)
        static_dir = HERE / "static"

    async def index(_):
        return web.FileResponse(static_dir / "index.html",
                                headers={"Cache-Control": "no-cache"})
    app.router.add_get("/", index)
    app.router.add_static("/", static_dir, show_index=False)

    async def on_startup(app):
        app["tasks"] = [asyncio.create_task(hub.telemetry_loop()),
                        asyncio.create_task(hub.suit.run())]

    async def on_cleanup(app):
        for t in app["tasks"]:
            t.cancel()
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    return app


async def serve(args):
    hub = Hub(args)
    runner = web.AppRunner(build_app(hub))
    await runner.setup()

    cert, key = Path(args.cert_dir) / "cert.pem", Path(args.cert_dir) / "key.pem"
    if cert.exists() and key.exists():
        ctx = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        ctx.load_cert_chain(cert, key)
        await web.TCPSite(runner, args.host, args.port, ssl_context=ctx).start()
        log.info("HTTPS  https://%s:%d/   wss://.../ws", args.host, args.port)
    else:
        log.warning("no cert in %s (run tools/make_cert.sh); HTTPS disabled", args.cert_dir)
        if not args.http_port:
            args.http_port = args.port
    if args.http_port:
        await web.TCPSite(runner, args.host, args.http_port).start()
        log.info("HTTP   http://%s:%d/   ws://.../ws  (localhost / adb reverse only)",
                 args.host, args.http_port)
    log.info("stt=%s tts=%s serial=%s dev=%s wake=%s", hub.stt.name, hub.tts.name,
             args.serial or "auto", args.dev, args.wake_word)
    await asyncio.Event().wait()


def main():
    p = argparse.ArgumentParser(description="Marswalk Jetson hub")
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8443, help="HTTPS + WSS port")
    p.add_argument("--http-port", type=int, default=0,
                   help="also serve plain HTTP (for adb reverse / localhost), e.g. 8080")
    p.add_argument("--static", default=str(REPO_DIR / "web" / "dist"),
                   help="built web app dir (default: web/dist)")
    p.add_argument("--cert-dir", default=str(JETSON_DIR / "certs"))
    p.add_argument("--serial", default=None,
                   help="serial port (default: first /dev/ttyACM* or ttyUSB*; 'none' = mock only)")
    p.add_argument("--warn-c", type=float, default=30.0)
    p.add_argument("--critical-c", type=float, default=35.0)
    p.add_argument("--margin-c", type=float, default=1.0,
                   help="an alert steps down once the temperature is this far under its threshold")
    p.add_argument("--stt", default="auto", help="auto | sensevoice | null")
    p.add_argument("--tts", default="auto", help="auto | supertonic | tone")
    p.add_argument("--lang", default="en", help="speech language code for STT and TTS")
    p.add_argument("--wake-word", default=None,
                   help="only obey speech containing this word, e.g. 'helmet' (noisy rooms)")
    p.add_argument("--keep-audio", type=int, default=100,
                   help="keep the last N utterances as WAV in logs/utterances/ for tuning (0 = keep none)")
    p.add_argument("--maps-dir", default=str(JETSON_DIR / "maps"),
                   help="where the field maps sent by the headset are kept")
    p.add_argument("--dev", action="store_true", help="accept dev.* messages from tools/fake_quest.py")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(name)-7s %(message)s", datefmt="%H:%M:%S")
    logging.getLogger("aiohttp.access").setLevel(logging.WARNING)
    try:
        asyncio.run(serve(args))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
