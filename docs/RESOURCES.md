# Resource analysis

What we found by connecting to the five resources published on the challenge's Resources tab. Checked on 2026-11-13.

**Marking**

- **[checked directly]**: we connected to the address from the environment that produced this document and read the response.
- **[search summary]**: confirmed only from a search result summary. The source page was not opened.
- **[not verified]**: unknown.

## At a glance

> **Status (2026-11-14): every resource below has been turned into files in the repository.** Section 8 lists what was built from which resource and where it is. Section 7 lists what we confirmed along the way. Sections 1–6 are the analysis as written before the hackathon, kept as the record of what we expected.

- **Exploration site**: the **Gediz Vallis channel** on Mount Sharp, Gale Crater. It does not overlap the boxwork example in the challenge text.
- **Six or more layers are usable**, from four different missions (MRO, Mars Odyssey, MGS, MSL Curiosity).
- **At walking scale only HiRISE terrain and optical are sharp.** Thermal is about 100 m, and the geologic map shows the whole site as one unit. This limit is the gap the challenge text describes, and the reason the helmet sensor is needed.
- **The path Curiosity actually drove and its photos are available with coordinates.** We use them to validate our route and to pin real Mars photos on the map.
- **Terrain elevation values cannot be read from Mars Trek tiles.** They must be cropped from a 3.6 GB USGS file.

---

## 1. Resources tab text

Copied from the screen the team lead provided.

| # | Resource | Description on the tab |
|---|---|---|
| R1 | Jet Propulsion Laboratory's (JPL) Mars Trek | "NASA web-based portal for exploration of Mars, showcases data collected by NASA at various landing sites." |
| R2 | USGS-NASA Planetary Geologic Mapping Program | "High-quality standardized geologic map of Mars" |
| R3 | Example of a route map visual for the Curiosity example mentioned above | "This animation shows a proposed route for NASA's Curiosity rover, which is climbing lower Mount Sharp on Mars. The annotated version of the map labels different regions that scientists working with the rover would like to explore in coming years. A flyover video explains them in more detail." |
| R4 | NASA Worldview | "Visually explore the past and the present of this dynamic planet from a satellite's perspective. Select from an array of stories below to learn more about Worldview (a part of NASA Earthdata), the satellite imagery we provide and events occurring around the world." |
| R5 | Mars Perseverance Raw Images Gallery | "Over 1 million images captured by the rover on its journey across the Mars surface." |

Notice at the top of the tab: "For non-U.S. Government websites, participants must comply with any data use parameters of that specific website." When using material from a site that is not NASA or USGS, follow that site's terms of use.

---

## 2. Analysis per resource

### R1. Mars Trek — the main source of our map

Address: https://trek.nasa.gov/mars/

- **Map tiles can be fetched by address alone.** It is WMTS with no login. [checked directly]
- **They load straight into a browser.** Tile responses carry `Access-Control-Allow-Origin: *`. [checked directly]
- **225 products are registered**, 39 of which cover our site. [checked directly]
- Tiles are 256×256 PNG. [checked directly]

Useful layers covering our site (137.40° E, 4.75° S):

| Kind (Q4) | Layer ID | Mission · instrument | Resolution at maximum zoom | Verdict |
|---|---|---|---|---|
| Optical | `curiosity_hirise_mosaic` | MRO · HiRISE | about 0.64 m/px | **Main layer.** Rocks are visible |
| Optical | `Gale_CTX_BlockAdj_dd` | MRO · CTX | about 10 m/px | Wide-area background |
| Terrain | `Gale_DEM_SMG_1m` | MRO · HiRISE | about 2.5 m/px | **Usable as a picture only.** See the caution below |
| Thermal | `THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018` | Mars Odyssey · THEMIS | about 81 m/px | Usable but blurry |
| Thermal | `THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018` | Mars Odyssey · THEMIS | about 81 m/px | Usable but blurry |
| Thermal | `TES_Thermal_Inertia` | MGS · TES | about 20 km/px | Useless at walking scale |
| Geologic | `SIM3292_Global_Geology` | USGS global geologic map | about 20 m/px (tiles) | Whole site is one unit. For explanation |
| Terrain | `mola128_mola64_merge_90Nto90S_SimpleC_clon0` | MGS · MOLA | about 1.3 km/px | Global background |

Resolutions are computed from the maximum zoom level in the WMTS configuration (256 px tiles, Mars radius 3,396,190 m).

