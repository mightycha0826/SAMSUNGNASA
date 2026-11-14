#!/usr/bin/env python3
"""Fake Quest client: plays the headset's side of docs/INTERFACES.md section 4
so E can test the hub without borrowing the headset.

Examples (run from jetson/ with .venv/bin/python):
  tools/fake_quest.py                                   # connect, print everything
  tools/fake_quest.py --text "take me to the survey site" # intent parser (hub needs --dev)
  tools/fake_quest.py --temp 31 --temp 36 --temp 25     # alert sequence (hub needs --dev)
  tools/fake_quest.py --wav samples/00_status_report.wav   # one utterance: mic.begin -> PCM -> mic.end
  tools/fake_quest.py --stream samples/00_status_report.wav --stream samples/02_nav_home.wav
                                                        # continuous stream, like the headset
  tools/fake_quest.py --say "Route recalculated"          # voice.say -> TTS back
  tools/fake_quest.py --url wss://10.42.0.1:8443/ws --for 10

Received TTS audio is saved as tts_out_<n>.wav.
"""
import argparse
import asyncio
import json
import ssl
import sys
import time
import wave

import aiohttp


def env(type_, payload):
    return json.dumps({"type": type_, "ts": int(time.time() * 1000), "payload": payload},
                      ensure_ascii=False)


async def send_wav(ws, path):
    with wave.open(path) as w:
        if w.getnchannels() != 1 or w.getsampwidth() != 2:
            sys.exit(f"{path}: need 16-bit mono WAV (ffmpeg -i in.wav -ac 1 -ar 16000 out.wav)")
        rate = w.getframerate()
        await ws.send_str(env("mic.begin", {"sampleRate": rate}))
        step = rate // 10  # 100 ms
        while chunk := w.readframes(step):
            await ws.send_bytes(chunk)
            await asyncio.sleep(0.1)   # real-time pace, like a live mic
    await ws.send_str(env("mic.end", {}))
    print(f">> sent {path} ({rate} Hz)")


async def stream_wavs(ws, paths, gap):
    """Like the real headset: one mic.begin with stream=true, then audio without end.
    The WAVs are played into the stream with `gap` seconds of silence around them."""
    await ws.send_str(env("mic.begin", {"sampleRate": 16000, "stream": True}))
    silence = b"\x00\x00" * 1600   # 100 ms
    async def quiet(secs):
        for _ in range(int(secs * 10)):
            await ws.send_bytes(silence)
            await asyncio.sleep(0.1)
    await quiet(gap)
    for path in paths:
        with wave.open(path) as w:
            if (w.getnchannels(), w.getsampwidth(), w.getframerate()) != (1, 2, 16000):
                sys.exit(f"{path}: --stream needs 16 kHz 16-bit mono WAV")
            while chunk := w.readframes(1600):
                await ws.send_bytes(chunk)
                await asyncio.sleep(0.1)
        print(f">> streamed {path}")
        await quiet(gap)
    await ws.send_str(env("mic.end", {}))


async def receiver(ws, quiet):
    tts, rate, n = bytearray(), 22050, 0
    async for msg in ws:
        if msg.type == aiohttp.WSMsgType.BINARY:
            tts += msg.data
            continue
        if msg.type != aiohttp.WSMsgType.TEXT:
            break
        m = json.loads(msg.data)
        if m["type"] == "telemetry" and quiet:
            continue
        print("<<", m["type"], json.dumps(m["payload"], ensure_ascii=False))
        if m["type"] == "tts.begin":
            tts.clear()
            rate = m["payload"].get("sampleRate", 22050)
        elif m["type"] == "tts.end":
            n += 1
            out = f"tts_out_{n}.wav"
            with wave.open(out, "wb") as o:
                o.setnchannels(1); o.setsampwidth(2); o.setframerate(rate); o.writeframes(tts)
            print(f"   saved {out} ({len(tts) / 2 / rate:.2f}s)")


async def main(a):
    ctx = None
    if a.url.startswith("wss"):
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE   # self-signed hub cert
    async with aiohttp.ClientSession() as s:
        async with s.ws_connect(a.url, ssl=ctx if ctx else False, heartbeat=5) as ws:
            print(">> connected", a.url)
            await ws.send_str(env("hello", {"client": "quest", "mock": True}))
            rx = asyncio.create_task(receiver(ws, a.quiet))
            await asyncio.sleep(0.3)
            for t in a.temp:
                await ws.send_str(env("dev.temp", {"suitTempC": t}))
                print(f">> dev.temp {t}")
                await asyncio.sleep(a.step)
            for t in a.text:
                await ws.send_str(env("dev.text", {"text": t}))
                print(f">> dev.text {t}")
                await asyncio.sleep(a.step)
            for t in a.say:
                await ws.send_str(env("voice.say", {"text": t, "priority": "normal"}))
                print(f">> voice.say {t}")
                await asyncio.sleep(a.step)
            for w in a.wav:
                await send_wav(ws, w)
                await asyncio.sleep(a.step)
            if a.stream:
                await stream_wavs(ws, a.stream, a.step)
            try:
                await asyncio.wait_for(rx, timeout=a.duration if a.duration > 0 else None)
            except asyncio.TimeoutError:
                pass


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--url", default="wss://127.0.0.1:8443/ws")
    p.add_argument("--text", action="append", default=[], help="dev.text: test intents without STT")
    p.add_argument("--temp", type=float, action="append", default=[], help="dev.temp: set mock suit temp")
    p.add_argument("--say", action="append", default=[], help="voice.say: ask the hub to speak")
    p.add_argument("--wav", action="append", default=[], help="16-bit mono WAV to stream as mic audio")
    p.add_argument("--stream", action="append", default=[],
                   help="16 kHz WAV played into one continuous mic stream (hub does the VAD)")
    p.add_argument("--step", type=float, default=2.0, help="seconds between scripted actions")
    p.add_argument("--for", dest="duration", type=float, default=0, help="exit after N seconds (0 = forever)")
    p.add_argument("-q", "--quiet", action="store_true", help="hide telemetry lines")
    try:
        asyncio.run(main(p.parse_args()))
    except KeyboardInterrupt:
        pass
