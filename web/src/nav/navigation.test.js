import test from 'node:test';
import assert from 'node:assert/strict';
import { NAV } from './config.js';
import { createGridFrame, cellToWorld, worldToCell } from './coordinates.js';
import { combineCosts, buildTerrain } from './costs.js';
import { segmentCost, plan } from './planner.js';
import { GoalTree } from './goal-tree.js';
import { Navigation } from './controller.js';
import { terrainArrays, sampleHeight } from '../map/terrain.js';
import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadCData } from './c-data.js';
import { analyzeRoute } from './analysis.js';

function field(cols, rows, fn = () => 1) {
  const costs = Float32Array.from({ length: cols * rows }, (_, i) => fn(i % cols, Math.floor(i / cols)));
  const finite = [...costs].filter(Number.isFinite);
  return { cols, rows, sx: 1, sz: 1, costs, min: Math.min(...finite), max: Math.max(...finite) };
}
function close(a, b, eps = 1e-7) { assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`); }

test('map coordinates preserve physical metres and ignore all demo dimensions', () => {
  const t = createGridFrame({ grid: { cols: 10, rows: 20, cellSizeM: 4 }, demo: { roomSizeM: [6, 4], regionCells: [2, 3, 5, 7] } });
  assert.equal(t.width, 40); assert.equal(t.depth, 80); assert.equal(t.sx, 4); assert.equal(t.sz, 4);
  for (const p of [[0, 0], [9, 19], [4.25, 11.75]]) {
    const world = cellToWorld(t, p); const again = worldToCell(t, world);
    close(again[0], p[0]); close(again[1], p[1]);
  }
  assert.ok(cellToWorld(t, [9, 19])[0] > cellToWorld(t, [0, 0])[0]);
  assert.ok(cellToWorld(t, [9, 19])[2] < cellToWorld(t, [0, 0])[2]);
});

test('missing height is preserved through the rendered surface downsampling', () => {
  const grid = { cols: 9, rows: 9, cellSizeM: 4 }, topo = new Float32Array(81).fill(100);
  const full = terrainArrays(topo, grid, 3); topo[1 * 9 + 1] = NaN;
  const withHole = terrainArrays(topo, grid, 3);
  assert.ok(withHole.indices.length < full.indices.length);
  assert.ok(Number.isNaN(sampleHeight(topo, grid, 1, 1)));
  assert.equal(sampleHeight(topo, grid, 8, 8), 100);
});

test('unknown is 3x, invalid terrain is blocked, and partial hazard overlap is conservative', () => {
  assert.equal(NAV.unknownMultiplier, 3);
  const ls = { grid: { cols: 4, rows: 4, cellSizeM: 4 }, demo: { roomSizeM: [4, 4] } };
  const topo = new Float32Array(16).fill(1), slope = new Float32Array(16).fill(0); topo[15] = NaN;
  const terrain = buildTerrain(ls, { topo, slope });
  const unknown = combineCosts(terrain);
  assert.equal(unknown.costs[0], 3); assert.equal(unknown.costs[15], Infinity);
  const cells = new Uint8Array(25); cells[2 * 5 + 2] = 1;
  const hazard = { frameId: terrain.frameId, originXZ: [-8, -8], cellSizeM: 3.2, cols: 5, rows: 5, cells, ts: 1 };
  const withHazard = combineCosts(terrain, hazard);
  assert.equal(withHazard.costs[1 * 4 + 1], Infinity);
});

test('line integral includes every weighted cell and rejects blocked corner cutting', () => {
  const f = field(3, 2, x => x === 1 ? 3 : 1);
  close(segmentCost(f, [0, 0], [2, 0]), 4);
  const corner = field(2, 2, (x, y) => x === 1 && y === 0 ? Infinity : 1);
  assert.equal(segmentCost(corner, [0, 0], [1, 1]), Infinity);
});


function drain(tree) {
  const end = performance.now() + 5000;
  while (!tree.done && performance.now() < end) tree.step(10000, Infinity);
  assert.equal(tree.done, true, 'repair did not converge');
  return tree;
}
function check(tree, start) {
  const actual = tree.path(start), expected = plan(tree.field, start, tree.goal, { algorithm: 'dijkstra' });
  assert.equal(actual.status, expected.status);
  if (actual.status !== 'ok') return actual;
  close(actual.cost, expected.cost);
  let cost = 0;
  for (let i = 1; i < actual.points.length; i++) {
    const a = actual.points[i - 1], b = actual.points[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (a.every(Number.isInteger)) assert.ok(!dx || !dy || Math.abs(dx) === Math.abs(dy), 'not an 8-way segment');
    cost += segmentCost(tree.field, a, b);
  }
  close(actual.cost, cost);
  return actual;
}

test('one precomputed destination serves multiple starts with exact 8-way costs', () => {
  const tree = drain(new GoalTree(field(20, 20), [18, 13]));
  const expanded = tree.stats.expanded;
  for (const start of [[1, 1], [18, 13], [0.2, 2.1], [19, 19]]) check(tree, start);
  assert.equal(tree.stats.expanded, expanded, 'lookup expanded the search');
  close(tree.path([1, 1]).cost, 12 * Math.SQRT2 + 5);
});

test('incremental repair matches independent Dijkstra after repeated mixed updates', () => {
  let seed = 719;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let k = 0; k < 12; k++) {
    let f = field(13, 11, () => random() < .14 ? Infinity : 1 + Math.floor(random() * 5));
    f.sx = .7; f.sz = 1.1;
    const tree = drain(new GoalTree(f, [11, 9]));
    for (let round = 0; round < 12; round++) {
      const next = { ...f, costs: f.costs.slice() }, changed = [];
      for (let j = 0; j < 5; j++) {
        const id = Math.floor(random() * f.costs.length);
        next.costs[id] = random() < .25 ? Infinity : 1 + Math.floor(random() * 5); changed.push(id);
      }
      tree.applyChanges(next, changed); drain(tree); f = next;
      for (const start of [[0, 0], [12, 10], [Math.floor(random() * 13), Math.floor(random() * 11)]]) check(tree, start);
    }
  }
});

test('blocked goals, disconnected areas and diagonal side-cell changes recover', () => {
  let f = field(9, 9), tree = drain(new GoalTree(f, [8, 8]));
  for (const ids of [[80], [80], [1, 9], [1, 9], Array.from({ length: 9 }, (_, r) => r * 9 + 4), [40]]) {
    const next = { ...f, costs: f.costs.slice() };
    for (const id of ids) next.costs[id] = Number.isFinite(f.costs[id]) ? Infinity : 1;
    tree.applyChanges(next, ids); drain(tree); f = next; check(tree, [0, 0]);
  }
});

test('further changes can arrive during an unfinished repair', () => {
  let f = field(30, 30), tree = drain(new GoalTree(f, [29, 29]));
  const next = { ...f, costs: f.costs.slice() }; next.costs[28 * 30 + 28] = Infinity;
  tree.applyChanges(next, [28 * 30 + 28]); tree.step(1, Infinity);
  const third = { ...next, costs: next.costs.slice() }; third.costs[28 * 30 + 28] = 3; third.costs[5] = Infinity;
  tree.applyChanges(third, [28 * 30 + 28, 5]); drain(tree); check(tree, [0, 0]);
});

function mockBus() {
  const handlers = new Map(), events = [];
  return { events, on(name, fn) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(fn); return () => handlers.get(name).delete(fn); },
    emit(name, payload) { events.push({ name, payload }); for (const fn of handlers.get(name) ?? []) fn(payload); } };
}
class FakeWorker { messages = []; postMessage(m) { this.messages.push(m); } terminate() {} send(m) { this.onmessage({ data: m }); } }
function fixture() {
  const clock = { now: 10000 }, bus = mockBus(), worker = new FakeWorker();
  const nav = new Navigation({ bus, worker, now: () => clock.now });
  const layerSet = { grid: { cols: 20, rows: 20, cellSizeM: 4 }, demo: { roomSizeM: [4, 4] }, waypoints: [{ id: 'base', cell: [2, 2] }, { id: 'site1', cell: [17, 2] }] };
  bus.emit('layers:ready', { layerSet, grids: { topo: new Float32Array(400), slope: new Float32Array(400) }, traverse: { points: [] } });
  const hazard = { frameId: nav.transform.frameId, originXZ: [-40, -40], cellSizeM: 4, cols: 20, rows: 20, cells: new Uint8Array(400), ts: clock.now };
  bus.emit('hazard:update', hazard);
  nav.setPosition(cellToWorld(nav.transform, [2, 2])); bus.emit('nav:request', { targetId: 'site1' });
  const result = () => worker.send({ type: 'result', id: nav.pending, version: nav.version, status: 'ok', points: [[2, 2], [17, 2]] });
  result();
  return { nav, bus, worker, hazard, clock, result };
}

test('unchanged and off-route hazards preserve guidance; on-route risk triggers repair', () => {
  const { nav, bus, worker, hazard, clock } = fixture();
  assert.equal(nav.lastStatus, 'ok'); const route = nav.route;
  const count = () => worker.messages.filter(m => m.type === 'plan').length;
  clock.now += 600; hazard.ts = clock.now;
  bus.emit('hazard:update', hazard); nav.tick(); assert.equal(count(), 1);
  // Opposite edge of the map, outside both route and clearance.
  hazard.cells[2 * 20 + 10] = 1;
  bus.emit('hazard:update', hazard); nav.tick(); assert.equal(count(), 1); assert.equal(nav.route, route);
  clock.now += 600; hazard.ts = clock.now;
  hazard.cells[17 * 20 + 10] = 255;
  bus.emit('hazard:update', hazard); nav.tick(); assert.equal(count(), 2);
  assert.equal(nav.lastStatus, 'ok'); // Safe guidance remains while cost is repaired.
  hazard.cells[17 * 20 + 10] = 1; hazard.ts = ++clock.now;
  bus.emit('hazard:update', hazard); assert.equal(nav.lastStatus, 'blocked'); assert.equal(nav.route.length, 0);
  nav.dispose();
});

test('stale output is rejected; unchanged scans persist and emergency priority works', () => {
  const { nav, bus, worker, hazard, clock } = fixture();
  const route = nav.route;
  worker.send({ type: 'result', id: nav.serial - 1, version: nav.version, status: 'ok', points: [[1, 1], [9, 9]] });
  assert.equal(nav.route, route);
  clock.now += 4000; nav.tick(); assert.equal(nav.lastStatus, 'ok');
  // The event contract sends changes, not heartbeats: silence cannot expire it.
  const old = { ...hazard, cells: new Uint8Array(400).fill(1), ts: hazard.ts - 1 };
  bus.emit('hazard:update', old); nav.tick(); assert.equal(nav.lastStatus, 'ok');
  bus.emit('alert:raise', { id: 'suit-temp', level: 'critical' }); assert.equal(nav.targetId, 'base');
  bus.emit('nav:request', { targetId: 'site1' }); assert.equal(nav.targetId, 'base');
  bus.emit('voice:command', { intent: 'nav.stop' }); assert.equal(nav.targetId, null);
  nav.dispose();
});

test('blocked starts retry after movement and malformed layer reloads clear readiness', () => {
  const { nav, bus, worker, clock } = fixture();
  bus.emit('nav:request', { targetId: 'site1' });
  worker.send({ type: 'result', id: nav.pending, version: nav.version, status: 'blocked', reason: 'start-blocked', points: [] });
  assert.equal(nav.dirty, false);
  clock.now += 600; nav.setPosition(cellToWorld(nav.transform, [5, 2])); nav.tick();
  assert.ok(nav.pending !== null);
  bus.emit('layers:ready', { ...nav.data, grids: {} });
  assert.equal(nav.transform, null); assert.equal(nav.route.length, 0);
  nav.dispose();
});

test('real Worker protocol plans all destinations and restores routes after obstacle removal', async t => {
  const moduleUrl = new URL('./planner.worker.js', import.meta.url).href;
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    globalThis.self = { postMessage: message => parentPort.postMessage(message) };
    import(${JSON.stringify(moduleUrl)}).then(() => parentPort.on('message', data => self.onmessage({ data })));
  `, { eval: true });
  t.after(() => worker.terminate());
  const request = (id, targetId, version) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { worker.off('message', onMessage); reject(Error('worker timeout')); }, 5000);
    const onMessage = m => {
      if (m.type === 'error') { clearTimeout(timer); worker.off('message', onMessage); reject(Error(m.reason)); }
      if (m.type !== 'result' || m.id !== id) return;
      clearTimeout(timer); worker.off('message', onMessage); assert.equal(m.version, version); resolve(m);
    };
    worker.on('message', onMessage);
    worker.postMessage({ type: 'plan', id, targetId, start: [3, 3] });
  });
  const layerSet = { grid: { cols: 32, rows: 32, cellSizeM: 4 }, demo: { roomSizeM: [4, 4] },
    waypoints: [{ id: 'base', cell: [1, 1] }, { id: 'site1', cell: [28, 28] }] };
  worker.postMessage({ type: 'setup', version: 1, layerSet, grids: { topo: new Float32Array(1024), slope: new Float32Array(1024) } });
  assert.equal((await request(1, 'site1', 1)).status, 'ok');
  assert.equal((await request(2, 'base', 1)).status, 'ok');
  const hazard = { frameId: createGridFrame(layerSet).frameId, originXZ: [-64, -64], cols: 16, rows: 16, cellSizeM: 8, cells: new Uint8Array(256), ts: 1 };
  for (let r = 0; r < 16; r++) hazard.cells[r * 16 + 8] = 1;
  worker.postMessage({ type: 'hazard', version: 2, hazard });
  assert.equal((await request(3, 'site1', 2)).status, 'blocked');
  hazard.cells.fill(0); hazard.ts = 2;
  worker.postMessage({ type: 'hazard', version: 3, hazard });
  assert.equal((await request(4, 'site1', 3)).status, 'ok');
});