**Caution: elevation values cannot be read from Trek's terrain tiles.** `Gale_DEM_SMG_1m` tiles are 8-bit gray pictures. In one sample tile (about 650 m across) the brightness range was 32–40, only 8 steps. That cannot be used for slope. Elevation must come from the "terrain elevation file" below. [checked directly]

**Optical and thermal tiles are 8-bit grayscale.** All six sample tiles were gray + alpha (only the geologic map uses a palette). [checked directly] Used as is, the map is black and white.

- Optical: whether to colorize is decided in the HUD design (F). A reddish Mars-like tint is a presentation choice, not a distortion of fact, but **we state in the presentation that the source is grayscale.**
- Thermal: brightness is relative brightness, not a temperature value. It cannot be shown as "so many degrees" or fed into route computation as a number. The thermal layer is for display.

Tile address format [checked directly]:

```
https://trek.nasa.gov/tiles/Mars/EQ/{layer ID}/1.0.0/default/default028mm/{zoom}/{row}/{col}.png

col = floor((longitude + 180) / 360 × 2^(zoom+1))
row = floor((90 − latitude) / 180 × 2^zoom)
```

The full layer list is returned as JSON from [checked directly]:

```
https://trek.nasa.gov/mars/TrekServices/ws/index/eq/searchItems?start=0&rows=2147483647&facetKeys=itemType&facetValues=product
```

Per-layer configuration is at `https://trek.nasa.gov/tiles/Mars/EQ/{layer ID}/1.0.0/WMTSCapabilities.xml`.

### R2. USGS-NASA Planetary Geologic Mapping Program — for explanation only

Address: https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars

