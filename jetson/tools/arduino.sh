#!/usr/bin/env bash
# Build / flash the suit temperature firmware from the Jetson (no Arduino IDE needed).
#   tools/arduino.sh setup                 # once: arduino-cli + AVR core + sensor libraries, into .tools/
#   tools/arduino.sh build                 # compile arduino/suit_temp
#   tools/arduino.sh flash [/dev/ttyACM0]  # compile and upload (stop the hub first: it holds the port)
#   tools/arduino.sh watch [/dev/ttyACM0]  # print the serial lines
# Other board: FQBN=arduino:avr:uno tools/arduino.sh build
set -euo pipefail
cd "$(dirname "$0")/.."
T=$PWD/.tools
export ARDUINO_DIRECTORIES_DATA=$T/arduino15 ARDUINO_DIRECTORIES_USER=$T/sketchbook ARDUINO_DIRECTORIES_DOWNLOADS=$T/staging
CLI=$T/arduino-cli
SKETCH=../arduino/suit_temp
FQBN=${FQBN:-arduino:avr:mega}   # the team board is a Mega 2560
port() { echo "${1:-$(ls /dev/ttyACM* /dev/ttyUSB* 2>/dev/null | head -1)}"; }

case "${1:-}" in
  setup)
    mkdir -p "$T"
    case "$(uname -m)" in aarch64) A=ARM64 ;; x86_64) A=64bit ;; *) echo "unknown arch"; exit 1 ;; esac
    curl -fL "https://downloads.arduino.cc/arduino-cli/arduino-cli_latest_Linux_$A.tar.gz" | tar xz -C "$T" arduino-cli
    "$CLI" core update-index
    "$CLI" core install arduino:avr
    "$CLI" lib install OneWire DallasTemperature "DHT sensor library" ;;
  build) "$CLI" compile --fqbn "$FQBN" "$SKETCH" ;;
  flash)
    P=$(port "${2:-}"); [ -n "$P" ] || { echo "no /dev/ttyACM* or /dev/ttyUSB* found"; exit 1; }
    "$CLI" compile --fqbn "$FQBN" --upload -p "$P" "$SKETCH" ;;
  watch)
    P=$(port "${2:-}"); [ -n "$P" ] || { echo "no serial port found"; exit 1; }
    "$CLI" monitor -p "$P" --config baudrate=115200 ;;
  *) sed -n '2,7p' "$0"; exit 1 ;;
esac
