# Interface contract

The formats of the data modules exchange. **This document comes before the code.** To change a format, tell B, edit this document, then edit the code.

When you give work to an AI, this file and your own folder are enough.

> Every number here (grid size, temperature thresholds and so on) is a starting value. The team fixes them in the first 3 hours of the hackathon.
>
> All text in the project is English: labels, alert messages, voice commands and spoken guidance.

## Contents

1. [Coordinates and units](#1-coordinates-and-units)
2. [Data files (made by C)](#2-data-files-made-by-c)
3. [Browser events](#3-browser-events)
4. [Jetson ↔ headset WebSocket](#4-jetson--headset-websocket)
5. [Arduino → Jetson serial](#5-arduino--jetson-serial)
6. [Voice commands](#6-voice-commands)

---

## 1. Coordinates and units

There are two coordinate systems. Mixing them up is what breaks most often at integration.

| Name | What | Unit | Used by |
|---|---|---|---|
| Map grid | Cells of the Mars map. `[col, row]`, the south-west corner is `[0, 0]` | cells | C, D |
| Room coordinates | WebXR `local-floor` reference space. `[x, y, z]`, y is up | meters | A, D, F |

- **Only D** writes the conversion between the two (`web/src/nav/`). Other modules do not compute it themselves.
- The conversion is defined by the `demo` entry of `layerset.json`. A region of the map is scaled down to the size of the room floor.
- **Only C** converts Mars longitude/latitude ↔ map grid. The browser only receives grid coordinates. One degree is about 59,274.7 m (radius 3,396,190 m).
- All times are Unix time in milliseconds (`Date.now()`).
- Field names end with the unit: Celsius (`C`) for temperature, meters (`M`) for distance. Examples: `suitTempC`, `distanceM`. (`suitTempC` is the **ambient temperature**: the sensor on the suit measures the air around the wearer. The field and the alert id `suit-temp` keep the names they had when it was called the suit temperature; body temperature is simulated in the headset and is not in this field.)

---

## 2. Data files (made by C)

Location: `web/public/data/`

### 2.1 `layerset.json` — layer list

The values below come from the analysis in [RESOURCES.md](RESOURCES.md). C fills in each `null` after processing the files.

```json
{
  "site": {
    "name": "Gediz Vallis channel, Mount Sharp, Gale Crater",
    "scienceGoal": "Survey sulfur-bearing rocks",
    "lat": -4.78681191,
    "lon": 137.4075342,
    "bounds": { "west": 137.39026, "east": 137.42481, "south": -4.80409, "north": -4.76954 },
    "geologicUnit": { "code": "Htu", "name": "Hesperian transition undivided unit", "source": "USGS SIM 3292" }
  },
  "grid": { "cols": 512, "rows": 512, "cellSizeM": 4.0 },
  "layers": [
    {
      "id": "topo",
      "kind": "topographic",
      "mission": "MRO, Mars Express, MGS",
      "instrument": "HiRISE, CTX, HRSC, MOLA",
      "file": "topo.bin",
      "format": "float32",
      "unit": "m",
      "min": null,
      "max": null,
      "label": "Terrain elevation",
      "sourceUrl": "https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m"
    },
    {
      "id": "slope",
      "kind": "derived",
      "mission": "MRO, Mars Express, MGS",
      "instrument": "HiRISE, CTX, HRSC, MOLA",
      "file": "slope.bin",
      "format": "float32",
      "unit": "deg",
      "min": null,
      "max": null,
      "label": "Slope",
      "sourceUrl": "https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m"
    },
    {
      "id": "optical",
      "kind": "optical",
      "mission": "MRO",
      "instrument": "HiRISE",
      "file": "optical.png",
      "format": "image",
      "label": "Optical image",
      "sourceUrl": "https://trek.nasa.gov/tiles/Mars/EQ/curiosity_hirise_mosaic/1.0.0/WMTSCapabilities.xml"
    },
    {
      "id": "thermal",
      "kind": "thermal",
      "mission": "Mars Odyssey",
      "instrument": "THEMIS",
      "file": "thermal.png",
      "format": "image",
      "label": "Thermal image (night)",
      "sourceUrl": "https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml"
    }
  ],
  "waypoints": [
    { "id": "base", "label": "Base", "cell": [0, 0] },
    { "id": "site1", "label": "Sulfur stone field", "cell": [256, 256] }
  ],
  "demo": {
    "regionCells": [246, 246, 266, 266],
    "roomSizeM": [4, 4]
  }
}
```

- `grid` divides 2,048 m × 2,048 m into 512×512 cells of 4 m. The source terrain is 1 m resolution, so a finer grid is possible. B, C and D decide after seeing headset performance.
- The `base` coordinates in `waypoints` and `demo` are placeholders. C and D fix them.
- In the example above `site1` is the center of the grid, but **in the real file `site1` is `[275, 272]`**, the place where the sulfur was actually found ([DATA.md](DATA.md) section 2). Read `base`, `site1` and `demo` from `layerset.json`; do not hard-code them.
- In the real file `label` is the short Korean name the HUD's Korean mode (`?lang=ko`) displays, and `labelEn` is the English name shown in the example above. The real file also has a few extra fields (`credit`, `rmc`, `sol`). Code works without reading them.

Fields:

| Field | Meaning |
|---|---|
| `site.lat`, `site.lon` | Reference point (south latitude is negative, east longitude) |
| `site.bounds` | Map extent. Every layer is cropped to it |
| `site.geologicUnit` | Geologic unit of the site. Shown in the status panel and the legend |
| `grid` | The grid all layers share. C resamples every layer to it whatever its source resolution |
| `layers[].kind` | Data kind from challenge text Q4: `optical`, `thermal`, `spectral`, `topographic`, `geophysical`, `atmospheric`, `radiation`, `chemical`. Computed layers are `derived` |
| `layers[].format` | `float32` (numeric grid) or `image` |
| `layers[].min`, `max` | Value range of a numeric grid. Used for coloring and the legend |
| `layers[].sourceUrl` | Address of the source data. Used as is in the submission text. **Never empty** |
| `waypoints` | Base and survey site. `cell` is a map grid coordinate. B's loader adds a third, derived one before `layers:ready`: `near`, a cell about 20 m from the base on the bearing to the survey site and not steeper than 20° (`web/src/core/waypoints.js`, `"derived": true`; `?near=<metres>` changes the distance, `?near=0` leaves it out). It is a destination like the others (`nav:request` `{ "targetId": "near" }`) |
| `demo.regionCells` | Map region mapped onto the room `[col0, row0, col1, row1]` |
| `demo.roomSizeM` | Room floor size that region is scaled down to `[width, depth]` |

### 2.2 Numeric grid files (`*.bin`)

- `Float32Array`, little endian, length `cols * rows`
- Row-major order: index `row * cols + col`
- Cells without a value are `NaN`

### 2.3 Image files (`*.png`)

- **Square, with a power-of-two side (2,048 or 4,096 pixels).** It need not match the grid (`cols` × `rows`). The image covers all of `site.bounds` and is stretched onto the map. (Stitched optical tiles are about 3,220 pixels wide, which is not an integer multiple of the grid.)
- North is up
- The optical and thermal sources are 8-bit **grayscale**. The HUD applies color.
- Brightness in the thermal image is **relative brightness**, not temperature. It has no `min` / `max`, and the legend says "relative brightness".

### 2.4 `env.json` — radiation and atmosphere time series

Values extracted from Curiosity observations. The headset replays them in order over the demo time.

```json
{
  "sourceUrls": ["https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/"],
  "radiationIsFixedValue": false,
  "samples": [
    { "sol": 4312, "localTime": "12:00", "radiationUGyPerDay": null, "pressurePa": null, "airTempK": null }
  ]
}
```

- `radiationUGyPerDay` is required. If it cannot be extracted from the RAD files, put in a published value and set `radiationIsFixedValue` to `true`. The status panel then labels it "published value".
- `pressurePa` and `airTempK` are optional. The atmospheric (REMS) data is unverified, so they may be `null`. The status panel hides `null` items.

### 2.5 `traverse.json` — Curiosity's actual traverse

Only the rover stops inside the map extent, from the NASA traverse record.

```json
{
  "sourceUrl": "https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json",
  "points": [
    { "sol": 4312, "rmc": "109_120", "lon": 137.4075342, "lat": -4.78681191, "elevM": -3689.67, "tiltDeg": null, "cell": [256, 256] }
  ]
}
```

- `rmc` is the source's `RMC` value (`site_drive`). It is the key that links photos to positions.
- C fills `cell` with the map grid coordinate.
- D connects these points and draws them on the map as "the path Curiosity actually took".

### 2.6 `pov.json` — rover point-of-view photos

Real photos Curiosity took at that spot.

```json
{
  "photos": [
    {
      "waypointId": "site1",
      "rmc": "109_120",
      "sol": 4312,
      "instrument": "NAV_LEFT_B",
      "file": "pov/site1.jpg",
      "caption": "",
      "sourceUrl": ""
    }
  ]
}
```

A photo whose `rmc` equals a point in `traverse.json` was taken at that point.

---

## 3. Browser events

How modules talk inside the web app. B provides the bus in `web/src/core/bus.js`.

```js
import { bus } from '../core/bus.js';

bus.emit('layer:toggle', { id: 'thermal', visible: true });   // send
bus.on('layer:toggle', ({ id, visible }) => { /* ... */ });   // receive
```

| Event | Sender | Receiver | When |
|---|---|---|---|
| `layers:ready` | B (core) | D, F | Once, when `layerset.json` and the files are loaded |
| `layer:toggle` | F, B (from voice) | D | A layer is turned on or off |
| `env:update` | B (core) | F | The next `env.json` sample is replayed |
| `hazard:update` | A | D, F | The field obstacle grid changes (at most twice a second). The grid is a window of 256 × 256 cells that moves with the wearer in steps of a tile (6.4 m): **read `originXZ` from every event**. An obstacle stays in it until clear floor is seen where it stood, or the wearer walks there |
| `nav:request` | F, B (from voice) | D | A route is requested |
| `nav:route` | D | F | A route was computed |
| `telemetry:update` | B (from the Jetson) | F | The ambient temperature (the sensor on the suit) arrives (once a second) |
| `alert:raise` | B (from the Jetson), D | F, D | A hazard appears |
| `alert:clear` | B (from the Jetson), D | F, D | A hazard is gone |
| `voice:command` | B (from the Jetson) | All modules | A voice command was understood |
| `voice:say` | All modules | B (to the Jetson) | Something should be said aloud |
| `mode:change` | F | All modules | The display mode changes |
| `app:mode` | B (core) | All modules | The wearer chose the Mars map or the field map on the start page |
| `nav:position` | field (B) | D | The headset's tracking moved the wearer (5 times a second). `scale` says how many map metres one real metre is: 1 on the field map; on the Mars map it is set for each route so that the route is about 3 m of walking |
| `voice:commands` | B (from the Jetson) | F | The hub's command list, for the menu above the back of the hand |
| `voice:text` | F | B (to the Jetson) | A command was picked from that menu; it runs like a spoken one |
| `map:store` | A | B (to the Jetson) | Tiles of the field map changed (at most every 2 s): `{ run, cellSizeM, tileCells: 64, tiles: [{ x, z, runs }], source, stats }`. A tile is 64 × 64 cells; tile (x, z) starts at room position (x, z) × 6.4 m; `runs` is its cells as `[value, count, ...]` |
| `map:request` | A | B (to the Jetson) | A session started or the room coordinates were reset: ask the hub for the map it stored last |
| `map:stored` | B (from the Jetson) | A | The hub's newest run: `{ run, cellSizeM, tileCells, tiles: [{ x, z, runs }], startedAt, savedAt, updates }` |
| `rescue:signal` | F (`hud/rescue.js`) | B (to the Jetson) | The emergency button was sent or cancelled: `{ active, position: [x, z] map metres or null, suitTempC, batteryPct }` |
| `rescue:state` | B (from the Jetson) | F | What became of this headset's signal: `{ active, acknowledged, by }` |
| `map:pick` | F | B | A place was picked on the palm map and its card is up: `{ cell: [col, row] }` on the Mars map, `{ room: [x, z] }` on the field map; `null` when the card closes. While it is up, a spoken "Navigate" means that place |
| `field:target` | F | field (B) | The target of the field map: `{ point: [x, z], label? }` in room metres (a place picked on the map, or a waypoint); `{ point: null }` deletes it |
| `waypoint:set` | F | field (B), D (map) | A waypoint was set or renamed: `{ id, label, room: [x, z] }` on the field map, `{ id, label, cell: [col, row] }` on the Mars map |
| `waypoint:remove` | F | field (B), D (map) | `{ id }`: the waypoint was deleted |
| `voice:dictate` | F | B (to the Jetson) | `{ on, id }`: the next thing said is to come back as text, not as a command (a waypoint's name) |
| `voice:dictation` | B (from the Jetson) | F | `{ id, text }`: what was said. `text` is empty with `unavailable: true` when there is no hub |
| `nav:waypoint` | F | D | A destination added or moved while running: `{ id: "pick", cell: [col, row], label }`. It joins `layerSet.waypoints`; request it with `nav:request` |

### Payload formats and mock data

**`layers:ready`**
```json
{ "layerSet": { "...": "layerset.json as is" }, "grids": { "topo": "Float32Array", "slope": "Float32Array" }, "traverse": { "...": "traverse.json as is" } }
```

**`layer:toggle`**
```json
{ "id": "thermal", "visible": true }
```

**`env:update`**
```json
{ "sol": 4312, "localTime": "12:00", "radiationUGyPerDay": 200, "radiationIsFixedValue": false, "pressurePa": null, "airTempK": null }
```
`pressurePa` and `airTempK` may be `null`. The `200` above is a mock value.

**`hazard:update`** — floor grid in room coordinates
```json
{
  "originXZ": [-2.0, -2.0],
  "cellSizeM": 0.1,
  "cols": 40,
  "rows": 40,
  "cells": "Uint8Array(cols*rows)",
  "ts": 1794000000000
}
```
`cells` values: `0` passable, `1` obstacle, `255` unknown. The index is `row * cols + col`; `originXZ` is the room coordinate of cell `[0, 0]`.

The real scan (`web/src/scan/`) sends a 16 m × 16 m grid (160 × 160 cells) built from the room geometry the headset keeps (WebXR `mesh-detection` and `plane-detection`), with two extra fields: `"source": "room-scan"` and `"stats": { "meshes", "planes", "obstacles", "floor", "depth" }`. It is the room as last scanned by the headset, not live depth.

With live depth the headset's depth image is laid over the same cells twice a second. The field map asks for it by default (`?depth=0` leaves it out); the Mars map only with `?depth=1`. Then something put down about 1 to 2.3 m from the wearer after the room scan becomes obstacle cells within a few seconds, and passable again when it is taken away (not yet checked on the headset). `source` is then `"room-scan+depth"`, and `stats.depth` counts the cells live depth blocks at that moment. Live depth never clears a cell the room scan marked as an obstacle.

**`nav:request`**
```json
{ "targetId": "site1" }
```

**`nav:route`**
```json
{
  "status": "ok",
  "targetId": "site1",
  "points": [[0, 0, 0], [0.5, 0, -0.5], [1.0, 0, -1.5]],
  "distanceM": 1.8,
  "reason": ""
}
```
- `status`: `ok`, `blocked` (no path), `arrived`, `cancelled`
- `points`: room coordinates where the floor arrows go
- `distanceM`: remaining distance in the room
- In field mode the route to the marked target is sent with `"targetId": "mark"` and `"frame": "room"`. D's own routes are in map metres and carry no `frame`.

**`telemetry:update`**
```json
{ "suitTempC": 24.5, "source": "arduino", "ts": 1794000000000 }
```
`source`: `arduino` or `mock`

**`alert:raise`**
```json
{ "id": "suit-temp", "level": "critical", "message": "Ambient temperature is critical", "ts": 1794000000000 }
```
- `level`: `warn` (only the status panel color changes) or `critical` (red flashing screen)
- `id` values: `suit-temp` (E), `route-blocked` (D), `radiation` (B, decided from `env.json`), `link-lost` (B, Jetson connection lost)
- On `critical`, D computes a new route to `base`.
- `radiation` thresholds (starting values, `web/src/core/radiation.js`): `warn` at 300 µGy/day, `critical` at 600 µGy/day, clear below 270. The observed values in `env.json` (about 152–157) raise nothing; `?radWarn=` and `?radCrit=` change them.

**`alert:clear`**
```json
{ "id": "suit-temp" }
```

**`voice:command`**
```json
{ "intent": "nav.start", "slots": { "targetId": "site1" }, "text": "Take me to the survey site" }
```
The `intent` list is in [section 6](#6-voice-commands).

**`voice:say`**
```json
{ "text": "Route recalculated", "priority": "normal" }
```
`priority`: `normal` or `urgent` (interrupts what is being said)

**`app:mode`**
```json
{ "mode": "field" }
```
`mode`: `mars` (NASA map on the palm, route between base and survey site) or `field` (the room scan rewrites the map around the wearer; targets, waypoints and arrows on the floor). `import { mode } from '../core/mode.js'` gives the current value.

**`nav:position`** — where the wearer is, in D's map metre frame (`web/src/nav/coordinates.js`)
```json
{ "point": [-36.0, 0, 404.0], "source": "headset", "scale": 100 }
```
The session starts on the `base` waypoint. In Mars mode one real metre moves the point `scale` metres (100 by default, `?walkScale=`), so that crossing a room crosses a visible part of the 2 km map; in field mode `scale` is 1.

**`voice:commands`**
```json
{ "commands": [{ "say": "Status", "intent": "status.report", "slots": {} }, { "say": "Base", "intent": "nav.home", "slots": {}, "mode": "mars" }] }
```
A command with `mode` is shown only on that map (`mars` or `field`). The menu is a card above the back of the left hand; it is operated by pointing at it with the right hand and pinching (`web/src/hud/pointer.js`).

**`voice:text`**
```json
{ "text": "Status", "intent": "status.report", "slots": {} }
```
B sends the text to the hub, which treats it as speech. Without a hub, B emits `voice:command` from `intent` and `slots` directly.

**`mode:change`**
```json
{ "mode": "emergency" }
```
`mode`: `normal`, `emergency`. (`night` and `record` were P2 ideas and are not built; no command sets them.)

---

## 4. Jetson ↔ headset WebSocket

- Address: `wss://<Jetson address>:8443/ws` (the port is a starting value)
- Every text message is JSON in the envelope below.

```json
{ "type": "telemetry", "ts": 1794000000000, "payload": {} }
```

- Only audio is sent as binary frames.
- In the browser only B's `web/src/core/link.js` opens the WebSocket. Other modules use the event bus.

### Jetson → headset

| type | payload | Browser event it becomes |
|---|---|---|
| `telemetry` | `{ "suitTempC": 24.5, "source": "arduino" }` | `telemetry:update` |
| `alert.raise` | `{ "id": "suit-temp", "level": "critical", "message": "..." }` | `alert:raise` |
| `alert.clear` | `{ "id": "suit-temp" }` | `alert:clear` |
| `voice.command` | `{ "intent": "...", "slots": {}, "text": "..." }` | `voice:command` |
| `voice.commands` | `{ "commands": [{ "say", "intent", "slots", "mode"? }] }` | `voice:commands`. Sent after `hello` and whenever `commands.json` changes |
| `tts.begin` | `{ "sampleRate": 22050, "priority": "normal" }` | (B prepares playback) |
| (binary) | 16-bit PCM, mono | (B plays it) |
| `tts.end` | `{}` | (B ends playback) |
| `map.stored` | `{ run, cellSizeM, tileCells, tiles: [{ x, z, runs }], startedAt, savedAt, updates }` | `map:stored`. The answer to `map.request`: every tile of the newest run; nothing is sent when no map is stored |
| `voice.dictation` | `{ "id": 3, "text": "Rock sample by the door." }` | `voice:dictation`. What this headset said after `voice.dictate`, sent to it alone |
| `rescue.state` | `{ "active": true, "from", "at", "position", "acknowledged": false, "by": null }` | `rescue:state`. To the headset that sent the signal. The other headsets get `alert.raise` `{ "id": "crew-rescue", "level": "warn", "message": "Rescue signal from a crew member" }` and `alert.clear` when it is cancelled |

### Headset → Jetson

| type | payload | When |
|---|---|---|
| `hello` | `{ "client": "quest", "mock": false }` | Right after connecting |
| `mic.begin` | `{ "sampleRate": 16000, "stream": true }` | When the microphone starts, and again after every reconnect |
| (binary) | 16-bit PCM, mono, 16 kHz | Continuously. The hub finds the utterances itself (voice activity detection) and ignores the microphone while it is speaking |
| `voice.dictate` | `{ "on": true, "id": 3, "seconds": 12 }` | The next utterance of this headset is sent back to it as `voice.dictation { id, text }` and is not matched against the commands. `"on": false` withdraws the request; it lapses by itself after `seconds` (12 by default) |
| `mic.end` | `{}` | Microphone stream ends. Without `"stream": true` in `mic.begin`, everything between `mic.begin` and `mic.end` is one utterance |
| `voice.status` | `{ "mic": "on", "audio": "running", "inputRate": 48000, "level": 0.02 }` | When the microphone or audio state changes, and every 10 s. Shows in the hub log why a headset is silent |
| `voice.text` | `{ "text": "Status" }` | A command picked from the headset's menu. The hub handles it exactly like recognized speech |
| `client.log` | `{ "kind": "error", "message": "..." }` | Headset diagnostics: errors, AR session events, a position heartbeat every 5 s. Written to `jetson/logs/headset.log` |
| `voice.say` | `{ "text": "...", "priority": "normal" }` | Forwards the browser's `voice:say` as is |
| `state` | `{ "mode": "normal", "navStatus": "ok", "targetId": "site1" }` | When state changes. The voice assistant uses it to answer "status report" |
| `map.store` | `{ "run": "abc-0", "cellSizeM": 0.1, "tileCells": 64, "tiles": [{ "x": -1, "z": 0, "runs": [255, 3996, 1, 100] }], "source": "room-scan+depth", "stats": {} }` | Tiles of the field map that changed, at most every 2 s. The hub keeps one file per run (`jetson/maps/field-<time>-<run>.json`) with every tile the run has sent; a later tile replaces an earlier one. A run is one stretch in one set of room coordinates. At most 4096 tiles a run |
| `map.request` | `{}` | After connecting, and when a session starts or the room coordinates are reset |
| `rescue.signal` | `{ "active": true, "position": [12.0, -3.5], "suitTempC": 24.5, "batteryPct": 76 }` | The emergency button. `"active": false` withdraws it. The crew is virtual: the hub acknowledges after 5 s and marks the acknowledgement as simulated |

### The mirror: a second WebSocket

`wss://<Jetson address>:8443/mirror` carries what the app draws to the hub, so it can be watched on a monitor without a Meta account or developer mode (`web/src/core/mirror.js`, `jetson/marswalk/mirror.py`). It is separate from `/ws` so that pictures never queue in front of the microphone stream and the alerts.

| Direction | Message | Meaning |
|---|---|---|
| headset → hub | binary | One JPEG, 640 × 480, about ten a second, only while someone is watching |
| headset → hub | `{ "info": { "width", "height", "fps", "ar", "mode", "space", "camera" } }` | When any of these change |
| hub → headset | `{ "viewers": 1, "tune": { "fovDeg": 58, "tiltDeg": 0 } }` | How many monitor pages are open; at 0 the headset makes no pictures. `tune`, when the camera lens was set on the monitor page (`POST /monitor/tune`): the lens the virtual things are drawn with over the camera picture |

The hub serves `/monitor` (the page), `/monitor.mjpg` (the pictures as one multipart response) and `/monitor.json` (state, including a rescue signal that is up).

### Ambient temperature thresholds (starting values)

| Range | Result |
|---|---|
| Below 30 °C | Normal |
| 30 °C or above | `alert.raise` (`warn`) |
| 35 °C or above | `alert.raise` (`critical`) |
| Critical, then below 34 °C | `alert.raise` (`warn`): the alert steps back down |
| Below 29 °C | `alert.clear` |

The level follows the temperature in both directions. The 1 °C margin on the way down (`--margin-c`) only keeps a reading that hovers on a threshold from raising and clearing over and over. Until 2026-11-14 an alert never stepped down and cleared only below 28 °C, so the alarm kept ringing as critical while the display showed 29 °C.

Chosen so that holding the sensor in a hand reaches them in the demo. E tunes them after measuring with the real sensor.

---

## 5. Arduino → Jetson serial

- Speed: 115200 baud
- One line per second, one JSON object per line, lines end with `\n`

```json
{"temp_c": 24.5}
```

- If the sensor cannot be read: `{"temp_c": null, "error": "read_failed"}`
- If no line arrives for 5 seconds, the Jetson switches `source` to `mock` and logs it.

---

## 6. Voice commands

E's hub turns speech into one of the `intent` values below. Speech is English. Anything that matches no command is dropped.

**The commands are data, not code: `jetson/commands.json`.** Add or change a phrase there and save; the hub reloads the file by itself. A phrase matches when its words appear in what was heard, and close misspellings by the speech recognizer match too. When several phrases match, the longest wins ("stop navigation" beats "stop"). A command may carry a `reply` the hub says back, and any new `intent` is sent to the headset as `voice:command` like the rest.

| intent | slots | Short form | Also | Handled by |
|---|---|---|---|---|
| `status.report` | `{}` | "Status" | "Status report" | E answers by voice itself |
| `nav.start` | `{ "targetId": "near" }` | "Navigate" | "Take me", "Guide me", "Nearby point" | Mars map: D, to the nearby point about 20 m from the base (`near` in `waypoints`; on a map without it, `?near=0`, B's `link.js` sends the survey site instead). Field map: field (guidance to the marked target) |
| `nav.start` | `{ "targetId": "site1" }` | — (voice only) | "Take me to the survey site", "Sulfur rocks" | Mars map: D, to the survey site (390 m by route) |
| `nav.home` | `{}` | "Base" | "Go back", "Return to base" | D (Mars map only) |
| `nav.mark` | `{}` | "Mark waypoint" | "Waypoint", "Set waypoint", "Mark here" | F: a waypoint where the wearer stands, or at the place picked on the map (both maps) |
| `waypoint.record` | `{}` | "Record" | "Record label", "Record message" | F: the next thing said becomes the name of the waypoint that was just set or is picked (`voice.dictate`). Voice and the card's button |
| `mark.delete` | `{}` | "Delete" | "Remove" | F: deletes the waypoint or target picked on the map |
| `nav.stop` | `{}` | "Stop" | "Stop navigation", "Cancel" | D, field. Also closes the card over a picked place and disarms an armed emergency button |
| `alert.ack` | `{}` | "Confirm" | "Acknowledge" | F. While the emergency button is armed it sends the rescue signal; while a new waypoint waits for its name it keeps the name it has |
| `sos.arm` | `{}` | "SOS" | "Rescue", "Help", "Emergency", "Mayday" | F: arms the emergency button, as pressing the red bar once does. Voice only |
| `sos.cancel` | `{}` | "Cancel rescue" | "Cancel emergency" | F: withdraws a rescue signal that was sent. Voice only |
| `layer.show` | `{ "id": "thermal" }` | "Thermal" (also "Optical", "Slope", "Elevation") | "Show the thermal map" | B → `layer:toggle`. Voice only: the layer tabs beside the map do the same by hand |

**This is the whole list, and it is short on purpose** (pruned on 2026-11-14). Every phrase is one more thing ordinary talk can trigger by accident, so only what the demo needs is left. Removed: `layer.hide` (one layer is always shown; naming another switches to it), `nav.clear` ("Mark target" again moves the target, "Stop" ends the guidance), `mode.set` (night mode was never built), and the looser synonyms ("home", "return", "report", "copy", "roger", "let's go", "photo", "camera", "height" and others).

Naming the survey site is the one longer form that changes the destination; it is not in the menu. The command menu on the headset shows six of the commands as buttons, at most five at a time: "Base" only on the Mars map (`"mode"` in `commands.json`).

B re-emits `nav.start` and `nav.home` as `nav:request` (on the Mars map), and `layer.show` as `layer:toggle`, so D never needs to know whether a request came from voice or the UI.