- The page is a collection of interactive maps. Its content is drawn by script, so we could not read the full list. [not verified]
- The global geologic map (SIM 3292) is also a layer on Mars Trek, and the geologic unit can be queried by coordinate. [checked directly]
- **The geologic unit of our site is `Htu` (Hesperian transition undivided unit).** [checked directly]
- The map is at 1:20,000,000 scale ([USGS SIM 3292](https://pubs.usgs.gov/publication/sim3292), search summary). At walking scale the whole site is one unit, so it does not help path finding.

Use: one line in the map legend, "geologic unit of this place". It is evidence that one more distinct source is layered in.

### R3. Curiosity's Proposed Path up Mount Sharp — design reference

Address: https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/

- What can be downloaded is one 1041×586 GIF (2.86 MB). It is not a data file. [checked directly]
- The page states which data the map was made from. [checked directly]

  > "Data used in creating this map came from several instruments on NASA's Mars Reconnaissance Orbiter (MRO), including the High Resolution Imaging Science Experiment (HiRISE), Compact Reconnaissance Imaging Spectrometer for Mars (CRISM) and the Context Camera (CTX). The High Resolution Stereo Camera (HRSC) instrument on the European Space Agency's Mars Express also contributed data."

Use: a model "route map" made by NASA itself. We borrow its way of marking regions and drawing the route. We use data from the same instruments (HiRISE, CTX).

### R4. NASA Worldview — not Mars data

Address: https://worldview.earthdata.nasa.gov/

- Page description: "Interactive interface for browsing full-resolution, global, daily satellite images. Supports time-critical application areas such as wildfire management, air quality measurements, and weather forecasting." [checked directly]
- It is a tool for viewing Earth observation imagery. Whether it has Mars layers was not checked. [not verified]

Use: a screen layout reference, not a data source. The challenge text also says "Look at how NASA missions to destinations other than Mars—Earth, the Moon, other planets in our solar system, and exoplanets in other systems—have created this type of map, for inspiration". We borrow how layers are turned on and off and how the legend is shown.

### R5. Mars Perseverance Raw Images Gallery — a different site

Address: https://mars.nasa.gov/mars2020/multimedia/raw-images/

- The photo list is available as JSON. The response reports 1,055,868 photos in total. [checked directly]
- Each photo carries its sol, camera and image addresses per size. [checked directly]
- **Perseverance is not in Gale Crater.** These photos do not show our site.

Photos of our site come from the **Curiosity raw images**. They are not on the Resources tab, but they are the same kind of material on the same NASA site.

- Address: `https://mars.nasa.gov/api/v1/raw_image_items/?order=sol+desc&per_page=50&page=0&condition_1=msl:mission&condition_2={first sol}:sol:gte&condition_3={last sol}:sol:lte&search={camera name}` [checked directly]
- 1,518,427 photos in total. [checked directly]
- **Photos can be pinned to map coordinates.** A photo's `site` and `drive` values match the `RMC` value in the traverse record below. Example: the navigation camera photos of sol 4312 are `site 109, drive 120`, and `RMC 109_120` in the traverse record is 137.4075° E, 4.7868° S. [checked directly]

---

## 3. NASA data found outside the Resources tab

### Terrain elevation file (USGS)

- Name: Mars MSL Gale Merged DEM 1m ([USGS page](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m)) [checked directly]
- File: `https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif`, 3.6 GB [checked directly: address and size. The file itself was not downloaded]
- Specification (from the label file) [checked directly]:

| Item | Value |
|---|---|
| Size | 32,980 × 57,440 pixels |
| Resolution | 1.0 m/pixel |
| Value format | Real numbers (elevation, meters) |
| Extent | 137.1242° E – 137.6806° E, 5.0987° S – 4.1296° S |
| Projection | Equirectangular, center latitude 0°, radius 3,396,190 m |

- How it was made: "The DEM is built up from High Resolution Stereo Camera (HRSC), Mars Reconnaissance Orbiter (MRO) Context Camera (CTX), and High Resolution Imaging Science Experiment (HiRISE) DEMs all tied to a Mars Orbiter Laser Altimeter (MOLA) DEM." [checked directly]
- **Whether a part of the file can be fetched without downloading all of it was not verified.** [not verified] If not, the 3.6 GB must be downloaded once. It is the first download to start when the hackathon begins.

### Curiosity traverse record (NASA)

- Address: `https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json` (about 0.66 MB) [checked directly]
- Path line: `https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_traverse.json` (about 1.36 MB) [checked directly]
- Contents: 1,388 rover stops from sol 3 to 5070. Each has longitude, latitude, elevation, rover tilt and cumulative drive distance. [checked directly]
- Overall extent: 137.3528° E – 137.4494° E, 4.8257° S – 4.5891° S, elevation −4521.3 m to −3473.7 m, 38,610 m cumulative [checked directly]
- All 1,388 stops are inside the terrain file above and the HiRISE optical layer. [checked directly]

It is very useful.

1. **Route validation**: we show our computed route next to the path Curiosity actually took.
2. **Traversability criterion**: the tilt the rover actually withstood supports our traversability threshold. Over the whole record the median tilt is 7.7°, the top 10% is 14.7° and the maximum is 29.1°. This is the tilt of the rover body, however, not a criterion for slopes a person can walk.
3. **Photo positions**: the key to pinning the R5-style photos to coordinates.

### Radiation (Curiosity RAD)

- Address: https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/ [checked directly]
- It is split into folders by sol range; the most recent is `SOL_04710_04843`. The period when the rover passed our site (`SOL_04258_04354`) is there too. [checked directly]
- Format: "The RDR files are in ASCII format." But it also says "The RDR data are NASA Level 1A data that mirror the raw instrument data obtained from telemetry". [checked directly]
- **How long it takes to extract dose rates from these files was not verified.** [not verified] They are close to raw, so the format document (SIS) has to be read.
- Alternative: use a published value as a fixed value. The galactic cosmic ray dose rate in Gale Crater is reported as about 180–225 µGy per day ([paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC8981195), search summary).

### Atmosphere (Curiosity REMS)

- Address: https://atmos.nmsu.edu/data_and_services/atmospheres_data/MARS/curiosity/rems.html
- **The connection failed** (certificate verification error in this environment). [not verified]
- That it contains pressure and temperature and covers sols 1–3778 is confirmed only from a search summary. [search summary] Whether it includes the period when the rover passed our site (sols 4100–4350) is unknown.

---

## 4. Exploration site: Gediz Vallis channel

### Why here

- It does not overlap the example in the challenge text (boxwork).
- It is a region on the R3 route map, named as a place scientists wanted to explore ([USGS article](https://www.usgs.gov/news/new-msl-video-fly-over-mount-sharp-mars), search summary).
- Curiosity actually visited in 2024, so photos and a traverse record exist.
- The science goal is clear. Curiosity found rocks of pure sulfur here ([JPL](https://www.jpl.nasa.gov/news/nasas-curiosity-mars-rover-takes-a-last-look-at-mysterious-sulfur/), search summary).

### Coordinates

| Item | Value | Evidence |
|---|---|---|
| Reference point inside the channel | 137.4075° E, 4.7868° S, elevation −3689.7 m | Traverse record, sol 4312 [checked directly] |
| Evidence that the point is inside the channel | Panorama taken inside the channel on sols 4311–4312 | [JPL PIA26410](https://www.jpl.nasa.gov/images/pia26410-curiositys-view-within-gediz-vallis-channel/), search summary |
| When the rover left the channel | sol 4352 (2024-11-02) | [search summary](https://astrobiology.com/2024/11/19/mars-rover-curiosity-panorama-of-gediz-vallis-channel/) |
| When the rover entered the channel | Unknown | [not verified] |

### Map extent (proposal)

A 2,048 m × 2,048 m square centered on the reference point.

- 137.39026° E – 137.42481° E, 4.80409° S – 4.76954° S
- Entirely inside the terrain file and the HiRISE optical layer. [checked directly]
- It contains 178 Curiosity stops (sols 3880–4493, elevation −3808.2 m to −3673.3 m). [checked directly]
- Rover tilt over this stretch: median 9.1°, top 10% 15.7°, maximum 22.4° [checked directly]

Reference path: from sol 4098 to 4312 Curiosity drove about 1,001 m and climbed 44 m (−3733.6 m → −3689.7 m). [checked directly] A fitting length for the "base → survey site" leg of our mission.

### How sharp the layers are over this extent

| Layer | Pixels across 2,048 m | Tiles needed |
|---|---|---|
| HiRISE optical | about 3,220 | 182 |
| Terrain (USGS file, 1 m) | 2,048 | (cropped from the file) |
| CTX optical | about 201 | 4 |
| THEMIS thermal | about 25 | 1 |

**The thermal image is only 25 pixels across the whole map.** Overlaid, it looks like a coarse mosaic. We do not hide this; we say it in the presentation. It is evidence of how coarse orbital data is at walking scale, and it leads straight to the challenge text's "built for regional and global views rather than the hyperlocalized areas astronauts will target".

---

## 5. Confirmed layers

| Rank | Layer | Kind (Q4) | Mission · instrument | Source | Status |
|---|---|---|---|---|---|
| 1 | Terrain elevation | topographic | MRO HiRISE·CTX, Mars Express HRSC, MGS MOLA | USGS file | **Done** → `topo.bin` |
| 2 | Slope | (derived) | Same as above | Computed from terrain | **Done** → `slope.bin` |
| 3 | Optical image | optical | MRO · HiRISE | Mars Trek tiles | **Done** → `optical.png` |
| 4 | Thermal image (night) | thermal | Mars Odyssey · THEMIS | Mars Trek tiles | **Done** → `thermal.png`. Coarse: 25 source pixels across the map |
| 5 | Rover traverse record | (ground truth) | MSL Curiosity | NASA JSON | **Done** → `traverse.json` |
| 6 | Rover point-of-view photos | optical (ground) | MSL Curiosity | NASA JSON | **Done** → `pov.json`, `pov/*.jpg` |
| 7 | Radiation | radiation | MSL Curiosity · RAD | PDS | **Done** → `env.json`. Real values from the RAD file, not a published value |
| 8 | Geologic unit | geologic | USGS SIM 3292 | Mars Trek query | **Done** → `layerset.json` (`site.geologicUnit`) |
| 9 | Atmosphere | atmospheric | MSL Curiosity · REMS | PDS | **Done** → `env.json` (pressure, air temperature) |

Layers 1–6 alone satisfy the challenge text's "at least three kinds of data" and "data from multiple NASA science missions".

The terrain file includes HRSC data from ESA's Mars Express. USGS and NASA produce and distribute the file, but the submission text will state that ESA data is included.

---

## 6. Still unknown

| Item | Who | When |
|---|---|---|
| Whether a part of the terrain file can be fetched | C | Right at the start |
| How to extract dose rates from the RAD files | C | After handing over terrain and optical |
| Whether the REMS data covers sols 4100–4350 | C | After handing over terrain and optical |
| The exact sol the rover entered the channel | C | When picking photos |
| Submission requirements (video length, description items, deadline) | C | Right at the start |
| Slope criterion for what a person can walk | C, D | Before route computation |
| Whether the terrain file and the traverse record share an elevation reference (the traverse field is named `elev_geoid`) | C | Right after getting the terrain file. Sample terrain elevation at the rover stops and compare with `elev_geoid`. If the difference is constant, use it as a correction |
| Whether the terrain file and the optical image overlap exactly (the two products were registered separately) | C | Lay the traverse over both layers. Record how many meters they are off |

The submission requirements could not be checked because connecting to the official site (spaceappschallenge.org) failed with a certificate error in this environment.

---

## 7. What we confirmed during the hackathon (C, 2026-11-14)

The results of actually doing the items in section 6. All are [checked directly]; the processing is in `data-pipeline/build_data.py` and the checks in `data-pipeline/validate.py`.

| Item | Result |
|---|---|
| Whether a part of the terrain file can be fetched | **Yes.** The server accepts range requests. We read only the 2,048 × 2,048 pixel map window instead of the 3.6 GB file |
| Elevation reference of the terrain file and the traverse record | **The same.** At the 178 rover stops inside the extent, (terrain − `elev_geoid`) is −0.17 m on average with a standard deviation of 0.24 m. No correction is used |
| Whether terrain and optical overlap | With the traverse laid over both, it follows the channel in each (`data-pipeline/check_overlay.png`). Shading computed from the terrain matches the optical image best within one cell (4 m). The correlation is only 0.29, so all we can say is that they are not off by much more than 4 m |
| How to extract dose rates from the RAD files | The number under `[DOSIMETRY_TOTAL_DOSE_E: NN]` in each per-sol file is the E-detector dose rate in µGy/h (`DOCUMENT/RAD_RDR_SIS`). For sol 4200: 88 observations, 2 dropped for a QC flag, 86 used, daily mean **154 µGy/day** (hourly 152–157). Sol 4312 gave 153 µGy/day. These are the instrument's values, uncorrected |
| Whether the REMS data covers sols 4100–4350 | **Yes.** `https://atmos.nmsu.edu/PDS/data/mslrem_1001/DATA/` goes up to sol 4843 (the landing page does not open, but the data folders do). The sol 4200 MODRDR file gives pressure 800–889 Pa and air temperature 206–268 K |
| Whether photos can be pinned to coordinates | **Yes.** There are 19 full-frame Left Navigation Camera images each at sol 4200 `RMC 107_2484` and sol 4098 `RMC 106_438`. One of each is used as `pov/site1.jpg` and `pov/base.jpg` |
| The sulfur discovery | Two JPL articles read in full (2024-07-18, 2024-11-18). The rover cracked the rock open on **May 30, 2024**, which is **sol 4200** in NASA's raw image record. Pure sulfur is a first on Mars, and the sulfur stones were too small for HiRISE to see. The rover took its farewell panorama on sol 4352 |
| **Where the sulfur stone field is** | **Not at the reference point of section 4 (the sol 4312 position).** On sol 4200 the rover drove about 9 m from `107_2394` to `107_2484` (137.40886° E, 4.78571° S) and stayed near there until sol 4237. That is about 102 m from the reference point. The survey site (`site1`) in the data was moved there. The map extent is unchanged. See [DATA.md](DATA.md) section 2 |
| From base to the survey site | The rover actually drove 593 m and climbed 45.2 m (sol 4098 → 4200). The "1,001 m, 44 m" in section 4 is the figure up to sol 4312 |
| Slope criterion for what a person can walk | Evidence from the Moon: Apollo astronauts walked on slopes below 15° (EPSC2024-196), and early Artemis walking traverses are planned below 20° (David Kring, Universe Today 2023). We found nothing for Mars. We propose **avoiding ground above 15° and closing ground above 20°**. With a 10° limit there is no route from base to the survey site. A route computed with this rule (390 m) stays 16 m on average from the path the rover actually drove ([DATA.md](DATA.md) section 7) |
| The exact sol the rover entered the channel | **About sol 4084–4086 (February 1–3, 2024).** NASA captions date a "Reaches Gediz Vallis Channel" navigation camera view to sol 4084 and the "Curiosity Arrives at Gediz Vallis Channel" panorama ([PIA26246](https://www.jpl.nasa.gov/images/pia26246-curiosity-arrives-at-gediz-vallis-channel/)) to sol 4086. [search summary: the captions were not opened] No single arrival sol is stated. Our base (sol 4098) is therefore a position just inside the channel, twelve sols after arrival |
| Submission requirements | Read from the official Project Submission Guide. Summary at the top of [SUBMISSION.md](SUBMISSION.md). **Demo is a video of 30 seconds or less or 7 slides or fewer, in English, with no image or voice of anyone under 18; deadline November 15, 11:59 p.m. local time** |

Still unknown: the exact position of the rock that was cracked open, and what slope a suited person can walk in Mars gravity.

---

## 8. What we built from these resources (C, 2026-11-14)

Everything below is in the repository. One script (`data-pipeline/build_data.py`) rebuilds all the data files from the addresses in this document, and a second (`data-pipeline/validate.py`) runs 54 checks on them. File-by-file detail is in [DATA.md](DATA.md).

### Data files, in `web/public/data/`

| File | Size | Built from | Resource |
|---|---|---|---|
| `optical.png` | 7.8 MB, 4096×4096 | 182 tiles of `curiosity_hirise_mosaic`, zoom 16 | R1 Mars Trek |
| `thermal.png` | 9 KB, 2048×2048 | 1 tile of `THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018`, zoom 9 | R1 Mars Trek |
| `topo.bin` | 1.0 MB, 512×512 float32 | The 2,048 m map window of `MSL_Gale_DEM_Mosaic_1m_v3.tif`, averaged to 4 m | USGS (section 3) |
| `slope.bin` | 1.0 MB, 512×512 float32 | Computed from `topo.bin` | — |
| `traverse.json` | 32 KB, 178 stops | `MSL_waypoints.json`, stops inside the map extent | NASA (section 3) |
| `env.json` | 4 KB, 24 hourly samples | RAD RDR and REMS MODRDR files for sol 4200 | NASA PDS (section 3) |
| `pov.json`, `pov/site1.jpg`, `pov/base.jpg` | 1.0 MB | Left Navigation Camera images at `RMC 107_2484` and `106_438` | NASA raw images, the Curiosity counterpart of R5 |
| `layerset.json` | 3 KB | Layer list, grid, base and survey site, geologic unit `Htu` | R2 (geologic unit), all of the above |

### How each of the five Resources tab entries was used

| # | Resource | Used for |
|---|---|---|
| R1 | JPL Mars Trek | Optical and thermal layers (tiles); the geologic unit lookup; the layer index used to answer the "missing data" list in the README |
| R2 | USGS-NASA Planetary Geologic Mapping Program | The geologic unit of the site, shown in the status panel and legend |
| R3 | Curiosity's proposed path up Mount Sharp | Not data. The idea of drawing a route against regions of interest; we draw the rover's actual path instead |
| R4 | NASA Worldview | Not Mars data. Reference for the layer switching screen |
| R5 | Mars Perseverance Raw Images Gallery | The same NASA service for Curiosity gives the photos in `pov.json`, pinned to map positions |

Outside the Resources tab, all from NASA or USGS: the USGS Gale terrain file, the Curiosity traverse record, and the RAD and REMS archives in the Planetary Data System.

### Scripts, checks and figures

| File | Content |
|---|---|
| `data-pipeline/build_data.py` | Downloads the sources and builds every file above. Rebuilding from an empty cache gives byte-identical files |
| `data-pipeline/validate.py` | 54 checks: format against INTERFACES, layers against each other, slope criterion analysis |
| `data-pipeline/validation_report.json` | The numbers the checks computed; the figures quoted in the docs come from here |
| `data-pipeline/reference_route.json` | A route from base to the survey site computed from the slope layer, for comparison with D's route |
| `data-pipeline/check_overlay.png` | The rover path laid over optical, terrain shading, slope and thermal |
| `docs/figures/layers.png`, `docs/figures/route.png` | English figures for the submission page and slides |

### Documents

| File | Content |
|---|---|
| [DATA.md](DATA.md) | What each data file is, how it was made, how accurate it is, the legend, credits and terms of use |
| [SUBMISSION.md](SUBMISSION.md) | The submission rules and the draft submission text, split by the form's fields |
| This file, section 7 | What was confirmed while doing the work |

### What the resources could not give us

- **Spectral data at walking scale.** Mars Trek has no CRISM raster covering our site; what covers it is global and coarser than our whole map. The `spectral` kind stays empty.
- **Anything sharper than HiRISE.** The best optical data is 0.64 m per pixel, and JPL reported that the sulfur stones at our survey site were too small for HiRISE to see. This is the gap the helmet's own sensor is meant to fill.
- **A live feed.** The radiation and weather values are a recording of one Martian day.
