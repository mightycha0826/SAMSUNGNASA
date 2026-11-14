"""NASA data -> layer files in web/public/data/ (slot C).

Run:   pip install -r requirements.txt
       python build_data.py            # everything
       python build_data.py optical    # one step (optical, thermal, topo, traverse, env, pov, layerset)
       python validate.py              # check the result

The format follows docs/INTERFACES.md section 2, the addresses docs/RESOURCES.md, and the
result is described in docs/DATA.md. Downloads are kept in data-pipeline/cache/ so a rerun
does not fetch them again. The environment variables MARSWALK_OUT and MARSWALK_CACHE change
the output and cache folders (useful for rebuilding from scratch).

Use of AI: this script was written with the help of an AI coding tool (Claude).
All data values are downloaded from the NASA and USGS addresses below; none are produced by AI.
"""
import json
import math
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import requests
from PIL import Image

HERE = Path(__file__).resolve().parent
OUT = Path(os.environ.get("MARSWALK_OUT") or HERE.parent / "web" / "public" / "data")
CACHE = Path(os.environ.get("MARSWALK_CACHE") or HERE / "cache")

# ---- Shared reference (INTERFACES.md 2.1) ----
WEST, EAST, SOUTH, NORTH = 137.39026, 137.42481, -4.80409, -4.76954
SITE_LON, SITE_LAT = 137.4075342, -4.78681191      # center of the map (Curiosity's sol 4312 position)
COLS = ROWS = 512
CELL_M = 4.0
MARS_R = 3396190.0
OPTICAL_PX = 4096
THERMAL_PX = 2048

# ---- Mission scenario: base and survey site are places where Curiosity actually stood ----
# RMC is the site_drive value in the traverse record (MSL_waypoints.json). Coordinates are read from it.
BASE_RMC = "106_438"       # sol 4098. The path the rover drove from here to the survey site is the reference path
SURVEY_RMC = "107_2484"    # sol 4200 (2024-05-30). End of the drive on which the rover cracked open a rock
#                            and found pure sulfur. It stayed near this spot until sol 4237
ENV_SOL = 4200             # radiation and atmosphere: the day the sulfur was found
DEMO_HALF_CELLS = 10       # demo region: an 80 m square centered on the survey site (to be fixed with D)

TREK = "https://trek.nasa.gov/tiles/Mars/EQ/{layer}/1.0.0/default/default028mm/{z}/{row}/{col}.png"
HIRISE = "curiosity_hirise_mosaic"
THEMIS = "THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018"
DEM_URL = "https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif"
DEM_PAGE = "https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m"
WAYPOINTS_URL = "https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json"
RAD_FILE = ("https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/DATA/SOL_04134_04257/"
            "RAD_RDR_2024_151_00_59_4200_V00.TXT")                                      # about 70 MB
REMS_FILE = ("https://atmos.nmsu.edu/PDS/data/mslrem_1001/DATA/SOL_04134_04257/SOL04200/"
             "RME_770298985RMD42000000000_______P1.TAB")                                # about 13 MB
RAW_API = ("https://mars.nasa.gov/api/v1/raw_image_items/?order=sol+desc&per_page=100&page=0"
           "&condition_1=msl:mission&condition_2={sol}:sol:gte&condition_3={sol}:sol:lte&search={cam}")
POV_CAM = "NAV_LEFT_B"
# The automatic pick showed a large part of the rover body, so the candidates were reviewed by eye
# and one showing only the horizon was chosen.
POV_PICK = {"base": "NLB_761299016EDR_F1060438NCAM00254M_"}


def cell_of(lon, lat):
    """Mars longitude/latitude -> map grid [col, row]. The southwest corner is [0, 0]."""
    col = int((lon - WEST) / (EAST - WEST) * COLS)
    row = int((lat - SOUTH) / (NORTH - SOUTH) * ROWS)
    return [min(max(col, 0), COLS - 1), min(max(row, 0), ROWS - 1)]


def in_bounds(lon, lat):
    return WEST <= lon <= EAST and SOUTH <= lat <= NORTH


