#!/usr/bin/env bash
# Download the speech models into jetson/models/ (about 1.2 GB, not in git).
#   STT: SenseVoice (int8 model is used)      TTS: Supertonic 3 (int8)
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p models && cd models
BASE=https://github.com/k2-fsa/sherpa-onnx/releases/download
get() {  # get <release tag> <archive name without .tar.bz2>
  [ -d "$2" ] && { echo "have $2"; return; }
  echo "downloading $2 ..."
  curl -fL "$BASE/$1/$2.tar.bz2" | tar xj
}
get asr-models sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17
get tts-models sherpa-onnx-supertonic-3-tts-int8-2026-05-11
rm -f sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/model.onnx   # float model, unused (900 MB)
du -sh ./*
