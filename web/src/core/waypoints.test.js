// node --test src/core/waypoints.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { nearbyWaypoint, navTarget, walkableNear, reachableFrom } from './waypoints.js';

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

test('"Navigate" goes to the nearby point, or to the survey site on a map without it', () => {
  const all = new Set(['base', 'site1', 'near']), noNear = new Set(['base', 'site1']);
  assert.equal(navTarget('near', all), 'near');
  assert.equal(navTarget(undefined, all), 'near');
  assert.equal(navTarget('site1', all), 'site1'); // "survey site" still means the survey site
  assert.equal(navTarget('near', noNear), 'site1');
  assert.equal(navTarget(undefined, noNear), 'site1');
  assert.equal(navTarget('near', null), 'near'); // before the map loads: as asked
});

test('a place picked on steep ground moves to the nearest walkable cell', () => {
  const ls = { grid: { cols: 20, rows: 20, cellSizeM: 4 } };
  const slope = new Float32Array(400).fill(35);
  slope[10 * 20 + 14] = 8; // walkable, 4 cells east of the pick
  slope[3 * 20 + 3] = 5; // walkable, but farther
  assert.deepEqual(walkableNear(ls, slope, [10.2, 9.8]), [14, 10]);
  slope[10 * 20 + 10] = 12;
  assert.deepEqual(walkableNear(ls, slope, [10.2, 9.8]), [10, 10], 'a walkable pick stays where it is');
  assert.equal(walkableNear(ls, new Float32Array(400).fill(35), [10, 10]), null, 'nothing walkable within reach');
  assert.deepEqual(walkableNear(ls, null, [10.4, 9.6]), [10, 10], 'no slope data: as picked');
});

test('a walkable patch that nothing leads to is not a destination: the pick goes to ground connected to the wearer', () => {
  const ls = { grid: { cols: 20, rows: 20, cellSizeM: 4 } };
  const slope = new Float32Array(400).fill(35);
  for (let c = 0; c <= 8; c++) slope[10 * 20 + c] = 5; // a walkable strip from the wearer at [0, 10] to [8, 10]
  slope[10 * 20 + 12] = 5; // an island next to the pick, cut off by steep ground
  const within = reachableFrom(ls, slope, [0, 10]);
  assert.equal(within[10 * 20 + 8], 1);
  assert.equal(within[10 * 20 + 12], 0);
  assert.deepEqual(walkableNear(ls, slope, [13, 10]), [12, 10], 'without the reachable set: the island');
  assert.deepEqual(walkableNear(ls, slope, [13, 10], { within }), [8, 10], 'with it: the end of the strip');
});