def fetch(url, path):
    path = Path(path)
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        r = requests.get(url, timeout=300)
        r.raise_for_status()
        path.write_bytes(r.content)
    return path


def write_json(name, obj, indent=1):
    (OUT / name).write_text(json.dumps(obj, ensure_ascii=False, indent=indent) + "\n", encoding="utf-8")


# ---- Optical / thermal: stitch Mars Trek tiles ----
def trek_mosaic(layer, z, out_px, resample):
    n_col, n_row = 2 ** (z + 1), 2 ** z
    c0 = math.floor((WEST + 180) / 360 * n_col)
    c1 = math.floor((EAST + 180) / 360 * n_col)
    r0 = math.floor((90 - NORTH) / 180 * n_row)
    r1 = math.floor((90 - SOUTH) / 180 * n_row)
    jobs = [(r, c) for r in range(r0, r1 + 1) for c in range(c0, c1 + 1)]

    def get(rc):
        r, c = rc
        p = fetch(TREK.format(layer=layer, z=z, row=r, col=c), CACHE / layer / f"{z}_{r}_{c}.png")
        return rc, Image.open(p).convert("LA")

    canvas = Image.new("LA", ((c1 - c0 + 1) * 256, (r1 - r0 + 1) * 256))
    with ThreadPoolExecutor(8) as ex:
        for (r, c), im in ex.map(get, jobs):
            canvas.paste(im, ((c - c0) * 256, (r - r0) * 256))

    px_per_deg = 256 * n_row / 180
    lon0, lat0 = c0 * 360 / n_col - 180, 90 - r0 * 180 / n_row
    box = ((WEST - lon0) * px_per_deg, (lat0 - NORTH) * px_per_deg,
           (EAST - lon0) * px_per_deg, (lat0 - SOUTH) * px_per_deg)
    gray, alpha = canvas.split()
    out = gray.resize((out_px, out_px), resample, box=box)
    empty = 1 - np.asarray(alpha.resize((out_px, out_px), Image.NEAREST, box=box)).astype(bool).mean()
    print(f"  {layer}: {len(jobs)} tiles, source {box[2] - box[0]:.0f} px -> {out_px} px, empty {empty:.1%}")
    return out


def build_optical():
    trek_mosaic(HIRISE, 16, OPTICAL_PX, Image.LANCZOS).save(OUT / "optical.png", optimize=True)


def build_thermal():
    # The source is only about 25 pixels across the whole map. Enlarge it so the source pixels stay
    # visible instead of smoothing them, to show plainly how coarse orbital thermal data is at
    # walking scale (RESOURCES.md section 4).
    trek_mosaic(THEMIS, 9, THERMAL_PX, Image.NEAREST).save(OUT / "thermal.png", optimize=True)


# ---- Terrain / slope: read only the map window of the USGS 1 m terrain file ----
def read_dem_1m():
    """1 m elevation grid of the extent (north up). Reads only the rows needed, not the 3.6 GB file."""
    cache = CACHE / "dem_1m.npy"
    if cache.exists():
        return np.load(cache)
    import rasterio
    from rasterio.windows import Window

    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
    n = int(COLS * CELL_M)
    with rasterio.open("/vsicurl/" + DEM_URL) as ds:
        row0, col0 = ds.index(math.radians(WEST) * MARS_R, math.radians(NORTH) * MARS_R)
        a = ds.read(1, window=Window(col0, row0, n, n)).astype(np.float32)
        a[a == ds.nodata] = np.nan
    CACHE.mkdir(parents=True, exist_ok=True)
    np.save(cache, a)
    return a


def build_topo():
    dem = read_dem_1m()
    k = int(CELL_M)
    with np.errstate(invalid="ignore"):
        topo = np.nanmean(dem.reshape(ROWS, k, COLS, k), axis=(1, 3))
    topo = topo[::-1]                      # row 0 = south
    dz_dy, dz_dx = np.gradient(topo, CELL_M)
    slope = np.degrees(np.arctan(np.hypot(dz_dx, dz_dy)))
    topo.astype("<f4").tofile(OUT / "topo.bin")
    slope.astype("<f4").tofile(OUT / "slope.bin")
    print(f"  topo {np.nanmin(topo):.1f} to {np.nanmax(topo):.1f} m, "
          f"max slope {np.nanmax(slope):.1f} deg, empty cells {int(np.isnan(topo).sum())}")


