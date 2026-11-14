# Data guide (slot C)

What the files in `web/public/data/` are, where they came from, how they were processed, and how far they can be trusted.
Written for the people building the map, route and HUD (D, F) and for whoever writes the submission text.

- Format contract: [INTERFACES.md](INTERFACES.md) section 2
- Analysis of the source data: [RESOURCES.md](RESOURCES.md)
- How to build: `data-pipeline/build_data.py` (rebuild), `data-pipeline/validate.py` (check)

Every number here was computed from the actual files by `validate.py` and saved in `data-pipeline/validation_report.json`.

> **Use of AI.** The processing scripts and this document were written with the help of an AI coding tool (Claude). All data values were downloaded from the NASA and USGS addresses below; none were produced by AI.

---

## 1. At a glance

| File | Content | Mission · instrument | Kind |
|---|---|---|---|
| `topo.bin` | Terrain elevation (m), 512×512, 4 m cells | MRO HiRISE·CTX, Mars Express HRSC, MGS MOLA | topographic |
| `slope.bin` | Slope (degrees), 512×512 | Computed from terrain | derived |
| `optical.png` | Optical image, 4096×4096 grayscale | MRO · HiRISE | optical |
| `thermal.png` | Night thermal image, 2048×2048 grayscale | Mars Odyssey · THEMIS | thermal |
| `traverse.json` | The path Curiosity actually drove, 178 stops | MSL Curiosity | ground truth |
| `env.json` | Radiation, pressure, air temperature for 24 hours | MSL Curiosity · RAD, REMS | radiation, atmospheric |
| `pov.json`, `pov/*.jpg` | Rover photos taken at base and at the survey site | MSL Curiosity · Navcam | optical (ground) |
| `layerset.json` | List of the layers above, the grid, base and survey site | — | — |

This covers five of the data kinds named in the challenge text (topographic, optical, thermal, radiation, atmospheric) plus one line of geology, from four NASA missions (MRO, Mars Odyssey, MGS, MSL Curiosity).

## 2. Mission scenario and points

| Point | What | Grid `[col, row]` | Coordinates | Basis |
|---|---|---|---|---|
| Map center | Reference point of the map extent | `[255, 256]` | 137.4075° E, 4.7868° S | Curiosity's sol 4312 position (`RMC 109_120`) |
| `site1` survey site | **Sulfur stone field** | `[275, 272]` | 137.4089° E, 4.7857° S | Sol 4200 position (`RMC 107_2484`). See below |
| `base` | Start and return point | `[247, 357]` | 137.4070° E, 4.7800° S | Sol 4098 position (`RMC 106_438`) |