test('C assets match the pinned source commit, including numeric grids and images', () => {
  const manifest = JSON.parse(readFileSync(new URL('./fixtures/c-data-source.json', import.meta.url)));
  for (const file of manifest.files) {
    let bytes = readFileSync(new URL(`../../public/data/${file.path}`, import.meta.url));
    if (file.path.endsWith('.json')) bytes = Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'));
    const hash = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    assert.equal(hash, file.gitBlobSha, file.path);
  }
});

test('C terrain produces a physical Mars route independent of display and demo settings', () => {
  const data = loadCData(), { layerSet, grids } = data;
  const frame = createGridFrame(layerSet), field = combineCosts(buildTerrain(layerSet, grids));
  const base = layerSet.waypoints.find(w => w.id === 'base').cell, site = layerSet.waypoints.find(w => w.id === 'site1').cell;
  assert.deepEqual(base, [247, 357]); assert.deepEqual(site, [275, 272]);
  assert.equal(frame.width, 2048); assert.equal(frame.sx, 4); assert.equal(field.sx, 4);
  const result = plan(field, base, site), tree = drain(new GoalTree(field, site));
  assert.equal(result.status, 'ok'); close(tree.path(base).cost, result.cost, 1e-5);
  const metrics = analyzeRoute(data, result.points, result.cost);
  const reference = JSON.parse(readFileSync(new URL('./fixtures/c-reference-route.json', import.meta.url)));
  const referenceMetrics = analyzeRoute(data, reference.cells);
  assert.ok(Math.abs(metrics.distanceM - referenceMetrics.distanceM) < 2);
  assert.ok(metrics.distanceM > 380 && metrics.distanceM < 405, JSON.stringify(metrics));
  assert.ok(metrics.ascentM > 40 && metrics.ascentM < 60); assert.ok(metrics.maxSlopeDeg <= 20);
  assert.ok(metrics.weightedCost > metrics.distanceM * 3);
  const other = { ...layerSet, demo: { roomSizeM: [500, .001], regionCells: [0, 0, 1, 1] } };
  const without = { ...layerSet }; delete without.demo;
  for (const ls of [other, without]) {
    const otherField = combineCosts(buildTerrain(ls, grids));
    assert.deepEqual(otherField, field); assert.deepEqual(createGridFrame(ls), frame);
    const otherRoute = plan(otherField, base, site); close(otherRoute.cost, result.cost);
    assert.deepEqual(otherRoute.points, result.points);
  }
});

