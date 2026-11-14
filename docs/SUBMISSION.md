# 제출 설명문 초안

> 영문 본문은 제출 양식의 칸 이름 그대로 나눴습니다. 칸마다 그대로 붙여 넣으면 됩니다. 한글 메모는 팀용이고 제출하지 않습니다.

## 제출 규칙 (공식 Project Submission Guide에서 확인, 2026-11-14)

출처: https://www.spaceappschallenge.org/resources/project-submission-guide/

- **마감:** 11월 15일(일) 23:59, 우리 Local Event의 현지 시각. 그 전에 **Submit for Judging**을 눌러야 합니다. 마감 뒤에 저장하거나 제출하면 심사 대상이 아닙니다. 마감 전에는 몇 번이든 고쳐 다시 제출할 수 있습니다.
- **데모는 30초 이하 영상 또는 7장 이하 슬라이드.** 넘으면 Global Judging 대상에서 빠집니다. README의 "1분 데모"는 이 규칙에 맞지 않습니다. → F, 팀 전원 확인 필요
- **영어만.** 제출 페이지와 링크된 자료 모두 영어여야 합니다. 영상에서 한국어로 말하면 영어 자막이 반드시 있어야 합니다. 슬라이드는 영어로만.
- **만 18세 미만의 얼굴·영상·목소리 금지.** 데모와 최종 결과물에 18세 미만인 사람의 모습이나 목소리가 들어가면 안 됩니다. 헤드셋 화면 녹화와 손, 자막 위주로 찍고, 내레이션을 누가 할지 팀에서 정해야 합니다. → F
- **링크는 로그인 없이 열려야 합니다.** 영상·문서는 사이트에 올릴 수 없고 YouTube, GitHub 등의 공개 링크로 냅니다. 이미지는 JPG·PNG·GIF 10MB까지 직접 올릴 수 있습니다.
- **AI 사용 표시.** AI로 만든 이미지·영상에는 보이는 워터마크, 음성·코드·데이터에는 설명 글과 메타데이터에 표시가 필요합니다. AI는 도구로 쓸 수 있지만, 문제를 어떻게 풀지 아이디어 자체를 AI가 내면 안 됩니다. AI로 만든 것에 NASA 로고나 임무 식별 표시를 넣으면 안 됩니다.
- **모든 필수 칸을 채워야 제출됩니다.** 팀원 전원이 같은 Local Event에 확정 등록되어 있어야 수상 대상입니다.
- 심사 기준은 Impact, Creativity, Validity, Relevance, Presentation 다섯 가지입니다. 심사의 대부분은 데모가 아니라 제출 페이지의 글로 이루어집니다.

## 제출 전에 할 것

- [ ] `[TODO]` 표시를 정리한다. 실제로 된 것만 남기고, 안 된 기능은 문장째 지운다.
- [ ] "Use of Super Intelligence" 칸에 팀원별로 쓴 도구와 용도를 적는다.
- [ ] 데모 링크와 최종 결과물 링크를 시크릿 창에서 열어 본다.
- [ ] 프로젝트 이름을 확정한다 (가칭 Marswalk Visor).

수치의 근거: 본문의 숫자는 모두 `data-pipeline/validate.py`가 실제 파일에서 계산한 값입니다(`data-pipeline/validation_report.json`). 파일별 설명은 [DATA.md](DATA.md), 원본 자료 분석은 [RESOURCES.md](RESOURCES.md)에 있습니다.

**조사 지점이 바뀌었습니다.** 황 암석을 발견한 실제 자리(sol 4200, 2024-05-30)는 지도 한가운데(sol 4312 위치)에서 약 102m 떨어져 있습니다. 본문과 데이터는 실제 발견 자리를 조사 지점으로 씁니다. README의 미션 시나리오(sol 4312, 1,001m, 44m)는 이와 다르니 팀에서 맞춰야 합니다. 근거는 [DATA.md](DATA.md) 2장.

---

## Project Name