**Why the survey site is not the map center.** According to JPL, on May 30, 2024 Curiosity drove over a rock and cracked it open, revealing crystals of pure sulfur ([JPL, 2024-07-18](https://www.jpl.nasa.gov/news/nasas-curiosity-rover-discovers-a-surprise-in-a-martian-rock/)). In NASA's raw image record May 30, 2024 is sol 4200, and on that sol the rover drove about 9 m from `107_2394` to `107_2484`. It then stayed near that spot until sol 4237. So the sulfur stone field is placed at the sol 4200 stop. The map center (the sol 4312 position) is about 102 m away, and calling it the sulfur stone field would be wrong.

- We could not find the exact coordinates of the cracked rock in public data. It lies somewhere along the 9 m driven on sol 4200, and `site1` is the end of that drive.
- Bright white stones are visible in the foreground of the rover photo for `site1` (`pov/site1.jpg`).
- The map extent and grid are unchanged. `site.lat` and `site.lon` are still the map center.

**Reference path.** The rover drove 593 m by its odometry from the base position to the survey site and climbed 45.2 m (sol 4098 → 4200). Joining the stops inside the extent with straight lines gives 518 m; the straight-line distance between the two points is 358 m.

**Demo region.** `[265, 262, 285, 282]`: an 80 m square centered on the survey site, mapped onto a 4 m room (1:20). Inside it the slope has a median of 10.7° and a maximum of 26.0°, the relief is 17.4 m, and it contains 11 rover stops. **This is a proposal, to be fixed with D.** Base is outside this region (about 360 m away), so D has to decide how "return to base" is shown inside the room.

## 3. Coordinates and grid

- Every layer covers the same extent (137.39026° E to 137.42481° E, 4.80409° S to 4.76954° S).
- In numeric grids the southwest corner is `[0, 0]` and the index is `row * 512 + col`. In images, up is north.
- Longitude/latitude → grid: `col = floor((lon − west) / (east − west) × 512)`, `row = floor((lat − south) / (north − south) × 512)`. The browser does not do this; it uses the `cell` values in the files.
- **A cell is 4.00 m north–south and about 3.99 m east–west.** The grid is proportional to longitude and latitude, so at 4.8° S the true east–west distance is 0.35% shorter. That is about 7 m across the whole map and can be ignored.

## 4. Layer by layer

### Terrain elevation `topo.bin`, slope `slope.bin`

- **Source:** USGS "Mars MSL Gale Merged DEM 1m" (`MSL_Gale_DEM_Mosaic_1m_v3.tif`, 3.6 GB)
- **Processing:** only the 2,048×2,048 pixel map window was read, not the whole file (the server accepts partial requests). The 1 m values were averaged 4×4 into 4 m cells. Slope is computed on the 4 m grid from the elevation difference to neighboring cells (8 m baseline for interior cells).
- **Value range:** elevation −3846.56 to −3412.10 m, slope 0.03 to 71.07°. No empty cells.
- **What slope means:** the average tilt seen over an 8 m width. Rocks and ledges smaller than that do not show. Filling that gap is A's field scan.
- **Credit:** USGS Astrogeology Science Center. The source includes ESA Mars Express HRSC data, which must be stated in the submission text.

### Optical image `optical.png`

- **Source:** JPL Mars Trek, layer `curiosity_hirise_mosaic`, 182 tiles at zoom level 16
- **Processing:** tiles joined, cropped to the map extent (about 3,220 pixels) and enlarged to 4,096 pixels. The source resolution is about 0.64 m per pixel.
- **Note:** the source is **grayscale**. Any color is a display choice, and the presentation says the source is grayscale.
- **Credit:** NASA/JPL-Caltech/University of Arizona

### Thermal image `thermal.png`

- **Source:** JPL Mars Trek, layer `THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018`, 1 tile
- **Processing:** the map extent is only **25 pixels wide** in the source. It is enlarged so that the source pixels show as squares, without smoothing, to show plainly how coarse orbital thermal data is at walking scale.
- **Note:** brightness is **relative brightness**, not temperature. It cannot be shown in degrees or used in route computation.
- **Credit:** NASA/JPL-Caltech/Arizona State University

### Rover path `traverse.json`

- **Source:** NASA `MSL_waypoints.json` (178 of 1,389 stops fall inside the extent, sols 3880 to 4493)
- **Fields:** `elevM` is the source's `elev_geoid`, `tiltDeg` is the tilt of the rover body, `rmc` is the source's `RMC` (the key that links photos to positions).
- **Note:** the points are stops. Joining them with straight lines is shorter than the real wheel track (518 m versus 593 m above).

### Radiation and atmosphere `env.json`

24 hourly means for **sol 4200 (2024-05-30)**, the day the sulfur was found. The headset replays them in order over the demo. This is **a recording of that day**, not a live feed or a forecast.

| Field | Value | Source |
|---|---|---|
| `radiationUGyPerDay` | daily mean 154.2, hourly 151.7 to 157.0 µGy/day | RAD RDR, E-detector dose rate (µGy/h) × 24 |
| `pressurePa` | 800.4 to 889.2 Pa | REMS MODRDR, `PRESSURE` |
| `airTempK` | 205.8 to 267.7 K (−67 to −5 °C) | REMS MODRDR, `AMBIENT_TEMP` |

- **Radiation is the instrument's value as reported.** It is the `[DOSIMETRY_TOTAL_DOSE_E]` value in the RAD file, without the corrections applied in papers. Of 88 observations, 2 carrying a quality (QC) flag were dropped and 86 used. The E detector is a plastic scintillator, the one closer to human tissue.
- **It changes little within the day.** Radiation stays between 152 and 157. Ordinary values will not trigger a radiation alert, so to show one in the demo the threshold or the method has to be agreed with B.
- **Sanity checks:** temperature peaks at 14:00; pressure is highest before dawn and lowest at 16:00; radiation is higher when pressure is lower (correlation −0.74), the direction expected when there is less atmosphere overhead.
- **Time:** `localTime` is local true solar time (LTST), and both instruments are binned on the same clock. The RAD documentation calls its observation time LMST, but it is LTST: the REMS label ties the spacecraft clock to UTC, RAD gives UTC per observation, and looked up that way the RAD times match the REMS LTST column to within 10 seconds. `build_data.py` runs this check on every build and stops if the two disagree by more than 2 minutes.
- `sourceUrls` holds the addresses of the two source files. The `note` field is explanatory and the loader does not read it.

### Rover photos `pov.json`

| File | Where | Photo |
|---|---|---|
| `pov/site1.jpg` | Survey site, sol 4200 (`107_2484`) | Left Navigation Camera. Bright stones in the foreground |
| `pov/base.jpg` | Base, sol 4098 (`106_438`) | Left Navigation Camera. Horizon and a butte |

- Only images whose `site` and `drive` numbers equal the traverse record's `RMC` were considered, so each photo was taken from that point on the map.
- The survey site photo is the one of 19 full-frame images there whose mast elevation is closest to level. For base, the automatic pick showed a large part of the rover body, so the candidates were reviewed by eye and one was chosen.
- **Credit:** NASA/JPL-Caltech. The source images are black and white.

### Geologic unit

`site.geologicUnit` in `layerset.json` holds `Htu` (Hesperian transition undivided unit, USGS SIM 3292). The whole map is one unit, so it is used only as one line in the legend.

## 5. Legend (for F)

The HUD is English by default and takes its layer names from its own strings. Its Korean mode (`?lang=ko`, for development) shows `label` from `layerset.json` as is, and its tabs are sized for short Korean names, so **`label` is Korean and `labelEn` holds the English name**. With English text in `label`, the Korean-mode tabs overflow (checked in the browser). `labelEn`, `credit`, `rmc` and `sol` are **extra fields** not in INTERFACES; existing fields are unchanged and code works without reading the extras.

| `id` | `label` | `labelEn` | Legend text |
|---|---|---|---|
| `topo` | 지형 높이 | Terrain elevation | −3,847 m to −3,412 m |
| `slope` | 경사도 | Slope | 0° to 71°; steeper is harder to walk |
| `optical` | 광학 영상 | Optical image | Grayscale. 0.64 m per pixel |
| `thermal` | 열 영상 (야간) | Thermal image (night) | Relative brightness, not temperature. 81 m per pixel |
| `base` | 기지 | Base | — |
| `site1` | 황 암석 지대 | Sulfur stone field | — |

One-line credit: `Data: NASA/JPL-Caltech/University of Arizona, NASA/JPL-Caltech/Arizona State University, USGS Astrogeology Science Center`

**Figures for the submission page and slides** (`docs/figures/`, rebuilt with `python validate.py --figure`):

| File | Content |
|---|---|
| `layers.png` | The four layers (optical, terrain shading, slope, thermal) in one image, with the rover path, base and survey site |
| `route.png` | Base to survey site: the route computed from the slope layer and the path the rover actually drove |

Both are plots of NASA data drawn by a script, not AI-generated images. A line under each figure says the script was written with AI assistance. The submission page accepts images up to 10 MB.

## 6. How accurate it is

`validate.py` runs 54 checks and all pass. The ones that test the layers against each other:

| What was checked | Result |
|---|---|
| Terrain elevation versus the elevation the rover recorded | Difference −0.17 m on average, standard deviation 0.24 m, at 178 stops |
| Whether the terrain is shifted sideways | Shifting the terrain by up to ±5 cells (20 m) never matches the rover elevations better than no shift |
| Terrain slope versus rover tilt | Median slope where the rover stood 8.8°, median rover tilt 9.1° |
| Optical image versus terrain | Shading computed from the terrain matches the optical image best within 1 cell (4 m). The correlation is only 0.29, so we can say no more than "not off by much more than 4 m" |
| Format | Grid length, empty cells, min/max, image size, source addresses and coordinates all match INTERFACES |

It was also checked in a browser: the built app opened with `?mock=link,hazard` loads these files and emits `layers:ready` and `env:update`, and the HUD shows the real values. **It has not been checked on the headset.**

## 7. Choosing the slope criterion (with D)

The shortest path from base to the survey site stepping only on cells at or below a slope limit:

| Slope limit | Walkable share of the map | Base → survey site |
|---|---|---|
| ≤ 10° | 37.6% | no route |
| ≤ 15° | 57.3% | 386 m |
| ≤ 20° | 69.7% | 386 m |
| ≤ 25° | 78.6% | 386 m |
| ≤ 30° | 86.2% | 386 m |

- The straight-line distance is 358 m; the path the rover drove is 518 m (joining its stops).
- **A 10° limit cuts the route.** From 15° up the same path results. The tilt the rover took inside this extent has a median of 9.1°, a 90th percentile of 15.4° and a maximum of 22.4°.

### Proposed rule: avoid above 15°, close above 20°

We found evidence for the slopes that people in spacesuits have walked. Both sources are about the Moon; we found nothing for Mars.

| Limit | Evidence | Source |
|---|---|---|
| **Below 15°** | "The astronauts climbed up to 150 m during the Apollo missions and walked on slopes of <15°." | Iqbal, Head et al., *Astronaut experiences on the slopes along Apollo EVAs*, EPSC2024-196 ([abstract](https://meetingorganizer.copernicus.org/EPSC2024/EPSC2024-196.html), read in full) |
| **Below 20°** | On the first Artemis walking missions: "Any traverse needs to be on slopes less than 20 degrees." (David Kring, LPI) | Universe Today 2023 ([article](https://www.universetoday.com/articles/lunar-astronauts-will-need-easy-walking-trails-around-the-moons-south-pole), read in full. An article quoting a researcher, not a NASA requirements document) |

- So we propose that **route cost rises quickly above 15° and cells above 20° are closed**. 69.7% of our map is at or below 20°.
- These figures are from the Moon (1/6 g). Mars (0.38 g) may differ. The submission text says the limits are "taken from Apollo walking experience and Artemis walking plans."
- The rover's tilt record is what the rover took, not a human standard. Still, the slope where the rover stopped on this stretch (median 8.6°, maximum 14.5°) is inside 15°, which is consistent with the rule.

### Does the slope layer give a sensible route?

We computed a route with the rule above and compared it with the path the rover actually drove (`validate.py`; step cost = distance × (1 + (slope/15)²), cells above 20° closed).

| | Route computed from our slope layer | Path the rover drove |
|---|---|---|
| Length | 390 m | 518 m (joining its stops) |
| Slope along it | median 6.8°, maximum 14.9° | at the stops: median 8.6°, maximum 14.5° |

- The computed route stays **16 m on average and 43 m at most** from the rover's path. It follows the same corridor. See `docs/figures/route.png`.
- The rover's path is probably longer because it detoured for science (not verified).
- The route is saved as a list of cells in `data-pipeline/reference_route.json`. It **does not replace D's route**; it is there to compare D's result against.

## 8. Limits to keep in mind

- Not run on the headset. If `optical.png` (7.8 MB, 4096 pixels) is too heavy, change `OPTICAL_PX` to 2048 in `build_data.py` and rebuild.
- The optical and thermal images are grayscale, and thermal brightness is not temperature.
- Radiation is the uncorrected instrument value, and one day's record.
- The exact position of the cracked sulfur rock is unknown. The survey site is where that day's drive ended.
- The examples in INTERFACES place the survey site at the map center `[256, 256]`. The real file has `[275, 272]`. Code must read `waypoints` from `layerset.json`.
