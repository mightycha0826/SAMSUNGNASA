# Marswalk Visor (working title)

**A three-layer map on a Mars explorer's helmet.**
An entry for the 2026 NASA Space Apps Challenge — *Interplanetary Survival Guide: Martian Map*.

> A helmet HUD that builds the map and the route from NASA data, fills in nearby obstacles with the helmet's sensors, and changes the route when the suit's condition becomes dangerous.

**This project is built on NASA data.** The map, the route, the status panel and the alerts all start from NASA mission data. The headset, the Jetson and the Arduino are the means of delivering that data to the explorer.

| Document | Who reads it | Contents |
|---|---|---|
| This README | Whole team | What we build and why, schedule, rules |
| [docs/ROLES.md](docs/ROLES.md) | Each owner | The six roles, done criteria, expected AI token use |
| [docs/INTERFACES.md](docs/INTERFACES.md) | Owners and their AIs | Data formats exchanged between modules |
| [docs/RESOURCES.md](docs/RESOURCES.md) | Whole team, especially C | Analysis of the published resources, data to use and addresses |
| [docs/CHALLENGE.md](docs/CHALLENGE.md) | Whole team | Full challenge text |

---

## 1. What we build

A Meta Quest 3 stands in for the spacesuit helmet, and we build the map a Mars explorer sees while walking. The map has three layers.

| Layer | What it shows | Data | Hardware |
|---|---|---|---|
| 1. Orbital map | 3D map of the exploration site with terrain, optical and thermal data overlaid | **NASA orbiter data** (MRO, Mars Odyssey, MGS) | Quest 3 (palm map) |
| 2. Field map | Nearby obstacles that orbital data cannot see | Helmet depth sensor laid over the NASA map | Quest 3 (real-time environment analysis) |
| 3. Survival info | Radiation, ambient temperature, emergency alerts | **NASA Curiosity observations** + temperature sensor | Jetson + Arduino |

Control is by palm gesture and voice only. The premise is that pressing a screen is hard with spacesuit gloves.

### Principle: every feature starts from NASA data

For every feature we must be able to answer "which NASA data does this value on screen come from?" A feature that cannot answer is postponed.

| Feature | NASA data behind it |
|---|---|
| Palm 3D map | Terrain (MRO HiRISE and others), optical (MRO HiRISE), thermal (Mars Odyssey THEMIS) |
| Route guidance | Slope computed from terrain. Shown next to the path Curiosity actually drove, as validation |
| Status panel | Radiation observed by Curiosity RAD, elevation and geologic unit of the current position |
| Emergency mode | Alert based on observed radiation (together with the ambient temperature alert) |
| Voice guidance | Reads the values above aloud |
| Rover point-of-view photo | Real photos Curiosity took at that spot |
| Real-time environment analysis | Corrects the route built from NASA data to fit nearby obstacles |

Where each dataset comes from is in [docs/RESOURCES.md](docs/RESOURCES.md).

Only two inputs are not NASA data: the helmet depth sensor and the temperature sensor on the suit (it measures the air around the wearer). Both operate only on top of the map and route built from NASA data.

### Real-time environment analysis is the kick of the demo

A map of NASA data alone is just a picture on a screen. Real-time environment analysis shows that map **alive in real space**. The moment an obstacle is placed in the demo, the route computed from NASA data is redrawn before your eyes.

- NASA data is the protagonist; real-time environment analysis makes it stand out.
- It ties to the challenge text, which says existing tools are "built for regional and global views rather than the hyperlocalized areas astronauts will target". The helmet sensor fills the very short range where orbital data is weak.
- The real data backs this up. Across our map extent (2 km) the thermal image is only 25 pixels wide, and even the sharpest optical image is about 0.64 m per pixel ([docs/RESOURCES.md](docs/RESOURCES.md) section 4). A rock at your feet is invisible from orbit.

### Mission scenario

Survey sulfur-bearing rocks in the **Gediz Vallis channel** on Mount Sharp, Gale Crater, and return to base.

