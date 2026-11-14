# jetson/ — Jetson hub (role E)

Everything outside the headset: suit temperature sensor, alerts, voice assistant, web app serving.
All formats follow [docs/INTERFACES.md](../docs/INTERFACES.md) sections 4–6. Headset connection: [QUEST_CONNECT.md](QUEST_CONNECT.md). Firmware: [../arduino/](../arduino/README.md).

## One-time setup

```bash
cd jetson
uv venv .venv && uv pip install --python .venv/bin/python -r requirements.txt
tools/get_models.sh                     # speech models into models/ (1.2 GB, not in git)
tools/make_cert.sh                      # certs/ (not in git)
tools/build_web.sh                      # web/dist, served by the hub (installs Node into .tools/ if needed)
sudo tools/setup_hotspot.sh '<password>'   # Jetson hotspot MARSWALK, 10.42.0.1
```

Without `uv`: `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`.

## Run

```bash
.venv/bin/python -m marswalk.hub --dev --http-port 8080
```

| Option | Meaning |
|---|---|
| `--dev` | Accept `dev.text` and `dev.temp` from the fake client. Turn off for the demo |
| `--http-port 8080` | Also serve plain HTTP (for `adb reverse` / `localhost` only) |
| `--serial /dev/ttyACM0` | Arduino port. Default: auto-detect. `none`: mock temperature only |
| `--static ../web/dist` | B's build output. If missing, the connection test page is served |
| `--warn-c 30 --critical-c 35 --clear-c 28` | Temperature alert thresholds (tune with the real sensor) |
| `--stt auto --tts auto` | Speech backends. `auto` uses the models if present, otherwise `null` / `tone` |

The same command runs on a PC without a Jetson (no Arduino → `source: mock`; no models → no STT, beep TTS).

Open `https://<Jetson IP>:8443/` in a browser for the connection test page: secure context, WebSocket, temperature, alerts, microphone (hold to talk), TTS playback.

## Voice

Speech is **English**. Both models run on the CPU through the `sherpa-onnx` wheel (no torch, no GPU).

| Part | Model | Measured on this Jetson (4 threads) |
|---|---|---|
| STT | SenseVoice (int8) | ~0.15 s for a 2 s command |
| TTS | Supertonic 3 (int8), 22.05 kHz output | ~1.0–1.3 s for a short sentence, ~2 s for the status report |
| Intent | keyword rules in `marswalk/intents.py` | instant |

- From the end of speech to `voice.command`: about 0.2 s plus network.
- The critical alert sentence is synthesized at startup, so it plays without the 1 s delay.
- `status.report` is answered by the hub itself: suit temperature, alerts, route state.
- An `urgent` utterance drops normal ones still waiting. Cutting audio that is already playing is the browser's job (it sees `priority: "urgent"` in `tts.begin`).

Commands (anything else is dropped):

| Say | intent |
|---|---|
| "Take me to the survey site" / "Guide me to the sulfur rocks" | `nav.start` |
| "Go back to base" / "Return to base" | `nav.home` |
| "Stop navigation" | `nav.stop` |
| "Show the thermal map" (also optical, slope, terrain) | `layer.show` |
| "Hide the thermal map" | `layer.hide` |
| "Status report" | `status.report` |
| "Acknowledge alert" | `alert.ack` |
| "Night mode" | `mode.set` |

## Testing without the headset

```bash
.venv/bin/python -m unittest discover tests        # alert thresholds, intents, spoken sentences
.venv/bin/python tools/voice_selftest.py --save samples   # sentence -> TTS -> STT -> intent, writes samples/*.wav

.venv/bin/python tools/fake_quest.py -q \
  --temp 31 --temp 36 --temp 25 \
  --text "take me to the survey site" \
  --say "Route recalculated" \
  --wav samples/00_nav_start.wav --wav samples/09_status_report.wav --for 5
```

Received TTS is saved as `tts_out_<n>.wav`. Use `--url wss://10.42.0.1:8443/ws` to reach the Jetson from another machine.

## Start at boot

```bash
sudo cp marswalk-hub.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now marswalk-hub
journalctl -u marswalk-hub -f
```

## Layout

| File | Contents |
|---|---|
| `marswalk/hub.py` | HTTPS + WSS server, 1 Hz telemetry, message handling, voice flow |
| `marswalk/sensors.py` | Serial reader; falls back to `mock` after 5 s of silence |
| `marswalk/alerts.py` | Temperature alert state machine (warn → critical, clears below 28 °C) |
| `marswalk/intents.py` | Keyword rule intent parser |
| `marswalk/speech.py` | Sentences the hub speaks (numbers spelled out) |
| `marswalk/voice.py` | STT / TTS backends |
| `marswalk/static/index.html` | Connection test page |
| `tools/fake_quest.py` | Fake Quest client |
| `tools/voice_selftest.py` | Voice round trip without a microphone |
| `tools/arduino.sh` | Build / flash the firmware from the Jetson |
| `tools/build_web.sh` | Build the web app into `web/dist` |

## Checked with the real web app

With `web/dist` built, the hub serves B's app and `link.js` connects to it (`http://localhost:8080/?jetson=ws://localhost:8080/ws&mock=data,hazard` on the Jetson itself): telemetry reaches the status panel, a critical temperature puts the HUD in emergency mode, and spoken "Take me to the survey site" / "Show the thermal map" arrive as `nav:request` / `layer:toggle`.

The web app's voice link is `web/src/core/voice.js`: a hands-free microphone (an energy detector sends each stretch of speech as `mic.begin` → PCM → `mic.end`, and ignores the microphone while the hub is speaking) and TTS playback (`urgent` cuts what is playing). Audio starts on the first tap or key press. `?voice=0` turns it off; `?voice=ptt` is hold-`V`-to-talk for PC testing. Checked in a PC browser with recorded speech fed in as the microphone; not yet with a real microphone or the headset.

## Not verified yet

- **Real voices and a real microphone.** STT accuracy was measured only with synthetic speech (11–12 of 12 commands). Record the team's voices through the headset or the test page and add the misrecognitions to `intents.py`.
- **Real sensor.** The firmware runs on the Mega 2560, but no sensor has been wired yet. Alert thresholds are still the starting values.
- `dev.*` messages are development-only and not in INTERFACES.md. The browser never sends them; the hub accepts them only with `--dev`.
