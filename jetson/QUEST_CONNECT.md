# Jetson ↔ Quest 3 connection guide (role E)

How to connect the Jetson Orin Nano Super and the Quest 3 so the architecture in [README section 4](../README.md) exists for real.

```
[Arduino] --USB serial--> [Jetson] <==Wi-Fi (Jetson hotspot)==> [Quest 3 browser]
                           - https://10.42.0.1:8443/      web app (B's build output)
                           - wss://10.42.0.1:8443/ws      hub (INTERFACES.md section 4)
```

**E does not occupy the headset.** There is one headset, shared by A, B and D ([ROLES.md](../docs/ROLES.md)). E builds the Jetson side to the end with **a laptop browser or the fake Quest client**, and hands the headset users a state where "opening one address" is all that is left. Do the headset steps here only after every check in section 0 passes.

**Three key decisions**

1. **Wi-Fi, with the Jetson running the hotspot.** The demo walks around a 4 m × 4 m room, so no cable. Venue Wi-Fi often blocks device-to-device traffic (client isolation), so we do not rely on it. This Jetson's wireless card supports AP mode (checked with `iw list`).
2. **Web app and WebSocket on the same address and port (8443).** WebXR and the microphone (`getUserMedia`) need HTTPS. A self-signed certificate needs one warning click on the headset; with a single origin, that one click also lets `wss://` through.
3. **The USB cable is the escape route.** With `adb reverse` the headset reaches the hub as `localhost`, which is a secure context without any certificate. Use it only when certificates block us. It ties the headset to the Jetson, so it is not how E develops.

We do not use PC VR streaming (Quest Link, Air Link, ALVR). The app runs inside the headset browser; the Jetson is only a web server and a sensor and voice hub.

---

## 0. Developing without the headset (E's normal way of working)

From the Jetson's point of view the headset does three things: open an HTTPS page, exchange WebSocket messages, send microphone PCM and receive TTS PCM. All three can be reproduced without it.

| What the headset does | What to use instead | What it verifies |
|---|---|---|
| Join the hotspot | Join `MARSWALK` from a laptop or phone | Hotspot, DHCP, `10.42.0.x` address |
| Open the HTTPS page | Laptop Chrome at `https://10.42.0.1:8443/` | Certificate SAN, same-origin serving |
| WebSocket | B's web app in laptop Chrome without `?mock=1`, or the fake Quest client | `hello`, `telemetry`, `alert.*`, `state` |
| Microphone → STT | The fake client sends a recorded WAV (16 kHz mono) as `mic.begin` → PCM → `mic.end` | STT, intent parsing, `voice.command` |
| TTS → speaker | The fake client saves the received PCM as WAV; play it on the laptop | `tts.begin` sample rate, audio quality |
| A mobile browser | Chrome on an Android phone (the Quest browser is Chromium-based too) | Certificate warning and microphone permission on mobile |

The fake Quest client is [`tools/fake_quest.py`](tools/fake_quest.py). It plays the "headset → Jetson" side of INTERFACES.md section 4. Usage is in [README.md](README.md).

```bash
cd jetson
.venv/bin/python -m marswalk.hub --dev                        # terminal 1
.venv/bin/python tools/fake_quest.py --temp 31 --temp 36 --temp 25 \
    --text "take me to the survey site" --wav samples/00_nav_start.wav   # terminal 2
```

`tools/voice_selftest.py --save samples` writes synthetic recordings of every [voice command](../docs/INTERFACES.md). Also record each sentence once in the team's own voices into `samples/`; measure STT accuracy and latency (end of speech → `voice.command` within 2–3 s) with those files.

### When the headset is used (not by E)

E does not borrow the headset. **B runs the checks below during B's own headset time**, following the table in section 4. E only watches the Jetson log.

| When | Who | What | Time |
|---|---|---|---|
| 0–3 h, when B confirms "the AR screen shows" | B | Rows 1–3 of the section 4 table (hotspot, HTTPS, `hello`) | 5 min |
| First integration | B | Rows 4–6 (temperature, microphone, TTS) | 10 min |
| 24–36 h integration | Everyone | Demo flow steps 1–4 | Part of integration |

