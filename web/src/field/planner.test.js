// node --test src/field/planner.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { planPath, inflate } from './planner.js';

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
