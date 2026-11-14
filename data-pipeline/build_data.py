"""NASA 데이터 -> web/public/data/ 레이어 파일 (C 슬롯).

실행:  pip install -r requirements.txt
       python build_data.py            # 전부
       python build_data.py optical    # 하나만 (optical, thermal, topo, traverse, env, layerset)

형식은 docs/INTERFACES.md 2장, 주소는 docs/RESOURCES.md 를 따른다.
받은 원본은 data-pipeline/cache/ 에 남겨 두어 다시 돌릴 때 내려받지 않는다.
"""
import io
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
OUT = HERE.parent / "web" / "public" / "data"
CACHE = HERE / "cache"

# ---- 공통 기준 (INTERFACES.md 2.1) ----
WEST, EAST, SOUTH, NORTH = 137.39026, 137.42481, -4.80409, -4.76954
SITE_LON, SITE_LAT = 137.4075342, -4.78681191
COLS = ROWS = 512
CELL_M = 4.0
MARS_R = 3396190.0
BASE_SOL = 4098          # 기지: Curiosity 가 sol 4098 에 있던 자리 (RESOURCES.md 4장 참고 경로)
OPTICAL_PX = 4096
THERMAL_PX = 2048
RAD_FIXED_UGY_PER_DAY = 200.0   # 발표값 범위 180~225 의 가운데쯤. RAD 파일에서 뽑으면 바꾼다.

TREK = "https://trek.nasa.gov/tiles/Mars/EQ/{layer}/1.0.0/default/default028mm/{z}/{row}/{col}.png"
HIRISE = "curiosity_hirise_mosaic"
THEMIS = "THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018"
DEM_URL = "https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif"
DEM_PAGE = "https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m"
WAYPOINTS_URL = "https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json"
RAD_URL = "https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/"
RAD_PAPER = "https://pmc.ncbi.nlm.nih.gov/articles/PMC8981195"


def cell_of(lon, lat):
    """화성 경위도 -> 지도 격자 [col, row]. 남서쪽 구석이 [0, 0]."""
    col = int((lon - WEST) / (EAST - WEST) * COLS)
    row = int((lat - SOUTH) / (NORTH - SOUTH) * ROWS)
    return [min(max(col, 0), COLS - 1), min(max(row, 0), ROWS - 1)]


def in_bounds(lon, lat):
    return WEST <= lon <= EAST and SOUTH <= lat <= NORTH


def fetch(url, path):
    path = Path(path)
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        r = requests.get(url, timeout=60)
        r.raise_for_status()
        path.write_bytes(r.content)
    return path


# ---- 광학 / 열: Mars Trek 타일 이어 붙이기 ----
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
    left = (WEST - (c0 * 360 / n_col - 180)) * px_per_deg
    right = (EAST - (c0 * 360 / n_col - 180)) * px_per_deg
    top = ((90 - r0 * 180 / n_row) - NORTH) * px_per_deg
    bottom = ((90 - r0 * 180 / n_row) - SOUTH) * px_per_deg
    gray, alpha = canvas.split()
    box = (left, top, right, bottom)
    out = gray.resize((out_px, out_px), resample, box=box)
    empty = 1 - np.asarray(alpha.resize((out_px, out_px), Image.NEAREST, box=box)).astype(bool).mean()
    print(f"  {layer}: 타일 {len(jobs)}장, 원본 {right - left:.0f}px -> {out_px}px, 빈 곳 {empty:.1%}")
    return out


def build_optical():
    trek_mosaic(HIRISE, 16, OPTICAL_PX, Image.LANCZOS).save(OUT / "optical.png", optimize=True)


def build_thermal():
    # 원본이 지도 전체에 25픽셀쯤이다. 흐린 그대로 보이게 부드럽게만 늘린다.
    trek_mosaic(THEMIS, 9, THERMAL_PX, Image.BICUBIC).save(OUT / "thermal.png", optimize=True)


