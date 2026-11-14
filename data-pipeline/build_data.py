"""NASA 데이터 -> web/public/data/ 레이어 파일 (C 슬롯).

실행:  pip install -r requirements.txt
       python build_data.py            # 전부
       python build_data.py optical    # 하나만 (optical, thermal, topo, traverse, env, pov, layerset)
       python validate.py              # 만든 파일 검사

형식은 docs/INTERFACES.md 2장, 주소는 docs/RESOURCES.md, 결과 설명은 docs/DATA.md 를 따른다.
받은 원본은 data-pipeline/cache/ 에 남겨 두어 다시 돌릴 때 내려받지 않는다.
환경 변수 MARSWALK_OUT, MARSWALK_CACHE 로 출력·캐시 폴더를 바꿀 수 있다 (처음부터 다시 만들어 볼 때).

AI 사용 고지: 이 스크립트는 AI 코딩 도구(Claude)의 도움을 받아 작성했다.
데이터 값은 모두 아래 NASA·USGS 주소에서 받은 것이고, AI 가 만든 값은 없다.
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

# ---- 공통 기준 (INTERFACES.md 2.1) ----
WEST, EAST, SOUTH, NORTH = 137.39026, 137.42481, -4.80409, -4.76954
SITE_LON, SITE_LAT = 137.4075342, -4.78681191      # 지도 한가운데 (Curiosity sol 4312 위치)
COLS = ROWS = 512
CELL_M = 4.0
MARS_R = 3396190.0
OPTICAL_PX = 4096
THERMAL_PX = 2048

# ---- 미션 시나리오: 기지와 조사 지점은 Curiosity 가 실제로 섰던 자리 ----
# RMC 는 주행 기록(MSL_waypoints.json)의 site_drive 값이다. 좌표는 기록에서 읽는다.
BASE_RMC = "106_438"       # sol 4098. 여기서 조사 지점까지 로버가 실제로 달린 길이 참고 경로다
SURVEY_RMC = "107_2484"    # sol 4200 (2024-05-30). 순수한 황 암석을 깨뜨려 발견한 주행이 끝난 자리.
#                            로버는 sol 4237 까지 이 자리 근처에 머물며 황 암석 지대를 조사했다
ENV_SOL = 4200             # 방사선·대기: 황을 발견한 그날 하루
DEMO_HALF_CELLS = 10       # demo 구역: 조사 지점을 가운데 둔 80m 정사각형 (D 와 확정)

TREK = "https://trek.nasa.gov/tiles/Mars/EQ/{layer}/1.0.0/default/default028mm/{z}/{row}/{col}.png"
HIRISE = "curiosity_hirise_mosaic"
THEMIS = "THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018"
DEM_URL = "https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif"
DEM_PAGE = "https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m"
WAYPOINTS_URL = "https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json"
RAD_FILE = ("https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/DATA/SOL_04134_04257/"
            "RAD_RDR_2024_151_00_59_4200_V00.TXT")                                      # 약 70MB
REMS_FILE = ("https://atmos.nmsu.edu/PDS/data/mslrem_1001/DATA/SOL_04134_04257/SOL04200/"
             "RME_770298985RMD42000000000_______P1.TAB")                                # 약 13MB
RAW_API = ("https://mars.nasa.gov/api/v1/raw_image_items/?order=sol+desc&per_page=100&page=0"
           "&condition_1=msl:mission&condition_2={sol}:sol:gte&condition_3={sol}:sol:lte&search={cam}")
POV_CAM = "NAV_LEFT_B"
# 자동으로 고른 사진에 로버 몸체가 크게 찍혀 있어, 후보를 눈으로 보고 지평선만 보이는 것으로 정했다
POV_PICK = {"base": "NLB_761299016EDR_F1060438NCAM00254M_"}


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
        r = requests.get(url, timeout=300)
        r.raise_for_status()
        path.write_bytes(r.content)
    return path


def write_json(name, obj, indent=1):
    (OUT / name).write_text(json.dumps(obj, ensure_ascii=False, indent=indent) + "\n", encoding="utf-8")


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
    lon0, lat0 = c0 * 360 / n_col - 180, 90 - r0 * 180 / n_row
    box = ((WEST - lon0) * px_per_deg, (lat0 - NORTH) * px_per_deg,
           (EAST - lon0) * px_per_deg, (lat0 - SOUTH) * px_per_deg)
    gray, alpha = canvas.split()
    out = gray.resize((out_px, out_px), resample, box=box)
    empty = 1 - np.asarray(alpha.resize((out_px, out_px), Image.NEAREST, box=box)).astype(bool).mean()
    print(f"  {layer}: 타일 {len(jobs)}장, 원본 {box[2] - box[0]:.0f}px -> {out_px}px, 빈 곳 {empty:.1%}")
    return out


def build_optical():
    trek_mosaic(HIRISE, 16, OPTICAL_PX, Image.LANCZOS).save(OUT / "optical.png", optimize=True)


def build_thermal():
    # 원본이 지도 전체에 25픽셀쯤이다. 부드럽게 뭉개지 않고 원본 픽셀이 그대로 보이게 늘린다.
    # 궤도 열 영상이 걷는 규모에서 얼마나 거친지 그대로 보여 주기 위해서다 (RESOURCES.md 4장).
    trek_mosaic(THEMIS, 9, THERMAL_PX, Image.NEAREST).save(OUT / "thermal.png", optimize=True)


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


def build_topo():
    dem = read_dem_1m()
    k = int(CELL_M)
    with np.errstate(invalid="ignore"):
        topo = np.nanmean(dem.reshape(ROWS, k, COLS, k), axis=(1, 3))
    topo = topo[::-1]                      # row 0 = 남쪽
    dz_dy, dz_dx = np.gradient(topo, CELL_M)
    slope = np.degrees(np.arctan(np.hypot(dz_dx, dz_dy)))
    topo.astype("<f4").tofile(OUT / "topo.bin")
    slope.astype("<f4").tofile(OUT / "slope.bin")
    print(f"  topo {np.nanmin(topo):.1f} ~ {np.nanmax(topo):.1f} m, "
          f"slope 최대 {np.nanmax(slope):.1f}도, 빈 칸 {int(np.isnan(topo).sum())}")


def grid_range(name):
    a = np.fromfile(OUT / name, "<f4")
    return round(float(np.nanmin(a)), 2), round(float(np.nanmax(a)), 2)


# ---- Curiosity 주행 기록 ----
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
    print(f"  traverse: {len(pts)}개 지점, sol {pts[0]['sol']} ~ {pts[-1]['sol']}")


# ---- 방사선 (Curiosity RAD) · 대기 (Curiosity REMS): 황을 발견한 sol 4200 하루 ----
def clock_hours(text):
    """'4200 23:24:02' 또는 '04199 23:10:07' -> 하루 중 시각(시)."""
    h, m, s = text.split()[-1].split(":")
    return int(h) + int(m) / 60 + float(s) / 3600


def read_rad_dose(path):
    """RAD RDR 파일에서 관측마다 (지방 태양시, 길이 초, E 검출기 선량률 µGy/h) 를 뽑는다.

    RAD_RDR_SIS: [DOSIMETRY_TOTAL_DOSE_E: NN] 아래 숫자가 E 검출기의 선량률(µGy/h)이다.
    E 는 플라스틱 섬광체로, 인체 조직에 가까운 쪽이다. 기기가 낸 값 그대로이고 보정하지 않았다.
    시각은 START_OBS_MARS 를 쓴다. SIS 는 이것을 LMST 라고 적었지만 sol 4312 파일로 견줘 보니
    지방 '진'태양시(LTST)에 더 가까웠다. 그래서 REMS 도 LTST 열로 묶는다. 둘의 차이는 약 50분이라,
    어느 쪽이든 방사선 값이 기압·기온과 최대 한 시간 칸 어긋날 수 있다 (docs/DATA.md).
    QC 가 00000000 이 아닌 관측("quality control issues may exist")은 뺀다.
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
        mid = (o["ltst"] + o["dur"] / 2 / 3699.0) % 24      # 화성의 한 시간은 약 3699초
        hours[int(mid)]["rad"].append((o["dose"], o["dur"]))

    with open(fetch(REMS_FILE, CACHE / f"rems_{ENV_SOL}.tab"), encoding="latin-1") as f:
        for line in f:
            c = line.split(",")
            h = hours[int(clock_hours(c[2].strip('" ')))]     # 3열 LTST
            temp, pres = float(c[15]), float(c[37])            # 16열 AMBIENT_TEMP(K), 38열 PRESSURE(Pa)
            if temp > -900:
                h["t"].append(temp)
            if pres > -900:
                h["p"].append(pres)

    all_rad = [x for h in hours for x in h["rad"]]
    wmean = lambda xs: sum(v * w for v, w in xs) / sum(w for _, w in xs)
    mean = lambda xs: round(sum(xs) / len(xs), 1) if xs else None
    samples = []
    for i, h in enumerate(hours):
        r = wmean(h["rad"]) if h["rad"] else wmean(all_rad)     # 관측이 없는 시간은 하루 평균
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
    print(f"  RAD 관측 {len(all_rad)}개 (QC 로 뺀 것 {dropped}개), 하루 평균 {wmean(all_rad) * 24:.1f} µGy/일 "
          f"(시간별 {min(rads)} ~ {max(rads)}), 관측 없는 시간 {sum(not h['rad'] for h in hours)}개")
    print(f"  기압 {min(ps)} ~ {max(ps)} Pa ({len(ps)}시간), 기온 {min(ts)} ~ {max(ts)} K ({len(ts)}시간)")