def grid_range(name):
    a = np.fromfile(OUT / name, "<f4")
    return round(float(np.nanmin(a)), 2), round(float(np.nanmax(a)), 2)


# ---- Curiosity traverse record ----
def load_waypoints():
    p = fetch(WAYPOINTS_URL, CACHE / "MSL_waypoints.json")
    feats = json.loads(p.read_text(encoding="utf-8"))["features"]
    return [f["properties"] for f in feats]


def waypoint(rmc):
    return next(w for w in load_waypoints() if w["RMC"] == rmc)


def build_traverse():
    pts = []
    for w in load_waypoints():
        if in_bounds(w["lon"], w["lat"]):
            pts.append({
                "sol": w["sol"], "rmc": w["RMC"], "lon": w["lon"], "lat": w["lat"],
                "elevM": w["elev_geoid"], "tiltDeg": w["tilt"], "cell": cell_of(w["lon"], w["lat"]),
            })
    write_json("traverse.json", {"sourceUrl": WAYPOINTS_URL, "points": pts})
    print(f"  traverse: {len(pts)} stops, sol {pts[0]['sol']} to {pts[-1]['sol']}")


# ---- Radiation (Curiosity RAD) and atmosphere (Curiosity REMS): sol 4200, the day of the discovery ----
def clock_hours(text):
    """'4200 23:24:02' or '04199 23:10:07' -> time of day in hours."""
    h, m, s = text.split()[-1].split(":")
    return int(h) + int(m) / 60 + float(s) / 3600


def read_rad_dose(path):
    """From a RAD RDR file, take (local solar time, duration in s, E-detector dose rate in uGy/h) per observation.

    RAD_RDR_SIS: the number under [DOSIMETRY_TOTAL_DOSE_E: NN] is the dose rate of the E detector (uGy/h).
    E is a plastic scintillator, the detector closer to human tissue. The value is used as reported, uncorrected.
    Time comes from START_OBS_MARS. The SIS calls it LMST, but checked against the sol 4312 file it is
    closer to local true solar time (LTST), so REMS is binned by its LTST column too. The two differ by
    about 50 minutes, so either way radiation may be off by up to one hourly bin relative to pressure
    and temperature (docs/DATA.md).
    Observations whose QC is not 00000000 ("quality control issues may exist") are dropped.
    """
    obs, cur, want = {}, None, False
    with open(path, encoding="latin-1") as f:
        for line in f:
            if line.startswith("["):
                want = False
                head = line[1:line.find("]")].split(": ")
                if len(head) == 2 and head[1].isdigit():
                    cur = obs.setdefault(int(head[1]), {})
                    want = head[0] == "DOSIMETRY_TOTAL_DOSE_E"
            elif want and line.strip():
                cur["dose"], want = float(line), False
            elif line.startswith("START_OBS_MARS"):
                cur["ltst"] = clock_hours(line.split('"')[1])
            elif line.startswith("OBS_DURATION"):
                cur["dur"] = int(line.split("=")[1])
            elif line.startswith("QC="):
                cur["qc"] = line.split('"')[1]
    with_dose = [o for o in obs.values() if "dose" in o and "ltst" in o]
    good = [o for o in with_dose if o.get("qc") == "00000000"]
    return good, len(with_dose) - len(good)