# ---- 지형 / 경사도: USGS 1m 지형 파일에서 범위만 읽기 ----
def read_dem_1m():
    """범위의 1m 높이 격자 (위쪽이 북쪽). 3.6GB 파일을 다 받지 않고 필요한 줄만 읽는다."""
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


def write_bin(name, grid):
    grid.astype("<f4").tofile(OUT / name)


def build_topo():
    dem = read_dem_1m()
    k = int(CELL_M)
    with np.errstate(invalid="ignore"):
        topo = np.nanmean(dem.reshape(ROWS, k, COLS, k), axis=(1, 3))
    topo = topo[::-1]                      # row 0 = 남쪽
    dz_dy, dz_dx = np.gradient(topo, CELL_M)
    slope = np.degrees(np.arctan(np.hypot(dz_dx, dz_dy)))
    write_bin("topo.bin", topo)
    write_bin("slope.bin", slope)
    stats = {
        "topo": [float(np.nanmin(topo)), float(np.nanmax(topo))],
        "slope": [float(np.nanmin(slope)), float(np.nanmax(slope))],
    }
    (CACHE / "stats.json").write_text(json.dumps(stats))
    print(f"  topo {stats['topo'][0]:.1f} ~ {stats['topo'][1]:.1f} m, "
          f"slope 최대 {stats['slope'][1]:.1f}도, 빈 칸 {int(np.isnan(topo).sum())}")


# ---- Curiosity 주행 경로 ----
def load_waypoints():
    p = fetch(WAYPOINTS_URL, CACHE / "MSL_waypoints.json")
    feats = json.loads(p.read_text(encoding="utf-8"))["features"]
    return [f["properties"] for f in feats]