test('20-degree boundary is allowed, steeper slopes and missing data are excluded', () => {
  const layerSet = { grid: { cols: 2, rows: 2, cellSizeM: 4 } };
  const terrain = buildTerrain(layerSet, { topo: new Float32Array(4), slope: Float32Array.of(15, 20, 20.01, NaN) });
  assert.equal(terrain.base[0], 2); close(terrain.base[1], 1 + (20 / 15) ** 2, 1e-6);
  assert.equal(terrain.base[2], Infinity); assert.equal(terrain.base[3], Infinity);
});

test('unregistered sensor coordinates cannot alter C mission routes', () => {
  const data = loadCData(), bus = mockBus(), worker = new FakeWorker(), nav = new Navigation({ bus, worker });
  bus.emit('layers:ready', data);
  const before = worker.messages.length, version = nav.version;
  const hazard = { originXZ: [-2, -2], cols: 40, rows: 40, cellSizeM: .1, cells: new Uint8Array(1600).fill(1), ts: Date.now() };
  bus.emit('hazard:update', hazard);
  assert.equal(worker.messages.length, before); assert.equal(nav.version, version); assert.equal(nav.hazard, null);
  assert.throws(() => combineCosts(buildTerrain(data.layerSet, data.grids), hazard), /hazard-frame-mismatch/);
  nav.dispose();
});

