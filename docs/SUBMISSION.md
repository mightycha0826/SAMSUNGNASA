# Submission text (draft)

> The text below is split by the field names of the submission form; paste each part into its field. The notes above the line and the `[TODO]` marks are for the team and are not submitted.

## Submission rules (read from the official Project Submission Guide, 2026-11-14)

Source: https://www.spaceappschallenge.org/resources/project-submission-guide/

- **Deadline:** Sunday, November 15, 11:59 p.m. in the time zone of our Local Event. **Submit for Judging** must be clicked before then. Anything saved or submitted after the deadline is not judged. Before the deadline the project can be edited and resubmitted any number of times.
- **The demo is a video of 30 seconds or less, or a deck of 7 slides or fewer.** Anything longer is not eligible for Global Judging. A one-minute demo does not fit this rule. → F and the whole team
- **English only.** The submission page and all linked material must be in English. If Korean is spoken in the video, English subtitles are required. Slides must be in English.
- **No image, video or voice of anyone under 18.** The demo and the final project may not include the likeness or voice of a person under 18. Film the headset view, hands and captions, and decide as a team who narrates. → F
- **Links must open without a login.** Videos and documents cannot be uploaded to the site; share public links (YouTube, GitHub and so on). Images (JPG, PNG, GIF) up to 10 MB can be uploaded directly.
- **Mark AI use.** AI-generated images and video need a visible watermark; audio, code and data need an acknowledgement in descriptive text and metadata. AI may be used as a tool, but not to come up with the idea of how to solve the challenge. AI-generated content may not carry NASA logos or mission identifiers.
- **Every required field must be filled in to submit.** All team members must be confirmed participants of the same Local Event to be eligible for awards.
- The five judging criteria are Impact, Creativity, Validity, Relevance and Presentation. Most of the judging is based on the text of the submission page, not on the demo.

## Before submitting

- [ ] Clear the `[TODO]` marks. Keep only what actually works and delete whole sentences about features that were not built.
- [ ] In the "Use of Super Intelligence" field, list the tools each team member used and what for.
- [ ] Open the demo link and the final project link in a private window.
- [ ] Settle the project name (working title: Marswalk Visor).
- [ ] Choose the images to upload to the submission page. `docs/figures/layers.png` (the four layers) and `route.png` (route comparison) are ready. Images up to 10 MB can be uploaded directly.

**What is built, as of the merge on 2026-11-14.** Use this when clearing the `[TODO]` marks.

| Part | Slot | State |
|---|---|---|
| NASA data layers, checks, figures | C | Built. 54 checks pass. Loaded by the app in a desktop browser |
| Skeleton, event bus, loader, mock mode | B | Built |
| HUD: status panel, alerts, layer tabs and legend | B, F | Built. Shows the real data in a desktop browser |
| Suit hub, temperature alerts, voice assistant, firmware | E | Built. Unit tests pass. Voice measured with synthetic speech only; no sensor wired yet |
| Palm map and layer display (`web/src/map/`) | D | **Not built yet** (empty module) |
| Route and floor arrows (`web/src/nav/`) | D | **Not built yet** (empty module) |
| Field obstacle scan (`web/src/scan/`) | A | **Not built yet** (empty module) |
| Destination photo on the HUD | F | **Not built yet**. The photos are ready in `pov.json` |
| Anything on the headset | all | **Not checked** |

Where the numbers come from: every number in the text was computed from the actual files by `data-pipeline/validate.py` (`data-pipeline/validation_report.json`). The files are described in [DATA.md](DATA.md) and the source data in [RESOURCES.md](RESOURCES.md).

**The survey site was moved.** The place where the sulfur was actually found (sol 4200, 2024-05-30) is about 102 m from the center of the map (the sol 4312 position). The text and the data use the real discovery position as the survey site. Evidence is in [DATA.md](DATA.md) section 2.

---

## Project Name

Marswalk Visor `[TODO: confirm the name]`

## High-Level Project Summary

**Marswalk Visor** is a helmet heads-up display for an astronaut walking on Mars. It layers data from four NASA Mars missions into one map of a single walkable site, plans a route across it, and then corrects that route with what the helmet sees a few steps ahead.

