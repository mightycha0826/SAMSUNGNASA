"""STT / TTS backends. The hub only calls transcribe() and synthesize().

Chosen after measuring on this Jetson (Orin Nano Super, CPU only, 4 threads). English:
- SenseVoiceSTT: sherpa-onnx SenseVoice (zh/en/ja/ko/yue), int8. ~0.1 s per 2 s command.
- SupertonicTTS: sherpa-onnx Supertonic 3, int8. ~1.0 s per short sentence.
  Fixed sentences (alerts) are synthesized once at startup and served from a cache.
Both run through the `sherpa-onnx` wheel; no torch, no GPU. Models: tools/get_models.sh.

Fallbacks, so the hub still runs on a PC without the models:
- NullSTT: returns "" (logs the audio length). Use the fake client's dev.text to test intents.
- ToneTTS: a short beep per sentence, enough to check tts.begin -> PCM -> tts.end.
"""
import logging
import math
import struct
import threading
import time
from pathlib import Path

log = logging.getLogger("voice")

TTS_RATE = 22050  # docs/INTERFACES.md section 4 (tts.begin sampleRate)
MODELS = Path(__file__).resolve().parent.parent / "models"
STT_DIR = MODELS / "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17"
TTS_DIR = MODELS / "sherpa-onnx-supertonic-3-tts-int8-2026-05-11"


# ---------- fallbacks ----------
class NullSTT:
    name = "null"

    def transcribe(self, pcm: bytes, sample_rate: int) -> str:
        secs = len(pcm) / 2 / max(sample_rate, 1)
        log.info("STT not configured; got %.1fs of audio", secs)
        return ""


class ToneTTS:
    name = "tone"
    sample_rate = TTS_RATE

    def synthesize(self, text: str) -> bytes:
        """16-bit mono PCM: 0.25 s at 660 Hz, 0.1 s gap, 0.25 s at 880 Hz."""
        def tone(freq, secs):
            n = int(self.sample_rate * secs)
            return b"".join(
                struct.pack("<h", int(8000 * math.sin(2 * math.pi * freq * i / self.sample_rate)))
                for i in range(n))
        gap = b"\x00\x00" * int(self.sample_rate * 0.1)
        return tone(660, 0.25) + gap + tone(880, 0.25)

    def warm(self, texts):
        pass


# ---------- sherpa-onnx ----------
class SenseVoiceSTT:
    name = "sensevoice"
    MIN_S = 0.3  # shorter than this is a stray button tap, not speech
    PAD_S = 0.4

    def __init__(self, lang: str = "en", threads: int = 4):
        import sherpa_onnx
        t = time.monotonic()
        self._rec = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=str(STT_DIR / "model.int8.onnx"), tokens=str(STT_DIR / "tokens.txt"),
            num_threads=threads, language=lang, use_itn=True)
        self._lock = threading.Lock()
        log.info("SenseVoice STT loaded in %.1fs (lang=%s)", time.monotonic() - t, lang)

    def transcribe(self, pcm: bytes, sample_rate: int) -> str:
        import numpy as np
        samples = np.frombuffer(pcm[:len(pcm) // 2 * 2], dtype="<i2").astype(np.float32) / 32768.0
        secs = len(samples) / max(sample_rate, 1)
        if secs < self.MIN_S:
            log.info("STT: %.2fs of audio, too short", secs)
            return ""
        # Push-to-talk audio starts and ends abruptly; without some silence around it the
        # model drops the last syllable.
        pad = np.zeros(int(sample_rate * self.PAD_S), dtype=np.float32)
        samples = np.concatenate([pad, samples, pad])
        t = time.monotonic()
        with self._lock:
            stream = self._rec.create_stream()
            stream.accept_waveform(sample_rate, samples)  # resamples to 16 kHz if needed
            self._rec.decode_stream(stream)
            text = stream.result.text.strip()
        log.info("STT %.2fs for %.1fs of audio: %r", time.monotonic() - t, secs, text)
        return text


class SupertonicTTS:
    name = "supertonic"
    sample_rate = TTS_RATE

    def __init__(self, lang: str = "en", voice: int = 0, speed: float = 1.05, threads: int = 4):
        import sherpa_onnx
        t = time.monotonic()
        d = TTS_DIR
        self._tts = sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                supertonic=sherpa_onnx.OfflineTtsSupertonicModelConfig(
                    duration_predictor=str(d / "duration_predictor.int8.onnx"),
                    text_encoder=str(d / "text_encoder.int8.onnx"),
                    vector_estimator=str(d / "vector_estimator.int8.onnx"),
                    vocoder=str(d / "vocoder.int8.onnx"),
                    tts_json=str(d / "tts.json"),
                    unicode_indexer=str(d / "unicode_indexer.bin"),
                    voice_style=str(d / "voice.bin")),
                num_threads=threads)))
        self._gen = sherpa_onnx.GenerationConfig()
        self._gen.sid = voice          # 0..9
        self._gen.speed = speed
        self._gen.num_steps = 5
        self._gen.extra = {"lang": lang}
        self._lock = threading.Lock()
        self._cache: dict[str, bytes] = {}
        log.info("Supertonic TTS loaded in %.1fs (lang=%s voice=%d)", time.monotonic() - t, lang, voice)

    def synthesize(self, text: str) -> bytes:
        if text in self._cache:
            return self._cache[text]
        import numpy as np
        t = time.monotonic()
        # Without closing punctuation the model cuts the last syllable of short sentences.
        spoken = text if text[-1:] in ".?!" else text + "."
        with self._lock:
            audio = self._tts.generate(spoken, self._gen)
        x = np.asarray(audio.samples, dtype=np.float32)
        rate = audio.sample_rate
        if rate == 2 * TTS_RATE:       # model is 44.1 kHz; halve it to the contract's 22.05 kHz
            x = x[:len(x) // 2 * 2].reshape(-1, 2).mean(axis=1)
            rate = TTS_RATE
        if rate != TTS_RATE:
            raise RuntimeError(f"unexpected TTS sample rate {audio.sample_rate}")
        x = np.concatenate([x, np.zeros(int(rate * 0.2), dtype=np.float32)])  # tail room for playback
        pcm = (np.clip(x, -1.0, 1.0) * 32767).astype("<i2").tobytes()
        log.info("TTS %.2fs for %.1fs of audio", time.monotonic() - t, len(pcm) / 2 / rate)
        return pcm

    def warm(self, texts):
        """Synthesize fixed sentences ahead of time so alerts speak without the ~1 s delay."""
        for text in texts:
            self._cache[text] = self.synthesize(text)


# ---------- factories ----------
def make_stt(name: str, lang: str = "en"):
    if name == "auto":
        name = "sensevoice" if (STT_DIR / "model.int8.onnx").exists() and _has_sherpa() else "null"
    if name == "null":
        return NullSTT()
    if name == "sensevoice":
        return SenseVoiceSTT(lang)
    raise ValueError(f"unknown STT backend: {name}")


def make_tts(name: str, lang: str = "en"):
    if name == "auto":
        name = "supertonic" if (TTS_DIR / "tts.json").exists() and _has_sherpa() else "tone"
    if name == "tone":
        return ToneTTS()
    if name == "supertonic":
        return SupertonicTTS(lang)
    raise ValueError(f"unknown TTS backend: {name}")


def _has_sherpa() -> bool:
    try:
        import numpy  # noqa: F401
        import sherpa_onnx  # noqa: F401
        return True
    except ImportError:
        return False
