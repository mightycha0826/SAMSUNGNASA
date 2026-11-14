#!/usr/bin/env python3
"""Voice round trip without a headset or a microphone:
each command sentence -> TTS -> (16 kHz, like the headset mic) -> STT -> intent parser.

  .venv/bin/python tools/voice_selftest.py              # print timings and results
  .venv/bin/python tools/voice_selftest.py --save samples   # also write samples/<intent>.wav
                                                          # (feed them to fake_quest.py --wav)
A synthetic voice is not a real one: also record the team's voices (QUEST_CONNECT.md).
"""
import argparse
import sys
import time
import wave
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from marswalk import intents  # noqa: E402
from marswalk.voice import make_stt, make_tts  # noqa: E402

SENTENCES = [  # docs/INTERFACES.md section 6, plus the phrasings we expect in the demo
    ("nav.start", "Take me to the survey site"), ("nav.start", "Guide me to the sulfur rocks"),
    ("nav.home", "Go back to base"), ("nav.home", "Return to base"),
    ("nav.stop", "Stop navigation"),
    ("layer.show", "Show the thermal map"), ("layer.hide", "Hide the thermal map"),
    ("layer.show", "Show the slope layer"), ("layer.show", "Show the terrain map"),
    ("status.report", "Status report"), ("alert.ack", "Acknowledge alert"),
    ("mode.set", "Night mode"),
]


def to_16k(pcm: bytes, rate: int) -> bytes:
    x = np.frombuffer(pcm, "<i2").astype(np.float32)
    n = np.arange(-64, 65)
    h = np.sinc(2 * 7500 / rate * n) * np.hamming(len(n))
    x = np.convolve(x, h / h.sum(), "same")
    m = int(len(x) * 16000 / rate)
    return np.interp(np.linspace(0, len(x) - 1, m), np.arange(len(x)), x).astype("<i2").tobytes()


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--save", metavar="DIR", help="write the 16 kHz WAVs here")
    a = p.parse_args()
    tts, stt = make_tts("supertonic"), make_stt("sensevoice")
    if a.save:
        Path(a.save).mkdir(parents=True, exist_ok=True)
    ok = 0
    for i, (want, text) in enumerate(SENTENCES):
        t0 = time.monotonic()
        pcm = to_16k(tts.synthesize(text), tts.sample_rate)
        t1 = time.monotonic()
        heard = stt.transcribe(pcm, 16000)
        t2 = time.monotonic()
        got = (intents.parse(heard) or {}).get("intent")
        ok += got == want
        print(f"{'ok  ' if got == want else 'FAIL'} tts {t1 - t0:.2f}s  stt {t2 - t1:.2f}s  "
              f"{text!r} -> {heard!r} -> {got}")
        if a.save:
            with wave.open(f"{a.save}/{i:02d}_{want.replace('.', '_')}.wav", "wb") as w:
                w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(pcm)
    print(f"{ok}/{len(SENTENCES)} commands recognized")
    return 0 if ok == len(SENTENCES) else 1


if __name__ == "__main__":
    sys.exit(main())
