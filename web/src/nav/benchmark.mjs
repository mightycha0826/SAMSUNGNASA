// Real C terrain; coverage and obstacle updates below are synthetic experiments.
// node src/nav/benchmark.mjs [repetitions]
import { performance } from 'node:perf_hooks';
import { buildTerrain, combineCosts } from './costs.js';
import { plan } from './planner.js';
import { GoalTree } from './goal-tree.js';
import { loadCData } from './c-data.js';
import { analyzeRoute } from './analysis.js';
import assert from 'node:assert/strict';
import os from 'node:os';

const data = loadCData(), terrain = buildTerrain(data.layerSet, data.grids);
const waypoint = id => data.layerSet.waypoints.find(w => w.id === id).cell;
const base = waypoint('base'), site = waypoint('site1');
const repetitions = Math.max(1, Number(process.argv[2]) || 3);
const drain = tree => { while (!tree.done) tree.step(100000, Infinity); };
const timed = fn => { const began = performance.now(); const value = fn(); return { ms: performance.now() - began, value }; };
const unknown = combineCosts(terrain), baseline = plan(unknown, base, site);
assert.equal(baseline.status, 'ok');
const metrics = analyzeRoute(data, baseline.points, baseline.cost), runs = [];
for (let run = 0; run < repetitions; run++) {
  const precompute = timed(() => [base, site].map(goal => { const tree = new GoalTree(unknown, goal); drain(tree); return tree; }));
  const cached = timed(() => precompute.value[1].path(base));
  assert.ok(Math.abs(cached.value.cost - baseline.cost) < 1e-5);
  const coverage = { frameId: terrain.frameId, originXZ: [-terrain.width / 2, -terrain.depth / 2], cellSizeM: terrain.cellSizeM,
    cols: terrain.cols, rows: terrain.rows, cells: new Uint8Array(terrain.cols * terrain.rows), ts: 1 };
  // Known coverage is simulated; it is not an observation supplied by NASA.
  const known = combineCosts(terrain, coverage), tree = new GoalTree(known, site); drain(tree);
  coverage.cells[(terrain.rows - 1 - 315) * terrain.cols + 264] = 1;
  const update = timed(() => {
    const next = combineCosts(terrain, coverage), changed = [];
    for (let i = 0; i < next.costs.length; i++) if (next.costs[i] !== known.costs[i]) changed.push(i);
    tree.applyChanges(next, changed); drain(tree);
    return { field: next, route: tree.path(base), changedCells: changed.length };
  });
  const fresh = timed(() => plan(update.value.field, base, site));
  assert.equal(update.value.route.status, fresh.value.status);
  if (fresh.value.status === 'ok') assert.ok(Math.abs(update.value.route.cost - fresh.value.cost) < 1e-5);
  runs.push({ twoDestinationPrecomputeMs: precompute.ms, cachedRouteMs: cached.ms,
    changedCells: update.value.changedCells, fullRepairWithFieldMs: update.ms,
    replannedStatus: update.value.route.status, freshAstarMs: fresh.ms, repairedVertices: tree.stats.expanded });
}
console.log(JSON.stringify({ node: process.version, cpu: os.cpus()[0].model,
  sourceCommit: '53a730576dd771a71a5c79a8386768befdabe1e9', grid: [terrain.cols, terrain.rows], cellSizeM: terrain.cellSizeM,
  scope: 'C terrain, actual map metres; synthetic coverage/obstacle experiment; Node elapsed time excluding Worker scheduling and rendering',
  metrics, runs }, null, 2));
