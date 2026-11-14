// node --test src/core/waypoints.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { nearbyWaypoint } from './waypoints.js';

// The real map: 512 x 512 cells of 4 m, base and survey site where layerset.json has them.
const REAL = { grid: { cols: 512, rows: 512, cellSizeM: 4 }, waypoints: [{ id: 'base', cell: [247, 357] }, { id: 'site1', cell: [275, 272] }] };

test('about 20 m from the base, on the way to the survey site', () => {
  const wp = nearbyWaypoint(REAL, 20);
  assert.equal(wp.id, 'near');
  const dx = wp.cell[0] - 247;
  const dy = wp.cell[1] - 357;
  const d = Math.hypot(dx, dy) * 4;
  assert.ok(Math.abs(d - 20) <= 2, `distance ${d}`);
  assert.equal(wp.distanceM, Math.round(d * 10) / 10);
  // same side as the survey site: north (rows decrease) and a little east
  assert.ok(dy < 0 && dx >= 0);
  // within 15 degrees of the bearing
  const cos = (dx * 28 + dy * -85) / (Math.hypot(dx, dy) * Math.hypot(28, 85));
  assert.ok(cos > Math.cos((15 * Math.PI) / 180));
});

test('a cell too steep to stand on is passed over for the next one along the ring', () => {
  const free = nearbyWaypoint(REAL, 20);
  const slope = new Float32Array(512 * 512).fill(5);
  slope[free.cell[1] * 512 + free.cell[0]] = 30;
  const other = nearbyWaypoint(REAL, 20, slope);
  assert.notDeepEqual(other.cell, free.cell);
  assert.ok(Math.abs(Math.hypot(other.cell[0] - 247, other.cell[1] - 357) * 4 - 20) <= 2);
  slope.fill(30);
  assert.equal(nearbyWaypoint(REAL, 20, slope), null);
  slope.fill(NaN);
  assert.equal(nearbyWaypoint(REAL, 20, slope), null);
});

test('stays on the map, and gives nothing when it cannot be placed', () => {
  const corner = { grid: { cols: 512, rows: 512, cellSizeM: 4 }, waypoints: [{ id: 'base', cell: [0, 0] }, { id: 'site1', cell: [256, 256] }] };
  const wp = nearbyWaypoint(corner, 20);
  assert.ok(wp.cell[0] >= 0 && wp.cell[1] >= 0);
  assert.equal(nearbyWaypoint({ grid: REAL.grid, waypoints: [REAL.waypoints[0]] }, 20), null); // no survey site
  assert.equal(nearbyWaypoint(REAL, 0), null);
  assert.equal(nearbyWaypoint(REAL, 5000), null); // farther than the survey site
});