Orbital maps of Mars are built for regional views. At the scale of a spacewalk they run out of detail: across our 2 km site the best optical image resolves about 0.64 m per pixel, and the thermal image is only 25 pixels wide. NASA's own experience at our site shows the gap. When the Curiosity rover reached a pale patch of ground in Gediz Vallis channel, it found a field of pure sulfur stones that, as JPL reported, had been "too small for MRO's High-Resolution Imaging Science Experiment (HiRISE) to see."

Our display therefore has three layers:

1. **Orbital map** — terrain, slope, optical and thermal data from NASA orbiters, shown as a 3D map that appears above the astronaut's open palm.
2. **Field map** — the helmet's depth sensor finds obstacles the orbital data cannot show, and the route is recalculated around them. `[TODO: keep only if it works in the demo]`
3. **Survival information** — radiation, air pressure and temperature measured by Curiosity at this site, suit temperature, and an emergency mode that redirects the astronaut to base.

It matters because a crew on foot needs one view that joins what orbiters know about a place with what is actually in front of them, without taking their hands off their work.

## Link to Project Demo

`[TODO: public link to a video of 30 s or less, or a deck of 7 slides or fewer]`

## Link to Final Project

`[TODO: public repository or deployed address]`

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
- **Route.** The route is computed from the slope layer and drawn as arrows on the floor. Ground gets more expensive to cross as it steepens past 15°, and ground steeper than 20° is closed. We took these limits from human experience rather than from the rover: Apollo astronauts walked on slopes below 15°, and planners of the first Artemis moonwalks expect traverses to stay below 20°. Both come from the Moon; we found no equivalent figure for Mars. `[TODO: confirm that D's route uses these limits; if not, replace with the real values]`
- **Field obstacles.** `[TODO]` When the depth sensor finds an obstacle on the route, that cell is marked blocked and the route is recomputed. In the demo a chair stands in for a boulder.
- **Safety.** A status panel in the corner of the view shows suit temperature, radiation, air pressure and temperature, the elevation of the survey site and the geologic unit. A suit temperature above the warning level draws an orange border; above the critical level the edges of the view flash red, a spoken alert plays, and the route changes to lead back to base. `[TODO: the return-to-base route needs D's route module; the alert levels (30 °C and 35 °C) are starting values until tuned with the real sensor]`
- **Destination preview.** `[TODO: not built yet; the photos are ready in pov.json]` Near the survey site the display shows the photo Curiosity took from that exact spot, so the astronaut knows what to expect on arrival.
- **Voice.** The astronaut speaks commands in English: "Take me to the survey site", "Return to base", "Show the thermal map", "Status report", "Acknowledge alert". Speech is recognized and answered on a small computer carried with the suit (an NVIDIA Jetson), with no internet connection; a spoken status report reads out suit temperature, alerts and route state, and the display shows what was heard so the wearer knows the command was taken. `[TODO: recognition was measured with synthetic speech only (11–12 of 12 commands); confirm with real voices on the headset]`

Everything is controlled by a palm gesture and voice, because gloved hands cannot press buttons.

### How it works

A Python pipeline downloads the NASA data, cuts every source to the same map area, and resamples it onto one shared 512 × 512 grid (4 m cells). The headset loads these prepared files; it does not download raw data during the walk. The app is a WebXR page built with Three.js and runs in the browser of a Meta Quest 3 headset, which stands in for the helmet. Its modules talk to each other only through a shared event bus, so each one also runs alone on mock data.

Everything outside the headset runs on an NVIDIA Jetson, standing in for the suit's computer. It serves the app to the headset over HTTPS, reads an Arduino temperature sensor (standing in for a suit sensor) once a second, decides when an alert starts and clears, and handles voice. Speech recognition (SenseVoice) and speech synthesis (Supertonic 3) both run on the Jetson's CPU through sherpa-onnx; a recognized sentence is matched to one of a fixed set of commands by keyword rules, not by a language model, so the assistant only does what is on the list. `[TODO: keep only what was actually used in the final demo]`

The room we walk in represents a scaled-down patch of the Martian surface. We state this at the start of the demo.