- **Survey site (sulfur stone field)**: 137.4089° E, 4.7857° S. Where Curiosity ended its drive on May 30, 2024 (sol 4200), the drive on which it cracked open a rock and found pure sulfur. It is about 102 m from the center of the map (the sol 4312 position, 137.4075° E, 4.7868° S). Evidence is in [docs/DATA.md](docs/DATA.md) section 2.
- **Base**: where Curiosity stood on sol 4098. 358 m from the survey site in a straight line and 45 m lower.
- **Science goal**: Curiosity found rocks of pure sulfur here, a first on Mars, and it is not yet known why they formed here ([JPL 2024-07-18](https://www.jpl.nasa.gov/news/nasas-curiosity-rover-discovers-a-surprise-in-a-martian-rock/), [JPL 2024-11-18](https://www.jpl.nasa.gov/news/nasas-curiosity-mars-rover-takes-a-last-look-at-mysterious-sulfur/), both read in full). The premise is that a human goes there to survey more widely.
- **Map extent**: 2,048 m × 2,048 m centered on 137.4075° E, 4.7868° S.
- **Reference path**: Curiosity drove 593 m and climbed 45 m from the base position to the survey site (sol 4098 → 4200).
- **Why this site**: it does not overlap the boxwork example in the challenge text, and being on the same Mount Sharp it lets us use terrain, optical, radiation and rover photos.

The evidence for coordinates and figures is in [docs/DATA.md](docs/DATA.md) and [docs/RESOURCES.md](docs/RESOURCES.md) sections 4 and 7.

### Demo flow (the one minute shown to the judges)

> **Check against the submission rules.** The official guide says the submitted demo is **a video of 30 seconds or less, or a deck of 7 slides or fewer**; anything longer is not eligible for Global Judging. No image, video or voice of anyone under 18 may appear. The flow below has to be cut to fit 30 seconds. All the rules are at the top of [docs/SUBMISSION.md](docs/SUBMISSION.md).

1. Raise the left palm and the Gediz Vallis 3D map appears. Switch layers.
2. Say "Take me to the survey site" and arrows are laid on the floor.
3. **(Kick)** While walking, meet a chair (playing a rock) and the route is recalculated.
4. Warm the temperature sensor by hand: the screen flashes red and the route changes to the return-to-base route.

The demo space (a room) stands in for a scaled-down part of the Martian surface. We state this first in the presentation.

---

## 2. What the challenge asks for

All quotations below are taken verbatim from [docs/CHALLENGE.md](docs/CHALLENGE.md).

| # | Challenge text | In our entry |
|---|---|---|
| Q1 | "create a layered, integrated view of a location or route on the Martian surface that pulls together data from multiple NASA science missions" | **Core task.** Layer 1, orbital map |
| Q2 | "create a map, tool, or interface a Mars astronaut could use during a surface exploration mission, using NASA data and tools" | **Core task.** The whole HUD |
| Q3 | "You might start by identifying some scientific goals for your mission and the location the astronaut will explore" | Mission scenario |
| Q4 | "You may consider including at least three kinds of data—optical, thermal, spectral, topographic, geophysical, atmospheric, radiation, and chemical are a few examples" | Three or more layer kinds |
| Q5 | "they are built for regional and global views rather than the hyperlocalized areas astronauts will target" | Layer 2, field map (our differentiator) |
| Q6 | "NASA’s first priority is always astronaut safety" | Layer 3, survival info, emergency mode |
| Q7 | "include a route map that shows where the astronaut will travel to accomplish their scientific objectives while avoiding significant obstacles such as large rock formations" | Route guidance |
| Q8 | "as a heads-up-display (HUD) projected on the spacesuit’s helmet visor" | HUD format (allowed by the text) |
| Q9 | "Consider how you might include these point-of-view images as part of your map" | Rover point-of-view photos (if time allows) |
| Q10 | "Astronauts will conduct Mars surface science wearing spacesuits and possibly carrying scientific equipment and other supplies. Consider how this might impact their mobility" | Palm and voice control (our interpretation) |

**Our approach**

- The core of the text is Q1 and Q2: **a map that layers data from several NASA missions**. This is the foundation of the entry, and a dedicated role (C) builds it first.
- Real-time environment analysis ties to Q5 and Q7. It is **a layer that puts nearby obstacles on top of the NASA data map**, and the kick that shows the map reacting to real space in the demo.

---

## 3. Features and priorities

The hackathon is 48 hours. We grade features and finish from the top.

- **P0**: cannot submit without it
- **P1**: makes the entry stand out
- **P2**: only if time remains

| Feature | Basis | Grade | Owner |
|---|---|---|---|
| NASA data layers (three or more kinds) | Q1, Q2, Q4 | P0 | C |
| Palm 3D map, layer switching | Q1, Q8 | P0 | D, F |
| Route guidance (obstacle-avoiding route, floor arrows) | Q7 | P0 | D |
| Curiosity's actual traverse shown (route validation) | Q1, Q7 | P0 | C, D |
| Status panel (radiation, ambient temperature, vitals) | Q6 | P0 | F, E |
| Emergency mode (red flashing screen) | Q6 | P0 | F, E |
| Real-time environment analysis (field obstacle layer, the demo kick) | Q5, Q7 | P1 | A |
| Voice commands (STT) and voice guidance (TTS) | Q10 | P1 | E |
| Rover point-of-view photos (real Curiosity photos) | Q9 | P1 | F, C |
| Night vision | No basis in the text | P2 | A, F |
| Video recording mode | No basis in the text | P2 | F |

Why night vision and recording are P2: users report that the Quest browser denies the feature that lets a WebXR session access passthrough camera frames (`camera-access`) ([Meta community forum](https://communityforums.atmeta.com/discussions/Questions_Discussions/request-webxr-raw-camera-access-camera-access-feature-in-quest-browser/1367463), confirmed by search summary, needs checking on the device). Filtering or recording the video directly may not be possible.

---

## 4. System architecture

```
[NASA data] --preprocessed on a PC--> layer files (height grid, images, JSON) --+
                                                                                v
[Arduino temperature sensor] --USB serial--> [Jetson Orin Nano Super] <--WebSocket--> [Quest 3 browser (WebXR app)]
                                              - sensor reading, hazard decision        - layered map, route, HUD
                                              - speech recognition -> intent -> speech  - field obstacle scan
                                              - web app serving (HTTPS)                 - microphone in, audio out
```

- **Web app**: Three.js + WebXR, built with Vite. Modules talk only through a shared event bus. Formats are in [docs/INTERFACES.md](docs/INTERFACES.md).
- **NASA data**: preprocessed on a PC during the hackathon and shipped as static files. The headset does not download source data in real time.
- **Mock mode**: every module must run alone on fake data. You can develop in a PC browser without the headset or the Jetson.

### Repository layout

```
web/                 web app (Vite + Three.js)
  src/core/          B  XR session, event bus, Jetson link
  src/scan/          A  field obstacle scan
  src/map/           D  palm map, layer display
  src/nav/           D  path finding, floor arrows
  src/hud/           F  status panel, emergency mode, layer switching UI
  src/mock/          B  mock data (everyone adds their own)
  public/data/       C  processed layer files
data-pipeline/       C  NASA data processing scripts (Python)
jetson/              E  hub server, voice, sensor reading
arduino/             E  temperature sensor firmware
docs/                documents
```

---

## 5. Roles at a glance

Details are in [docs/ROLES.md](docs/ROLES.md), which also lists the owners.

| Slot | Owner | Role | One-line description |
|---|---|---|---|
| A | 이효제 | Real-time environment analysis | Builds a map of nearby obstacles from the headset depth sensor |
| B | 차유근 | XR core · integration lead | Builds the skeleton and merges everyone's code into one |
| C | 김건민 | NASA data layers · mission scenario | Gets NASA data and processes it into map layers |
| D | 안현상 | Map · route guidance | Shows the palm map, computes the route and lays the arrows |
| E | 김도훈 | Jetson hub · voice · sensor | Runs the voice assistant and the temperature sensor on the Jetson |
| F | 길윤석 | HUD UI · demo | Builds the status panel and the emergency screen, shoots the demo video |

---

## 6. 48-hour schedule

The hackathon is on November 14–15 ([spaceappschallenge.org/2026](https://www.spaceappschallenge.org/2026/), confirmed by search summary).

| Time | To do | Done when |
|---|---|---|
| 0–3 h | Start the terrain file (3.6 GB) download, fix the interfaces, put up the skeleton | An empty AR screen shows on the headset |
| 3–24 h | Each module developed (mock mode) | Each module runs alone on fake data |
| ~12 h | **C hands over one terrain layer first** | Real Martian terrain shows on D's map |
| 24–36 h | Integration | Demo flow steps 1–4 run end to end on the headset |
| 36–44 h | Rehearsal, demo video shoot | A video file exists |
| 44–48 h | Submission | Submitted |

If any P0 item is not done at the 24-hour mark, P1 and P2 work stops and helps P0.

---

## 7. Risks and mitigations

| Risk | Mitigation | Owner |
|---|---|---|
| If NASA data processing is late the map is empty | Optical tiles can be fetched right away, so hand those over first. Terrain within 12 hours | C |
| The terrain file and the traverse record may use different elevation references | **Resolved.** They agree: mean difference −0.17 m at 178 rover stops. No correction is used | C |
| Terrain elevation values exist only in the 3.6 GB file | **Resolved.** The server accepts partial requests; only the map window is read | C |
| Radiation data is close to raw and may take long to interpret | **Resolved.** Dose rates for sol 4200 are extracted from the RAD file (154 µGy/day on average) | C |
| Atmospheric (REMS) data could not be verified | **Resolved.** Pressure and air temperature for sol 4200 are in `env.json` | C, F |
| WebXR only works on HTTPS (or localhost) ([MDN](https://developer.mozilla.org/docs/Web/API/Navigator/xr)) | Confirm the headset can connect within the first 3 hours | B |
| Depth and mesh data may not come out as expected | Check on the device within the first 3 hours. If not, A falls back to plane detection | A |
| Hand tracking and microphone input in the browser are unverified | Check on the device within the first 3 hours | D, E |
| Submission requirements (video, description, deadline) are unknown | **Resolved.** Read from the official guide and summarized at the top of [docs/SUBMISSION.md](docs/SUBMISSION.md). Demo: 30 s video or 7 slides; deadline Nov 15, 11:59 p.m. local | C |
| Integration piles up at the end | Interface changes only after B approves | B |

---

## 8. NASA data

The Resources tab was published and we checked it directly. Detailed analysis and addresses are in [docs/RESOURCES.md](docs/RESOURCES.md).

| Rank | Layer | Kind (Q4) | Mission · instrument | Source |
|---|---|---|---|---|
| 1 | Terrain elevation | topographic | MRO HiRISE·CTX, Mars Express HRSC, MGS MOLA | [USGS Gale 1m DEM](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m) |
| 2 | Slope | (derived) | Same as above | Computed from terrain |
| 3 | Optical image | optical | MRO · HiRISE | [Mars Trek](https://trek.nasa.gov/mars/) |
| 4 | Thermal image (night) | thermal | Mars Odyssey · THEMIS | [Mars Trek](https://trek.nasa.gov/mars/) |
| 5 | Rover traverse record | (ground truth) | MSL Curiosity | [NASA traverse record](https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json) |
| 6 | Rover point-of-view photos | optical (ground) | MSL Curiosity | NASA raw images |
| 7 | Radiation | radiation | MSL Curiosity · RAD | [PDS](https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/) |
| 8 | Air pressure and temperature | atmospheric | MSL Curiosity · REMS | [PDS](https://atmos.nmsu.edu/PDS/data/mslrem_1001/) |
| 9 | Geologic unit | geologic | USGS SIM 3292 | [Mars Trek](https://trek.nasa.gov/mars/) |

- All of these are processed and in `web/public/data/`. What each file is, how it was made and how far it can be trusted is in [docs/DATA.md](docs/DATA.md).
- Four different NASA missions are involved (MRO, Mars Odyssey, MGS, MSL Curiosity).

**How the five resources are used**

| Resource | Use |
|---|---|
| Mars Trek | Main source of optical and thermal tiles |
| USGS-NASA Planetary Geologic Mapping Program | Shows the geologic unit of the site |
| Curiosity route map example | Design reference for the route map |
| NASA Worldview | Reference for the layer switching screen (an Earth observation tool, not a source of Mars data) |
| Mars Perseverance Raw Images Gallery | We use Curiosity photos served the same way (Perseverance is in a different crater) |

**Limits to keep in mind**

- Mars Trek terrain tiles are pictures, so no elevation values can be read from them. Elevation comes only from the USGS file.
- The thermal image is about 81 m per pixel, so 25 pixels across our map extent, and its brightness is relative brightness, not temperature.
- The optical image is 8-bit grayscale. If we colorize it, we state in the presentation that the source is grayscale.
- The terrain file and the traverse record share an elevation reference (mean difference −0.17 m at 178 rover stops), and terrain and optical overlap to within 4 m. How this was checked is in [docs/DATA.md](docs/DATA.md) section 6.
- The radiation and weather values are a recording of one Martian day (sol 4200), not a live feed.
- The global geologic map shows our whole site as a single unit (`Htu`).

### Missing data: comparison with the five resource sites

A teammate compared this README with the five resource sites and listed data we were not using (2026-11-14, branch `claude/amazing-hawking-l74jh3`). C went through the list the same day. The "Status" column is what C found; items marked "checked" were checked against the live Mars Trek layer index (225 products, 39 covering our site) or against the files in `web/public/data/`.

| ID | Missing item | Source | Status (C, 2026-11-14) |
|---|---|---|---|
| M1 | Spectral and mineral data (CRISM, OMEGA) | Mars Trek, Curiosity route page | **Checked: nothing usable at our scale.** Trek's CRISM raster indicators cover other regions, not Gale. What covers our site is global: a map of hydrous mineral detections (OMEGA, CRISM) and TES mineral abundance maps at kilometers per pixel, less than one pixel across our 2 km map. `spectral` stays empty, and we say so |
| M2 | THEMIS daytime thermal image | Mars Trek | **Checked: available** (`THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018`), not added. Same 81 m per pixel as the night image we use |
| M3 | MOLA·HRSC global DEM (about 200 m) | Mars Trek, USGS | **Not needed.** It was the fallback if the 3.6 GB file failed; the 1 m terrain is read directly |
| M4 | CTX optical mosaic (about 5–6 m) | Mars Trek | **Checked: covers our site** (`curiosity_ctx_mosaic`, `Gale_CTX_BlockAdj_dd`), not needed. HiRISE at 0.64 m covers the whole map |
| M5 | Place names, landing sites, exploration zones, thematic layers | Mars Trek | Global overlays exist (dune fields, exploration zones and others). Not checked for our site |
| M6 | Curiosity planned route and science regions | Curiosity route page | A single GIF, not data. We use the rover's actual path instead (`traverse.json`) |
| M7 | Trek subsetting, elevation profile | Mars Trek | **Not needed.** The terrain file accepts partial requests, so only the map window is read |
| M8 | Trek rock detection | Mars Trek | Not checked. It is a tool, not a layer in the index |
| M9 | Trek sun angle | Mars Trek | Not checked |
| M10 | Trek WMTS tile addresses and structure | Mars Trek | **Done.** [docs/RESOURCES.md](docs/RESOURCES.md) section 2 |
| M11 | Source, metadata and position link of Curiosity photos | NASA raw images API | **Done.** `pov.json`: photos matched to map positions by site and drive number ([docs/DATA.md](docs/DATA.md) section 4) |
| M12 | Worldview screen features (compare, measure, time slider) | Worldview | UI ideas, not data. For F |

**What the five sites do not have**

- Atmospheric (REMS) and radiation (RAD) data: **done**, both from the Planetary Data System, in `env.json`.
- Chemical and geophysical data: still empty.
- A finer geologic map of Mount Sharp or Gale Crater: not found.
- Coordinates of Curiosity's planned route: not found.

The teammate's list also pointed to a `docs/MISSING_DATA.md` with evidence per item. That file was not in the branch, so it is not linked here.

---

## 9. Collaboration rules

1. **Edit only your own folder.** If someone else's folder needs a change, ask its owner.
2. **Modules talk only through events.** Do not call another module's functions directly.
3. **Tell B before changing an interface.** Edit [docs/INTERFACES.md](docs/INTERFACES.md) first, then the code.
4. **Branches**: `feat/<slot>-<topic>` (for example `feat/d-palm-map`). B merges into `main`.
5. **Push small and often.** At least once every 3 hours.
6. **Give the AI only what it needs.** `docs/INTERFACES.md` and your own folder are enough and cost fewer tokens.

---

## 10. Verification level of this document

- Challenge requirements: quoted from the text the team lead provided ([docs/CHALLENGE.md](docs/CHALLENGE.md)).
- Addresses, formats, resolutions and coordinates of NASA data: checked by connecting directly (2026-11-13). The level per item is marked in [docs/RESOURCES.md](docs/RESOURCES.md).
- Submission requirements: read from the official Project Submission Guide (2026-11-14).
- Radiation (RAD), atmospheric (REMS) data, terrain alignment and the sulfur discovery at Gediz Vallis: checked against the source files and the JPL articles (2026-11-14). Details in [docs/DATA.md](docs/DATA.md) and [docs/RESOURCES.md](docs/RESOURCES.md) section 7.
- Hackathon schedule and Quest browser capabilities: confirmed only from search result summaries.
- **Not checked on the headset:** the data files were loaded by the web app in a desktop browser only.
- Priorities, role split, schedule and expected token use: proposals, not facts. The team can change them.

---

## 11. How to run

Node.js 20.19 or later is required (22.12 or later on the 22 line). The web app is in `web/`.

```bash
cd web
npm install
npm run dev        # https://localhost:5173/ (self-signed certificate)
```

**Mock mode on a PC** — every event flows without the headset, the Jetson or real data.

- Open `https://localhost:5173/?mock=1`. Get past the certificate warning with "Advanced → Proceed".
- The top-left panel shows the events on the bus and their counts. Keyboard: `N` navigate, `H` base, `S` stop, `L` thermal / optical map, `T` temperature spike.
- HUD text is English by default (as in the mockup); add `?lang=ko` for Korean. HUD size, position and flash period are tuned with the numbers in `web/src/hud/config.js`.
- Parts can be mocked separately: `?mock=link,hazard` (parts: `data`, `link`, `hazard`). `?mockSpeed=10` runs the timeline ten times faster.
- `?mock=1&mode=field` opens the PC view in field mode, where the fake obstacle is outlined in red on the floor and stands on the field map.

**From the headset** — put the PC and the headset on the same Wi-Fi.

1. Enter the `Network: https://<PC address>:5173/` address printed by `npm run dev` in the headset browser.
2. Get past the certificate warning and press **Start AR** (the button labelled `AR 시작`). Without a Jetson, append `?mock=link` to the address (`?mock=1` also swaps the room scan for a fake chair).
3. Give the Jetson address with `?jetson=<address>:8443`. The default is port 8443 on the same host as the page. If the Jetson also uses a self-signed certificate, open `https://<Jetson address>:8443/` once in the headset browser and accept the warning, or the WebSocket will not connect.

**Two ways in** — the start page has two buttons.

- **Mars map**: the NASA terrain on the left palm, layers, the route between base and survey site. On a PC the **Mars route planner** panel (top right) picks start and destination; its destinations are the base, the survey site (390 m by route) and a **nearby point about 20 m from the base**, which is the one selected at first (22 m by route on the real terrain; `?near=<metres>` moves it, `?near=0` removes it). Walking moves your marker on the map (one real metre counts as 100 m by default, `?walkScale=`). **The route is also laid on the real floor**, with the same arrows and destination marker as on the field map. It is planned from the Mars data alone (slope and terrain): the furniture of the room plays no part in it. One real metre stands for up to 100 m on Mars, and the scale is set for each route so that it is about 3 m of real walking: the 22 m route to the nearby point and the 390 m route to the survey site are both a few steps across the room (`?walkScale=` fixes the scale instead).
- **Field map**: the premise is that you stand at the base on Mars. The palm map is the Mars map zoomed to 20 m around you, 1 : 1 with the room. It is the same kind of object as the Mars map: a relief over the palm, with the Mars terrain as its ground and its description on the card that goes around the map. Wherever the headset has scanned the room, the map is rewritten with the structure that is really there, standing on the ground, and everywhere else it is still the Mars data. Say **"Mark target"** where you stand, walk away, and the way back is drawn as arrows on the floor and as a line on the map. What moves on the map (your arrow, the target, the route) floats above its surface on thin stems: painted onto the map it was draped half over a wall's top and half over the floor beside it. The scanned structure is also shaded red on the real floor: a soft translucent fill with a light that travels across it and a few sparks, like the selection a phone shows before it erases an object from a photo. There is no outline: a bright line around every obstacle was too much in the headset.
  - The scan starts from the room geometry the Quest 3 keeps (run Space Setup once; without it the app says "No room scan").
  - This mode also asks the headset for live depth and lays it on top, so the map follows the room: a chair put down after the room scan shows up within about a second when it stands about 1 to 2.3 m from you. What live depth has marked **stays on the map** when you walk away or look elsewhere; an obstacle is taken off only when the sensor sees clear floor where it stood. Whatever was in the room scan stays. **Not yet checked on the headset.** If the field map misbehaves, add `?depth=0` to the address: the room scan then works alone.
  - **Settled areas cost little, but are still watched.** A cell read six times with the same answer is settled, so the reads go to what is new. Settled ground in view is looked at again every 1.5 s; two reads that agree settle it again, so standing in a room that is all known costs about half the reads of exploring. This is what makes a chair put down on known floor show within 3 s and one taken away clear within 4 s (A called it the chair problem: before, known ground was only read again after you had been 4 m away). `?settle=0` turns settling off.
  - **The map has no edge and is kept on the Jetson.** The floor is divided into tiles of 6.4 m. The app works on a window of 4 × 4 tiles (25.6 m) that moves with you; tiles that leave it are kept aside and come back when you return, so the map grows as far as you walk (it used to end 8 m from where the session started). Every change goes to the hub tile by tile, which writes one file per run to `jetson/maps/` (the newest 200 kept). A new session gets the last stored map back and uses it for what it has not seen yet, but only once its own scan has found enough of the same obstacles in the same places, because the headset may have moved its origin (`?remember=0` turns the handing back off). Live depth still only sees about 2.5 m around you: ground farther away is mapped when you get near it.
  - **Where you have walked is clear floor.** The cells under you are freed at once, and the room scan cannot block them again: a doorway that was shut when the room was scanned stays open once you have walked through it. Something put there later is still found by live depth.
  - **Guidance on the floor.** Chevrons every 42 cm over a faint band, with a light that runs along them toward the destination; they fade in just ahead of your feet and fade out a few metres on. The destination has rings spreading on the floor, a column of light that thins out upward, a diamond turning at chest height and a label with its name and distance.
  - **Narrow gaps.** A gap a person can get through sideways, about 30 cm, counts as walkable; a 10 cm gap does not. The route still keeps 30 cm from obstacles where there is room, and takes a squeeze only when the wide way is about 3 m longer.
  - `?mock=1` and `?mock=hazard` put a fake chair in place of the scan, so the real room is not outlined and live depth does nothing: on the headset without a Jetson use `?mock=link`.

**Menus: point and pinch.** The left hand brings a menu up, the right hand operates it from where it is, as with the Quest 3's own hand pointer. Nothing is touched, so the hands never cover each other from the headset's cameras.

- Open left palm turned up: the map, with the layer tabs beside it (Mars map). **A menu or hologram shows only over an open hand** (at least three fingers stretched out): a hand that points, pinches or makes a fist brings nothing up, however it is turned.
- Back of the open left hand up, as when looking at a watch: the command card above the hand (Status, Navigate, Base or Mark target, Stop, Confirm) with the red **SOS** bar under them. On the Mars map "Navigate" goes to the nearby point about 20 m from the base; say "Take me to the survey site" for the 390 m route.
- Point the right hand at a menu: a thin beam and a ring cursor show where you aim, and the button under the cursor lights up. Pinch thumb and index finger to press it. The ring closes as the fingers do.
- A menu stays where it appeared instead of riding on the left hand; it follows only when the hand has moved about 5 cm away, and it does not move while you point at it.
- Controllers work the same way (point, pull the trigger). If the beam does not seem to come from where you point, add `?ray=own` to the address.
- A menu closes at once when the hand turns to the other gesture (map ↔ commands), and 0.12 s after the hand turns away; it only lingers (0.9 s) when the hand is lost from view.
- **Pick a place on the map.** Point the right hand at the map over the left palm: the cursor follows the terrain. Pinch, and a pin marks the place and a small card over it offers **Navigate** and **Cancel**; saying "Navigate" or "Cancel" does the same. The pick moves to the nearest ground that can be walked (20° or less) and is connected to the base, and the card says how far it moved. On a PC, click the map. On the field map the same gesture picks a place in the room, and "Navigate" makes it the target, as "Mark target" makes the place underfoot.
- **Emergency.** Press the red SOS bar: it is armed for 8 s ("SEND SOS"). Press it again, or say "Confirm", and the rescue signal goes out; "Cancel" disarms it. By voice alone: "Emergency", then "Confirm". The hub then raises an alert on every other headset connected to it ("Rescue signal from a crew member"), shows a red banner on the monitor page and says so aloud. The crew is virtual: five seconds later the hub acknowledges in the crew's name and the bar says "Base crew (simulated) notified". "CANCEL SOS", or saying "Cancel rescue", withdraws the signal.

**The right hand: vitals.** The right hand points, and it shows one thing of its own.

- Open right palm turned up: a figure of the wearer turns slowly over the palm. It is the same kind of object as the map over the left palm: it floats a little above the palm, a little away from you and a little toward the middle of the body, with a cone of light from the palm, and its readings are on the caption card that goes around its cylinder, under the plate the figure stands on, always facing you.
- The readings: oxygen, heart rate, suit pressure, the body temperature of head, torso, arms and legs, and battery. A part of the figure turns orange or red when a reading that belongs to it is out of range (head: oxygen, head temperature; torso: body temperature, heart rate; arms and legs: their temperature, suit pressure; backpack: battery), and the caption names what to check.
- **What is real and what is not.** The battery is the headset's own, and the temperature sensor on the Jetson is real, but it measures the **air around the wearer** (the caption shows it as "Ambient"), not the body. Oxygen, heart rate, suit pressure and every body temperature are simulated and marked "sim". The simulated body warms by 0.12 °C for each degree the ambient temperature is above 30 °C, so heating the sensor shows on the figure as well. `?simO2=12`, `?simPressure=24`, `?simHeart=160`, `?simBody=38.5` set them from the address.
- The figure is built in the app from smooth solids, not loaded from a file, so it needs no download.
- **Two hands at once.** Where the hands could get in each other's way the left one has the say: the vitals stay away while the right hand's pointer is on a menu or on the map, and while the two wrists are closer than 16 cm (the cameras then see one hand in front of the other).

**Watching the headset from the Jetson.** Open `http://localhost:8080/monitor` on the Jetson (or `https://10.42.0.1:8443/monitor` from another device on the hotspot). It shows, live, what the app is drawing from the wearer's head: HUD, map, menus, pointer, arrows and the obstacle glow, plus a 1 m floor grid and dots on the hand joints. It needs no Meta account and no developer mode: the app itself sends the pictures to the hub, ten a second, and only while the page is open (they are encoded and sent by a worker, so the headset's frames do not wait for them). The room is behind it: on a headset the page asks the browser for a camera when it loads and draws its picture as the background (`?mirror=nocam` leaves it out; a desk computer is not asked for its webcam). Our Quest 3 offers three: "camera 0, facing front", which is a virtual camera showing the wearer's avatar, and two "facing back", the passthrough cameras; a back one is taken (`?mirrorCam=camera 1` picks by name if the other one is wanted). The camera sits beside the eye and has another lens, so the virtual things are roughly, not exactly, where the wearer sees them (`?mirrorFov=` adjusts). `?mirror=0` turns the mirror off.

**The readings: tiles that move.** There is no status card in a corner any more. Each reading is a tile of its own, with its number and a bar or a graph of its last minute, and the tiles stand in two columns left and right of what you look at (they end 26° out; the 23° in the middle stay clear).

- **Always there:** battery (the headset's own), oxygen (simulated) and ambient temperature (the Jetson's sensor: the air around the wearer), each a bar with its limits marked. They come first, so they keep the top places.
- **The rest by importance** (`web/src/hud/importance.js`): a reading has a base (route 70 while one is active, heart rate 35, body temperature 33, radiation 32, suit pressure 30, air temperature 12, air pressure 10), plus 50 when it is out of range and 100 when critical, plus up to 20 for heading toward its limit. Those at 31 or more are shown, at most three; so tiles come and go. A reading on show keeps its place unless another beats it clearly. Elevation, geologic unit and the layer name are no longer shown.
- **Level columns:** the tiles fill right, left, right, left in order, so the columns are level or the right one has one more.
- **To the middle:** a reading in a critical state, and the ambient temperature as soon as its alert sounds (30 °C), leaves its column and comes to the middle, under the line of sight and above the alert card, 18 % larger. The others close up. When it is back in range it returns.
- **How they move:** on a spring, there in about a quarter of a second with a 5 % overshoot, stretching by up to 6 % along the way; a new tile fades in where it belongs, a dropped one fades out where it stood.
- **Lower than centred:** what is laid out as centred looks a little high in the Quest 3, so the whole HUD hangs 1.5° lower (`HUD.viewDropDeg`). The confirmation of a command ("Navigate") appears just below the line of sight.

**Voice.** The headset ends the microphone whenever it is taken off or the system menu opens; the app now opens it again by itself (it used to stay dead until the page was reloaded, which is why speech often seemed not to be recognised at all). The hub keeps the last 100 utterances as WAV files in `jetson/logs/utterances/`, named by time and by what was understood, for tuning.

**Alerts.** Warn and critical alerts bring up the alert card at the bottom, beep, and light the whole view softly in orange or red with each beep (`?wash=0` turns the light off, `?sound=0` the beep). "Confirm" stops both. The ambient temperature alert steps back down as the temperature falls: critical above 35 °C, back to warn below 34 °C, cleared below 29 °C.

**Device check page** — open `https://<PC address>:5173/check.html` in the headset browser. Press **Start AR check** (`AR 점검 시작`), look around the room for 10 seconds and raise both hands: a table shows the granted session features and whether hands, depth, mesh and planes were received. The microphone is checked separately with the **Microphone check** (`마이크 점검`) button.

**Build and test**

```bash
npm run build      # static files in web/dist/ (served by the Jetson)
npm test           # unit tests: scan grid, field planner, hand pointer, route planner
npm run smoke      # with the dev server running, checks the mock-mode event flow (needs Playwright)
```

Module owners start from `index.js` in their own folder (`web/src/scan/`, `map/`, `nav/`, `hud/`). What `init(ctx)` and `update(frame)` receive is described in the comment at the top of each file.
