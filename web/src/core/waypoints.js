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
