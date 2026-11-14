"""Checks for web/public/data/ (slot C).

Run:   python validate.py          # exit code 1 if anything fails
       python validate.py --figure # also redraws check_overlay.png and docs/figures/

Part 1 checks the format against docs/INTERFACES.md section 2, part 2 cross-checks the layers
against each other, and part 3 is the analysis used to choose the slope criterion with D.
The numbers are saved in validation_report.json.

Use of AI: this script was written with the help of an AI coding tool (Claude).
"""
import heapq
import json
import math
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
DATA = Path(os.environ.get("MARSWALK_OUT") or HERE.parent / "web" / "public" / "data")
KINDS = {"optical", "thermal", "spectral", "topographic", "geophysical", "atmospheric", "radiation", "chemical", "derived"}
SLOPE_LIMITS = (10, 15, 20, 25, 30)

fails, report = [], {}


def check(ok, text):
    print(("  ok   " if ok else "  FAIL ") + text)
    if not ok:
        fails.append(text)
    return ok


def load(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


# ---------- Part 1: format ----------
print("1. Format (INTERFACES section 2)")
ls = load("layerset.json")
b, g = ls["site"]["bounds"], ls["grid"]
cols, rows, cell = g["cols"], g["rows"], g["cellSizeM"]
deg_m = math.pi * 3396190.0 / 180
check(abs((b["north"] - b["south"]) * deg_m - rows * cell) < 1, f"north-south length of the extent equals the grid ({(b['north'] - b['south']) * deg_m:.1f} m)")
check(abs((b["east"] - b["west"]) * deg_m - cols * cell) < 1, "east-west length of the extent equals the grid")

grids = {}
for layer in ls["layers"]:
    lid = layer["id"]
    check(layer["kind"] in KINDS, f"{lid}: kind '{layer['kind']}'")
    check(all(layer.get(k) for k in ("mission", "instrument", "sourceUrl", "label", "file")), f"{lid}: mission, instrument, sourceUrl, label filled in")
    path = DATA / layer["file"]
    if not check(path.exists(), f"{lid}: file {layer['file']} exists"):
        continue
    if layer["format"] == "float32":
        a = np.fromfile(path, "<f4")
        if check(a.size == cols * rows, f"{lid}: length {a.size} = cols*rows"):
            a = a.reshape(rows, cols)
            grids[lid] = a
            check(not np.isnan(a).any(), f"{lid}: no empty cells (NaN)")
            check(abs(float(np.nanmin(a)) - layer["min"]) < 0.01 and abs(float(np.nanmax(a)) - layer["max"]) < 0.01,
                  f"{lid}: min and max match the file ({layer['min']} to {layer['max']} {layer['unit']})")
    else:
        im = Image.open(path)
        w, h = im.size
        check(w == h and w in (2048, 4096), f"{lid}: square, {w} px (2048 or 4096)")
        check(im.mode == "L", f"{lid}: 8-bit grayscale")
        check("min" not in layer and "max" not in layer, f"{lid}: image layer has no min or max")
report["missions"] = sorted({m.strip() for l in ls["layers"] for m in l["mission"].split(",")})
check(len(ls["layers"]) >= 3, f"{len(ls['layers'])} layers (3 or more)")
check(len(report["missions"]) >= 2, f"{len(report['missions'])} missions: {', '.join(report['missions'])}")

wp = {w["id"]: w for w in ls["waypoints"]}
for wid in ("base", "site1"):
    c = wp.get(wid, {}).get("cell", [-1, -1])
    check(0 <= c[0] < cols and 0 <= c[1] < rows, f"waypoint {wid} {c} is inside the grid")
c0, r0, c1, r1 = ls["demo"]["regionCells"]
check(0 <= c0 < c1 <= cols and 0 <= r0 < r1 <= rows, f"demo region {ls['demo']['regionCells']} is inside the grid")
check(c0 <= wp["site1"]["cell"][0] < c1 and r0 <= wp["site1"]["cell"][1] < r1, "the survey site is inside the demo region")

tr = load("traverse.json")
pts = tr["points"]
check(bool(tr["sourceUrl"]) and len(pts) > 0, f"traverse: {len(pts)} stops, sourceUrl present")


def cell_of(lon, lat):
    return [min(cols - 1, int((lon - b["west"]) / (b["east"] - b["west"]) * cols)),
            min(rows - 1, int((lat - b["south"]) / (b["north"] - b["south"]) * rows))]


check(all(p["cell"] == cell_of(p["lon"], p["lat"]) for p in pts), "traverse: cell equals the value computed from longitude and latitude")
check(all(pts[i]["sol"] <= pts[i + 1]["sol"] for i in range(len(pts) - 1)), "traverse: in sol order")
rmcs = {p["rmc"]: p for p in pts}
for wid in ("base", "site1"):
    check(rmcs.get(wp[wid].get("rmc"), {}).get("cell") == wp[wid]["cell"], f"waypoint {wid} is in the same cell as traverse stop {wp[wid].get('rmc')}")

env = load("env.json")
s = env["samples"]
check(len(s) == 24 and [x["localTime"] for x in s] == [f"{i:02d}:00" for i in range(24)], "env: 24 hourly samples")
check(all(isinstance(x["radiationUGyPerDay"], (int, float)) for x in s), "env: every radiationUGyPerDay is a number")
check(all(u.startswith("https://") for u in env["sourceUrls"]) and env["radiationIsFixedValue"] is False, "env: source addresses present, not a fixed value")
check(all(50 < x["radiationUGyPerDay"] < 1000 for x in s), "env: radiation in a plausible range (50 to 1000 uGy/day)")
check(all(x["pressurePa"] is None or 500 < x["pressurePa"] < 1200 for x in s), "env: pressure in a plausible range (500 to 1200 Pa)")
check(all(x["airTempK"] is None or 150 < x["airTempK"] < 300 for x in s), "env: air temperature in a plausible range (150 to 300 K)")

pov = load("pov.json")
for ph in pov["photos"]:
    ok = (DATA / ph["file"]).exists() and ph["sourceUrl"].startswith("https://") and ph["waypointId"] in wp
    check(ok and ph["rmc"] == wp[ph["waypointId"]].get("rmc"), f"pov {ph['waypointId']}: file and source present, taken at that point ({ph['rmc']})")

# ---------- Part 2: cross-checks ----------
print("2. Layers against each other")
topo, slope = grids["topo"], grids["slope"]
diff = np.array([topo[p["cell"][1], p["cell"][0]] - p["elevM"] for p in pts])
report["dem_minus_rover_elev_m"] = {"mean": round(float(diff.mean()), 2), "std": round(float(diff.std()), 2),
                                    "min": round(float(diff.min()), 2), "max": round(float(diff.max()), 2), "n": len(pts)}
check(abs(diff.mean()) < 1 and diff.std() < 1,
      f"terrain elevation minus rover elevation: mean {diff.mean():+.2f} m, standard deviation {diff.std():.2f} m ({len(pts)} stops)")

# If the terrain were shifted sideways, some other offset would match the rover elevations better.
best = min(((float(np.std([topo[min(rows - 1, max(0, p["cell"][1] + dr)), min(cols - 1, max(0, p["cell"][0] + dc))] - p["elevM"] for p in pts])), dc, dr)
            for dc in range(-5, 6) for dr in range(-5, 6)))
report["dem_best_shift_cells"] = {"dcol": best[1], "drow": best[2], "std_m": round(best[0], 2), "std_at_zero_m": round(float(diff.std()), 2)}
check(abs(best[1]) <= 1 and abs(best[2]) <= 1,
      f"shifting the terrain by up to 5 cells never beats no shift (best shift [{best[1]}, {best[2]}] cells, standard deviation {best[0]:.2f} m)")

at_stops = np.array([slope[p["cell"][1], p["cell"][0]] for p in pts])
tilt = np.array([p["tiltDeg"] for p in pts])
report["slope_at_rover_stops_deg"] = {"median": round(float(np.median(at_stops)), 1), "p90": round(float(np.percentile(at_stops, 90)), 1), "max": round(float(at_stops.max()), 1)}
report["rover_tilt_deg"] = {"median": round(float(np.median(tilt)), 1), "p90": round(float(np.percentile(tilt, 90)), 1), "max": round(float(tilt.max()), 1)}
check(abs(np.median(at_stops) - np.median(tilt)) < 3,
      f"median slope where the rover stood {np.median(at_stops):.1f} deg is close to the median rover tilt {np.median(tilt):.1f} deg")

# Optical image versus terrain: brightness in the optical image depends on which way a slope faces the sun.
# Shade the terrain from several sun directions, keep the one most like the optical image, then shift it to find the best fit.
opt = np.asarray(Image.open(DATA / "optical.png").resize((cols, rows), Image.BOX), dtype=np.float32)[::-1]
gy, gx = np.gradient(topo, cell)


def norm(a):
    a = a - a.mean()
    return a / (a.std() + 1e-9)


def corr(a, b_, dc, dr, m=12):
    return float((a[m + dr:rows - m + dr, m + dc:cols - m + dc] * b_[m:rows - m, m:cols - m]).mean())


o = norm(opt - np.asarray(Image.fromarray(opt).resize((32, 32), Image.BOX).resize((cols, rows), Image.BICUBIC)))
az_best = max(range(0, 360, 15), key=lambda az: corr(norm(-(gx * math.sin(math.radians(az)) + gy * math.cos(math.radians(az)))), o, 0, 0))
shade = norm(-(gx * math.sin(math.radians(az_best)) + gy * math.cos(math.radians(az_best))))
c_zero = corr(shade, o, 0, 0)
c_best, dc_b, dr_b = max((corr(shade, o, dc, dr), dc, dr) for dc in range(-8, 9) for dr in range(-8, 9))
report["optical_vs_terrain"] = {"sun_azimuth_deg": az_best, "corr_at_zero": round(c_zero, 3), "best_corr": round(c_best, 3),
                                "best_shift_cells": [dc_b, dr_b], "best_shift_m": round(math.hypot(dc_b, dr_b) * cell, 1)}
check(c_zero > 0.2, f"optical brightness resembles the terrain shading (correlation {c_zero:.2f}, assuming sun azimuth {az_best} deg)")
check(abs(dc_b) <= 2 and abs(dr_b) <= 2,
      f"optical and terrain fit best at a shift of [{dc_b}, {dr_b}] cells = {math.hypot(dc_b, dr_b) * cell:.0f} m (within 2 cells)")

rad = np.array([x["radiationUGyPerDay"] for x in s])
pres = np.array([x["pressurePa"] for x in s], dtype=float)
temp = np.array([x["airTempK"] for x in s], dtype=float)
r_rp = float(np.corrcoef(rad, pres)[0, 1])
report["env"] = {"radiation_mean": round(float(rad.mean()), 1), "radiation_min": float(rad.min()), "radiation_max": float(rad.max()),
                 "pressure_min": float(pres.min()), "pressure_max": float(pres.max()), "temp_min": float(temp.min()), "temp_max": float(temp.max()),
                 "corr_radiation_pressure": round(r_rp, 2), "warmest_hour": int(temp.argmax()), "lowest_pressure_hour": int(pres.argmin())}
check(11 <= int(temp.argmax()) <= 16, f"warmest hour is {int(temp.argmax())}:00 (daytime)")
check(r_rp < 0, f"radiation is higher when pressure is lower (correlation {r_rp:+.2f}), as expected with less atmosphere overhead")

# ---------- Part 3: analysis for choosing the slope criterion ----------
print("3. Slope criterion analysis (base -> survey site)")
base_c, site_c = tuple(wp["base"]["cell"]), tuple(wp["site1"]["cell"])
rover_m = None
if wp["base"].get("rmc") in rmcs and wp["site1"].get("rmc") in rmcs:
    i0, i1 = sorted((pts.index(rmcs[wp["base"]["rmc"]]), pts.index(rmcs[wp["site1"]["rmc"]])))
    seg = pts[i0:i1 + 1]
    rover_m = sum(math.hypot((seg[i + 1]["lon"] - seg[i]["lon"]) * deg_m * math.cos(math.radians(seg[i]["lat"])),
                             (seg[i + 1]["lat"] - seg[i]["lat"]) * deg_m) for i in range(len(seg) - 1))
    report["rover_path_m"] = round(rover_m)
    print(f"  path the rover drove (its stops joined by straight lines): {rover_m:.0f} m")
straight = math.hypot(base_c[0] - site_c[0], base_c[1] - site_c[1]) * cell
report["straight_m"] = round(straight)
print(f"  straight-line distance: {straight:.0f} m")


PREFER_DEG, BLOCK_DEG = 15, 20      # evidence in docs/DATA.md section 7 (Apollo walking experience, Artemis walking plans)


def shortest(limit, weighted=False):
    """Path stepping only on cells with slope <= limit. Returns (length in m, list of cells), or (None, []) if none.

    weighted=False: the shortest path.
    weighted=True : steeper ground costs more. Step cost = distance x (1 + (slope/PREFER_DEG)^2).
    """
    ok = slope <= limit
    if not (ok[base_c[1], base_c[0]] and ok[site_c[1], site_c[0]]):
        return None, []
    cost = np.full((rows, cols), np.inf)
    cost[base_c[1], base_c[0]] = 0
    prev = {}
    heap = [(0.0, base_c[0], base_c[1])]
    while heap:
        d, c, r = heapq.heappop(heap)
        if (c, r) == site_c:
            path = [site_c]
            while path[-1] != base_c:
                path.append(prev[path[-1]])
            path.reverse()
            length = sum(cell * math.hypot(a[0] - b_[0], a[1] - b_[1]) for a, b_ in zip(path, path[1:]))
            return length, [list(p) for p in path]
        if d > cost[r, c]:
            continue
        for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            nc, nr = c + dc, r + dr
            if 0 <= nc < cols and 0 <= nr < rows and ok[nr, nc]:
                step = cell * math.hypot(dc, dr)
                if weighted:
                    step *= 1 + (slope[nr, nc] / PREFER_DEG) ** 2
                nd = d + step
                if nd < cost[nr, nc]:
                    cost[nr, nc] = nd
                    prev[(nc, nr)] = (c, r)
                    heapq.heappush(heap, (nd, nc, nr))
    return None, []


def dist_to_polyline(p, line):
    """Shortest distance (in cells) from point p to the polyline `line`."""
    best_d = math.inf
    for (x1, y1), (x2, y2) in zip(line, line[1:]):
        dx, dy = x2 - x1, y2 - y1
        t = 0 if dx == dy == 0 else max(0, min(1, ((p[0] - x1) * dx + (p[1] - y1) * dy) / (dx * dx + dy * dy)))
        best_d = min(best_d, math.hypot(p[0] - x1 - t * dx, p[1] - y1 - t * dy))
    return best_d


report["slope_limits"] = {}
routes = {}
for lim in SLOPE_LIMITS:
    frac = float((slope <= lim).mean())
    d, routes[lim] = shortest(lim)
    report["slope_limits"][str(lim)] = {"walkable_fraction": round(frac, 3), "route_m": None if d is None else round(d)}
    print(f"  slope <= {lim:2d} deg: {frac:5.1%} of the map walkable, " + ("no route from base to the survey site" if d is None else f"shortest route {d:.0f} m"))
check(any(v["route_m"] for v in report["slope_limits"].values()), "a route from base to the survey site exists under at least one limit")

# Reference route: steeper ground costs more and cells above BLOCK_DEG are closed. Compared with the path the rover drove.
# It does not replace D's route; it only checks that the slope layer yields a sensible route.
ref_m, ref = shortest(BLOCK_DEG, weighted=True)
rover_line = [p["cell"] for p in seg] if rover_m else []
if ref and rover_line:
    sep = np.array([dist_to_polyline(p, rover_line) for p in ref]) * cell
    on_route = np.array([slope[r, c] for c, r in ref])
    on_rover = np.array([slope[p["cell"][1], p["cell"][0]] for p in seg])
    report["reference_route"] = {"prefer_deg": PREFER_DEG, "block_deg": BLOCK_DEG, "length_m": round(ref_m), "cells": len(ref),
                                 "mean_sep_from_rover_m": round(float(sep.mean()), 1), "max_sep_from_rover_m": round(float(sep.max()), 1),
                                 "slope_median_deg": round(float(np.median(on_route)), 1), "slope_max_deg": round(float(on_route.max()), 1),
                                 "rover_stops_slope_median_deg": round(float(np.median(on_rover)), 1), "rover_stops_slope_max_deg": round(float(on_rover.max()), 1),
                                 "climb_m": round(float(topo[site_c[1], site_c[0]] - topo[base_c[1], base_c[0]]), 1)}
    print(f"  reference route (costly above {PREFER_DEG} deg, closed above {BLOCK_DEG} deg): {ref_m:.0f} m, median slope {np.median(on_route):.1f} deg, max {on_route.max():.1f} deg")
    print(f"  it stays {sep.mean():.0f} m on average and {sep.max():.0f} m at most from the rover path. Slope at the rover stops: median {np.median(on_rover):.1f} deg, max {on_rover.max():.1f} deg")
    check(on_route.max() <= BLOCK_DEG, f"the reference route never steps on a cell above {BLOCK_DEG} deg")
    (HERE / "reference_route.json").write_text(json.dumps(
        {"note": f"Slope-weighted path from base to site1: step cost = distance x (1 + (slope/{PREFER_DEG})^2), cells steeper than {BLOCK_DEG} deg blocked. For comparison only.",
         "preferDeg": PREFER_DEG, "blockDeg": BLOCK_DEG, "lengthM": round(ref_m), "cells": ref}, ensure_ascii=False) + "\n", encoding="utf-8")

dr_ = slope[r0:r1, c0:c1]
dt_ = topo[r0:r1, c0:c1]
report["demo_region"] = {"cells": [c0, r0, c1, r1], "size_m": (c1 - c0) * cell, "slope_median": round(float(np.median(dr_)), 1),
                         "slope_max": round(float(dr_.max()), 1), "relief_m": round(float(dt_.max() - dt_.min()), 1),
                         "rover_stops_inside": sum(c0 <= p["cell"][0] < c1 and r0 <= p["cell"][1] < r1 for p in pts)}
print(f"  demo region {(c1 - c0) * cell:.0f} m: median slope {np.median(dr_):.1f} deg, max {dr_.max():.1f} deg, relief {dt_.max() - dt_.min():.1f} m, "
      f"{report['demo_region']['rover_stops_inside']} rover stops inside")

(HERE / "validation_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

# ---------- Overlay figure ----------
if "--figure" in sys.argv:
    N = 768

    def overlay(img):
        img = img.convert("RGB").resize((N, N))
        d = ImageDraw.Draw(img)
        xy = [((p["lon"] - b["west"]) / (b["east"] - b["west"]) * N, (b["north"] - p["lat"]) / (b["north"] - b["south"]) * N) for p in pts]
        d.line(xy, fill=(0, 255, 255), width=2)
        d.rectangle([c0 / cols * N, N - r1 / rows * N, c1 / cols * N, N - r0 / rows * N], outline=(255, 255, 0), width=2)
        for wid, color in (("base", (0, 255, 0)), ("site1", (255, 60, 60))):
            x, y = (wp[wid]["cell"][0] + .5) / cols * N, N - (wp[wid]["cell"][1] + .5) / rows * N
            d.ellipse([x - 7, y - 7, x + 7, y + 7], outline=color, width=3)
        return img

    t = topo[::-1]
    ty, tx = np.gradient(t, cell)
    hs = np.clip(128 + 280 * (-tx + ty) / np.sqrt(1 + tx ** 2 + ty ** 2), 0, 255).astype(np.uint8)
    sl = np.clip(slope[::-1] / 35 * 255, 0, 255).astype(np.uint8)
    panels = [Image.open(DATA / "optical.png"), Image.fromarray(hs), Image.fromarray(sl), Image.open(DATA / "thermal.png")]
    out = Image.new("RGB", (N * 2, N * 2))
    for i, p in enumerate(panels):
        out.paste(overlay(p), ((i % 2) * N, (i // 2) * N))
    out.save(HERE / "check_overlay.png", optimize=True)
    print("check_overlay.png: optical | terrain shading / slope (brighter is steeper) | thermal. Cyan = rover path, green = base, red = survey site, yellow = demo region")

    # ---- Figures for the submission page and slides (docs/figures/) ----
    from PIL import ImageFont
    FIG = HERE.parent / "docs" / "figures"
    FIG.mkdir(parents=True, exist_ok=True)

    def font(size):
        for name in ("arial.ttf", "DejaVuSans.ttf"):
            try:
                return ImageFont.truetype(name, size)
            except OSError:
                pass
        return ImageFont.load_default()

    def label(d, xy, text, size=22, fill=(255, 255, 255)):
        f = font(size)
        x0, y0, x1, y1 = d.textbbox(xy, text, font=f)
        d.rectangle([x0 - 6, y0 - 4, x1 + 6, y1 + 4], fill=(0, 0, 0))
        d.text(xy, text, font=f, fill=fill)

    CYAN, YELLOW, GREEN, RED = (0, 229, 255), (255, 214, 0), (60, 255, 90), (255, 70, 70)
    NOTE = "Marswalk Visor - built from NASA data by the team's pipeline (code written with AI assistance)"

    # 1) The four layers in one image
    P = 720
    titles = ["Optical - MRO HiRISE (0.64 m/px)", "Terrain shading - from USGS Gale DEM (1 m)",
              "Slope - brighter is steeper", "Thermal, night - Mars Odyssey THEMIS (81 m/px)"]
    fig = Image.new("RGB", (P * 2, P * 2 + 44), (0, 0, 0))
    for i, p in enumerate(panels):
        im = p.convert("RGB").resize((P, P), Image.NEAREST if i == 3 else Image.LANCZOS)
        d = ImageDraw.Draw(im)
        d.line([((q["lon"] - b["west"]) / (b["east"] - b["west"]) * P, (b["north"] - q["lat"]) / (b["north"] - b["south"]) * P) for q in pts], fill=CYAN, width=3)
        for wid, color in (("base", GREEN), ("site1", RED)):
            x, y = (wp[wid]["cell"][0] + .5) / cols * P, P - (wp[wid]["cell"][1] + .5) / rows * P
            d.ellipse([x - 9, y - 9, x + 9, y + 9], outline=color, width=4)
        label(d, (14, 12), titles[i])
        fig.paste(im, ((i % 2) * P, (i // 2) * P))
    d = ImageDraw.Draw(fig)
    d.text((14, P * 2 + 10), "Gediz Vallis channel, Gale Crater, Mars - 2 km x 2 km.  Cyan: Curiosity's path.  Green: base.  Red: sulfur stone field.   " + NOTE,
           font=font(15), fill=(200, 200, 200))
    fig.save(FIG / "layers.png", optimize=True)

    # 2) Base -> survey site: the computed route and the path the rover drove
    if ref:
        xs = [c for c, _ in ref + rover_line] + [base_c[0], site_c[0]]
        ys = [r for _, r in ref + rover_line] + [base_c[1], site_c[1]]
        half = max(max(xs) - min(xs), max(ys) - min(ys)) // 2 + 14
        cx, cy = (max(xs) + min(xs)) // 2, (max(ys) + min(ys)) // 2
        x0, y0 = min(max(cx - half, 0), cols - 2 * half), min(max(cy - half, 0), rows - 2 * half)
        S = 1200
        k = S / (2 * half)                                  # pixels per cell
        opt_full = Image.open(DATA / "optical.png")
        m = opt_full.size[0] / cols
        im = opt_full.crop((x0 * m, (rows - y0 - 2 * half) * m, (x0 + 2 * half) * m, (rows - y0) * m)).resize((S, S), Image.LANCZOS).convert("RGB")
        d = ImageDraw.Draw(im)
        px = lambda c, r: ((c + .5 - x0) * k, S - (r + .5 - y0) * k)
        d.line([px(c, r) for c, r in rover_line], fill=CYAN, width=5)
        d.line([px(c, r) for c, r in ref], fill=YELLOW, width=5)
        for cell_, color, name in ((base_c, GREEN, "Base"), (site_c, RED, "Sulfur stone field")):
            x, y = px(*cell_)
            d.ellipse([x - 13, y - 13, x + 13, y + 13], outline=color, width=5)
            label(d, (x + 20, y - 14), name, 24)
        label(d, (16, 14), "Route check: planned route vs. the path Curiosity actually drove", 26)
        rr = report["reference_route"]
        label(d, (16, 58), f"Yellow: route from our slope layer (avoids steep ground, never above {BLOCK_DEG} deg) - {rr['length_m']} m", 22, YELLOW)
        label(d, (16, 94), f"Cyan: Curiosity's path, sols 4098-4200 - {report['rover_path_m']} m between stops", 22, CYAN)
        bar = 100 / cell * k                                # 100 m
        d.line([(S - 40 - bar, S - 60), (S - 40, S - 60)], fill=(255, 255, 255), width=6)
        label(d, (S - 40 - bar, S - 100), "100 m", 22)
        d.text((16, S - 28), "Image: NASA/JPL-Caltech/University of Arizona (HiRISE).  " + NOTE, font=font(14), fill=(220, 220, 220))
        im.save(FIG / "route.png", optimize=True)
    print("docs/figures/layers.png, route.png: figures for the submission page and slides")

print(f"\n{str(len(fails)) + ' FAILED' if fails else 'All checks passed'}  (validation_report.json)")
sys.exit(1 if fails else 0)