Marswalk Visor `[TODO: 확정]`

## High-Level Project Summary

**Marswalk Visor** is a helmet heads-up display for an astronaut walking on Mars. It layers data from four NASA Mars missions into one map of a single walkable site, plans a route across it, and then corrects that route with what the helmet sees a few steps ahead.

Orbital maps of Mars are built for regional views. At the scale of a spacewalk they run out of detail: across our 2 km site the best optical image resolves about 0.64 m per pixel, and the thermal image is only 25 pixels wide. NASA's own experience at our site shows the gap. When the Curiosity rover reached a pale patch of ground in Gediz Vallis channel, it found a field of pure sulfur stones that, as JPL reported, had been "too small for MRO's High-Resolution Imaging Science Experiment (HiRISE) to see."

Our display therefore has three layers:

1. **Orbital map** — terrain, slope, optical and thermal data from NASA orbiters, shown as a 3D map that appears above the astronaut's open palm.
2. **Field map** — the helmet's depth sensor finds obstacles the orbital data cannot show, and the route is recalculated around them. `[TODO: 데모에서 되면 남긴다]`
3. **Survival information** — radiation, air pressure and temperature measured by Curiosity at this site, suit temperature, and an emergency mode that redirects the astronaut to base.

It matters because a crew on foot needs one view that joins what orbiters know about a place with what is actually in front of them, without taking their hands off their work.

## Link to Project Demo

`[TODO: 30초 이하 영상 또는 7장 이하 슬라이드의 공개 링크]`

## Link to Final Project

`[TODO: 공개 저장소 또는 배포 주소]`

## Detailed Project Description

### Mission scenario

- **Site:** Gediz Vallis channel on Mount Sharp, Gale Crater. The map is a 2,048 m × 2,048 m square centered at 137.4075°E, 4.7868°S.
- **Science goal:** On May 30, 2024 (mission sol 4200) Curiosity drove over a rock in this channel and cracked it open, revealing crystals of pure elemental sulfur, the first found on Mars. Scientists do not yet know why it formed there. In our scenario a crew returns on foot to survey the sulfur field more widely than a rover could.
- **Survey site:** the spot where Curiosity ended that sol-4200 drive (137.4089°E, 4.7857°S). The rover stayed around this spot for the following weeks to study the sulfur stones.
- **Base:** where Curiosity stood on sol 4098, 358 m away in a straight line and 45 m lower.
- **Route:** from base to the survey site. Curiosity itself drove 593 m between these two points, so our planned route can be compared with a path a real vehicle took.

We chose a site Curiosity explored so that orbital data, ground-truth positions, radiation and weather measurements, and surface photos all exist for the same place. Every point in the scenario is a position from NASA's rover record, not a guess on the map.

### What it does

- **Palm map.** Raising the left palm shows the 3D terrain of the site. The astronaut switches between optical, thermal and slope layers. Curiosity's actual path is drawn on the map in its own color.
- **Route.** The route is computed from the slope layer, so it bends around steep ground, and is drawn as arrows on the floor. `[TODO: 팀이 정한 경사 기준과 근거]`
- **Field obstacles.** `[TODO]` When the depth sensor finds an obstacle on the route, that cell is marked blocked and the route is recomputed. In the demo a chair stands in for a boulder.
- **Safety.** A status panel shows radiation, air pressure and temperature, suit temperature, elevation and the geologic unit. When the suit temperature sensor crosses its limit, the edges of the view flash red and the route changes to lead back to base.
- **Destination preview.** `[TODO]` Near the survey site the display shows the photo Curiosity took from that exact spot, so the astronaut knows what to expect on arrival.
- **Voice.** `[TODO]` Spoken commands such as "guide me to the survey site" are recognized on a Jetson computer, which also reads status aloud.

Everything is controlled by a palm gesture and voice, because gloved hands cannot press buttons.

### How it works

