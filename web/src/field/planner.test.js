// node --test src/field/planner.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { planPath, inflate, impassable } from './planner.js';

function room(cols = 60, rows = 60) {
  return { originXZ: [-3, -3], cellSizeM: 0.1, cols, rows, cells: new Uint8Array(cols * rows) };
}
function wall(g, x0, z0, x1, z1) {
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const x = g.originXZ[0] + (c + 0.5) * g.cellSizeM;
    const z = g.originXZ[1] + (r + 0.5) * g.cellSizeM;
    if (x >= x0 && x <= x1 && z >= z0 && z <= z1) g.cells[r * g.cols + c] = 1;
  }
}
const length = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

test('no grid: straight line', () => {
  const r = planPath(null, [0, 0], [3, 4]);
  assert.equal(r.points.length, 2);
  assert.equal(r.distanceM, 5);
});

test('empty room: nearly straight', () => {
  const r = planPath(room(), [-2, -2], [2, 2]);
  assert.equal(r.blocked, false);
  assert.ok(Math.abs(r.distanceM - Math.hypot(4, 4)) < 0.2, String(r.distanceM));
  assert.ok(r.points.length <= 3);
});

test('goes around a wall and keeps its distance', () => {
  const g = room();
  wall(g, -0.1, -3, 0.1, 1.5); // a wall with a gap at the bottom of the room
  const r = planPath(g, [-2, 0], [2, 0]);
  assert.equal(r.blocked, false);
  assert.ok(r.distanceM > 5, `detour expected, got ${r.distanceM}`);
  assert.ok(Math.abs(length(r.points) - r.distanceM) < 1e-6);
  const blocked = inflate(g);
  for (let i = 1; i < r.points.length; i++) {
    for (let k = 0; k <= 20; k++) {
      const x = r.points[i - 1][0] + ((r.points[i][0] - r.points[i - 1][0]) * k) / 20;
      const z = r.points[i - 1][1] + ((r.points[i][1] - r.points[i - 1][1]) * k) / 20;
      const c = Math.floor((x + 3) / 0.1);
      const rr = Math.floor((z + 3) / 0.1);
      assert.equal(blocked[rr * g.cols + c], 0, `path enters the margin at ${x.toFixed(2)}, ${z.toFixed(2)}`);
    }
  }
});

test('sealed off: blocked', () => {
  const g = room();
  wall(g, -0.1, -3, 0.1, 3);
  assert.equal(planPath(g, [-2, 0], [2, 0]).blocked, true);
});

test('target marked next to a wall still gets a path', () => {
  const g = room();
  wall(g, 1.0, -3, 1.2, 3);
  const r = planPath(g, [-2, 0], [0.85, 0]); // inside the wall's clearance margin
  assert.equal(r.blocked, false);
  assert.deepEqual(r.points[0], [-2, 0]);
});

test('unknown floor is walkable', () => {
  const g = room();
  g.cells.fill(255);
  assert.equal(planPath(g, [-2, -2], [2, 2]).blocked, false);
});

// Two walls across the room with an opening of `gapM` between them at x = 0.
function gapRoom(gapM) {
  const g = room();
  wall(g, -3, -0.1, -gapM / 2 - 0.001, 0.1);
  wall(g, gapM / 2 + 0.001, -0.1, 3, 0.1);
  return g;
}

test('a 30 cm gap can be squeezed through', () => {
  const r = planPath(gapRoom(0.3), [0, -2], [0, 2]);
  assert.equal(r.blocked, false);
  assert.ok(r.distanceM < 4.5, `straight through expected, got ${r.distanceM}`);
});

test('a 30 cm gap whose sides fall inside cells (2 free cells) still passes', () => {
  const g = room();
  wall(g, -3, -0.1, -0.11, 0.1);
  wall(g, 0.11, -0.1, 3, 0.1); // free: the cells at x = -0.05 and 0.05
  assert.equal(planPath(g, [0, -2], [0, 2]).blocked, false);
});

test('a 10 cm gap is too narrow', () => {
  const g = room();
  wall(g, -3, -0.1, -0.01, 0.1);
  wall(g, 0.11, -0.1, 3, 0.1); // free: one cell
  assert.equal(planPath(g, [0, -2], [0, 2]).blocked, true);
  const blocked = impassable(g);
  assert.equal(blocked[30 * g.cols + 30], 1, 'the cell in the gap is not walkable');
});

test('a diagonal pinch between two corners is too narrow', () => {
  const g = room(20, 20);
  g.cells[9 * 20 + 9] = 1;
  g.cells[11 * 20 + 11] = 1; // (10, 10) sits between the two corners
  assert.equal(impassable(g)[10 * 20 + 10], 1);
  assert.equal(impassable(g)[10 * 20 + 12], 0);
});

test('a wide way a little longer is taken instead of the squeeze', () => {
  const g = room();
  wall(g, -3, -0.1, -1.6, 0.1); // a 1 m opening at x = -1.6 .. -0.6
  wall(g, -0.6, -0.1, -0.151, 0.1);
  wall(g, 0.151, -0.1, 3, 0.1); // and a 30 cm gap at x = 0
  const r = planPath(g, [0, -1], [0, 1]);
  assert.equal(r.blocked, false);
  assert.ok(r.points.some((p) => p[0] < -0.7), `expected the wide opening: ${JSON.stringify(r.points)}`);
});

test('the squeeze is taken when the wide way is far', () => {
  const g = room();
  wall(g, -2.0, -0.1, -0.151, 0.1); // the only other opening is at the far left wall
  wall(g, 0.151, -0.1, 3, 0.1);
  const r = planPath(g, [1, -1], [1, 1]);
  assert.equal(r.blocked, false);
  assert.ok(r.points.every((p) => p[0] > -1), `expected the gap at x = 0: ${JSON.stringify(r.points)}`);
});

test('known floor is preferred to unseen floor: the known way is taken unless it is three times as long', () => {
  // The straight way from A to B (4 m) lies on floor nobody has seen; a corridor of known floor
  // goes around it.
  const make = (detourHalfM) => {
    const g = room(120, 120); // 12 m square, origin -3
    g.originXZ = [-6, -6];
    g.cells.fill(255);
    const known = (x0, z0, x1, z1) => {
      for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
        const x = g.originXZ[0] + (c + 0.5) * g.cellSizeM;
        const z = g.originXZ[1] + (r + 0.5) * g.cellSizeM;
        if (x >= x0 && x <= x1 && z >= z0 && z <= z1) g.cells[r * g.cols + c] = 0;
      }
    };
    known(-2.6, -0.6, -1.4, detourHalfM + 0.6); // up from A
    known(-2.6, detourHalfM - 0.6, 2.6, detourHalfM + 0.6); // across
    known(1.4, -0.6, 2.6, detourHalfM + 0.6); // down to B
    return g;
  };
  const viaKnown = (r) => r.points.some((p) => p[1] > 0.5);
  // The known way is 4 + 2 x 1.5 = 7 m against 4 m of unseen floor (costing 12): it is taken.
  assert.equal(viaKnown(planPath(make(1.5), [-2, 0], [2, 0])), true);
  // A known way of 4 + 2 x 5 = 14 m is more than three times the direct 4 m: straight across.
  assert.equal(viaKnown(planPath(make(5), [-2, 0], [2, 0])), false);
});
