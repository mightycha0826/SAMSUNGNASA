# jetson/ — Jetson hub (role E)

Everything outside the headset: the temperature sensor on the suit (ambient temperature: the air around the wearer), alerts, voice assistant, web app serving.
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
| `--warn-c 30 --critical-c 35 --margin-c 1` | Temperature alert thresholds (tune with the real sensor). An alert steps down once the temperature is `margin` under its threshold |
| `--wake-word helmet` | Only obey speech that contains the word ("Helmet, status report"). For rooms where other people talk; off by default |
| `--stt auto --tts auto` | Speech backends. `auto` uses the models if present, otherwise `null` / `tone` |

The same command runs on a PC without a Jetson (no Arduino → `source: mock`; no models → no STT, beep TTS).

Open `https://<Jetson IP>:8443/` in a browser for the connection test page: secure context, WebSocket, temperature, alerts, microphone (hold to talk), TTS playback.

## Voice

Speech is **English**. Everything runs on the Jetson CPU through the `sherpa-onnx` wheel (no torch, no GPU).

```
headset mic --16 kHz PCM, continuous--> Silero VAD --utterance--> SenseVoice STT --text--> commands.json --> voice.command
                                         (muted while the hub speaks)                                    \-> Supertonic TTS --> headset
```

| Part | Model | Measured on this Jetson (4 threads) |
|---|---|---|
| Voice activity | Silero VAD | 0.09 s for 8 s of audio |
| STT | SenseVoice (int8) | ~0.15 s per command |
| Commands | `commands.json`, fuzzy phrase match | instant |
| TTS | Supertonic 3 (int8), 22.05 kHz output | ~1.0–1.3 s for a short sentence, ~2 s for the status report |

What makes it robust:

- **The headset only streams audio; the hub decides what is speech.** A neural detector copes with noise and the headset's automatic gain, where a loudness threshold in the browser did not.
- **The microphone is ignored while the hub is speaking**, so it never hears its own voice as a command.
- **Short commands** ("Status", "Base", "Thermal") and **fuzzy matching**: "thermo mat" still means "thermal map"; phrases under 5 letters must match exactly, so "shop" is not "stop".
- **The microphone permission is asked on the 2D page**, before the AR session starts, and the page shows `Voice: mic on · audio running` above the Start AR button when it is ready.
- **The headset reports its microphone state** (`voice.status`) and the hub logs it, with the input level every 10 s. Everything the recognizer hears, matched or not, goes to `logs/heard.log`.

### Adding or changing a command

Edit [`commands.json`](commands.json) and save. The hub reloads it by itself; a typo in the file keeps the previous commands working and logs an error.

```json
{ "intent": "camera.shot", "phrases": ["photo", "take a picture"], "reply": "Picture taken" }
```

- `intent` and `slots` are sent to the headset as `voice.command`; any module can listen for a new intent on the bus (`voice:command`).
- `reply` (optional) is spoken by the hub.
- `{layer}` in a phrase or slot stands for every entry of `vars.layer`, so one line covers all layers.
- `wake_word` (or `--wake-word helmet`) makes the hub obey only speech that contains the word.
- Try a sentence without a headset: `.venv/bin/python tools/voice_selftest.py --text "show me the thermal map"`.

