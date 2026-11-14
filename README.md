# Marswalk Visor (가칭)

**화성 탐사자의 헬멧에 뜨는 3겹 지도.**
2026 NASA Space Apps Challenge — *Interplanetary Survival Guide: Martian Map* 출품작입니다.

> NASA 데이터로 지도와 길을 만들고, 헬멧 센서로 눈앞 장애물을 메우고, 슈트 상태가 위험해지면 경로를 바꿔주는 헬멧 HUD.

**이 프로젝트의 바탕은 NASA 데이터입니다.** 지도, 경로, 상태창, 경보 모두 NASA 임무 데이터에서 출발합니다. 헤드셋·젯슨·아두이노는 그 데이터를 탐사자에게 전달하는 수단입니다.

| 문서 | 누가 읽나 | 내용 |
|---|---|---|
| 이 README | 팀 전원 | 무엇을 왜 만드는지, 일정, 규칙 |
| [docs/ROLES.md](docs/ROLES.md) | 각 담당자 | 6명의 역할, 완료 기준, AI 토큰 소모 예상 |
| [docs/INTERFACES.md](docs/INTERFACES.md) | 담당자와 각자의 AI | 모듈끼리 주고받는 데이터 형식 |
| [docs/RESOURCES.md](docs/RESOURCES.md) | 팀 전원, 특히 C | 공개된 리소스 분석, 쓸 데이터와 주소 |
| [docs/CHALLENGE.md](docs/CHALLENGE.md) | 팀 전원 | 챌린지 원문 전체 |

---

## 1. 무엇을 만드나

Meta Quest 3를 "우주복 헬멧"으로 삼아, 화성 탐사자가 걸으면서 보는 지도를 만듭니다. 지도는 세 겹입니다.

| 겹 | 무엇을 보여주나 | 데이터 | 장비 |
|---|---|---|---|
| 1. 궤도 지도 | 지형·광학·열 데이터를 겹친 탐사 지점 3D 지도 | **NASA 궤도선 데이터** (MRO, Mars Odyssey, MGS) | Quest 3 (손바닥 지도) |
| 2. 현장 지도 | 궤도 데이터에 안 보이는 눈앞 장애물 | NASA 지도 위에 헬멧 깊이 센서를 얹음 | Quest 3 (실시간 환경 분석) |
| 3. 생존 정보 | 방사선 상태, 슈트 온도, 비상 경보 | **NASA Curiosity 관측 데이터** + 온도 센서 | Jetson + Arduino |

조작은 손바닥 제스처와 음성으로만 합니다. 우주복 장갑을 낀 손으로는 화면을 누르기 어렵다는 설정입니다.

### 원칙: 모든 기능은 NASA 데이터에서 출발한다

기능을 만들 때 "이 화면의 값은 어느 NASA 데이터에서 오는가"에 답할 수 있어야 합니다. 답할 수 없는 기능은 뒤로 미룹니다.

| 기능 | 바탕이 되는 NASA 데이터 |
|---|---|
| 손바닥 3D 지도 | 지형(MRO HiRISE 등), 광학(MRO HiRISE), 열(Mars Odyssey THEMIS) |
| 길안내 | 지형에서 계산한 경사도. Curiosity가 실제로 지나간 길과 나란히 보여 검증 |
| 상태창 | Curiosity RAD의 방사선 관측값, 현재 위치의 높이와 지질 단위 |
| 비상 모드 | 방사선 관측값 기준 경보 (슈트 온도 경보와 함께) |
| 음성 안내 | 위 값들을 말로 읽어 줌 |
| 로버 시점 사진 | Curiosity가 그 자리에서 찍은 실제 사진 |
| 실시간 환경 분석 | NASA 데이터로 만든 경로를, 눈앞 장애물에 맞춰 고침 |

어떤 데이터를 어디서 받는지는 [docs/RESOURCES.md](docs/RESOURCES.md)에 있습니다.

NASA 데이터가 아닌 입력은 둘뿐입니다. 헬멧 깊이 센서와 슈트 온도 센서입니다. 둘 다 NASA 데이터로 만든 지도와 경로 위에서만 동작합니다.

### 실시간 환경 분석은 시연의 킥이다

