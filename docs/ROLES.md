# Roles

Six people each take one slot, A–F. Owners are listed in the table below.

| Slot | Role | Skills needed | Expected token use | Owner |
|---|---|---|---|---|
| [A](#a--real-time-environment-analysis) | Real-time environment analysis | 3D math, WebGL | Highest | 이효제 |
| [B](#b--xr-core--integration-lead) | XR core · integration lead | Web front end in general, Git | High | 차유근 |
| [C](#c--nasa-data-layers--mission-scenario) | NASA data layers · mission scenario | Python, data processing | Highest | 김건민 |
| [D](#d--map--route-guidance) | Map · route guidance | 3D math, algorithms | Medium-high | 안현상 |
| [E](#e--jetson-hub--voice--sensor) | Jetson hub · voice · sensor | Python, Linux, embedded | High | 김도훈 |
| [F](#f--hud-ui--demo) | HUD UI · demo | UI, video editing | Medium | 길윤석 |

**Common principle**: this project is built on NASA data. Which NASA data each feature starts from is in [README section 1](../README.md#principle-every-feature-starts-from-nasa-data).

**How to read this**

- Grades P0 / P1 / P2 are defined in [README section 3](../README.md#3-features-and-priorities). Finish P0 first.
- All data formats are in [INTERFACES.md](INTERFACES.md). Only names are used here.
- "Expected token use" is an estimate from the nature of the work handed to an AI. It is not measured.

**Schedule notes**

- The two most important seats are **B** and **C**. If B is late nobody can merge; if C is late the map is empty. If either is stuck, tell the team at once.
- There is one headset. A, B and D, who really need the device, share it by time. The rest of the time everyone develops in mock mode.

---

## A — Real-time environment analysis

> Builds a map of nearby obstacles from the headset depth sensor. It shows the route built from NASA data reacting to real space: the kick of the demo.

- Folder: `web/src/scan/`
- Basis: challenge text Q5, Q7 ([README section 2](../README.md#2-what-the-challenge-asks-for))

### Tasks

| Grade | Task |
|---|---|
| P1 | Receive WebXR depth and mesh data and turn it into a floor grid |
| P1 | Classify each cell as "passable / obstacle / unknown" and send `hazard:update` |
| P1 | Show obstacles on screen (for example a red outline) |
| P2 | Night vision: draw depth and mesh as green outlines (with F) |

### Done when

- Putting a chair in the room marks that spot as obstacle cells.
- Removing the chair clears it within a few seconds.
- Fake obstacles appear in mock mode without the headset.

### Exchanges

| Direction | With | What |
|---|---|---|
| Receives | B | XR session, per-frame call |
| Gives | D | `hazard:update` (used for route recalculation) |
| Gives | F | `hazard:update` (used for the night vision display, P2) |

### First 3 hours

1. When B's skeleton is up, check on the headset that depth and mesh data actually arrive.
2. If they do not, tell the team at once and fall back to plane detection (`plane-detection`).
3. Make the mock data (a fake obstacle grid) first and hand it to D, so D is not kept waiting.

Meta's help pages confirm that the Quest browser provides depth and mesh data on Quest 3 ([Meta help](https://www.meta.com/help/quest/1406582186767703/), search summary). There are also developer reports that the room mesh was not drawn ([Babylon.js forum](https://forum.babylonjs.com/t/webxr-room-mesh-access/45744), search summary). It must be checked on the device.

### Work that uses many tokens

| Rank | Work | Why it costs | How to reduce it |
|---|---|---|---|
| 1 | Debugging errors that only happen on the device | The AI cannot see the headset screen, so pasting logs and asking repeats | First build a tool that prints debug text on screen. Paste only the relevant log lines |
| 2 | Depth data → floor grid conversion | Coordinate transforms and matrix math are tangled, and long code gets rewritten several times | Ask one function at a time. Fix the input and output formats first |
| 3 | Checking WebXR API usage | The API changes often and the AI may produce wrong code | Paste the relevant part of the official docs with the question |

---

## B — XR core · integration lead

> Builds the skeleton and merges everyone's code into one. Has the final say on technical decisions.

- Folders: `web/src/core/`, `web/src/mock/`, build configuration

### Tasks

| Grade | Task |
|---|---|
| P0 | Project skeleton (Vite + Three.js), AR session start button |
| P0 | Event bus (`bus.js`) |
| P0 | Serve over HTTPS so the headset can connect (with E) |
| P0 | Data loader: reads `layerset.json` and the rest, sends `layers:ready` and `env:update` |
| P0 | Jetson link (`link.js`): WebSocket messages ↔ events |
| P0 | Mock mode: appending `?mock=1` to the address runs on fake data |
| P0 | Merging into `main`, integration tests |
| P1 | Send microphone input to the Jetson and play the audio received |
| P1 | Turn voice commands into `nav:request` and `layer:toggle` |
| P1 | Raise the radiation alert (from `env.json`) and the Jetson disconnect alert |

### Done when

- Opening the address in the headset browser and pressing the button shows the AR screen.
- Opening it with `?mock=1` in a PC browser makes every event flow without the headset or the Jetson.
- Demo flow steps 1–4 run without a break.

### Exchanges

| Direction | With | What |
|---|---|---|
| Gives | Everyone | Skeleton, event bus, mock mode |
| Receives | C | Files in `web/public/data/` |
| Receives/gives | E | WebSocket messages |
| Receives | Everyone | Merge requests |

### First 3 hours

1. Put up the skeleton and the event bus **within 1 hour**. Everyone else starts from it.
2. Confirm HTTPS access and AR session start on the headset.
3. Check that hand tracking and the microphone permission appear, and tell D and E.
4. Fix the starting values in INTERFACES.md with the team.

WebXR only works on HTTPS or localhost ([MDN: Navigator.xr](https://developer.mozilla.org/docs/Web/API/Navigator/xr), search summary). Serving from the Jetson needs a certificate.

### Work that uses many tokens

| Rank | Work | Why it costs | How to reduce it |
|---|---|---|---|
| 1 | Integration debugging | Several people's modules must be read at once to find the cause | Pick one failing event and give only the sending and receiving files |
| 2 | HTTPS, certificate and network problems | Every environment differs, so trial and error runs long | Give the exact error message and the network layout in one go |
| 3 | Generating the skeleton | Many files come out at once | It is done once. Write all the requirements up front and get it in one pass |

---

## C — NASA data layers · mission scenario

> Gets NASA data and processes it into map layers. This seat owns the core task of the challenge.

- Folders: `data-pipeline/`, `web/public/data/`, `docs/`
- Basis: challenge text Q1, Q2, Q3, Q4

### Tasks

| Grade | Task |
|---|---|
| P0 | Find out the submission requirements (video length, description items, deadline) and share them |
| P0 | **Optical layer** (`optical.png`): fetch 182 HiRISE tiles from Mars Trek and stitch them — first of all |
| P0 | **Terrain layer** (`topo.bin`) and slope (`slope.bin`): crop the map extent from the USGS file — within 12 hours |
| P0 | Thermal layer (`thermal.png`): one THEMIS tile from Mars Trek. Brightness is relative, not temperature |
| P0 | Right after getting the terrain file, check the elevation reference: sample terrain elevation at the rover stops, compare with `elev_geoid` in the traverse record, and check the overlap with the optical image |
| P0 | Curiosity traverse (`traverse.json`): keep the rover stops inside the map extent |
| P0 | Radiation values (`env.json`): extract from the RAD files. If not done in 6 hours, use a published value |
| P0 | Decide the base coordinates (`waypoints`) |
| P0 | Submission text: which data from which mission was used and why |
| P1 | Pick Curiosity photos of the survey site (`pov.json`) |
| P2 | Check the atmospheric (REMS) data and add it to `env.json` |

The site and the map extent are decided (Gediz Vallis channel, a 2,048 m square). Data addresses, the tile formulas, and what is and is not verified are all in [RESOURCES.md](RESOURCES.md). **Read it before starting.**

### Done when

- `layerset.json` has three or more layer kinds, all on the same grid.
- Curiosity's traverse laid on the terrain does not stray off the path (the easiest alignment check).
- Every layer has `mission`, `instrument` and `sourceUrl` filled in.
- Data from two or more different NASA missions is included (challenge text: "data from multiple NASA science missions").
- Switching layers on D's map never misaligns with the terrain.

### Exchanges

| Direction | With | What |
|---|---|---|
| Gives | B, D | `layerset.json`, `*.bin`, `*.png` |
| Gives | D | `traverse.json` |
| Gives | F | `env.json`, layer legend, `pov.json` |
| Gives | Everyone | Site and science goal, submission requirements |
| Receives | F | Demo video |

### First 3 hours

1. **Start the terrain file (3.6 GB) download first.** Also check whether a part of it can be fetched.
2. Read the submission requirements and post a summary in the team channel.
3. While the download runs, fetch the HiRISE optical tiles and make `optical.png`. That alone puts real Mars on D's map.
4. Hand over `layerset.json` and `topo.bin` with fake terrain (a gentle hill) **first**, so D is not kept waiting.
5. Make `traverse.json` from the traverse record. The file is small, so it is quick.

The terrain file is at `planetarymaps.usgs.gov`. The address and size are confirmed, but the file has not been downloaded.

### Work that uses many tokens

| Rank | Work | Why it costs | How to reduce it |
|---|---|---|---|
| 1 | Interpreting radiation (RAD) data | It is close to raw, so the long format document (SIS) has to be read | Give only the tables and field descriptions needed, not the whole document. Stop after 6 hours |
| 2 | Aligning layers with different coordinate systems and resolutions | When a projection conversion is off, finding the cause takes several rounds | Give the spec table and the tile formulas from RESOURCES.md as is |
| 3 | Repeated edits to processing scripts | Large files run slowly and errors show up late | Run a small crop first. Give summary statistics, not the data itself |
| 4 | Submission text | Writing and polishing | Give the evidence table (mission, instrument, address) and get the draft in one pass |

**Do not paste data files into the AI.** It is the fastest way to burn tokens.

---

## D — Map · route guidance

> Shows the palm map, computes the route and lays arrows on the floor.

- Folders: `web/src/map/`, `web/src/nav/`
- Basis: challenge text Q1, Q7, Q8

### Tasks

| Grade | Task |
|---|---|
| P0 | Build 3D terrain from the height grid (`topo`) and drape the layer image over it |
| P0 | Raising the left palm shows the map above the hand |
| P0 | Switch the draped layer on `layer:toggle` |
| P0 | Compute the route with slope as the cost (A* or similar) |
| P0 | Draw the path Curiosity actually took (`traverse.json`) on the map in a different color |
| P0 | Convert the route to room coordinates and lay floor arrows. Send `nav:route` |
| P0 | On a `critical` alert, switch to the route to base |
| P1 | Recompute the route around obstacles from `hazard:update` |
| P1 | Show the current position, the route and the survey site on the map |

### Done when

- Raising the palm shows the map within 1 second; lowering it hides the map.
- Requesting a destination gives a route that goes around steep ground.
- Following the floor arrows ends in `arrived`.
- Putting a chair on the route makes the arrows go around it (P1).

### Exchanges

| Direction | With | What |
|---|---|---|
| Receives | B | `layers:ready`, `nav:request`, `layer:toggle`, `alert:raise` |
| Receives | A | `hazard:update` |
| Gives | F | `nav:route` |
| Gives | Everyone | Map grid ↔ room coordinate conversion functions (only D writes them) |

### First 3 hours

1. Show 3D terrain from a fake height grid in a PC browser.
2. Check with B that hand tracking arrives on the headset. If not, use a controller button instead.
3. Decide the conversion convention (which side of the room is north) and tell A and F.

### Work that uses many tokens

| Rank | Work | Why it costs | How to reduce it |
|---|---|---|---|
| 1 | Palm gesture detection | Whether the joint orientation math is right only shows on the device, so edits repeat | Fix the conditions as numbers (angle above so many degrees) and tune them yourself with the joint values on screen |
| 2 | Map grid ↔ room coordinate conversion | Flipped axes are a common mistake | Give the convention and three example coordinates, and get test code with it |
| 3 | Path finding | The algorithm is well known and comes out in one pass | Just give exact input and output formats |

---

## E — Jetson hub · voice · sensor

> Runs the voice assistant and the temperature sensor on the Jetson. Owns everything outside the headset.

- Folders: `jetson/`, `arduino/`
- Basis: challenge text Q6, Q10

### Tasks

| Grade | Task |
|---|---|
| P0 | Arduino firmware: read the temperature and send it over serial every second |
| P0 | Jetson hub server: read serial and send `telemetry` over WebSocket |
| P0 | Send `alert.raise` above the temperature threshold and `alert.clear` when it drops |
| P0 | Serve the web app over HTTPS (with B) |
| P1 | Speech recognition (STT): turn audio from the headset into text |
| P1 | Intent parsing: turn text into one of the [defined commands](INTERFACES.md#6-voice-commands) |
| P1 | Speech synthesis (TTS): turn guidance sentences into audio and send it to the headset |
| P1 | Answer "Status report" by voice with the current temperature and route state |

The voice assistant covers **equipment management and the defined commands**, in English. No free conversation. Intent parsing starts with keyword rules; a small language model is added only if time remains.

### Done when

- Holding the sensor in a hand raises the temperature in the headset status panel.
- Above the threshold the screen flashes red; it stops when the sensor cools.
- Saying "Take me to the survey site" lays the arrows within 2–3 seconds (P1).
- The server runs in mock mode on a PC without the Jetson.

### Exchanges

| Direction | With | What |
|---|---|---|
| Receives/gives | B | All WebSocket messages |
| Gives | F | (via B) temperature, alerts |
| Gives | D | (via B) voice commands |

### First 3 hours

1. Check that temperature values come out of the Arduino over serial.
2. Put up a WebSocket server that sends fake temperatures first and give B the address.
3. Install STT and TTS on the Jetson and measure whether they are fast enough.
4. Measure the temperature of the real sensor held in a hand and tune the alert thresholds.

STT and TTS speed was measured on the Jetson (see [jetson/README.md](../jetson/README.md)); accuracy with real voices through the headset microphone still has to be checked.

### Work that uses many tokens

| Rank | Work | Why it costs | How to reduce it |
|---|---|---|---|
| 1 | Fixing Jetson install errors | Install logs are long and Jetson-specific package problems are common | Give the 30 lines around the first error, not the whole log. State the Jetson OS version first |
| 2 | Voice streaming | Microphone → server → recognition → synthesis → playback is one chain, and it is hard to find where it broke | Test each stage alone (STT from a recorded file, TTS from text) |
| 3 | Writing the hub server | Comes out in one pass | Give INTERFACES.md section 4 as is |
| 4 | Arduino firmware | Short | Give only the sensor model and the pin number |

---

## F — HUD UI · demo

> Builds the status panel and the emergency screen, and shoots the demo video the judges will see.

- Folder: `web/src/hud/`
- Basis: challenge text Q6, Q8, Q9

### Tasks

| Grade | Task |
|---|---|
| P0 | Status panel: suit temperature, radiation, current elevation, geologic unit, remaining distance, current layer name |
| P0 | Emergency mode: on a `critical` alert the screen edges flash red. Send `mode:change` |
| P0 | Layer switching UI and legend (next to the palm map) |
| P0 | Write the demo script, run the rehearsal, shoot and edit the demo video |
| P1 | Show `warn` alerts, route status messages |
| P1 | Near the survey site, show the photo Curiosity took there |
| P2 | Night vision screen (with A), recording mode indicator |

### Done when

- The status panel follows in a corner of the view and stays readable while walking.
- On a temperature alert the flashing starts within 1 second and stops when the alert clears.
- The flashing does not cover the map or the arrows.
- The demo video meets the submission requirements (checked by C).

A whole screen flashing fast can be uncomfortable to look at. Flash only the edges, slowly.

### Exchanges

| Direction | With | What |
|---|---|---|
| Receives | B | `telemetry:update`, `env:update`, `alert:raise`, `alert:clear`, `layers:ready` |
| Receives | D | `nav:route` |
| Receives | C | Layer legend, `pov.json` |
| Gives | D | `layer:toggle`, `nav:request` |
| Gives | Everyone | `mode:change` |
| Gives | C | Demo video |

### First 3 hours

1. Show the status panel with mock data in a PC browser.
2. Check text size and distance on the headset. A size that looks good on a PC may be unreadable there.
3. Find out how to record the headset screen. Trying it for the first time at hour 36 is too late.
4. Write a first draft of the demo script.

### Work that uses many tokens

| Rank | Work | Why it costs | How to reduce it |
|---|---|---|---|
| 1 | Panel layout and legibility tweaks | Requests like "a bit bigger, a bit to the left" repeat dozens of times | Ask for size and position as settings, then change the numbers yourself |
| 2 | Flash and outline effects | Shader code only proves right on the device | Specify the look as numbers (period, color, thickness) |
| 3 | Demo script and captions | Polishing the wording | Finish the script first, then polish it in one pass |

---

## For everyone: how to save AI tokens

1. **Give only what is needed.** INTERFACES.md and your own folder. Do not make it read the whole repository.
2. **Fix the format first.** Saying "the input is this, the output is this" up front reduces rewrites.
3. **Trim logs.** Paste only the lines around the first error.
4. **Tune numbers yourself.** Put sizes, colors and thresholds in settings and edit them by hand.
5. **Do not paste large files.** Summarize data files and build output.
6. **If stuck, ask a person within 30 minutes.** Someone next to you may already have hit the same problem.
