import { NAV } from './config.js';
import { cellToWorld, createGridFrame } from './coordinates.js';

export function validateHazard(h) {
  return !!h && Number.isInteger(h.cols) && Number.isInteger(h.rows) && h.cols > 0 && h.rows > 0 &&
    Number.isFinite(h.cellSizeM) && h.cellSizeM > 0 && h.originXZ?.length === 2 &&
    h.originXZ.every(Number.isFinite) && h.cells instanceof Uint8Array &&
    h.cells.length === h.cols * h.rows && Number.isFinite(h.ts) &&
    h.cells.every(v => v === 0 || v === 1 || v === 255);
}

export function hazardField(h, clearanceM = NAV.clearanceM) {
  if (!validateHazard(h)) throw new Error('invalid-hazard');
  const costs = Float32Array.from(h.cells, v => v === 1 ? Infinity : v === 255 ? NAV.unknownMultiplier : 1);
  const n = Math.ceil(clearanceM / h.cellSizeM);
  for (let r = 0; r < h.rows; r++) for (let c = 0; c < h.cols; c++) {
    if (h.cells[r * h.cols + c] !== 1) continue;
    for (let dr = -n; dr <= n; dr++) for (let dc = -n; dc <= n; dc++) {
      // Cell rectangles expanded in metres; conservative square clearance.
      if (r + dr >= 0 && r + dr < h.rows && c + dc >= 0 && c + dc < h.cols)
        costs[(r + dr) * h.cols + c + dc] = Infinity;
    }
  }
  return { cols: h.cols, rows: h.rows, sx: h.cellSizeM, sz: h.cellSizeM, costs,
    originXZ: h.originXZ, min: 1 };
}

export function buildTerrain(layerSet, grids) {
  const t = createGridFrame(layerSet);
  const n = t.cols * t.rows;
  if (grids.topo?.length !== n || grids.slope?.length !== n) throw new Error('missing-topo-or-slope');
  const base = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = grids.slope[i];
    base[i] = Number.isFinite(grids.topo[i]) && Number.isFinite(s) && s >= 0 && s <= NAV.maxSlopeDeg
      ? 1 + (s / NAV.slopeReferenceDeg) ** 2 : Infinity;
  }
  return { ...t, base };
}

export function combineCosts(terrain, hazard = null) {
  if (hazard && hazard.frameId !== terrain.frameId) throw new Error('hazard-frame-mismatch');
  const h = hazard ? hazardField(hazard) : null;
  const costs = new Float32Array(terrain.base.length);
  let min = Infinity, max = 0;
  for (let r = 0; r < terrain.rows; r++) for (let c = 0; c < terrain.cols; c++) {
    let mult = NAV.unknownMultiplier;
    if (h) {
      const p = cellToWorld(terrain, [c, r]);
      // Conservative intersection, not just the centre: no raster cell may
      // hide part of a scanned obstacle or an unknown area.
      const x0 = (p[0] - terrain.sx / 2 - h.originXZ[0]) / h.sx;
      const x1 = (p[0] + terrain.sx / 2 - h.originXZ[0]) / h.sx;
      const y0 = (p[2] - terrain.sz / 2 - h.originXZ[1]) / h.sz;
      const y1 = (p[2] + terrain.sz / 2 - h.originXZ[1]) / h.sz;
      const eps = 1e-10;
      mult = x0 < -eps || y0 < -eps || x1 > h.cols + eps || y1 > h.rows + eps ? NAV.unknownMultiplier : 1;
      const c0 = Math.max(0, Math.floor(x0 + eps)), c1 = Math.min(h.cols - 1, Math.ceil(x1 - eps) - 1);
      const r0 = Math.max(0, Math.floor(y0 + eps)), r1 = Math.min(h.rows - 1, Math.ceil(y1 - eps) - 1);
      for (let hr = r0; hr <= r1; hr++) for (let hc = c0; hc <= c1; hc++) mult = Math.max(mult, h.costs[hr * h.cols + hc]);
    }
    const w = terrain.base[r * terrain.cols + c] * mult;
    costs[r * terrain.cols + c] = w;
    if (Number.isFinite(w)) { min = Math.min(min, w); max = Math.max(max, w); }
  }
  return { cols: terrain.cols, rows: terrain.rows, sx: terrain.sx, sz: terrain.sz, costs, min, max };
}

export function sameHazard(a, b) {
  return !!a && a.frameId === b.frameId && a.cols === b.cols && a.rows === b.rows && a.cellSizeM === b.cellSizeM &&
    a.originXZ[0] === b.originXZ[0] && a.originXZ[1] === b.originXZ[1] &&
    a.cells.length === b.cells.length && a.cells.every((v, i) => v === b.cells[i]);
}

// A changed sensor rectangle matters only when it intersects the remaining
// route. Include half a terrain cell because combineCosts uses full cell areas.
export function hazardAffectsRoute(before, after, points, marginX = 0, marginZ = 0) {
  if (!before || before.cols !== after.cols || before.rows !== after.rows || before.sx !== after.sx ||
      before.sz !== after.sz || before.originXZ.some((v, i) => v !== after.originXZ[i])) return true;
  const intersects = (a, b, x0, x1, z0, z1) => {
    let lo = 0, hi = 1;
    for (const [v, d, min, max] of [[a[0], b[0] - a[0], x0, x1], [a[2], b[2] - a[2], z0, z1]]) {
      if (!d) { if (v < min || v > max) return false; }
      else { const p = (min - v) / d, q = (max - v) / d; lo = Math.max(lo, Math.min(p, q)); hi = Math.min(hi, Math.max(p, q)); }
    }
    return lo <= hi;
  };
  for (let id = 0; id < after.costs.length; id++) {
    if (before.costs[id] === after.costs[id]) continue;
    const x = after.originXZ[0] + (id % after.cols) * after.sx;
    const z = after.originXZ[1] + Math.floor(id / after.cols) * after.sz;
    for (let i = 0; i < points.length; i++) if (intersects(points[Math.max(0, i - 1)], points[i],
      x - marginX, x + after.sx + marginX, z - marginZ, z + after.sz + marginZ)) return true;
  }
  return false;
}