def build_env():
    hours = [{"rad": [], "p": [], "t": []} for _ in range(24)]

    rad, dropped = read_rad_dose(fetch(RAD_FILE, CACHE / f"rad_{ENV_SOL}.txt"))
    for o in rad:
        mid = (o["ltst"] + o["dur"] / 2 / 3699.0) % 24      # a Mars hour is about 3699 s
        hours[int(mid)]["rad"].append((o["dose"], o["dur"]))

    with open(fetch(REMS_FILE, CACHE / f"rems_{ENV_SOL}.tab"), encoding="latin-1") as f:
        for line in f:
            c = line.split(",")
            h = hours[int(clock_hours(c[2].strip('" ')))]     # column 3: LTST
            temp, pres = float(c[15]), float(c[37])            # column 16 AMBIENT_TEMP (K), column 38 PRESSURE (Pa)
            if temp > -900:
                h["t"].append(temp)
            if pres > -900:
                h["p"].append(pres)

    all_rad = [x for h in hours for x in h["rad"]]
    wmean = lambda xs: sum(v * w for v, w in xs) / sum(w for _, w in xs)
    mean = lambda xs: round(sum(xs) / len(xs), 1) if xs else None
    samples = []
    for i, h in enumerate(hours):
        r = wmean(h["rad"]) if h["rad"] else wmean(all_rad)     # an hour with no observation gets the daily mean
        samples.append({"sol": ENV_SOL, "localTime": f"{i:02d}:00",
                        "radiationUGyPerDay": round(r * 24, 1),
                        "pressurePa": mean(h["p"]), "airTempK": mean(h["t"])})
    write_json("env.json", {
        "sourceUrls": [RAD_FILE, REMS_FILE],
        "radiationIsFixedValue": False,
        "note": ("Hourly means for MSL sol 4200 (2024-05-30), binned by local true solar time. "
                 "radiation: RAD RDR E-detector dose rate (uGy/h) x 24, as reported by the instrument, "
                 "uncorrected, QC-flagged observations excluded. pressure/airTemp: REMS MODRDR."),
        "samples": samples,
    })
    rads = [s["radiationUGyPerDay"] for s in samples]
    ps = [s["pressurePa"] for s in samples if s["pressurePa"] is not None]
    ts = [s["airTempK"] for s in samples if s["airTempK"] is not None]
    print(f"  RAD: {len(all_rad)} observations ({dropped} dropped for QC), daily mean {wmean(all_rad) * 24:.1f} uGy/day "
          f"(hourly {min(rads)} to {max(rads)}), hours without an observation {sum(not h['rad'] for h in hours)}")
    print(f"  pressure {min(ps)} to {max(ps)} Pa ({len(ps)} hours), air temperature {min(ts)} to {max(ts)} K ({len(ts)} hours)")


# ---- Rover point-of-view photos (P1) ----
def build_pov():
    (OUT / "pov").mkdir(exist_ok=True)
    photos = []
    for wp_id, rmc in (("site1", SURVEY_RMC), ("base", BASE_RMC)):
        w = waypoint(rmc)
        p = fetch(RAW_API.format(sol=w["sol"], cam=POV_CAM), CACHE / f"raw_{w['sol']}_{POV_CAM}.json")
        items = [i for i in json.loads(p.read_text(encoding="utf-8"))["items"]
                 if i["site"] == w["site"] and i["drive"] == w["drive"] and i["scale_factor"] == 1
                 and i["extended"].get("sample_type") == "full"]
        if not items:
            print(f"  {wp_id}: no full-frame photo taken at {rmc}. Skipped")
            continue
        # A photo showing the horizon: the one whose mast elevation is closest to level, unless POV_PICK names one
        best = next((i for i in items if i["imageid"] == POV_PICK.get(wp_id)), None) \
            or min(items, key=lambda i: abs(float(i["extended"]["mast_el"])))
        src = fetch(best["url"], CACHE / "pov" / f"{best['imageid']}.jpg")
        (OUT / "pov" / f"{wp_id}.jpg").write_bytes(src.read_bytes())
        photos.append({
            "waypointId": wp_id, "rmc": rmc, "sol": w["sol"], "instrument": best["instrument"],
            "file": f"pov/{wp_id}.jpg",
            "caption": f"Curiosity, Left Navigation Camera, sol {w['sol']} ({best['date_taken'][:10]})",
            "credit": "NASA/JPL-Caltech",
            "sourceUrl": best["url"],
        })
        print(f"  {wp_id}: {best['imageid']} ({len(items)} candidates, mast elevation {best['extended']['mast_el']} deg, "
              f"azimuth {best['extended']['mast_az']} deg)")
    write_json("pov.json", {"photos": photos})