A Python pipeline downloads the NASA data, cuts every source to the same map area, and resamples it onto one shared 512 × 512 grid (4 m cells). The headset loads these prepared files; it does not download raw data during the walk. The app is a WebXR page built with Three.js and runs in the browser of a Meta Quest 3 headset, which stands in for the helmet. A Jetson computer reads an Arduino temperature sensor (standing in for a suit sensor) and handles voice. `[TODO: 실제로 쓴 것만 남긴다]`

The room we walk in represents a scaled-down patch of the Martian surface. We state this at the start of the demo.

### Benefits and what we hope to achieve

- One view of a walkable site that combines five kinds of NASA data instead of separate regional maps.
- A route that is planned from orbital data and checked against a path a real rover drove.
- An honest picture of where orbital data stops being enough, and a way to fill that gap in the field.

### Tools

Python (NumPy, Rasterio, Pillow), JavaScript, Three.js, WebXR, Vite, Meta Quest 3, NVIDIA Jetson, Arduino. `[TODO: 실제로 쓴 것만]`

## Use of Super Intelligence (SI)

`[TODO: 팀원별로 실제 사용한 도구와 용도를 적는다. 아래는 형식 예시.]`

- AI coding assistants (`[tool names]`) were used to write and debug code, including the data pipeline, and to draft documentation and this description. The project idea, the choice of site and the design decisions were made by the team.
- AI-assisted code is marked in the repository's commit messages.
- No AI-generated images or video appear in the project. `[TODO: 음성 합성(TTS)을 쓰면 여기에 적고, 영상 설명에도 표시한다]`
- All NASA data values shown in the project come from the sources listed below, not from AI.

## NASA Data

| Layer | Kind | Mission · Instrument | Source | How we use it |
|---|---|---|---|---|
| Terrain elevation | topographic | MRO (HiRISE, CTX), MGS (MOLA) | USGS "Mars MSL Gale Merged DEM 1m" | 3D terrain; basis for slope |
| Slope | derived | same as above | computed from the terrain | cost for route planning |
| Optical image | optical | MRO · HiRISE | JPL Mars Trek, `curiosity_hirise_mosaic` | surface texture on the map |
| Thermal image (night) | thermal | Mars Odyssey · THEMIS | JPL Mars Trek, `THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018` | map layer |
| Rover path | ground truth | MSL Curiosity | NASA `MSL_waypoints.json` | route check; elevation check |
| Radiation | radiation | MSL Curiosity · RAD | Planetary Data System, RAD RDR, sol 4200 | status panel, alert |
| Air pressure and temperature | atmospheric | MSL Curiosity · REMS | Planetary Data System, REMS MODRDR, sol 4200 | status panel |
| Rover photos | optical (surface) | MSL Curiosity · Navcam | NASA Curiosity raw images, sols 4098 and 4200 | point-of-view photos at base and at the destination |
| Geologic unit | geologic | USGS SIM 3292 (via Mars Trek) | global geologic map | one line in the legend: unit `Htu` |

This gives five kinds of data from the challenge's list (topographic, optical, thermal, radiation, atmospheric) plus geology, from four NASA missions (MRO, Mars Odyssey, MGS, MSL Curiosity).

**What we did with the data**

