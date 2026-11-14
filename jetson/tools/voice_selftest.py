#!/usr/bin/env python3
"""Voice checks without a headset or a microphone.

  tools/voice_selftest.py --text "show me the thermal map"   # which command would this be?
  tools/voice_selftest.py                  # every test sentence -> TTS -> stream with silence
                                           #   between -> VAD -> STT -> command matcher
  tools/voice_selftest.py --save samples   # also write samples/<n>_<intent>.wav
                                           # (feed them to fake_quest.py --wav / --stream)
A synthetic voice is not a real one: also check with the team's voices through the headset
(everything the hub hears is written to logs/heard.log).
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

SENTENCES = [  # short forms first: these are what we say in the demo
    ("status.report", "Status"), ("nav.start", "Navigate"), ("nav.home", "Base"),
    ("nav.stop", "Stop"), ("nav.mark", "Mark target"), ("alert.ack", "Confirm"),
    ("layer.show", "Thermal"), ("layer.show", "Slope"),
    ("layer.show", "Elevation"), ("layer.show", "Optical"),
    ("nav.start", "Take me to the survey site"), ("nav.home", "Go back to base"),
    ("nav.stop", "Stop navigation"), ("layer.show", "Show the thermal map"),
    ("status.report", "Status report"), ("alert.ack", "Acknowledge alert"),
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
    p.add_argument("--text", action="append", default=[],
                   help="only run the command matcher on this text (no models needed)")
    p.add_argument("--save", metavar="DIR", help="write the 16 kHz WAVs here")
    a = p.parse_args()
    if a.text:
        for text in a.text:
            cmd = intents.parse(text)
            print(f"{text!r} -> {(cmd['intent'], cmd['slots']) if cmd else None}")
        return 0

    from marswalk.voice import make_segmenter
    tts, stt, seg = make_tts("supertonic"), make_stt("sensevoice"), make_segmenter()
    if a.save:
        Path(a.save).mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(0)

    def quiet(secs):   # room noise between utterances
        return (rng.standard_normal(int(16000 * secs)) * 60).astype("<i2").tobytes()

    ok = 0
    for i, (want, text) in enumerate(SENTENCES):
        t0 = time.monotonic()
        pcm = to_16k(tts.synthesize(text), tts.sample_rate)
        t1 = time.monotonic()
        # Stream it the way the headset does: 100 ms chunks, silence before and after.
        stream = quiet(1.0) + pcm + quiet(1.5)
        heard = []
        seg.reset()
        for j in range(0, len(stream), 3200):
            for samples in seg.feed(stream[j:j + 3200], 16000):
                heard.append(stt.transcribe(samples, 16000))
        t2 = time.monotonic()
        got = [(intents.parse(h) or {}).get("intent") for h in heard]
        good = got == [want]
        ok += good
        print(f"{'ok  ' if good else 'FAIL'} tts {t1 - t0:.2f}s  vad+stt {t2 - t1:.2f}s  "
              f"{text!r} -> {heard} -> {got}")
        if a.save:
            with wave.open(f"{a.save}/{i:02d}_{want.replace('.', '_')}.wav", "wb") as w:
                w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(pcm)
    print(f"{ok}/{len(SENTENCES)} commands recognized")
    return 0 if ok == len(SENTENCES) else 1


if __name__ == "__main__":
    sys.exit(main())