If a check fails, the headset goes straight back to B and E reproduces the problem with the section 0 methods. For problems that only happen on the headset (Quest browser certificate or microphone policy), get the console log from B.

---

## 1. Create the Jetson hotspot

Create it once with NetworkManager and it comes up at every boot. `sudo jetson/tools/setup_hotspot.sh '<team password>'` does the same as:

```bash
sudo nmcli con add type wifi ifname wlP1p1s0 con-name marswalk autoconnect yes ssid MARSWALK
sudo nmcli con modify marswalk 802-11-wireless.mode ap 802-11-wireless.band a ipv4.method shared ipv4.addresses 10.42.0.1/24
sudo nmcli con modify marswalk wifi-sec.key-mgmt wpa-psk wifi-sec.psk '<team password>'
sudo nmcli con up marswalk
```

- `ipv4.method shared`: the Jetson hands out DHCP addresses, and if the wired port (`enP8p1s0`) has internet, the headset gets it too.
- Try `band a` (5 GHz) first. If it does not come up, it may be the regulatory domain: try `sudo iw reg set KR`, and if that fails switch to `band bg` (2.4 GHz). Voice and telemetry are fine on 2.4 GHz.
- The Jetson is always `10.42.0.1`. On the headset use this IP, not a `.local` name.

Quest 3: Settings → Wi-Fi → connect to `MARSWALK`.

## 2. Create the certificate

The IP the headset connects to must be in the certificate.

```bash
jetson/tools/make_cert.sh            # to include the wired IP too: jetson/tools/make_cert.sh 10.1.111.79
```

- `jetson/certs/` is in `.gitignore`. The key never goes into the repository.

## 3. Serve the web app and the WebSocket from one origin

One hub server does both.

| Path | Contents |
|---|---|
| `/` | Static files from `web/dist/`, built by B with `npm run build` |
| `/ws` | The WebSocket of INTERFACES.md section 4 |

The hub is [`marswalk/hub.py`](marswalk/hub.py) (`aiohttp` alone: static files + WebSocket + TLS). While `web/dist/` does not exist it serves the connection test page.

- B's `link.js` connects to `wss://<page host>:8443/ws` by default, so the app served from the hub on 8443 connects with no extra parameter. Another hub address is given with `?jetson=<host>:8443`.
- While B uses the Vite dev server on a PC, the PC connects to `wss://<Jetson IP>:8443/ws`. Open `https://<Jetson IP>:8443/` once in that browser and accept the warning, or `wss` will not connect.
- Firewall: if `sudo ufw status` says `active`, run `sudo ufw allow 8443/tcp`.

## 4. First connection from the headset (during B's headset time)

Do this after all section 0 checks pass on a laptop. Hand this section to B.

1. In the Quest browser, enter `https://10.42.0.1:8443/`.
2. "Your connection is not private" → Advanced → Proceed. (Once per headset; again if browser data is cleared.)
3. When the page loads, press "Start AR" → allow microphone and hand tracking.
4. A `hello` message (`{"client":"quest"}`) in the Jetson log means the connection works.

Check in the order below, **one thing at a time**, so it is obvious where it stops.

| # | Check | Success | If it fails |
|---|---|---|---|
| 1 | Headset joined the hotspot | Quest Wi-Fi screen shows `10.42.0.x` | Password; try 2.4 GHz |
| 2 | HTTPS page loads | Page shows after the warning | Is `10.42.0.1` in the certificate SAN? Is the server on `0.0.0.0`? |
| 3 | WebSocket connects | `hello` on the Jetson | The address `link.js` uses (browser console) |
| 4 | Telemetry flows | Status panel temperature changes every second | Jetson send log |
| 5 | Microphone arrives | Binary frames after `mic.begin` | Is the page HTTPS? Was permission granted? |
| 6 | TTS is audible | Sound on the headset after `tts.begin` → PCM → `tts.end` | Sample rate (22050) matches |

## 5. USB connection (escape route)

This ties the headset to the Jetson, so it is not for everyday use. Use it when a certificate problem on the headset is not solved within 30 minutes, agreed with B and during B's headset time. Viewing the console (use 2) is done by whoever is using the headset (A, B, D) on their own PC.

Plug the Quest 3's USB-C into a USB-A port on the Jetson.

**Preparation (once)**