NASA 데이터 지도만으로는 화면 속 그림에 그칩니다. 실시간 환경 분석은 그 지도가 **실제 공간에서 살아 움직이는 것**을 보여 주는 장치입니다. 시연에서 장애물을 놓는 순간 NASA 데이터로 계산한 경로가 눈앞에서 다시 그려집니다.

- 주인공은 NASA 데이터이고, 실시간 환경 분석은 그것을 돋보이게 하는 역할입니다.
- 원문과도 맞닿습니다. 기존 도구는 "built for regional and global views rather than the hyperlocalized areas astronauts will target"이라고 했습니다. 궤도 데이터가 약한 초근거리를 헬멧 센서가 메웁니다.
- 실제 데이터가 이를 뒷받침합니다. 우리 지도 범위(2km)에서 열 영상은 가로 25픽셀뿐이고, 가장 선명한 광학 영상도 픽셀 하나가 약 0.64m입니다 ([docs/RESOURCES.md](docs/RESOURCES.md) 4장). 발 앞의 돌은 궤도에서 보이지 않습니다.

### 미션 시나리오

게일 크레이터 샤프산(Mount Sharp)의 **게디즈 발리스(Gediz Vallis) 수로**에서 황이 든 돌을 조사하고 기지로 돌아옵니다.

