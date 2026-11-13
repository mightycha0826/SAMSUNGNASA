# 인터페이스 계약

모듈끼리 주고받는 데이터의 형식입니다. **이 문서가 코드보다 먼저입니다.** 형식을 바꾸려면 B에게 말하고, 이 문서를 고친 뒤 코드를 고칩니다.

AI에게 작업을 시킬 때 이 파일과 자기 폴더만 주면 됩니다.

> 여기 나오는 숫자(격자 크기, 온도 기준 등)는 모두 시작값입니다. 해커톤 첫 3시간에 팀이 확정합니다.

## 목차

1. [좌표와 단위](#1-좌표와-단위)
2. [데이터 파일 (C가 만든다)](#2-데이터-파일-c가-만든다)
3. [브라우저 이벤트](#3-브라우저-이벤트)
4. [젯슨 ↔ 헤드셋 WebSocket](#4-젯슨--헤드셋-websocket)
5. [아두이노 → 젯슨 시리얼](#5-아두이노--젯슨-시리얼)
6. [음성 명령 목록](#6-음성-명령-목록)

---

## 1. 좌표와 단위

좌표계가 둘 있습니다. 헷갈리면 통합 때 가장 많이 깨지는 부분입니다.

| 이름 | 무엇 | 단위 | 누가 쓰나 |
|---|---|---|---|
| 지도 격자 | 화성 지도의 칸. `[col, row]`, 남서쪽 구석이 `[0, 0]` | 칸 | C, D |
| 방 좌표 | WebXR `local-floor` 기준 공간. `[x, y, z]`, y가 위쪽 | 미터 | A, D, F |

- 두 좌표계를 잇는 변환은 **D만** 만듭니다 (`web/src/nav/`). 다른 모듈은 변환을 직접 계산하지 않습니다.
- 변환 기준은 `layerset.json`의 `demo` 항목입니다. 지도의 일부 구역을 방 바닥 크기로 축소해 대응시킵니다.
- 화성 경위도 ↔ 지도 격자 변환은 **C만** 합니다. 브라우저에는 격자 좌표만 넘어옵니다. 1도는 약 59,274.7m입니다 (반지름 3,396,190m 기준).
- 시간은 모두 밀리초 단위 Unix 시각(`Date.now()`)입니다.
- 온도는 섭씨(`C`), 거리는 미터(`M`)를 필드 이름 끝에 붙입니다. 예: `suitTempC`, `distanceM`.

---

## 2. 데이터 파일 (C가 만든다)

위치: `web/public/data/`

### 2.1 `layerset.json` — 레이어 목록

아래 값은 [RESOURCES.md](RESOURCES.md)의 분석 결과로 채운 것입니다. `null`은 C가 파일을 가공한 뒤 채웁니다.

```json
{
  "site": {
    "name": "Gediz Vallis channel, Mount Sharp, Gale Crater",
    "scienceGoal": "황이 든 돌 조사",
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
      "label": "지형 높이",
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
      "label": "경사도",
      "sourceUrl": "https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m"
    },
    {
      "id": "optical",
      "kind": "optical",
      "mission": "MRO",
      "instrument": "HiRISE",
      "file": "optical.png",
      "format": "image",
      "label": "광학 영상",
      "sourceUrl": "https://trek.nasa.gov/tiles/Mars/EQ/curiosity_hirise_mosaic/1.0.0/WMTSCapabilities.xml"
    },
    {
      "id": "thermal",
      "kind": "thermal",
      "mission": "Mars Odyssey",
      "instrument": "THEMIS",
      "file": "thermal.png",
      "format": "image",
      "label": "열 영상 (야간)",
      "sourceUrl": "https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml"
    }
  ],
  "waypoints": [
    { "id": "base", "label": "기지", "cell": [0, 0] },
    { "id": "site1", "label": "황 암석 지대", "cell": [256, 256] }
  ],
  "demo": {
    "regionCells": [246, 246, 266, 266],
    "roomSizeM": [4, 4]
  }
}
```

- `grid`는 2,048m × 2,048m를 4m 칸 512×512로 나눈 것입니다. 원본 지형은 1m 해상도라 더 촘촘하게도 만들 수 있습니다. 헤드셋 성능을 보고 B, C, D가 정합니다.
- `waypoints`의 `base` 좌표와 `demo`는 자리만 잡은 값입니다. C와 D가 확정합니다.
- `site1`은 격자 한가운데, 즉 기준점입니다.

필드 설명:

| 필드 | 뜻 |
|---|---|
| `site.lat`, `site.lon` | 기준점 좌표 (남위는 음수, 동경) |
| `site.bounds` | 지도 범위. 모든 레이어를 이 범위로 잘라 맞춘다 |
| `site.geologicUnit` | 이 지점의 지질 단위. 상태창과 범례에 표시 |
| `grid` | 모든 레이어가 공유하는 격자. 레이어마다 해상도가 달라도 C가 이 격자에 맞춰 낸다 |
| `layers[].kind` | 원문 Q4의 데이터 종류: `optical`, `thermal`, `spectral`, `topographic`, `geophysical`, `atmospheric`, `radiation`, `chemical`. 계산으로 만든 것은 `derived` |
| `layers[].format` | `float32`(숫자 격자) 또는 `image`(색 입힌 이미지) |
| `layers[].min`, `max` | 숫자 격자의 값 범위. 색 입히기와 범례에 쓴다 |
| `layers[].sourceUrl` | 원본 데이터 주소. 제출 설명문에 그대로 쓴다. **비워 두지 않는다** |
| `waypoints` | 기지와 조사 지점. `cell`은 지도 격자 좌표 |
| `demo.regionCells` | 방에 대응시킬 지도 구역 `[col0, row0, col1, row1]` |
| `demo.roomSizeM` | 그 구역을 축소해 놓을 방 바닥 크기 `[가로, 세로]` |

### 2.2 숫자 격자 파일 (`*.bin`)

- `Float32Array`, 리틀 엔디언, 길이 `cols * rows`
- 행 우선 순서: 인덱스 `row * cols + col`
- 값이 없는 칸은 `NaN`

### 2.3 이미지 파일 (`*.png`)

- 크기는 `cols x rows` 픽셀의 정수배
- 위쪽이 북쪽

### 2.4 `env.json` — 방사선·대기 시계열

Curiosity 관측 자료에서 뽑은 값입니다. 헤드셋은 이를 데모 시간에 맞춰 순서대로 재생합니다.

```json
{
  "sourceUrls": ["https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/"],
  "radiationIsFixedValue": false,
  "samples": [
    { "sol": 4312, "localTime": "12:00", "radiationUGyPerDay": null, "pressurePa": null, "airTempK": null }
  ]
}
```

- `radiationUGyPerDay`는 필수입니다. RAD 파일에서 뽑지 못하면 발표된 값을 넣고 `radiationIsFixedValue`를 `true`로 둡니다. 상태창은 이때 "발표값"이라고 표시합니다.
- `pressurePa`, `airTempK`는 선택입니다. 대기(REMS) 자료를 확인하지 못했으므로 `null`일 수 있습니다. 상태창은 `null`인 항목을 숨깁니다.

### 2.5 `traverse.json` — Curiosity 실제 주행 경로

NASA 주행 기록에서 지도 범위 안의 정차 지점만 추린 것입니다.

```json
{
  "sourceUrl": "https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json",
  "points": [
    { "sol": 4312, "rmc": "109_120", "lon": 137.4075342, "lat": -4.78681191, "elevM": -3689.67, "tiltDeg": null, "cell": [256, 256] }
  ]
}
```

- `rmc`는 원본의 `RMC` 값(`site_drive`)입니다. 사진과 위치를 잇는 열쇠입니다.
- `cell`은 C가 지도 격자 좌표로 바꿔 넣습니다.
- D는 이 점들을 이어 "Curiosity가 실제로 간 길"로 지도에 그립니다.

### 2.6 `pov.json` — 로버 시점 사진

Curiosity가 그 자리에서 찍은 실제 사진입니다.

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

`rmc`가 `traverse.json`의 점과 같으면 그 자리에서 찍은 사진입니다.

---

## 3. 브라우저 이벤트

웹앱 안에서 모듈끼리 대화하는 방법입니다. B가 `web/src/core/bus.js`에 버스를 만듭니다.

```js
import { bus } from '../core/bus.js';

bus.emit('layer:toggle', { id: 'thermal', visible: true });   // 보내기
bus.on('layer:toggle', ({ id, visible }) => { /* ... */ });   // 받기
```

| 이벤트 | 보내는 쪽 | 받는 쪽 | 언제 |
|---|---|---|---|
| `layers:ready` | B (core) | D, F | `layerset.json`과 파일을 다 읽었을 때 한 번 |
| `layer:toggle` | F, B(음성 전달) | D | 레이어를 켜거나 끌 때 |
| `env:update` | B (core) | F | `env.json`의 다음 표본을 재생할 때 |
| `hazard:update` | A | D, F | 현장 장애물 격자가 바뀔 때 (초당 2회 이하) |
| `nav:request` | F, B(음성 전달) | D | 경로를 요청할 때 |
| `nav:route` | D | F | 경로를 새로 계산했을 때 |
| `telemetry:update` | B (젯슨에서 받음) | F | 슈트 온도가 올 때 (초당 1회) |
| `alert:raise` | B (젯슨에서 받음), D | F, D | 위험이 생겼을 때 |
| `alert:clear` | B (젯슨에서 받음), D | F, D | 위험이 풀렸을 때 |
| `voice:command` | B (젯슨에서 받음) | 전 모듈 | 음성 명령을 알아들었을 때 |
| `voice:say` | 전 모듈 | B (젯슨으로 보냄) | 음성으로 안내할 말이 있을 때 |
| `mode:change` | F | 전 모듈 | 화면 모드가 바뀔 때 |

### payload 형식과 목 데이터

**`layers:ready`**
```json
{ "layerSet": { "...": "layerset.json 내용 그대로" }, "grids": { "topo": "Float32Array", "slope": "Float32Array" }, "traverse": { "...": "traverse.json 내용 그대로" } }
```

**`layer:toggle`**
```json
{ "id": "thermal", "visible": true }
```

**`env:update`**
```json
{ "sol": 4312, "localTime": "12:00", "radiationUGyPerDay": 200, "radiationIsFixedValue": false, "pressurePa": null, "airTempK": null }
```
`pressurePa`와 `airTempK`는 `null`일 수 있습니다. 위의 `200`은 목 데이터용 값입니다.

**`hazard:update`** — 방 좌표 기준 바닥 격자
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
`cells` 값: `0` 지나갈 수 있음, `1` 장애물, `255` 아직 모름. 인덱스는 `row * cols + col`, `originXZ`는 격자 `[0, 0]` 칸의 방 좌표입니다.

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
- `status`: `ok`, `blocked`(길 없음), `arrived`, `cancelled`
- `points`: 방 좌표. 바닥 화살표를 놓을 자리
- `distanceM`: 방 기준 남은 거리

**`telemetry:update`**
```json
{ "suitTempC": 24.5, "source": "arduino", "ts": 1794000000000 }
```
`source`: `arduino` 또는 `mock`

**`alert:raise`**
```json
{ "id": "suit-temp", "level": "critical", "message": "슈트 온도가 위험 수준입니다", "ts": 1794000000000 }
```
- `level`: `warn`(상태창 색만 바뀜) 또는 `critical`(화면 붉은 점멸)
- `id` 목록: `suit-temp`(E), `route-blocked`(D), `radiation`(B가 `env.json` 기준으로 판정), `link-lost`(B, 젯슨 연결 끊김)
- `critical`이 오면 D는 `base`로 가는 경로를 새로 계산합니다.

**`alert:clear`**
```json
{ "id": "suit-temp" }
```

**`voice:command`**
```json
{ "intent": "nav.start", "slots": { "targetId": "site1" }, "text": "조사 지점으로 안내해 줘" }
```
`intent` 목록은 [6장](#6-음성-명령-목록)에 있습니다.

**`voice:say`**
```json
{ "text": "경로를 다시 계산했습니다", "priority": "normal" }
```
`priority`: `normal` 또는 `urgent`(말하던 것을 끊고 먼저 말함)

**`mode:change`**
```json
{ "mode": "emergency" }
```
`mode`: `normal`, `emergency`, `night`(P2), `record`(P2)

---

## 4. 젯슨 ↔ 헤드셋 WebSocket

- 주소: `wss://<젯슨 주소>:8443/ws` (포트는 시작값)
- 글자 메시지는 모두 아래 봉투 형식의 JSON입니다.

```json
{ "type": "telemetry", "ts": 1794000000000, "payload": {} }
```

- 음성 데이터만 바이너리 프레임으로 보냅니다.
- 브라우저에서는 B의 `web/src/core/link.js`만 WebSocket을 엽니다. 다른 모듈은 이벤트 버스만 씁니다.

### 젯슨 → 헤드셋

| type | payload | 브라우저에서 바뀌는 이벤트 |
|---|---|---|
| `telemetry` | `{ "suitTempC": 24.5, "source": "arduino" }` | `telemetry:update` |
| `alert.raise` | `{ "id": "suit-temp", "level": "critical", "message": "..." }` | `alert:raise` |
| `alert.clear` | `{ "id": "suit-temp" }` | `alert:clear` |
| `voice.command` | `{ "intent": "...", "slots": {}, "text": "..." }` | `voice:command` |
| `tts.begin` | `{ "sampleRate": 22050, "priority": "normal" }` | (B가 재생 준비) |
| (바이너리) | 16비트 PCM, 모노 | (B가 재생) |
| `tts.end` | `{}` | (B가 재생 종료) |

### 헤드셋 → 젯슨

| type | payload | 언제 |
|---|---|---|
| `hello` | `{ "client": "quest", "mock": false }` | 연결 직후 |
| `mic.begin` | `{ "sampleRate": 16000 }` | 마이크 전송 시작 |
| (바이너리) | 16비트 PCM, 모노, 16kHz | 말하는 동안 |
| `mic.end` | `{}` | 마이크 전송 끝 |
| `voice.say` | `{ "text": "...", "priority": "normal" }` | 브라우저의 `voice:say`를 그대로 전달 |
| `state` | `{ "mode": "normal", "navStatus": "ok", "targetId": "site1" }` | 상태가 바뀔 때. 음성 비서가 "지금 상황"을 답하는 데 쓴다 |

### 슈트 온도 기준 (시작값)

| 구간 | 결과 |
|---|---|
| 30°C 미만 | 정상 |
| 30°C 이상 | `alert.raise` (`warn`) |
| 35°C 이상 | `alert.raise` (`critical`) |
| 다시 28°C 미만 | `alert.clear` |

데모에서 센서를 손으로 쥐어 올릴 수 있는 온도로 잡은 값입니다. 실제 센서로 재 보고 E가 조정합니다.

---

## 5. 아두이노 → 젯슨 시리얼

- 속도: 115200 baud
- 1초에 한 줄, 줄마다 JSON 하나, 줄 끝은 `\n`

```json
{"temp_c": 24.5}
```

- 센서를 읽지 못하면 `{"temp_c": null, "error": "read_failed"}`
- 젯슨은 5초 동안 줄이 안 오면 `source`를 `mock`으로 바꾸고 로그를 남깁니다.

---

## 6. 음성 명령 목록

E의 명령 해석기가 말을 아래 `intent` 중 하나로 바꿉니다. 목록에 없는 말은 버립니다.

| intent | slots | 예시 문장 | 받는 모듈 |
|---|---|---|---|
| `nav.start` | `{ "targetId": "site1" }` | "조사 지점으로 안내해 줘" | D |
| `nav.home` | `{}` | "기지로 돌아가자" | D |
| `nav.stop` | `{}` | "안내 그만" | D |
| `layer.show` | `{ "id": "thermal" }` | "열 지도 보여 줘" | B → `layer:toggle` |
| `layer.hide` | `{ "id": "thermal" }` | "열 지도 꺼 줘" | B → `layer:toggle` |
| `status.report` | `{}` | "상태 알려 줘" | E가 직접 음성으로 답함 |
| `alert.ack` | `{}` | "경보 확인" | F |
| `mode.set` | `{ "mode": "night" }` | "야간 모드" (P2) | F |

`nav.start`, `nav.home`은 B가 `nav:request`로, `layer.show`·`layer.hide`는 `layer:toggle`로 바꿔 다시 내보냅니다. 그래서 D는 음성인지 UI인지 구분할 필요가 없습니다.