def build_traverse():
    pts = []
    for w in load_waypoints():
        if in_bounds(w["lon"], w["lat"]):
            pts.append({
                "sol": w["sol"], "rmc": w["RMC"], "lon": w["lon"], "lat": w["lat"],
                "elevM": w["elev_geoid"], "tiltDeg": w["tilt"], "cell": cell_of(w["lon"], w["lat"]),
            })
    (OUT / "traverse.json").write_text(
        json.dumps({"sourceUrl": WAYPOINTS_URL, "points": pts}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"  traverse: {len(pts)}개 지점, sol {pts[0]['sol']} ~ {pts[-1]['sol']}")


# ---- 방사선 (지금은 발표값) ----
def build_env():
    env = {
        "sourceUrls": [RAD_URL, RAD_PAPER],
        "radiationIsFixedValue": True,
        "samples": [
            {"sol": 4312, "localTime": "12:00", "radiationUGyPerDay": RAD_FIXED_UGY_PER_DAY,
             "pressurePa": None, "airTempK": None},
        ],
    }
    (OUT / "env.json").write_text(json.dumps(env, ensure_ascii=False, indent=1), encoding="utf-8")


# ---- 레이어 목록 ----
def build_layerset():
    stats = json.loads((CACHE / "stats.json").read_text())
    base = next(w for w in load_waypoints() if w["sol"] >= BASE_SOL)
    dem_src = {"mission": "MRO, Mars Express, MGS", "instrument": "HiRISE, CTX, HRSC, MOLA", "sourceUrl": DEM_PAGE}
    wmts = "https://trek.nasa.gov/tiles/Mars/EQ/{}/1.0.0/WMTSCapabilities.xml"
    layerset = {
        "site": {
            "name": "Gediz Vallis channel, Mount Sharp, Gale Crater",
            "scienceGoal": "황이 든 돌 조사",
            "lat": SITE_LAT, "lon": SITE_LON,
            "bounds": {"west": WEST, "east": EAST, "south": SOUTH, "north": NORTH},
            "geologicUnit": {"code": "Htu", "name": "Hesperian transition undivided unit", "source": "USGS SIM 3292"},
        },
        "grid": {"cols": COLS, "rows": ROWS, "cellSizeM": CELL_M},
        "layers": [
            {"id": "topo", "kind": "topographic", **dem_src, "file": "topo.bin", "format": "float32",
             "unit": "m", "min": round(stats["topo"][0], 2), "max": round(stats["topo"][1], 2), "label": "지형 높이"},
            {"id": "slope", "kind": "derived", **dem_src, "file": "slope.bin", "format": "float32",
             "unit": "deg", "min": round(stats["slope"][0], 2), "max": round(stats["slope"][1], 2), "label": "경사도"},
            {"id": "optical", "kind": "optical", "mission": "MRO", "instrument": "HiRISE",
             "file": "optical.png", "format": "image", "label": "광학 영상", "sourceUrl": wmts.format(HIRISE)},
            {"id": "thermal", "kind": "thermal", "mission": "Mars Odyssey", "instrument": "THEMIS",
             "file": "thermal.png", "format": "image", "label": "열 영상 (야간)", "sourceUrl": wmts.format(THEMIS)},
        ],
        "waypoints": [
            {"id": "base", "label": "기지", "cell": cell_of(base["lon"], base["lat"])},
            {"id": "site1", "label": "황 암석 지대", "cell": cell_of(SITE_LON, SITE_LAT)},
        ],
        # demo 는 자리만 잡은 값. D 와 함께 확정한다.
        "demo": {"regionCells": [246, 246, 266, 266], "roomSizeM": [4, 4]},
    }
    (OUT / "layerset.json").write_text(json.dumps(layerset, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  base = sol {base['sol']} {layerset['waypoints'][0]['cell']}, site1 = {layerset['waypoints'][1]['cell']}")


# ---- 로버 시점 사진 (P1) ----
RAW_API = ("https://mars.nasa.gov/api/v1/raw_image_items/?order=sol+desc&per_page=100&page=0"
           "&condition_1=msl:mission&condition_2={sol}:sol:gte&condition_3={sol}:sol:lte&search={cam}")
# 조사 지점마다 [waypointId, sol, RMC]. RMC 는 traverse.json 의 점과 같아야 그 자리 사진이다.
POV_SITES = [("site1", 4312, "109_120")]
POV_CAM = "NAV_LEFT_B"


def build_pov():
    (OUT / "pov").mkdir(exist_ok=True)
    photos = []
    for wp_id, sol, rmc in POV_SITES:
        site, drive = (int(v) for v in rmc.split("_"))
        p = fetch(RAW_API.format(sol=sol, cam=POV_CAM), CACHE / f"raw_{sol}_{POV_CAM}.json")
        items = [i for i in json.loads(p.read_text(encoding="utf-8"))["items"]
                 if i["site"] == site and i["drive"] == drive and i["scale_factor"] == 1
                 and i["extended"].get("sample_type") == "full"]
        # 지평선이 보이는 사진: 마스트 고개 각도가 수평에 가장 가까운 것
        best = min(items, key=lambda i: abs(float(i["extended"]["mast_el"])))
        fetch(best["url"], OUT / "pov" / f"{wp_id}.jpg")
        photos.append({
            "waypointId": wp_id, "rmc": rmc, "sol": sol, "instrument": best["instrument"],
            "file": f"pov/{wp_id}.jpg",
            "caption": f"Curiosity {best['title']} ({best['date_taken'][:10]})",
            "sourceUrl": best["url"],
        })
        print(f"  {wp_id}: {best['imageid']} (후보 {len(items)}장, 고개 각도 {best['extended']['mast_el']}도, "
              f"방위 {best['extended']['mast_az']}도)")
    (OUT / "pov.json").write_text(json.dumps({"photos": photos}, ensure_ascii=False, indent=1), encoding="utf-8")


STEPS = {"optical": build_optical, "thermal": build_thermal, "topo": build_topo,
         "traverse": build_traverse, "env": build_env, "layerset": build_layerset, "pov": build_pov}

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name in sys.argv[1:] or STEPS:
        print(name)
        STEPS[name]()
