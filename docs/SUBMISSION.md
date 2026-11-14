# 제출 설명문 초안

> 영문 본문은 제출 양식에 그대로 붙여 넣을 수 있게 썼습니다. 한글 메모는 팀용이고 제출하지 않습니다.

## 제출 전에 확인할 것

- [ ] **제출 양식의 항목과 글자 수 제한.** 공식 사이트(spaceappschallenge.org) 접속이 인증서 오류로 실패해 2026년 양식을 확인하지 못했습니다. 아래 항목 구성은 지난 대회 양식(요약, 데모 링크, 프로젝트 링크, 상세 설명, NASA 데이터, 그 밖의 데이터, AI 사용, 참고 자료)을 따른 것입니다. 팀 페이지에 로그인해 실제 항목과 맞춰 봅니다.
- [ ] **`[TODO]` 표시.** 아직 만들지 않았거나 수치가 없는 부분입니다. 제출 직전에 실제로 된 것만 남기고, 안 된 기능은 문장째 지웁니다.
- [ ] **방사선 값.** 지금 `env.json`은 발표값(200 µGy/일)입니다. RAD 파일에서 뽑으면 4장의 방사선 줄을 고칩니다.
- [ ] **AI 사용 고지.** 팀원마다 쓴 도구를 6장에 적습니다.
- [ ] 프로젝트 이름(가칭 Marswalk Visor), 데모 영상 링크, 저장소 링크.

수치의 근거: 레이어 수치는 `data-pipeline/build_data.py`를 돌려 나온 값이고, 좌표와 자료 규격은 [RESOURCES.md](RESOURCES.md)에서 가져왔습니다.

---

## 1. High-Level Project Summary

**Marswalk Visor** is a helmet heads-up display for an astronaut walking on Mars. It layers data from four NASA Mars missions into one map of a single walkable site, plans a route across it, and then keeps that route honest with what the helmet sees a few steps ahead.

Orbital maps of Mars are built for regional views. At the scale of a spacewalk they run out of detail: across our 2 km site the best optical image resolves about 0.64 m per pixel, and the thermal image is only 25 pixels wide. A rock at the astronaut's feet is invisible from orbit. Our display therefore has three layers:

1. **Orbital map** — terrain, slope, optical and thermal data from NASA orbiters, shown as a 3D map that appears above the astronaut's open palm.
2. **Field map** — the helmet's depth sensor finds obstacles the orbital data cannot show, and the route is recalculated around them. `[TODO: keep only if working in the demo]`
3. **Survival information** — radiation measured by Curiosity at this site, suit temperature, and an emergency mode that redirects the astronaut to base.

The astronaut controls everything with a palm gesture and voice, because gloved hands cannot press buttons. We built the prototype on a Meta Quest 3 headset standing in for the helmet.

## 2. Mission Scenario

- **Site:** Gediz Vallis channel on Mount Sharp, Gale Crater (137.4075°E, 4.7868°S). NASA's Curiosity rover stood at this point on sol 4312.
- **Science goal:** Curiosity found rocks made of pure elemental sulfur in this channel. In our scenario a crew returns on foot to survey the sulfur field more widely than a rover could.
- **Map area:** a 2,048 m × 2,048 m square centered on that point.
- **Route:** from a base placed where Curiosity was on sol 4098 to the sulfur site. Curiosity itself covered this stretch in about 1,001 m of driving while climbing 44 m, so we can compare our planned route with a path a real vehicle took.

We chose a site Curiosity explored so that orbital data, ground-truth positions, radiation measurements and surface photos all exist for the same place.

## 3. How It Works

**Data preparation.** A Python pipeline downloads the NASA data, cuts every source to the same map area, and resamples it onto one shared 512 × 512 grid (4 m cells). The headset loads these prepared files; it does not download raw data during the walk.

**Palm map.** Raising the left palm shows the 3D terrain. The astronaut switches between optical, thermal and slope layers. Curiosity's actual path is drawn on the map in a separate color.

**Route.** The route is computed from the slope layer, so it bends around steep ground, and is drawn as arrows on the floor. `[TODO: state the slope limit the team chose and why]`

**Field obstacles.** `[TODO]` When the depth sensor finds an obstacle on the route, that cell is marked blocked and the route is recomputed. In the demo, a chair stands in for a boulder.

**Safety.** The status panel shows radiation, suit temperature, elevation and the geologic unit. When the suit temperature sensor crosses its limit, the edges of the view flash red and the route changes to lead back to base.

**Voice.** `[TODO]` Spoken commands such as "guide me to the survey site" are recognized on a Jetson computer, which also reads status back aloud.

**Demo space.** The room we walk in represents a scaled-down patch of the Martian surface. We state this at the start of the demo.

## 4. NASA Data

