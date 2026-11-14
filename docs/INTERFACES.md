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
- Field names end with the unit: Celsius (`C`) for temperature, meters (`M`) for distance. Examples: `suitTempC`, `distanceM`.

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
- The real file has a few extra fields (`credit`, `rmc`, `sol`). Code works without reading them.

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
| `waypoints` | Base and survey site. `cell` is a map grid coordinate |
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
| `hazard:update` | A | D, F | The field obstacle grid changes (at most twice a second) |
| `nav:request` | F, B (from voice) | D | A route is requested |
| `nav:route` | D | F | A route was computed |
| `telemetry:update` | B (from the Jetson) | F | Suit temperature arrives (once a second) |
| `alert:raise` | B (from the Jetson), D | F, D | A hazard appears |
| `alert:clear` | B (from the Jetson), D | F, D | A hazard is gone |
| `voice:command` | B (from the Jetson) | All modules | A voice command was understood |
| `voice:say` | All modules | B (to the Jetson) | Something should be said aloud |
| `mode:change` | F | All modules | The display mode changes |

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

**`telemetry:update`**
```json
{ "suitTempC": 24.5, "source": "arduino", "ts": 1794000000000 }
```
`source`: `arduino` or `mock`

**`alert:raise`**
```json
{ "id": "suit-temp", "level": "critical", "message": "Suit temperature is critical", "ts": 1794000000000 }
```
- `level`: `warn` (only the status panel color changes) or `critical` (red flashing screen)
- `id` values: `suit-temp` (E), `route-blocked` (D), `radiation` (B, decided from `env.json`), `link-lost` (B, Jetson connection lost)
- On `critical`, D computes a new route to `base`.

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

**`mode:change`**
```json
{ "mode": "emergency" }
```
`mode`: `normal`, `emergency`, `night`(P2), `record`(P2)

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
| `tts.begin` | `{ "sampleRate": 22050, "priority": "normal" }` | (B prepares playback) |
| (binary) | 16-bit PCM, mono | (B plays it) |
| `tts.end` | `{}` | (B ends playback) |

### Headset → Jetson

| type | payload | When |
|---|---|---|
| `hello` | `{ "client": "quest", "mock": false }` | Right after connecting |
| `mic.begin` | `{ "sampleRate": 16000 }` | Microphone stream starts |
| (binary) | 16-bit PCM, mono, 16 kHz | While speaking |
| `mic.end` | `{}` | Microphone stream ends |
| `voice.say` | `{ "text": "...", "priority": "normal" }` | Forwards the browser's `voice:say` as is |
| `state` | `{ "mode": "normal", "navStatus": "ok", "targetId": "site1" }` | When state changes. The voice assistant uses it to answer "status report" |

### Suit temperature thresholds (starting values)

| Range | Result |
|---|---|
| Below 30 °C | Normal |
| 30 °C or above | `alert.raise` (`warn`) |
| 35 °C or above | `alert.raise` (`critical`) |
| Back below 28 °C | `alert.clear` |

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

E's intent parser turns speech into one of the `intent` values below. Speech is English. Anything not in the list is dropped.

| intent | slots | Example sentence | Handled by |
|---|---|---|---|
| `nav.start` | `{ "targetId": "site1" }` | "Take me to the survey site" | D |
| `nav.home` | `{}` | "Go back to base" | D |
| `nav.stop` | `{}` | "Stop navigation" | D |
| `layer.show` | `{ "id": "thermal" }` | "Show the thermal map" | B → `layer:toggle` |
| `layer.hide` | `{ "id": "thermal" }` | "Hide the thermal map" | B → `layer:toggle` |
| `status.report` | `{}` | "Status report" | E answers by voice itself |
| `alert.ack` | `{}` | "Acknowledge alert" | F |
| `mode.set` | `{ "mode": "night" }` | "Night mode" (P2) | F |

B re-emits `nav.start` and `nav.home` as `nav:request`, and `layer.show` / `layer.hide` as `layer:toggle`, so D never needs to know whether a request came from voice or the UI.