Current commands (kept to what the demo needs; every extra phrase is one more thing ordinary talk can trigger): "Status", "Navigate" (to the nearby point about 20 m from the base; "Take me to the survey site" names the far one), "Base", "Mark waypoint" (then "Record" to say its name, or "Confirm"), "Delete" (the waypoint or target picked on the map), "Stop", "Confirm", "SOS" / "Rescue" / "Help" (arms the SOS; one "Confirm" then sends it, "Cancel rescue" withdraws it), "Thermal" / "Optical" / "Slope" / "Elevation", and the longer forms in [INTERFACES.md section 6](../docs/INTERFACES.md#6-voice-commands).

- The critical alert sentence is synthesized at startup, so it plays without the 1 s delay.
- `status.report` is answered by the hub itself: ambient temperature, alerts, route state.
- An `urgent` utterance drops normal ones still waiting; the browser cuts audio already playing.

### Headset menu and diagnostics

- The hub sends its command list (`voice.commands`) when a headset connects and whenever `commands.json` changes. The headset shows it as a card above the back of the left hand; pointing at an entry and pinching comes back as `voice.text` and runs like speech. `"say"` sets the label, `"menu": false` keeps a command out of the list, and `"mode": "mars"` or `"field"` shows it only on that map.
- The headset reports errors, AR session events (start, end, visibility, reference space reset) and its head position every 5 s as `client.log`. They are in `logs/headset.log`; errors also appear in the hub log.

## Testing without the headset

```bash
.venv/bin/python -m unittest discover tests        # alert thresholds, intents, spoken sentences
.venv/bin/python tools/voice_selftest.py --save samples   # sentence -> TTS -> STT -> intent, writes samples/*.wav

.venv/bin/python tools/fake_quest.py -q \
  --temp 31 --temp 36 --temp 25 \
  --text "take me to the survey site" \
  --say "Route recalculated" \
  --stream samples/00_status_report.wav --stream samples/02_nav_home.wav --for 8
```

Received TTS is saved as `tts_out_<n>.wav`. Use `--url wss://10.42.0.1:8443/ws` to reach the Jetson from another machine.

## Start at boot

```bash
sudo cp marswalk-hub.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now marswalk-hub
journalctl -u marswalk-hub -f
```

### Monitor, stored maps, rescue signal

- **Monitor.** `http://localhost:8080/monitor` (or `https://<jetson>:8443/monitor`) shows what the headset app is drawing, live. The app sends JPEG pictures over `/mirror` only while the page is open. No Meta account or developer mode is involved.
- **Field maps.** The headset sends the tiles of its obstacle map that changed (a tile is 6.4 m square); the hub keeps them in `maps/` (`--maps-dir`), one JSON file per run holding every tile of that run, the newest 200 runs. After a restart the newest run is still handed back to a headset that asks, and a run that carries on is merged into its own file. Files from before the tiles (one grid per file) are skipped.
- **Utterances.** The last 100 pieces of speech the hub cut out of the microphone stream are kept as WAV in `logs/utterances/`, named by time and by what the recogniser made of them (`--keep-audio 0` keeps none). This is audio of whoever spoke near the headset; it stays on the Jetson and `logs/` is not in git.
- **Rescue signal.** The headset's emergency button (the red bar on its command card, or "SOS" / "Rescue" / "Help" then "Confirm" by voice) arrives as `rescue.signal`. The hub logs it, raises the alert `crew-rescue` on every other headset, shows a banner on the monitor page, speaks, and after 5 s acknowledges in the name of a crew that does not exist ("Base crew (simulated)").

## Layout

| File | Contents |
|---|---|
| `marswalk/hub.py` | HTTPS + WSS server, 1 Hz telemetry, message handling, voice flow |
| `marswalk/sensors.py` | Serial reader; falls back to `mock` after 5 s of silence |
| `marswalk/alerts.py` | Temperature alert state machine (the level follows the temperature up and down, 1 °C margin) |
| `commands.json` | The voice commands (edit this to add or change one) |
| `marswalk/intents.py` | Matches what was heard against `commands.json` |
| `marswalk/speech.py` | Sentences the hub speaks (numbers spelled out) |
| `marswalk/voice.py` | STT / TTS backends |
| `marswalk/maps.py` | The field map on disk (`maps/`) |
| `marswalk/mirror.py` | The headset's view for the monitor page (`/mirror`, `/monitor`) |
| `marswalk/static/monitor.html` | The monitor page |
| `marswalk/static/index.html` | Connection test page |
| `tools/fake_quest.py` | Fake Quest client |
| `tools/voice_selftest.py` | Voice round trip without a microphone |
| `tools/arduino.sh` | Build / flash the firmware from the Jetson |
| `tools/build_web.sh` | Build the web app into `web/dist` |

## Checked with the real web app

With `web/dist` built, the hub serves B's app and `link.js` connects to it (`http://localhost:8080/?jetson=ws://localhost:8080/ws&mock=data,hazard` on the Jetson itself): telemetry reaches the status panel, a critical temperature puts the HUD in emergency mode, and spoken "Take me to the survey site" / "Show the thermal map" arrive as `nav:request` / `layer:toggle`.

The web app's voice link is `web/src/core/voice.js`: it streams the microphone continuously and plays the hub's speech (`urgent` cuts what is playing). `?voice=0` turns it off; `?mockMic=a.wav,b.wav` uses audio files as the microphone. Checked in a PC browser with `mockMic`: "Thermal" switched the map layer and "Navigate" made D's planner compute the route. Not yet confirmed with the headset's own microphone.

## Not verified yet

- **Real voices and a real microphone.** Accuracy was measured only with synthetic speech (18 of 18 test sentences through the streaming path, before the command list was shortened; not measured again since). After a session with the headset, read `logs/heard.log` and add what was misheard to `commands.json`.
- **Real sensor.** A sensor is wired and read by the hub (2026-11-14: warming it by hand raised the alerts). Alert thresholds are still the starting values.
- `dev.*` messages are development-only and not in INTERFACES.md. The browser never sends them; the hub accepts them only with `--dev`.