### Benefits and what we hope to achieve

- One view of a walkable site that combines five kinds of NASA data instead of separate regional maps.
- A route that is planned from orbital data and checked against a path a real rover drove.
- An honest picture of where orbital data stops being enough, and a way to fill that gap in the field.

### Tools

- **Data pipeline:** Python, NumPy, Rasterio (GDAL), Pillow, Requests
- **Headset app:** JavaScript, Three.js, WebXR, Vite, Meta Quest 3
- **Suit hub:** Python, aiohttp, pySerial, sherpa-onnx with the SenseVoice (speech recognition) and Supertonic 3 (speech synthesis) models, NVIDIA Jetson
- **Sensor:** Arduino Mega 2560 with a temperature sensor

`[TODO: only what was actually used]`

## Use of Super Intelligence (SI)

`[TODO: list the tools each team member actually used and what for. The lines below are a template.]`

- AI coding assistants (`[tool names]`) were used to write and debug code, including the data pipeline, and to draft documentation and this description. The project idea, the choice of site and the design decisions were made by the team.
- AI-assisted code is marked in the repository's commit messages.
- **Speech models inside the project:** the voice assistant uses a speech recognition model (SenseVoice) and a speech synthesis model (Supertonic 3). Every sentence the assistant speaks is synthesized audio, and so are the sample recordings in `jetson/samples/`. The commands it accepts are matched by keyword rules written by the team. `[TODO: state in the demo video's description and captions that the assistant's voice is synthesized; label jetson/samples/ as synthesized audio]`
- No AI-generated images or video appear in the project. The figures in `docs/figures/` are plots of NASA data drawn by our script; a line under each says the script was written with AI assistance.
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
  - The radiation and weather files come from two instruments with separate archives, so we checked that they share a clock: looked up through spacecraft time, their local solar times agree to within 10 seconds.
  - The weather record behaves as expected: temperature peaks in the early afternoon, and radiation rises when air pressure falls (correlation −0.74), as it should when there is less atmosphere overhead.
- **Checking the route against a real one:** a route computed from our slope layer with the limits above runs 390 m from base to the survey site and never crosses ground steeper than 14.9°. It stays on average 16 m (at most 43 m) from the path Curiosity actually drove between the same two points. An astronaut's planned route and a rover's real route pick the same corridor. (Figure: `docs/figures/route.png`.) `[TODO: recompute with D's actual route, or keep the wording that this is a reference computation]`
- **Reproducibility:** one script rebuilds every data file from the NASA sources, and a second script runs 54 checks on the result. Rebuilding from an empty cache gives byte-identical files.

**Limits we want to be clear about**

- The optical and thermal sources are grayscale. Any color on the map is our display choice, not measured color.
- The thermal image is about 81 m per pixel, so it is only 25 pixels across our map, and its brightness is relative, not a temperature. We show it as it is: it demonstrates how coarse orbital data becomes at walking scale.
- The global geologic map shows our whole site as a single unit, so it informs the legend, not the route.
- The radiation and weather values are a recording of one Martian day (sol 4200, May 30, 2024) replayed during the demo, not a live feed or a forecast. The radiation values are the instrument's reported dose rates; we excluded two observations flagged for possible quality issues and applied no further correction.
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
- W. Iqbal, J. W. Head et al., "Astronaut experiences on the slopes along Apollo EVAs," EPSC Abstracts Vol. 17, EPSC2024-196, 2024 — https://doi.org/10.5194/epsc2024-196 (slope limit for walking)
- Universe Today, "Lunar Astronauts Will Need Easy Walking Trails Around the Moon's South Pole" (2023), quoting David A. Kring — https://www.universetoday.com/articles/lunar-astronauts-will-need-easy-walking-trails-around-the-moons-south-pole (slope limit for Artemis walking traverses)
- Software: Three.js, Vite, NumPy, Rasterio, Pillow, Requests, aiohttp, pySerial `[TODO: only what was actually used; check licenses]`
- sherpa-onnx (speech recognition and synthesis runtime), with the SenseVoice and Supertonic 3 models from its releases — https://github.com/k2-fsa/sherpa-onnx `[TODO: check the model licenses]`