# ---- Layer list ----
def build_layerset():
    base, survey = waypoint(BASE_RMC), waypoint(SURVEY_RMC)
    sc, sr = cell_of(survey["lon"], survey["lat"])
    h = DEMO_HALF_CELLS
    c0, r0 = min(max(sc - h, 0), COLS - 2 * h), min(max(sr - h, 0), ROWS - 2 * h)
    t_min, t_max = grid_range("topo.bin")
    s_min, s_max = grid_range("slope.bin")
    dem_src = {"mission": "MRO, Mars Express, MGS", "instrument": "HiRISE, CTX, HRSC, MOLA", "sourceUrl": DEM_PAGE}
    wmts = "https://trek.nasa.gov/tiles/Mars/EQ/{}/1.0.0/WMTSCapabilities.xml"
    layerset = {
        "site": {
            "name": "Gediz Vallis channel, Mount Sharp, Gale Crater",
            "scienceGoal": "Survey the field of pure-sulfur stones",
            "lat": SITE_LAT, "lon": SITE_LON,
            "bounds": {"west": WEST, "east": EAST, "south": SOUTH, "north": NORTH},
            "geologicUnit": {"code": "Htu", "name": "Hesperian transition undivided unit", "source": "USGS SIM 3292"},
        },
        "grid": {"cols": COLS, "rows": ROWS, "cellSizeM": CELL_M},
        "layers": [
            {"id": "topo", "kind": "topographic", **dem_src, "file": "topo.bin", "format": "float32",
             "unit": "m", "min": t_min, "max": t_max, "label": "Terrain elevation",
             "credit": "USGS Astrogeology Science Center; NASA/JPL-Caltech/University of Arizona/MSSS; ESA/DLR/FU Berlin"},
            {"id": "slope", "kind": "derived", **dem_src, "file": "slope.bin", "format": "float32",
             "unit": "deg", "min": s_min, "max": s_max, "label": "Slope",
             "credit": "Computed from the USGS Gale merged DEM"},
            {"id": "optical", "kind": "optical", "mission": "MRO", "instrument": "HiRISE",
             "file": "optical.png", "format": "image", "label": "Optical image",
             "credit": "NASA/JPL-Caltech/University of Arizona", "sourceUrl": wmts.format(HIRISE)},
            {"id": "thermal", "kind": "thermal", "mission": "Mars Odyssey", "instrument": "THEMIS",
             "file": "thermal.png", "format": "image", "label": "Thermal image (night)",
             "credit": "NASA/JPL-Caltech/Arizona State University", "sourceUrl": wmts.format(THEMIS)},
        ],
        "waypoints": [
            {"id": "base", "label": "Base", "cell": cell_of(base["lon"], base["lat"]),
             "rmc": base["RMC"], "sol": base["sol"]},
            {"id": "site1", "label": "Sulfur stone field", "cell": [sc, sr],
             "rmc": survey["RMC"], "sol": survey["sol"]},
        ],
        # demo: an 80 m region centered on the survey site mapped onto a 4 m room (1:20). To be fixed with D.
        "demo": {"regionCells": [c0, r0, c0 + 2 * h, r0 + 2 * h], "roomSizeM": [4, 4]},
    }
    write_json("layerset.json", layerset, indent=2)
    drive = survey["dist_total_m"] - base["dist_total_m"]
    climb = survey["elev_geoid"] - base["elev_geoid"]
    print(f"  base = sol {base['sol']} {layerset['waypoints'][0]['cell']}, "
          f"site1 = sol {survey['sol']} {[sc, sr]}, demo = {layerset['demo']['regionCells']}")
    print(f"  the rover drove {drive:.0f} m from base to the survey site, elevation change {climb:+.1f} m")


STEPS = {"optical": build_optical, "thermal": build_thermal, "topo": build_topo,
         "traverse": build_traverse, "env": build_env, "pov": build_pov, "layerset": build_layerset}

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name in sys.argv[1:] or STEPS:
        print(name)
        STEPS[name]()
