// A destination close to the start, added to the waypoints the data brings (base and the survey
// site, hundreds of metres apart).
//
// Why: the survey site is 358 m from the base in a straight line. A destination about 20 m out
// lies inside the 20 m the field map shows around the wearer, and gives the route planner a
// short route to look at. It is derived, not NASA data: a cell on the bearing from the base to
// the survey site, at the asked distance, moved sideways along that ring if the cell on the
// bearing is too steep to stand on.
//
// Pure arithmetic: node --test src/core/waypoints.test.js

/**
 * @param layerSet   { grid: { cols, rows, cellSizeM }, waypoints: [{ id, cell: [col, row] }] }
 * @param distanceM  how far from the start, in map metres
 * @param slope      optional Float32Array of slopes in degrees (row * cols + col)
 * @param opts       { fromId, towardId, maxSlopeDeg }
 * @returns the waypoint to add, or null (no start, no bearing, or nothing usable on the ring)
 */
export function nearbyWaypoint(layerSet, distanceM, slope = null, { fromId = 'base', towardId = 'site1', maxSlopeDeg = 20 } = {}) {
  const { cols, rows, cellSizeM } = layerSet?.grid ?? {};
  const from = layerSet?.waypoints?.find((w) => w.id === fromId);
  const toward = layerSet?.waypoints?.find((w) => w.id === towardId);
  if (!from || !toward || !(cellSizeM > 0) || !(distanceM > 0)) return null;
  const bx = toward.cell[0] - from.cell[0];
  const by = toward.cell[1] - from.cell[1];
  const far = Math.hypot(bx, by);
  const r = distanceM / cellSizeM; // the distance in cells
  if (far < 1e-9 || r >= far) return null; // no bearing, or the survey site itself is nearer

  // Every cell whose centre is within half a cell of the ring, nearest to the bearing first.
  const reach = Math.ceil(r) + 1;
  const ring = [];
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const d = Math.hypot(dx, dy);
      if (Math.abs(d - r) > 0.5) continue;
      const col = from.cell[0] + dx;
      const row = from.cell[1] + dy;
      if (col < 0 || row < 0 || col >= cols || row >= rows) continue;
      const off = Math.acos(Math.max(-1, Math.min(1, (dx * bx + dy * by) / (d * far)))); // angle off the bearing
      ring.push({ col, row, off, d });
    }
  }
  // Roughly on the bearing (within 15 degrees) the cell closest to the asked distance comes
  // first; outside that, the one least off the bearing.
  const NEAR_BEARING = (15 * Math.PI) / 180;
  ring.sort((a, b) => (a.off > NEAR_BEARING) - (b.off > NEAR_BEARING)
    || (a.off <= NEAR_BEARING ? Math.abs(a.d - r) - Math.abs(b.d - r) || a.off - b.off : a.off - b.off));
  const usable = (c) => {
    if (!slope) return true;
    const s = slope[c.row * cols + c.col];
    return Number.isFinite(s) && s < maxSlopeDeg;
  };
  const pick = ring.find(usable);
  if (!pick) return null;
  const actualM = Math.round(pick.d * cellSizeM * 10) / 10;
  return {
    id: 'near',
    label: `Nearby point · ${Math.round(actualM)} m`,
    labelEn: `Nearby point · ${Math.round(actualM)} m`,
    cell: [pick.col, pick.row],
    derived: true, // not from the data: made from the base position and the bearing to the survey site
    fromId,
    towardId,
    distanceM: actualM,
  };
}

/** Where "Navigate" goes when the command names no destination the map has, in this order. */
export const NAV_DEFAULTS = ['near', 'site1'];

/**
 * The destination a nav.start command means. "Navigate" names the nearby point; a map without
 * it (?near=0, or no usable cell) gets the survey site instead.
 * @param {string | undefined} targetId what the command asked for
 * @param {Set<string> | null} known ids of the waypoints the map has, null before the map loads
 */
export function navTarget(targetId, known = null) {
  if (!known) return targetId ?? NAV_DEFAULTS[0];
  if (targetId && known.has(targetId)) return targetId;
  return NAV_DEFAULTS.find((id) => known.has(id)) ?? targetId ?? NAV_DEFAULTS[0];
}

/**
 * The walkable cell nearest to `cell`: the cell itself when its slope is at most maxSlopeDeg,
 * else the closest one that is, within reachCells; null when there is none. The planner closes
 * ground steeper than that, so a destination picked on a steep spot would have no route.
 * @param {{ grid: { cols: number, rows: number } }} layerSet
 * @param {Float32Array | null} slope degrees per cell (grids.slope); without it the cell is taken as it is
 * @param {{ within?: Uint8Array | null }} opts within: only cells marked 1 count (reachableFrom): walkable
 *        ground that cannot be reached from where the wearer is would have no route either
 */
export function walkableNear(layerSet, slope, cell, { maxSlopeDeg = 20, reachCells = 15, within = null } = {}) {
  const { cols, rows } = layerSet.grid;
  const c0 = Math.round(cell[0]);
  const r0 = Math.round(cell[1]);
  const ok = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows && (!slope || slope[r * cols + c] <= maxSlopeDeg) && (!within || within[r * cols + c] === 1);
  if (ok(c0, r0)) return [c0, r0];
  let best = null;
  let bestD = Infinity;
  for (let dr = -reachCells; dr <= reachCells; dr++) {
    for (let dc = -reachCells; dc <= reachCells; dc++) {
      const d = dc * dc + dr * dr;
      if (d < bestD && d <= reachCells * reachCells && ok(c0 + dc, r0 + dr)) {
        best = [c0 + dc, r0 + dr];
        bestD = d;
      }
    }
  }
  return best;
}

/**
 * The cells that can be walked to from `cell` over ground no steeper than maxSlopeDeg, moving
 * to any of the eight neighbours: 1 where reachable. Much of a crater wall is walkable in
 * patches that nothing leads to; a destination has to be on ground that is connected to the
 * wearer. (The planner has the last word: it also knows hazards. This is the slope alone.)
 */
export function reachableFrom(layerSet, slope, cell, maxSlopeDeg = 20) {
  const { cols, rows } = layerSet.grid;
  const out = new Uint8Array(cols * rows);
  const walk = (i) => !slope || slope[i] <= maxSlopeDeg;
  const start = Math.round(cell[1]) * cols + Math.round(cell[0]);
  if (!(start >= 0 && start < out.length)) return out;
  const queue = new Int32Array(cols * rows);
  let head = 0;
  let tail = 0;
  out[start] = 1; // where the wearer stands counts, whatever the slope under their feet
  queue[tail++] = start;
  while (head < tail) {
    const i = queue[head++];
    const c = i % cols;
    const r = (i - c) / cols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dc && !dr) continue;
        const cc = c + dc;
        const rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
        const j = rr * cols + cc;
        if (out[j] || !walk(j)) continue;
        out[j] = 1;
        queue[tail++] = j;
      }
    }
  }
  return out;
}