# ---- 로버 시점 사진 (P1) ----
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
            print(f"  {wp_id}: {rmc} 에서 찍은 전체 크기 사진 없음. 건너뜀")
            continue
        # 지평선이 보이는 사진: 마스트 고개 각도가 수평에 가장 가까운 것. POV_PICK 에 있으면 그 사진
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
        print(f"  {wp_id}: {best['imageid']} (후보 {len(items)}장, 고개 각도 {best['extended']['mast_el']}도, "
              f"방위 {best['extended']['mast_az']}도)")
    write_json("pov.json", {"photos": photos})


# ---- 레이어 목록 ----
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
            "scienceGoal": "황이 든 돌 조사",
            "scienceGoalEn": "Survey the field of pure-sulfur stones",
            "lat": SITE_LAT, "lon": SITE_LON,
            "bounds": {"west": WEST, "east": EAST, "south": SOUTH, "north": NORTH},
            "geologicUnit": {"code": "Htu", "name": "Hesperian transition undivided unit", "source": "USGS SIM 3292"},
        },
        "grid": {"cols": COLS, "rows": ROWS, "cellSizeM": CELL_M},
        "layers": [
            {"id": "topo", "kind": "topographic", **dem_src, "file": "topo.bin", "format": "float32",
             "unit": "m", "min": t_min, "max": t_max, "label": "지형 높이", "labelEn": "Elevation",
             "credit": "USGS Astrogeology Science Center; NASA/JPL-Caltech/University of Arizona/MSSS; ESA/DLR/FU Berlin"},
            {"id": "slope", "kind": "derived", **dem_src, "file": "slope.bin", "format": "float32",
             "unit": "deg", "min": s_min, "max": s_max, "label": "경사도", "labelEn": "Slope",
             "credit": "Computed from the USGS Gale merged DEM"},
            {"id": "optical", "kind": "optical", "mission": "MRO", "instrument": "HiRISE",
             "file": "optical.png", "format": "image", "label": "광학 영상", "labelEn": "Optical image",
             "credit": "NASA/JPL-Caltech/University of Arizona", "sourceUrl": wmts.format(HIRISE)},
            {"id": "thermal", "kind": "thermal", "mission": "Mars Odyssey", "instrument": "THEMIS",
             "file": "thermal.png", "format": "image", "label": "열 영상 (야간)",
             "labelEn": "Thermal image (night, relative brightness)",
             "credit": "NASA/JPL-Caltech/Arizona State University", "sourceUrl": wmts.format(THEMIS)},
        ],
        "waypoints": [
            {"id": "base", "label": "기지", "labelEn": "Base", "cell": cell_of(base["lon"], base["lat"]),
             "rmc": base["RMC"], "sol": base["sol"]},
            {"id": "site1", "label": "황 암석 지대", "labelEn": "Sulfur stone field", "cell": [sc, sr],
             "rmc": survey["RMC"], "sol": survey["sol"]},
        ],
        # demo: 조사 지점을 가운데 둔 80m 구역을 4m 방에 대응 (1:20). D 와 확정한다.
        "demo": {"regionCells": [c0, r0, c0 + 2 * h, r0 + 2 * h], "roomSizeM": [4, 4]},
    }
    write_json("layerset.json", layerset, indent=2)
    drive = survey["dist_total_m"] - base["dist_total_m"]
    climb = survey["elev_geoid"] - base["elev_geoid"]
    print(f"  base = sol {base['sol']} {layerset['waypoints'][0]['cell']}, "
          f"site1 = sol {survey['sol']} {[sc, sr]}, demo = {layerset['demo']['regionCells']}")
    print(f"  로버가 기지에서 조사 지점까지 실제로 달린 거리 {drive:.0f}m, 높이 변화 {climb:+.1f}m")


STEPS = {"optical": build_optical, "thermal": build_thermal, "topo": build_topo,
         "traverse": build_traverse, "env": build_env, "pov": build_pov, "layerset": build_layerset}

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name in sys.argv[1:] or STEPS:
        print(name)
        STEPS[name]()