| Layer | Kind | Mission · Instrument | Source | How we use it |
|---|---|---|---|---|
| Terrain elevation | topographic | MRO (HiRISE, CTX), MGS (MOLA) | USGS "Mars MSL Gale Merged DEM 1m" | 3D terrain; basis for slope |
| Slope | derived | same as above | computed from the terrain | cost for route planning |
| Optical image | optical | MRO · HiRISE | JPL Mars Trek, `curiosity_hirise_mosaic` | surface texture on the map |
| Thermal image (night) | thermal | Mars Odyssey · THEMIS | JPL Mars Trek, `THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018` | map layer |
| Rover path | ground truth | MSL Curiosity | NASA `MSL_waypoints.json` | route check; elevation check |
| Radiation | radiation | MSL Curiosity · RAD | published RAD results `[TODO: or PDS RAD files]` | status panel, alert |
| Geologic unit | geologic | USGS SIM 3292 (via Mars Trek) | global geologic map | one line in the legend: unit `Htu` |
| Rover photos | optical (surface) | MSL Curiosity | NASA raw images `[TODO]` | point-of-view photo at the destination |

This gives more than three kinds of data (topographic, optical, thermal, radiation, geologic) from four NASA missions (MRO, Mars Odyssey, MGS, MSL Curiosity).

**What we did with the data**

- **Optical:** 182 HiRISE tiles joined into one image covering the map area.
- **Terrain:** the source file is 3.6 GB at 1 m resolution. We read only our 2,048 m window, averaged it to 4 m cells, and computed slope. Elevation in the map area ranges from −3,846.6 m to −3,412.1 m.
- **Rover path:** 178 of Curiosity's stops (sols 3880–4493) fall inside the map area.
- **Checking alignment:** layers from different sources can be shifted against each other, so we tested them with Curiosity's path. At the 178 stops, the terrain elevation differs from the rover's recorded elevation by −0.17 m on average (standard deviation 0.24 m), and the path follows the channel in both the optical image and the terrain. On the ground Curiosity stood on, our slope layer has a median of 8.8°, close to the rover's own recorded median tilt of 9.1°.

**Limits we want to be clear about**

- The optical and thermal sources are grayscale. Any color on the map is our display choice, not measured color.
- The thermal image is about 81 m per pixel, so it is only 25 pixels across our map, and its brightness is relative, not a temperature. We show it as it is: it demonstrates how coarse orbital data becomes at walking scale, which is the gap the helmet sensor fills.
- The global geologic map shows our whole site as a single unit, so it informs the legend, not the route.
- The radiation value is a fixed published figure for Gale Crater (about 200 µGy per day, within the reported 180–225 µGy range), not a live reading. `[TODO: update if extracted from RAD files]`
- The rover's tilt record describes what a rover handled. It is not a standard for what a suited person can walk.

## 5. Space Agency Partner & Other Data

- **ESA Mars Express · HRSC:** the USGS terrain file we use was built from HiRISE, CTX and HRSC elevation models tied to MOLA, so it includes ESA data. The file is produced and distributed by USGS.
- **Non-NASA inputs:** only two — the headset's depth sensor and an Arduino temperature sensor standing in for a suit sensor. Both act on top of the map and route made from NASA data.

## 6. Use of Artificial Intelligence

`[TODO: 팀원별로 실제 사용한 도구와 용도를 적는다. 아래는 형식 예시.]`

- AI coding assistants (`[tool names]`) were used to write and debug code, including the data pipeline, and to draft documentation and this description.
- No AI-generated images, video or audio appear in the project. `[TODO: 음성 합성(TTS)을 쓰면 여기에 적는다]`
- All NASA data values shown in the project come from the sources listed above, not from AI.

## 7. References

- JPL Mars Trek — https://trek.nasa.gov/mars/
- USGS Astrogeology, Mars MSL Gale Merged DEM 1m — https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m
- NASA MSL Curiosity waypoints — https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json
- MSL RAD data, Planetary Data System — https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/
- Radiation at Gale Crater (published values) — https://pmc.ncbi.nlm.nih.gov/articles/PMC8981195 `[TODO: 원문에서 수치 확인]`
- USGS SIM 3292, Geologic Map of Mars — https://pubs.usgs.gov/publication/sim3292
- NASA, Curiosity's Proposed Path up Mount Sharp — https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/
- JPL, Curiosity and the sulfur stones of Gediz Vallis — https://www.jpl.nasa.gov/news/nasas-curiosity-mars-rover-takes-a-last-look-at-mysterious-sulfur/ `[TODO: 원문 확인]`
- Curiosity raw images — https://mars.nasa.gov/msl/multimedia/raw-images/ `[TODO: 사진을 쓰면 남긴다]`
- Software: Three.js, WebXR, Vite, Python (NumPy, Rasterio, Pillow) `[TODO: 실제 쓴 것만]`