1. Join a Meta developer organization with the headset owner's account, then enable developer mode in the Meta Horizon phone app → Devices.
2. Install adb on the Jetson: `sudo apt install adb`
3. Plug in the cable and accept "Allow USB debugging" → always allow, on the headset.
4. `adb devices` showing the device as `device` means it works.

**Use 1 — connect without a certificate (escape route)**

Started with `--http-port 8080` (the systemd service does this by default), the hub also serves the same app without TLS on 8080. Forward the headset's 8080 to the Jetson's 8080:

```bash
adb reverse tcp:8080 tcp:8080
```

Open `http://localhost:8080/?jetson=ws://localhost:8080/ws` in the headset browser. `localhost` is a secure context even over HTTP, so WebXR and the microphone work. The `?jetson=` parameter is needed because the app's default is `wss://` on port 8443. The cable means no walking demo.

**Use 2 — view the headset browser console**

For A, B and D when chasing "errors that only happen on the device" ([ROLES.md](../docs/ROLES.md)). Plug the developer-mode headset into a PC (or the Jetson) over USB and open `chrome://inspect/#devices` in that PC's Chrome: the Quest browser tabs are listed. Copy only the relevant console lines to the AI.

**Use 3 — wireless adb**

`adb tcpip 5555`, unplug the cable, then `adb connect <headset IP>:5555`. The console stays visible while the headset is on the hotspot.

## Walking beyond the Guardian boundary

When the wearer walks out of the Quest's boundary, the headset pauses the app and the HUD disappears. Two ways around it:

1. **Turn the boundary off on the headset (the reliable way).** With developer mode on: Settings → Advanced (or System) → Developer → turn off **Physical Space Features**. Menu names move between Horizon OS versions; the Meta Quest Developer Hub on a PC has the same switch. With the boundary off nothing warns about walls and furniture, so clear the floor and have someone watch the wearer.
2. **Ask the browser for an unbounded space (experimental).** Add `?space=unbounded` to the address. The Quest Browser lists the WebXR `unbounded` reference space as experimental since 34.2; the app shifts it to floor level and keeps working in room coordinates. If the headset refuses it, the session stays on `local-floor`. Which one is in use is written to `logs/headset.log` (`"event": "space"`). Not yet tried on the headset.

## 6. Demo day checklist

- [ ] Powering on the Jetson brings up the `MARSWALK` hotspot by itself
- [ ] The hub starts by itself as a systemd service (`jetson/marswalk-hub.service`)
- [ ] The headset joins `MARSWALK` by itself (turn off auto-connect for other networks)
- [ ] `https://10.42.0.1:8443/` is bookmarked in the headset browser
- [ ] The certificate warning is already accepted (do not clear browser data after the rehearsal)
- [ ] Turning off the Jetson or the hotspot raises the `link-lost` alert on the HUD
- [ ] Jetson and headset within 10 m, no metal objects between them
- [ ] Jetson in performance mode: `sudo nvpmodel -m 0` then `sudo jetson_clocks` (speech model speed)

## 7. To agree with B

| Item | Proposal |
|---|---|
| Where the web app is served | The Jetson, same origin `https://10.42.0.1:8443/` |
| WebSocket address | `link.js` default `wss://<page host>:8443/ws` (already so); `?jetson=` overrides |
| Disconnect detection | Server pings every 5 s; the browser raises `link-lost` when the socket closes |
| Microphone | `mic.begin` → 16 kHz 16-bit mono PCM binary frames → `mic.end` (INTERFACES.md section 4 as written) |
| TTS playback | `tts.begin` carries `sampleRate` (22050) and `priority`; `urgent` cuts whatever is playing |
| Web app deployment | On the Jetson: `git pull && cd web && npm install && npm run build` (needs Node.js 20.19+), then restart the hub |

## Verification level

- AP mode support and interface names (`wlP1p1s0`, `enP8p1s0`): checked on this Jetson (2026-11-14, JetPack R39.2.1).
- Whether the 5 GHz hotspot actually comes up, and whether the Quest browser allows `wss` after the self-signed certificate warning: **needs checking on the device.**
- `localhost` being a secure context: [MDN Secure contexts](https://developer.mozilla.org/docs/Web/Security/Secure_Contexts).
