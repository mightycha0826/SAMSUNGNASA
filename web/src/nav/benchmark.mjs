// Reproducible synthetic benchmark; no NASA observations are used.
// node src/nav/benchmark.mjs [repetitions]
import { performance } from 'node:perf_hooks';
import { buildTerrain, combineCosts } from './costs.js';
import { Search } from './planner.js';
import { GoalTree } from './goal-tree.js';
import assert from 'node:assert/strict';
import os from 'node:os';

const repetitions = Math.max(1, Number(process.argv[2]) || 3);
const n = 512, topo = new Float32Array(n * n), slope = new Float32Array(n * n);
for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
  const x = c / n, y = r / n;
  topo[r * n + c] = -3760 + 90 * (0.6 * x + 0.4 * y) + 18 * Math.sin(x * 6.3) * Math.cos(y * 4.9) +
    9 * Math.sin(x * 15.1 + 1.3) * Math.sin(y * 12.7) + 35 * Math.exp(-((x - 0.7) ** 2 + (y - 0.3) ** 2) / 0.012) -
    12 * Math.exp(-((x - y) ** 2) / 0.004);
}
const at = (c, r) => topo[Math.max(0, Math.min(n - 1, r)) * n + Math.max(0, Math.min(n - 1, c))];
for (let r = 0; r < n; r++) for (let c = 0; c < n; c++)
  slope[r * n + c] = Math.atan(Math.hypot((at(c + 1, r) - at(c - 1, r)) / 8, (at(c, r + 1) - at(c, r - 1)) / 8)) * 180 / Math.PI;
const layerSet = { grid: { cols: n, rows: n, cellSizeM: 4 }, demo: { roomSizeM: [4, 4] } };
const flat = buildTerrain(layerSet, { topo: new Float32Array(n * n), slope: new Float32Array(n * n) });
const hills = buildTerrain(layerSet, { topo, slope });
const hcells = new Uint8Array(40 * 40);
for (let r = 0; r < 40; r++) for (let c = 0; c < 40; c++) {
  if (r < 2 || c < 2 || r >= 38 || c >= 38) hcells[r * 40 + c] = 255;
  else if (r >= 26 && r <= 30 && c >= 9 && c <= 13) hcells[r * 40 + c] = 1;
}
const hazard = { originXZ: [-2, -2], cellSizeM: 0.1, cols: 40, rows: 40, cells: hcells, ts: 1 };

const drain = tree => { while (!tree.done) tree.step(100000, Infinity); };
const time = fn => { const t = performance.now(); const value = fn(); return { ms: performance.now() - t, value }; };
const results = [];
for (let rep = 0; rep < repetitions; rep++) {
  const combined = time(() => combineCosts(hills, hazard));
  const field = combined.value, start = [40, 40], goals = [[256, 256], [40, 40]];
  const precompute = time(() => goals.map(goal => { const t = new GoalTree(field, goal); drain(t); return t; }));
  const tree = precompute.value[0];
  const cached = time(() => tree.path(start)); assert.equal(cached.value.status, 'ok');
  // Chair centred on an interior point of the planned route, away from endpoints.
  const points = cached.value.points, midpoint = points[Math.floor(points.length / 2)];
  const hc = Math.max(3, Math.min(36, Math.floor((midpoint[0] + .5) / n * 40)));
  const hr = Math.max(3, Math.min(36, Math.floor((1 - (midpoint[1] + .5) / n) * 40)));
  const changedHazard = { ...hazard, cells: hcells.slice(), ts: 2 }; changedHazard.cells[hr * 40 + hc] = 1;
  const update = time(() => {
    const next = combineCosts(hills, changedHazard), changed = [];
    for (let i = 0; i < next.costs.length; i++) if (next.costs[i] !== field.costs[i]) changed.push(i);
    tree.applyChanges(next, changed); drain(tree); return { next, changed: changed.length, path: tree.path(start) };
  });
  const fresh = time(() => {
    const s = new Search(update.value.next, start, goals[0], { algorithm: 'astar' });
    while (!s.done) s.step(100000, Infinity); return s.result;
  });
  assert.equal(update.value.path.status, fresh.value.status);
  assert.equal(fresh.value.status, 'ok');
  assert.ok(Math.abs(update.value.path.cost - fresh.value.cost) < 1e-7);
  const secondLookup = time(() => tree.path([41, 42]));
  results.push({ fieldMs: combined.ms, twoGoalPrecomputeMs: precompute.ms, cachedPathMs: cached.ms,
    updateWithFieldAndPathMs: update.ms, changedCells: update.value.changed, repairedVertices: tree.stats.expanded,
    freshAstarMs: fresh.ms, freshAstarVertices: fresh.value.stats.expanded, nextStartLookupMs: secondLookup.ms });
}
console.log(JSON.stringify({ node: process.version, cpu: os.cpus()[0].model, grid: [n, n], repetitions,
  scope: 'Synthetic terrain, 40x40 scan with 0.2m clearance; Node elapsed time, no Worker scheduling or rendering; not Quest measurements', results }, null, 2));