- **Optical:** 182 HiRISE tiles joined into one image covering the map area.
- **Terrain:** the source file is 3.6 GB at 1 m resolution. We read only our 2,048 m window, averaged it to 4 m cells, and computed slope. Elevation in the map area ranges from −3,846.6 m to −3,412.1 m.
- **Rover path:** 178 of Curiosity's stops (sols 3880–4493) fall inside the map area.
- **Radiation:** from the RAD file for sol 4200, the day of the sulfur discovery, we took the dose rate of the E detector (plastic scintillator) for each of 86 observations and averaged them by hour of local solar time. The daily mean is 154 µGy per day; hourly values range from 152 to 157.
- **Atmosphere:** from the REMS file for the same sol, hourly means of air pressure (800–889 Pa) and estimated ambient air temperature (206–268 K).
- **Rover photos:** Left Navigation Camera images taken at the base position and at the survey site. Each image's site and drive numbers match the rover-path record for that position, so the photo shows what is actually visible from that point on the map. In the survey-site photo, bright stones lie in the foreground.
- **Checking the layers against each other:** layers from different sources can be shifted against each other, so we tested them with Curiosity's path.
  - At the 178 stops, the terrain elevation differs from the rover's recorded elevation by −0.17 m on average (standard deviation 0.24 m). Shifting the terrain sideways by up to 20 m in any direction only makes the match worse.
  - Shading computed from the terrain lines up with the optical image to within one 4 m grid cell.
  - On the ground Curiosity stood on, our slope layer has a median of 8.8°, close to the rover's own recorded median tilt of 9.1°.
  - The weather record behaves as expected: temperature peaks in the early afternoon, and radiation rises when air pressure falls (correlation −0.74), as it should when there is less atmosphere overhead.
- **Reproducibility:** one script rebuilds every data file from the NASA sources, and a second script runs 53 checks on the result. Rebuilding from an empty cache gives byte-identical files.

**Limits we want to be clear about**

- The optical and thermal sources are grayscale. Any color on the map is our display choice, not measured color.
- The thermal image is about 81 m per pixel, so it is only 25 pixels across our map, and its brightness is relative, not a temperature. We show it as it is: it demonstrates how coarse orbital data becomes at walking scale.
- The global geologic map shows our whole site as a single unit, so it informs the legend, not the route.
- The radiation and weather values are a recording of one Martian day (sol 4200, May 30, 2024) replayed during the demo, not a live feed or a forecast. The radiation values are the instrument's reported dose rates; we excluded two observations flagged for possible quality issues and applied no further correction. The time stamps of the radiation and weather files may differ by up to about 50 minutes.
- We do not know the exact position of the rock Curiosity cracked open. Our survey site is where the rover ended its 9 m drive that day, so the rock lies within about 9 m of it.
- The terrain and slope layers describe the ground at a scale of several meters. Rocks and ledges smaller than that do not appear in them.
- The rover's tilt record describes what a rover handled. It is not a standard for what a suited person can walk.

## Space Agency Partner Data and Other References

**Space Agency Partner data**

- **ESA (European Space Agency) — Mars Express · HRSC:** the USGS terrain file we use was built from HiRISE, CTX and HRSC elevation models tied to MOLA, so it includes ESA data. The file is produced and distributed by USGS.

**Non-NASA inputs:** only two — the headset's depth sensor and an Arduino temperature sensor standing in for a suit sensor. Both act on top of the map and route made from NASA data.

**References**

- JPL Mars Trek — https://trek.nasa.gov/mars/
- USGS Astrogeology, Mars MSL Gale Merged DEM 1m — https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m
- NASA MSL Curiosity waypoints — https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json
- MSL RAD Reduced Data Records, Planetary Data System — https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/
- MSL REMS data, Planetary Data System — https://atmos.nmsu.edu/PDS/data/mslrem_1001/
- NASA Curiosity raw images — https://mars.nasa.gov/msl/multimedia/raw-images/
- USGS SIM 3292, Geologic Map of Mars — https://pubs.usgs.gov/publication/sim3292
- NASA JPL, "NASA's Curiosity Rover Discovers a Surprise in a Martian Rock" (July 18, 2024) — https://www.jpl.nasa.gov/news/nasas-curiosity-rover-discovers-a-surprise-in-a-martian-rock/
- NASA JPL, "NASA's Curiosity Mars Rover Takes a Last Look at Mysterious Sulfur" (Nov. 18, 2024) — https://www.jpl.nasa.gov/news/nasas-curiosity-mars-rover-takes-a-last-look-at-mysterious-sulfur/
- NASA, Curiosity's Proposed Path up Mount Sharp — https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/
- Software: Three.js, Vite, NumPy, Rasterio, Pillow `[TODO: 실제 쓴 것만, 라이선스 확인]`