- **탐사 지점**: 동경 137.4075°, 남위 4.7868°. Curiosity가 sol 4312에 머문 자리입니다.
- **과학 목표**: Curiosity가 이곳에서 순수한 황으로 된 돌을 발견했습니다 ([JPL](https://www.jpl.nasa.gov/news/nasas-curiosity-mars-rover-takes-a-last-look-at-mysterious-sulfur/), 검색 요약). 사람이 직접 가서 더 넓게 조사한다는 설정입니다.
- **지도 범위**: 기준점을 가운데 둔 2,048m × 2,048m.
- **참고 경로**: Curiosity는 이 수로까지 약 1,001m를 주행하며 44m를 올라갔습니다 (sol 4098 → 4312).
- **이 지점을 고른 이유**: 원문 예시인 박스워크와 겹치지 않으면서, 같은 샤프산이라 지형·광학·방사선·로버 사진을 모두 쓸 수 있습니다.

좌표와 수치의 근거는 [docs/RESOURCES.md](docs/RESOURCES.md) 4장에 있습니다.

### 데모 흐름 (심사에서 보여줄 1분)

1. 왼손 손바닥을 들면 게디즈 발리스 3D 지도가 뜬다. 레이어를 바꿔 본다.
2. "조사 지점으로 안내해 줘"라고 말하면 바닥에 화살표가 깔린다.
3. **(킥)** 걷다가 의자(바위 역할)를 만나면 경로가 다시 계산된다.
4. 온도 센서를 손으로 데우면 화면이 붉게 점멸하고, 기지 복귀 경로로 바뀐다.

데모 공간(방)은 화성 표면의 일부를 축소해 대신합니다. 발표에서 이 점을 먼저 밝힙니다.

---

## 2. 챌린지가 요구하는 것

아래 인용은 모두 [docs/CHALLENGE.md](docs/CHALLENGE.md)에서 글자 그대로 가져왔습니다.

| # | 원문 | 우리 작품에서 |
|---|---|---|
| Q1 | "create a layered, integrated view of a location or route on the Martian surface that pulls together data from multiple NASA science missions" | **핵심 과제.** 1겹 궤도 지도 |
| Q2 | "create a map, tool, or interface a Mars astronaut could use during a surface exploration mission, using NASA data and tools" | **핵심 과제.** HUD 전체 |
| Q3 | "You might start by identifying some scientific goals for your mission and the location the astronaut will explore" | 미션 시나리오 |
| Q4 | "You may consider including at least three kinds of data—optical, thermal, spectral, topographic, geophysical, atmospheric, radiation, and chemical are a few examples" | 레이어 3종 이상 |
| Q5 | "they are built for regional and global views rather than the hyperlocalized areas astronauts will target" | 2겹 현장 지도 (우리의 차별점) |
| Q6 | "NASA’s first priority is always astronaut safety" | 3겹 생존 정보, 비상 모드 |
| Q7 | "include a route map that shows where the astronaut will travel to accomplish their scientific objectives while avoiding significant obstacles such as large rock formations" | 길안내 |
| Q8 | "as a heads-up-display (HUD) projected on the spacesuit’s helmet visor" | HUD 형식 (원문이 허용) |
| Q9 | "Consider how you might include these point-of-view images as part of your map" | 로버 시점 사진 (여유 시) |
| Q10 | "Astronauts will conduct Mars surface science wearing spacesuits and possibly carrying scientific equipment and other supplies. Consider how this might impact their mobility" | 손바닥·음성 조작 (우리의 해석) |

**우리의 접근**

- 원문의 핵심은 Q1·Q2, 즉 **NASA 여러 임무의 데이터를 겹친 지도**입니다. 이것이 작품의 바탕이고, 전담 역할(C)이 최우선으로 만듭니다.
- 실시간 환경 분석은 Q5와 Q7에 연결됩니다. NASA 데이터 지도 위에 **눈앞 장애물을 얹는 레이어**이자, 시연에서 지도가 실제 공간에 반응하는 것을 보여 주는 킥입니다.

---

## 3. 기능과 우선순위

해커톤은 48시간입니다. 등급을 나눠 위에서부터 완성합니다.

- **P0**: 없으면 출품할 수 없는 것
- **P1**: 작품을 돋보이게 하는 것
- **P2**: 시간이 남으면 하는 것

| 기능 | 근거 | 등급 | 담당 |
|---|---|---|---|
| NASA 데이터 레이어 (3종 이상) | Q1, Q2, Q4 | P0 | C |
| 손바닥 3D 지도, 레이어 전환 | Q1, Q8 | P0 | D, F |
| 길안내 (장애물 회피 경로, 바닥 화살표) | Q7 | P0 | D |
| Curiosity 실제 주행 경로 표시 (경로 검증) | Q1, Q7 | P0 | C, D |
| 상태창 (방사선·높이·슈트 온도) | Q6 | P0 | F, E |
| 비상 모드 (화면 붉은 점멸) | Q6 | P0 | F, E |
| 실시간 환경 분석 (현장 장애물 레이어, 시연의 킥) | Q5, Q7 | P1 | A |
| 음성 명령(STT)과 음성 안내(TTS) | Q10 | P1 | E |
| 로버 시점 사진 표시 (Curiosity 실제 사진) | Q9 | P1 | F, C |
| 야간투시 | 원문에 근거 없음 | P2 | A, F |
| 영상촬영 모드 | 원문에 근거 없음 | P2 | F |

야간투시와 영상촬영을 P2로 둔 이유: Quest 브라우저에서 WebXR 세션이 패스스루 카메라 영상에 접근하는 기능(`camera-access`)이 거부된다는 사용자 보고가 있습니다 ([Meta 커뮤니티 포럼](https://communityforums.atmeta.com/discussions/Questions_Discussions/request-webxr-raw-camera-access-camera-access-feature-in-quest-browser/1367463), 검색 요약으로 확인, 기기에서 확인 필요). 영상을 직접 필터링하거나 녹화하는 방식이 안 될 수 있습니다.

---

## 4. 시스템 구조

```
[NASA 데이터] --PC에서 미리 가공--> 레이어 파일 (높이 격자, 이미지, JSON) --+
                                                                            v
[Arduino 온도 센서] --USB 시리얼--> [Jetson Orin Nano Super] <--WebSocket--> [Quest 3 브라우저 (WebXR 앱)]
                                      - 센서 수집, 위험 판정                   - 레이어 지도, 경로, HUD
                                      - 음성 인식 -> 명령 해석 -> 음성 합성     - 현장 장애물 스캔
                                      - 웹앱 서빙 (HTTPS)                      - 마이크 입력, 음성 출력
```

- **웹앱**: Three.js + WebXR, Vite로 빌드합니다. 모듈끼리는 공용 이벤트 버스로만 대화합니다. 형식은 [docs/INTERFACES.md](docs/INTERFACES.md)에 있습니다.
- **NASA 데이터**: 해커톤 중에 PC에서 미리 가공해 정적 파일로 넣습니다. 헤드셋이 원본 데이터를 실시간으로 내려받지 않습니다.
- **목(mock) 모드**: 모든 모듈은 가짜 데이터로 혼자 돌아가야 합니다. 헤드셋이나 젯슨이 없어도 PC 브라우저에서 개발할 수 있습니다.

### 저장소 구조

```
web/                 웹앱 (Vite + Three.js)
  src/core/          B  XR 세션, 이벤트 버스, 젯슨 연결
  src/scan/          A  현장 장애물 스캔
  src/map/           D  손바닥 지도, 레이어 표시
  src/nav/           D  경로 탐색, 바닥 화살표
  src/hud/           F  상태창, 비상 모드, 레이어 전환 UI
  src/mock/          B  목 데이터 (각자 자기 것 추가)
  public/data/       C  가공된 레이어 파일
data-pipeline/       C  NASA 데이터 가공 스크립트 (Python)
jetson/              E  허브 서버, 음성, 센서 수집
arduino/             E  온도 센서 펌웨어
docs/                문서
```

---

## 5. 역할 한눈에

자세한 내용은 [docs/ROLES.md](docs/ROLES.md)에 있습니다. 담당자는 [ROLES.md](docs/ROLES.md)의 표에 적혀 있습니다.

| 슬롯 | 담당 | 역할 | 한 줄 설명 |
|---|---|---|---|
| A | 이효제 | 실시간 환경 분석 | 헤드셋 깊이 센서로 눈앞 장애물 지도를 만든다 |
| B | 차유근 | XR 코어 · 통합 리드 | 뼈대를 만들고 모두의 코드를 하나로 합친다 |
| C | 김건민 | NASA 데이터 레이어 · 미션 시나리오 | NASA 데이터를 구해 지도 레이어로 가공한다 |
| D | 안현상 | 지도 · 길안내 | 손바닥 지도를 띄우고 경로를 계산해 화살표를 깐다 |
| E | 김도훈 | 젯슨 허브 · 음성 · 센서 | 젯슨에서 음성 비서와 온도 센서를 돌린다 |
| F | 길윤석 | HUD UI · 데모 | 상태창과 비상 화면을 만들고 데모 영상을 찍는다 |

---

## 6. 48시간 일정

해커톤 일정은 11월 14~15일입니다 ([spaceappschallenge.org/2026](https://www.spaceappschallenge.org/2026/), 검색 요약으로 확인).

| 시간 | 할 일 | 끝났다는 기준 |
|---|---|---|
| 0~3h | 지형 파일(3.6GB) 다운로드 시작, 인터페이스 확정, 뼈대 올리기 | 헤드셋에서 빈 AR 화면이 뜬다 |
| 3~24h | 각자 모듈 개발 (목 모드) | 각 모듈이 가짜 데이터로 혼자 돈다 |
| ~12h | **C가 지형 레이어 1종을 먼저 넘긴다** | D의 지도에 실제 화성 지형이 보인다 |
| 24~36h | 통합 | 데모 흐름 1~4가 헤드셋에서 이어진다 |
| 36~44h | 리허설, 데모 영상 촬영 | 영상 파일이 있다 |
| 44~48h | 제출 | 제출 완료 |

24시간 시점에 P0가 안 된 것이 있으면 P1·P2 작업을 멈추고 P0를 돕습니다.

---

## 7. 위험과 대비

| 위험 | 대비 | 담당 |
|---|---|---|
| NASA 데이터 가공이 늦으면 지도가 비어 버린다 | 광학 타일은 바로 받을 수 있으니 먼저 넘긴다. 지형은 12시간 안에 | C |
| 지형과 주행 기록의 높이 기준이 다를 수 있다 | 지형을 받은 직후 정차 지점에서 높이를 비교해 보정값을 구한다 | C |
| 지형 높이 값은 3.6GB 파일에만 있다 | 시작 직후 다운로드를 건다. 일부만 잘라 받을 수 있는지 확인한다 | C |
| 방사선 자료는 원시 자료에 가까워 해석이 오래 걸릴 수 있다 | 6시간 안에 안 되면 발표된 값을 고정값으로 쓴다 | C |
| 대기(REMS) 자료는 확인하지 못했다 | 없어도 출품할 수 있게 상태창에서 필수로 두지 않는다 | C, F |
| WebXR은 HTTPS(또는 localhost)에서만 켜진다 ([MDN](https://developer.mozilla.org/docs/Web/API/Navigator/xr)) | 첫 3시간 안에 헤드셋에서 접속되는지 확인한다 | B |
| 깊이·메쉬 데이터가 기대대로 안 나올 수 있다 | 첫 3시간 안에 기기에서 확인한다. 안 되면 A는 평면 감지로 낮춘다 | A |
| 손 추적, 마이크 입력이 브라우저에서 되는지 확인하지 못했다 | 첫 3시간 안에 기기에서 확인한다 | D, E |
| 제출물 요건(영상, 설명문, 마감 시각)을 모른다 | 시작 직후 공식 페이지에서 확인해 팀에 공유한다 | C |
| 통합이 막판에 몰린다 | 인터페이스 변경은 B 승인 후에만 한다 | B |

---

## 8. NASA 데이터

Resources 탭이 공개되어 직접 접속해 확인했습니다. 자세한 분석과 주소는 [docs/RESOURCES.md](docs/RESOURCES.md)에 있습니다.

| 순위 | 레이어 | 종류 (Q4) | 임무 · 장비 | 출처 |
|---|---|---|---|---|
| 1 | 지형 높이 | topographic | MRO HiRISE·CTX, Mars Express HRSC, MGS MOLA | [USGS Gale 1m DEM](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m) |
| 2 | 경사도 | (계산) | 위와 같음 | 지형에서 계산 |
| 3 | 광학 영상 | optical | MRO · HiRISE | [Mars Trek](https://trek.nasa.gov/mars/) |
| 4 | 열 영상 (야간) | thermal | Mars Odyssey · THEMIS | [Mars Trek](https://trek.nasa.gov/mars/) |
| 5 | 로버 주행 기록 | (지상 실측) | MSL Curiosity | [NASA 주행 기록](https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json) |
| 6 | 로버 시점 사진 | optical (지상) | MSL Curiosity | NASA 원본 사진 |
| 7 | 방사선 | radiation | MSL Curiosity · RAD | [PDS](https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/) |
| 8 | 지질 단위 | geologic | USGS SIM 3292 | [Mars Trek](https://trek.nasa.gov/mars/) |

- 1~6은 주소와 형식을 직접 확인했습니다. 7은 폴더 구조만 확인했고 값 추출은 해 보지 못했습니다.
- 서로 다른 임무가 4개입니다 (MRO, Mars Odyssey, MGS, MSL Curiosity).

**리소스 5개를 어떻게 쓰나**

| 리소스 | 쓰임 |
|---|---|
| Mars Trek | 광학·열 타일의 주 공급원 |
| USGS-NASA Planetary Geologic Mapping Program | 지점의 지질 단위 표시 |
| Curiosity 경로 지도 예시 | 경로 지도 디자인 참고 |
| NASA Worldview | 레이어 전환 화면 참고 (지구 관측 도구이며 화성 데이터 출처가 아님) |
| Mars Perseverance Raw Images Gallery | 같은 방식의 Curiosity 사진을 씀 (Perseverance는 다른 크레이터에 있음) |

**알아 둘 한계**

- Mars Trek의 지형 타일은 그림이라 높이 값을 얻을 수 없습니다. 높이는 USGS 파일에서만 나옵니다.
- 열 영상은 약 81m/픽셀이라 우리 지도 범위에서 가로 25픽셀이고, 밝기는 온도가 아닌 상대 밝기입니다.
- 광학 영상은 8비트 회색조입니다. 색을 입히면 발표에서 원본이 회색조라고 밝힙니다.
- 지형 파일과 주행 기록의 높이 기준이 같은지, 지형과 광학이 정확히 겹치는지는 확인하지 못했습니다. 경로가 지면 위로 뜨거나 묻히면 이것부터 의심합니다.
- 전 지구 지질도는 우리 지점 전체가 한 단위(`Htu`)로 나옵니다.

---

## 9. 협업 규칙

1. **자기 폴더만 고칩니다.** 남의 폴더를 고쳐야 하면 그 담당자에게 요청합니다.
2. **모듈끼리는 이벤트로만 대화합니다.** 다른 모듈의 함수를 직접 부르지 않습니다.
3. **인터페이스를 바꾸려면 B에게 먼저 말합니다.** [docs/INTERFACES.md](docs/INTERFACES.md)를 고친 뒤 코드를 고칩니다.
4. **브랜치**: `feat/<슬롯>-<내용>` (예: `feat/d-palm-map`). `main`에는 B가 합칩니다.
5. **작게, 자주 올립니다.** 최소 3시간에 한 번은 푸시합니다.
6. **AI에게는 필요한 것만 줍니다.** `docs/INTERFACES.md`와 자기 폴더만 주면 토큰이 덜 듭니다.

---

## 10. 이 문서의 확인 수준

- 챌린지 요구사항: 팀장이 준 원문에서 인용했습니다 ([docs/CHALLENGE.md](docs/CHALLENGE.md)).
- NASA 데이터의 주소, 형식, 해상도, 좌표: 직접 접속해 확인했습니다 (2026-11-13). 항목별 확인 수준은 [docs/RESOURCES.md](docs/RESOURCES.md)에 표시했습니다.
- 제출물 요건: 공식 사이트 접속이 실패해 모릅니다.
- 대기(REMS) 자료, 방사선 값 추출 방법: 확인하지 못했습니다.
- 해커톤 일정, Quest 브라우저 기능, 게디즈 발리스의 과학적 발견: 검색 결과 요약으로만 확인했습니다.
- 우선순위, 역할 분담, 일정표, 토큰 소모 예상: 사실이 아니라 제안입니다. 팀이 바꿀 수 있습니다.

---

## 11. 실행 방법

Node.js 20.19 이상이 필요합니다. 웹앱은 `web/`에 있습니다.

```bash
cd web
npm install
npm run dev        # https://localhost:5173/ (자체 서명 인증서)
```

**PC에서 목 모드** — 헤드셋·젯슨·실데이터 없이 모든 이벤트가 흐릅니다.

- `https://localhost:5173/?mock=1` 을 엽니다. 인증서 경고는 "고급 → 계속"으로 넘어갑니다.
- 왼쪽 위 창에 버스에 흐르는 이벤트와 횟수가 보입니다. 키보드 `N` 안내, `H` 기지, `S` 그만, `L` 열 지도, `T` 온도 급상승.
- 일부만 가짜로 돌릴 수 있습니다: `?mock=link,hazard` (부분: `data`, `link`, `hazard`). `?mockSpeed=10` 은 시간표를 10배 빠르게 돌립니다.

**헤드셋에서 접속** — PC와 헤드셋을 같은 Wi-Fi에 둡니다.

1. `npm run dev` 가 찍는 `Network: https://<PC 주소>:5173/` 주소를 헤드셋 브라우저에 입력합니다.
2. 인증서 경고를 넘긴 뒤 **AR 시작**을 누릅니다. 젯슨 없이 볼 때는 주소 뒤에 `?mock=1` 을 붙입니다.
3. 젯슨 주소는 `?jetson=<주소>:8443` 으로 줍니다. 기본값은 페이지와 같은 호스트의 8443 포트입니다. 젯슨도 자체 서명 인증서를 쓰면, 헤드셋 브라우저에서 `https://<젯슨 주소>:8443/` 을 한 번 열어 경고를 넘겨야 WebSocket이 붙습니다.

**기기 점검 페이지** — 헤드셋 브라우저에서 `https://<PC 주소>:5173/check.html` 을 엽니다. **AR 점검 시작**을 누르고 10초 동안 방을 둘러보며 두 손을 들면, 허용된 세션 기능과 손·깊이·메쉬·평면 수신 여부가 표로 나옵니다. 마이크는 **마이크 점검** 버튼으로 따로 확인합니다.

**빌드와 테스트**

```bash
npm run build      # web/dist/ 에 정적 파일 (젯슨에서 서빙할 것)
npm run smoke      # 개발 서버가 떠 있을 때, 목 모드 이벤트 흐름 확인 (Playwright 필요)
```

모듈 담당자는 자기 폴더의 `index.js` 에서 시작합니다 (`web/src/scan/`, `map/`, `nav/`, `hud/`). `init(ctx)` 와 `update(frame)` 이 받는 값은 각 파일 맨 위 주석에 있습니다.