test('registered metre-scale hazards are updated in the same generic map frame', () => {
  const data = loadCData(), terrain = buildTerrain(data.layerSet, data.grids);
  const hazard = { frameId: terrain.frameId, originXZ: [-1024, -1024], cols: 512, rows: 512, cellSizeM: 4, cells: new Uint8Array(512 * 512), ts: 1 };
  const known = combineCosts(terrain, hazard), unknown = combineCosts(terrain);
  const id = 357 * 512 + 247;
  close(unknown.costs[id], known.costs[id] * 3, 1e-6);
  hazard.cells[(511 - 315) * 512 + 264] = 1;
  const blocked = combineCosts(terrain, hazard); assert.equal(blocked.costs[315 * 512 + 264], Infinity);
});

test('route metrics handle positions in the edge half-cell without inventing elevation', () => {
  const data = { layerSet: { grid: { cols: 2, rows: 2, cellSizeM: 4 } }, grids: { topo: Float32Array.of(1, 2, 1, 2), slope: new Float32Array(4) } };
  const metrics = analyzeRoute(data, [[-.25, 0], [1, 0]]);
  close(metrics.distanceM, 5); close(metrics.ascentM, 1);
  assert.equal(analyzeRoute(data, [[-.51, 0], [1, 0]]), null);
});
