# 리소스 분석

챌린지 Resources 탭에 공개된 자료 5개를 직접 접속해 확인한 결과입니다. 확인일은 2026-11-13입니다.

**표기 규칙**

- **[직접 확인]**: 이 문서를 만든 환경에서 해당 주소에 접속해 응답을 읽었습니다.
- **[검색 요약]**: 검색 결과 요약으로만 확인했습니다. 원문은 열어 보지 못했습니다.
- **[확인 못함]**: 모릅니다.

## 한눈에 보기

- **탐사 지점**: 게일 크레이터 샤프산의 **게디즈 발리스(Gediz Vallis) 수로**로 정했습니다. 원문 예시인 박스워크와 겹치지 않습니다.
- **쓸 수 있는 레이어는 6종 이상**이고, 서로 다른 임무 4개에서 나옵니다 (MRO, Mars Odyssey, MGS, MSL Curiosity).
- **걸어서 다니는 규모에서 선명한 것은 HiRISE 지형과 광학뿐입니다.** 열 영상은 약 100m, 지질도는 지점 전체가 한 단위입니다. 이 한계가 원문이 말한 빈틈이고, 헬멧 센서가 필요한 이유입니다.
- **Curiosity가 실제로 지나간 길과 사진을 좌표로 얻을 수 있습니다.** 우리 경로를 검증하고, 지도 위에 실제 화성 사진을 꽂는 데 씁니다.
- **지형 높이 값은 Mars Trek 타일로는 얻을 수 없습니다.** USGS의 3.6GB 파일에서 잘라 내야 합니다.

---

## 1. Resources 탭 원문

팀장이 준 화면에서 옮겼습니다.

| # | 리소스 | 원문 설명 |
|---|---|---|
| R1 | Jet Propulsion Laboratory's (JPL) Mars Trek | "NASA web-based portal for exploration of Mars, showcases data collected by NASA at various landing sites." |
| R2 | USGS-NASA Planetary Geologic Mapping Program | "High-quality standardized geologic map of Mars" |
| R3 | Example of a route map visual for the Curiosity example mentioned above | "This animation shows a proposed route for NASA's Curiosity rover, which is climbing lower Mount Sharp on Mars. The annotated version of the map labels different regions that scientists working with the rover would like to explore in coming years. A flyover video explains them in more detail." |
| R4 | NASA Worldview | "Visually explore the past and the present of this dynamic planet from a satellite's perspective. Select from an array of stories below to learn more about Worldview (a part of NASA Earthdata), the satellite imagery we provide and events occurring around the world." |
| R5 | Mars Perseverance Raw Images Gallery | "Over 1 million images captured by the rover on its journey across the Mars surface." |

탭 상단의 주의 문구: "For non-U.S. Government websites, participants must comply with any data use parameters of that specific website." NASA·USGS가 아닌 사이트의 자료를 쓸 때는 그 사이트의 이용 조건을 따라야 합니다.

---

## 2. 리소스별 분석

### R1. Mars Trek — 우리 지도의 주 공급원

주소: https://trek.nasa.gov/mars/

- **지도 타일을 주소만으로 받을 수 있습니다.** WMTS 방식이고 로그인이 없습니다. [직접 확인]
- **브라우저에서 바로 불러올 수 있습니다.** 타일 응답에 `Access-Control-Allow-Origin: *`가 붙어 있습니다. [직접 확인]
- **등록된 자료는 225개**이고, 그중 39개가 우리 지점을 덮습니다. [직접 확인]
- 타일은 256×256 PNG입니다. [직접 확인]

우리 지점(동경 137.40°, 남위 4.75°)을 덮는 레이어 중 쓸 만한 것:

| 종류 (Q4) | 레이어 ID | 임무 · 장비 | 최대 확대 시 해상도 | 판단 |
|---|---|---|---|---|
| 광학 | `curiosity_hirise_mosaic` | MRO · HiRISE | 약 0.64 m/px | **주 레이어.** 바위가 보이는 수준 |
| 광학 | `Gale_CTX_BlockAdj_dd` | MRO · CTX | 약 10 m/px | 넓은 범위 배경용 |
| 지형 | `Gale_DEM_SMG_1m` | MRO · HiRISE | 약 2.5 m/px | **그림으로만 쓸 수 있음.** 아래 주의 참고 |
| 열 | `THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018` | Mars Odyssey · THEMIS | 약 81 m/px | 쓸 수 있으나 흐림 |
| 열 | `THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018` | Mars Odyssey · THEMIS | 약 81 m/px | 쓸 수 있으나 흐림 |
| 열 | `TES_Thermal_Inertia` | MGS · TES | 약 20 km/px | 걷는 규모에서는 쓸모없음 |
| 지질 | `SIM3292_Global_Geology` | USGS 전 지구 지질도 | 약 20 m/px (타일) | 지점 전체가 한 단위. 설명용 |
| 지형 | `mola128_mola64_merge_90Nto90S_SimpleC_clon0` | MGS · MOLA | 약 1.3 km/px | 전 지구 배경용 |

해상도는 WMTS 설정의 최대 확대 단계에서 계산한 값입니다 (256px 타일, 화성 반지름 3,396,190m).

**주의: Trek의 지형 타일에서는 높이 값을 얻을 수 없습니다.** `Gale_DEM_SMG_1m` 타일은 8비트 회색 그림입니다. 표본 타일 하나(가로 약 650m)의 밝기 범위가 32~40, 즉 8단계뿐이었습니다. 경사도 계산에는 못 씁니다. 높이 값은 아래 "지형 높이 파일"에서 얻어야 합니다. [직접 확인]

**광학·열 타일은 8비트 회색조입니다.** 표본 타일 6장이 모두 회색+투명도 형식(지질도만 색상표)이었습니다. [직접 확인] 그대로 쓰면 지도가 흑백입니다.

- 광학: 색을 입힐지는 HUD 디자인(F)에서 정합니다. 화성답게 붉은 계열을 입히는 것은 사실을 꾸미는 것이 아니라 표현 선택이지만, **발표에서 원본이 회색조라고 밝힙니다.**
- 열: 밝기는 온도 값이 아니라 상대적인 밝기입니다. "몇 도"로 표시할 수 없고, 경로 계산에 수치로 넣을 수도 없습니다. 열 레이어는 보여 주기용입니다.

타일 주소 형식 [직접 확인]:

```
https://trek.nasa.gov/tiles/Mars/EQ/{레이어 ID}/1.0.0/default/default028mm/{확대}/{행}/{열}.png

열 = floor((경도 + 180) / 360 × 2^(확대+1))
행 = floor((90 − 위도) / 180 × 2^확대)
```

레이어 목록 전체는 다음 주소에서 JSON으로 받습니다 [직접 확인]:

```
https://trek.nasa.gov/mars/TrekServices/ws/index/eq/searchItems?start=0&rows=2147483647&facetKeys=itemType&facetValues=product
```

레이어별 설정은 `https://trek.nasa.gov/tiles/Mars/EQ/{레이어 ID}/1.0.0/WMTSCapabilities.xml`에 있습니다.

### R2. USGS-NASA Planetary Geologic Mapping Program — 설명용으로만

주소: https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars

- 페이지는 대화형 지도 모음입니다. 내용이 스크립트로 그려져 목록 전체는 읽지 못했습니다. [확인 못함]
- 전 지구 지질도(SIM 3292)는 Mars Trek에 레이어로도 올라와 있고, 좌표로 지질 단위를 조회할 수 있습니다. [직접 확인]
- **우리 지점의 지질 단위는 `Htu` (Hesperian transition undivided unit)입니다.** [직접 확인]
- 이 지도는 1:2,000만 축척입니다 ([USGS SIM 3292](https://pubs.usgs.gov/publication/sim3292), 검색 요약). 걷는 규모에서는 지점 전체가 한 단위로 나와 길 찾기에는 도움이 안 됩니다.

쓰임새: 지도 범례에 "이곳의 지질 단위" 한 줄로 넣습니다. 서로 다른 출처를 하나 더 겹쳤다는 근거가 됩니다.

### R3. Curiosity's Proposed Path up Mount Sharp — 디자인 참고

주소: https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/

- 내려받을 수 있는 것은 1041×586 크기의 GIF 한 장(2.86MB)입니다. 데이터 파일이 아닙니다. [직접 확인]
- 이 지도가 어떤 데이터로 만들어졌는지 페이지에 적혀 있습니다. [직접 확인]

  > "Data used in creating this map came from several instruments on NASA's Mars Reconnaissance Orbiter (MRO), including the High Resolution Imaging Science Experiment (HiRISE), Compact Reconnaissance Imaging Spectrometer for Mars (CRISM) and the Context Camera (CTX). The High Resolution Stereo Camera (HRSC) instrument on the European Space Agency's Mars Express also contributed data."

쓰임새: NASA가 직접 만든 "경로 지도"의 본보기입니다. 우리 지도의 구역 표시와 경로 그리는 방식을 여기서 참고합니다. 같은 장비(HiRISE, CTX)의 데이터를 우리도 씁니다.

### R4. NASA Worldview — 화성 데이터 아님

주소: https://worldview.earthdata.nasa.gov/

- 페이지 설명: "Interactive interface for browsing full-resolution, global, daily satellite images. Supports time-critical application areas such as wildfire management, air quality measurements, and weather forecasting." [직접 확인]
- 지구 관측 영상을 보는 도구입니다. 화성 레이어가 있는지는 확인하지 못했습니다. [확인 못함]

쓰임새: 데이터 출처가 아니라 화면 구성 참고용입니다. 원문도 "Look at how NASA missions to destinations other than Mars—Earth, the Moon, other planets in our solar system, and exoplanets in other systems—have created this type of map, for inspiration"이라고 했습니다. 레이어를 켜고 끄는 방식과 범례 표시를 참고합니다.

### R5. Mars Perseverance Raw Images Gallery — 지점이 다름

주소: https://mars.nasa.gov/mars2020/multimedia/raw-images/

- JSON으로 사진 목록을 받을 수 있습니다. 응답의 전체 사진 수는 1,055,868장입니다. [직접 확인]
- 사진마다 촬영 sol, 카메라, 크기별 이미지 주소가 들어 있습니다. [직접 확인]
- **Perseverance는 게일 크레이터에 없습니다.** 이 사진들은 우리 지점의 풍경이 아닙니다.

우리 지점의 사진은 **Curiosity 원본 사진**에서 얻습니다. Resources 탭에는 없지만 같은 NASA 사이트의 같은 종류 자료입니다.

- 주소: `https://mars.nasa.gov/api/v1/raw_image_items/?order=sol+desc&per_page=50&page=0&condition_1=msl:mission&condition_2={시작 sol}:sol:gte&condition_3={끝 sol}:sol:lte&search={카메라 이름}` [직접 확인]
- 전체 1,518,427장입니다. [직접 확인]
- **사진을 지도 좌표에 꽂을 수 있습니다.** 사진의 `site`·`drive` 값이 아래 주행 기록의 `RMC` 값과 맞물립니다. 예: sol 4312의 내비게이션 카메라 사진은 `site 109, drive 120`이고, 주행 기록의 `RMC 109_120`은 동경 137.4075°, 남위 4.7868°입니다. [직접 확인]

---

## 3. Resources 탭 밖에서 찾은 NASA 데이터

### 지형 높이 파일 (USGS)

- 이름: Mars MSL Gale Merged DEM 1m ([USGS 페이지](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m)) [직접 확인]
- 파일: `https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif`, 3.6GB [직접 확인: 주소와 크기. 파일 자체는 내려받지 않음]
- 규격 (라벨 파일에서) [직접 확인]:

| 항목 | 값 |
|---|---|
| 크기 | 32,980 × 57,440 픽셀 |
| 해상도 | 1.0 m/픽셀 |
| 값 형식 | 실수 (높이, 미터) |
| 범위 | 동경 137.1242° ~ 137.6806°, 남위 5.0987° ~ 4.1296° |
| 투영 | Equirectangular, 중심 위도 0°, 반지름 3,396,190m |

- 만든 방법: "The DEM is built up from High Resolution Stereo Camera (HRSC), Mars Reconnaissance Orbiter (MRO) Context Camera (CTX), and High Resolution Imaging Science Experiment (HiRISE) DEMs all tied to a Mars Orbiter Laser Altimeter (MOLA) DEM." [직접 확인]
- **파일 전체를 받지 않고 일부만 잘라 받을 수 있는지는 확인하지 못했습니다.** [확인 못함] 안 되면 3.6GB를 한 번 받아야 합니다. 해커톤 시작 직후 가장 먼저 걸어 둘 다운로드입니다.

### Curiosity 주행 기록 (NASA)

- 주소: `https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json` (약 0.66MB) [직접 확인]
- 경로선: `https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_traverse.json` (약 1.36MB) [직접 확인]
- 내용: sol 3부터 5070까지 정차 지점 1,388개. 지점마다 경도, 위도, 높이, 로버 기울기, 누적 주행 거리가 있습니다. [직접 확인]
- 전체 범위: 동경 137.3528° ~ 137.4494°, 남위 4.8257° ~ 4.5891°, 높이 −4521.3m ~ −3473.7m, 누적 38,610m [직접 확인]
- 1,388개 지점 모두 위 지형 파일과 HiRISE 광학 레이어 범위 안에 있습니다. [직접 확인]

쓰임새가 큽니다.

1. **경로 검증**: 우리가 계산한 경로를 Curiosity가 실제로 간 길과 나란히 보여 줍니다.
2. **통행 기준**: 로버가 실제로 견딘 기울기를 통행 가능 기준의 근거로 씁니다. 전체 기록에서 기울기 중앙값 7.7°, 상위 10% 14.7°, 최대 29.1°입니다. 다만 이는 로버 차체의 기울기이고, 사람이 걸을 수 있는 경사의 기준은 아닙니다.
3. **사진 위치**: 위 R5의 사진을 좌표에 꽂는 열쇠입니다.

### 방사선 (Curiosity RAD)

- 주소: https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/ [직접 확인]
- sol 구간별 폴더로 나뉘어 있고, 가장 최근 폴더는 `SOL_04710_04843`입니다. 우리 지점을 지난 시기(`SOL_04258_04354`)도 있습니다. [직접 확인]
- 형식: "The RDR files are in ASCII format." 다만 "The RDR data are NASA Level 1A data that mirror the raw instrument data obtained from telemetry"라고 적혀 있습니다. [직접 확인]
- **이 파일에서 선량률 값을 뽑는 데 얼마나 걸릴지는 확인하지 못했습니다.** [확인 못함] 원시 자료에 가까워 해석 문서(SIS)를 읽어야 합니다.
- 대안: 발표된 값을 고정값으로 씁니다. 게일 크레이터의 은하 우주선 선량률은 하루 약 180~225 µGy로 보고되어 있습니다 ([논문](https://pmc.ncbi.nlm.nih.gov/articles/PMC8981195), 검색 요약).

### 대기 (Curiosity REMS)

- 주소: https://atmos.nmsu.edu/data_and_services/atmospheres_data/MARS/curiosity/rems.html
- **접속에 실패했습니다** (이 환경에서 인증서 검증 오류). [확인 못함]
- 기압과 온도가 들어 있고 sol 1~3778을 다룬다는 것은 검색 요약으로만 확인했습니다. [검색 요약] 우리 지점을 지난 시기(sol 4100~4350)가 포함되는지는 모릅니다.

---

## 4. 탐사 지점: 게디즈 발리스 수로

### 왜 여기인가

- 원문 예시(박스워크)와 겹치지 않습니다.
- R3의 경로 지도에 나오는 구역입니다. 과학자들이 탐사하고 싶어 한 곳으로 꼽혔습니다 ([USGS 기사](https://www.usgs.gov/news/new-msl-video-fly-over-mount-sharp-mars), 검색 요약).
- Curiosity가 2024년에 실제로 다녀가 사진과 주행 기록이 있습니다.
- 과학 목표가 분명합니다. Curiosity가 이곳에서 순수한 황으로 된 돌을 발견했습니다 ([JPL](https://www.jpl.nasa.gov/news/nasas-curiosity-mars-rover-takes-a-last-look-at-mysterious-sulfur/), 검색 요약).

### 좌표

| 항목 | 값 | 근거 |
|---|---|---|
| 수로 안 기준점 | 동경 137.4075°, 남위 4.7868°, 높이 −3689.7m | 주행 기록 sol 4312 [직접 확인] |
| 그 지점이 수로 안이라는 근거 | sol 4311~4312에 수로 안 파노라마 촬영 | [JPL PIA26410](https://www.jpl.nasa.gov/images/pia26410-curiositys-view-within-gediz-vallis-channel/), 검색 요약 |
| 수로를 떠난 시점 | sol 4352 (2024-11-02) | [검색 요약](https://astrobiology.com/2024/11/19/mars-rover-curiosity-panorama-of-gediz-vallis-channel/) |
| 수로에 들어간 시점 | 모름 | [확인 못함] |

### 지도 범위 (제안)

기준점을 가운데 둔 2,048m × 2,048m 정사각형입니다.

- 동경 137.39026° ~ 137.42481°, 남위 4.80409° ~ 4.76954°
- 지형 파일과 HiRISE 광학 레이어 범위 안에 완전히 들어갑니다. [직접 확인]
- 이 안에 Curiosity 정차 지점이 178개 있습니다 (sol 3880 ~ 4493, 높이 −3808.2m ~ −3673.3m). [직접 확인]
- 이 구간의 로버 기울기: 중앙값 9.1°, 상위 10% 15.7°, 최대 22.4° [직접 확인]

참고 경로: Curiosity는 sol 4098에서 4312까지 약 1,001m를 주행하며 44m를 올라갔습니다 (−3733.6m → −3689.7m). [직접 확인] 우리 미션의 "기지 → 조사 지점" 구간으로 삼기에 알맞은 길이입니다.

### 이 범위에서 레이어가 얼마나 선명한가

| 레이어 | 2,048m를 가로지르는 픽셀 수 | 필요한 타일 수 |
|---|---|---|
| HiRISE 광학 | 약 3,220 | 182 |
| 지형 (USGS 파일, 1m) | 2,048 | (파일에서 잘라 냄) |
| CTX 광학 | 약 201 | 4 |
| THEMIS 열 | 약 25 | 1 |

**열 영상은 지도 전체에 25픽셀뿐입니다.** 겹치면 큰 모자이크처럼 보입니다. 숨기지 말고 발표에서 그대로 말합니다. 궤도 데이터가 걷는 규모에서 얼마나 거친지 보여 주는 증거이고, 원문의 "built for regional and global views rather than the hyperlocalized areas astronauts will target"과 그대로 이어집니다.

---

## 5. 확정 레이어

| 순위 | 레이어 | 종류 (Q4) | 임무 · 장비 | 출처 | 상태 |
|---|---|---|---|---|---|
| 1 | 지형 높이 | topographic | MRO HiRISE·CTX, Mars Express HRSC, MGS MOLA | USGS 파일 | 주소 확인. 내려받기 필요 |
| 2 | 경사도 | (계산) | 위와 같음 | 지형에서 계산 | 지형 다음 |
| 3 | 광학 영상 | optical | MRO · HiRISE | Mars Trek 타일 | 바로 받을 수 있음 |
| 4 | 열 영상 (야간) | thermal | Mars Odyssey · THEMIS | Mars Trek 타일 | 바로 받을 수 있음. 흐림 |
| 5 | 로버 주행 기록 | (지상 실측) | MSL Curiosity | NASA JSON | 바로 받을 수 있음 |
| 6 | 로버 시점 사진 | optical (지상) | MSL Curiosity | NASA JSON | 바로 받을 수 있음 |
| 7 | 방사선 | radiation | MSL Curiosity · RAD | PDS | 형식 해석 필요. 안 되면 발표값 |
| 8 | 지질 단위 | geologic | USGS SIM 3292 | Mars Trek 조회 | 한 줄 표시 |
| 9 | 대기 | atmospheric | MSL Curiosity · REMS | PDS | 확인 못함 |

1~6만으로도 원문의 "at least three kinds of data"와 "data from multiple NASA science missions"를 채웁니다.

지형 파일에는 ESA Mars Express의 HRSC 자료가 섞여 있습니다. 파일을 만들어 배포하는 곳은 USGS와 NASA이지만, 제출 설명문에 ESA 자료가 포함됐다고 적습니다.

---

## 6. 아직 모르는 것

| 항목 | 누가 | 언제 |
|---|---|---|
| 지형 파일을 일부만 잘라 받을 수 있는지 | C | 시작 직후 |
| RAD 파일에서 선량률을 뽑는 방법 | C | 지형·광학을 넘긴 뒤 |
| REMS 자료가 sol 4100~4350을 포함하는지 | C | 지형·광학을 넘긴 뒤 |
| 수로에 들어간 정확한 sol | C | 사진을 고를 때 |
| 제출물 요건 (영상 길이, 설명문 항목, 마감 시각) | C | 시작 직후 |
| 사람이 걸을 수 있는 경사 기준 | C, D | 경로 계산 전 |
| 지형 파일과 주행 기록의 높이 기준이 같은지 (주행 기록 필드 이름은 `elev_geoid`) | C | 지형 파일을 받은 직후. 정차 지점 좌표에서 지형 높이를 뽑아 주행 기록의 `elev_geoid`와 비교한다. 차이가 일정하면 보정값으로 쓴다 |
| 지형 파일과 광학 영상이 정확히 겹치는지 (서로 다른 자료가 따로 위치를 맞춤) | C | 두 레이어 위에 주행 경로를 얹어 본다. 몇 미터 어긋나는지 기록한다 |

제출물 요건은 공식 사이트(spaceappschallenge.org) 접속이 이 환경에서 인증서 오류로 실패해 확인하지 못했습니다.

---

## 7. 해커톤 중에 확인한 것 (C, 2026-11-14)

위 6장의 항목을 실제로 해 본 결과입니다. 모두 [직접 확인]이고, 가공은 `data-pipeline/build_data.py`에 있습니다.

| 항목 | 결과 |
|---|---|
| 지형 파일을 일부만 잘라 받을 수 있는지 | **됩니다.** 서버가 부분 요청(Range)을 받습니다. 3.6GB를 다 받지 않고 지도 범위 2,048×2,048픽셀만 읽었습니다 |
| 지형 파일과 주행 기록의 높이 기준 | **같습니다.** 범위 안 정차 지점 178곳에서 (지형 − `elev_geoid`)가 평균 −0.17m, 표준편차 0.24m. 보정값을 쓰지 않습니다 |
| 지형과 광학 영상이 겹치는지 | 두 레이어에 주행 경로를 얹으면 둘 다 수로를 따라갑니다 (`data-pipeline/check_overlay.png`). 지형으로 만든 음영 그림과 광학 영상이 가장 잘 겹치는 자리는 1칸(4m) 이내였습니다. 상관이 0.29로 높지 않아 "4m보다 크게 어긋나 있지는 않다"까지만 말할 수 있습니다 |
| RAD 파일에서 선량률을 뽑는 방법 | sol별 파일의 `[DOSIMETRY_TOTAL_DOSE_E: NN]` 아래 숫자가 E 검출기 선량률(µGy/h)입니다 (`DOCUMENT/RAD_RDR_SIS`). sol 4200은 관측 88개 중 QC 표시가 있는 2개를 빼고 86개, 하루 평균 **154 µGy/일**(시간별 152~157). sol 4312도 뽑아 봤고 153 µGy/일이었습니다. 기기가 낸 값 그대로이며 보정하지 않았습니다 |
| REMS 자료가 sol 4100~4350을 포함하는지 | **포함합니다.** `https://atmos.nmsu.edu/PDS/data/mslrem_1001/DATA/`에 sol 4843까지 있습니다 (안내 페이지는 안 열리지만 자료 폴더는 열립니다). sol 4200의 MODRDR 파일에서 기압 800~889 Pa, 기온 206~268 K를 얻었습니다 |
| 사진을 좌표에 꽂을 수 있는지 | **됩니다.** sol 4200 `RMC 107_2484`와 sol 4098 `RMC 106_438`에서 찍은 전체 크기 왼쪽 내비게이션 카메라 사진이 각각 19장 있습니다. 한 장씩 골라 `pov/site1.jpg`, `pov/base.jpg`로 씁니다 |
| 황 암석 발견 | JPL 기사 두 편 원문 확인 (2024-07-18, 2024-11-18). 로버가 돌을 밟아 깨뜨린 것은 **2024년 5월 30일**이고, NASA 사진 기록에서 그날은 **sol 4200**입니다. 순수한 황은 화성에서 처음이고, 황 암석은 HiRISE로 보기에는 너무 작았다고 적혀 있습니다. 로버가 수로를 떠나며 파노라마를 찍은 것은 sol 4352입니다 |
| **황 암석 지대의 위치** | **4장의 기준점(sol 4312 위치)이 아닙니다.** sol 4200에 로버는 `107_2394`에서 `107_2484`(137.40886°E, 4.78571°S)까지 약 9m를 달렸고, 그 뒤 sol 4237까지 그 근처에 머물렀습니다. 기준점에서 약 102m 떨어진 곳입니다. 데이터의 조사 지점(`site1`)은 이 자리로 옮겼습니다. 지도 범위는 그대로입니다. 자세한 근거는 [DATA.md](DATA.md) 2장 |
| 기지에서 조사 지점까지 | 로버가 실제로 달린 거리 593m, 높이 변화 +45.2m (sol 4098 → 4200). 4장의 "1,001m, 44m"는 sol 4312까지의 값입니다 |
| 사람이 걸을 수 있는 경사 기준 | 달에서의 근거를 찾았습니다. Apollo 우주인은 15° 미만의 경사를 걸었고(EPSC2024-196), Artemis 초기 보행 계획은 20° 미만입니다(David Kring, Universe Today 2023). 화성 기준은 찾지 못했습니다. **15°부터 피하고 20°를 넘으면 막는 것**을 제안합니다. 10° 이하로는 기지에서 조사 지점까지 길이 끊깁니다. 이 기준으로 계산한 길(390m)은 로버가 실제로 간 길에서 평균 16m 떨어져 있습니다 ([DATA.md](DATA.md) 7장) |
| 제출물 요건 | 공식 Project Submission Guide 확인. 요약은 [SUBMISSION.md](SUBMISSION.md) 맨 위. **데모는 30초 이하 영상 또는 7장 이하 슬라이드, 영어, 18세 미만의 모습·목소리 금지, 마감 11월 15일 23:59 현지 시각** |

아직 모르는 것: 수로에 들어간 정확한 sol, 깨뜨린 황 암석의 정확한 좌표, 화성 중력에서 우주복을 입은 사람이 걸을 수 있는 경사.
