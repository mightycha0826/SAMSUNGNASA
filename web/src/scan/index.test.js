// node --test src/scan/index.test.js
// The scan module as a whole, with a stand-in for the headset: a room model (WebXR meshes), a
// head that walks, and the bus. Checks what goes out as hazard:update and map:store when the
// window moves, and what a stored map does when it comes back. No depth sensing here (grid.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window ??= {};
const { init, update, SCAN } = await import('./index.js');
const { encodeRuns, decodeRuns } = await import('./memory.js');
const { TILES } = await import('./tiles.js');

const T = TILES.cells;
const COLS = T * TILES.window;
const TILE_M = T * SCAN.cellM;
const IDENTITY = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

// A corridor 40 m long and 6 m wide: its floor, and a wall along one side.
const quad = (points) => ({ meshSpace: {}, lastChangedTime: 1, vertices: Float32Array.from(points.flat()), indices: Uint32Array.from([0, 1, 2, 0, 2, 3]) });
const FLOOR = quad([[-9.95, 0, -3.05], [29.95, 0, -3.05], [29.95, 0, 2.95], [-9.95, 0, 2.95]]);
const WALL = quad([[-9.95, 0, -3.05], [29.95, 0, -3.05], [29.95, 2.5, -3.05], [-9.95, 2.5, -3.05]]);
const meshes = new Set([FLOOR, WALL]);

const sentEvents = [];
const on = {};
const hooks = {};
const hub = new Map(); // what a hub would hold: run -> its tiles, merged as they arrive
let lastRun = null; // the run of the last map:store
function emit(name, payload) {
  sentEvents.push([name, payload]);
  if (name !== 'map:store') return;
  lastRun = payload.run;
  if (!hub.has(lastRun)) hub.set(lastRun, new Map());
  for (const t of payload.tiles) hub.get(lastRun).set(`${t.x},${t.z}`, t);
}
const ctx = {
  bus: { on: (name, fn) => (on[name] = fn), emit },
  xr: { has: () => false, enabledFeatures: [], onSessionStart: (fn) => (hooks.start = fn), onSessionEnd: (fn) => (hooks.end = fn) },
  mock: { hazard: false },
  renderer: { xr: {} },
  scene: { add() {} },
};
const refSpace = { addEventListener() {} };
let now = 1000;
const head = [0, 0];

// Run the app's frame loop for `ms` with the head where it is.
function frames(ms) {
  for (const end = now + ms; now < end; now += 100) {
    update({
      time: now,
      refSpace,
      xrFrame: {
        detectedMeshes: meshes,
        detectedPlanes: undefined,
        getPose: () => ({ transform: { matrix: IDENTITY } }),
        getViewerPose: () => ({ transform: { position: { x: head[0], y: 1.6, z: head[1] }, matrix: IDENTITY } }),
      },
    });
  }
}
// Walk in a straight line along x to `x`, at 1 m/s.
function walkTo(x) {
  const step = Math.sign(x - head[0]) * 0.1;
  while (Math.abs(x - head[0]) > 0.05) {
    head[0] += step;
    frames(100);
  }
  head[0] = x;
  frames(3000); // stand still: the map is sent and stored
}
// The events of one name sent since the last call, oldest first.
function taken(name) {
  const found = sentEvents.filter(([n]) => n === name).map(([, payload]) => payload);
  for (let i = sentEvents.length - 1; i >= 0; i--) if (sentEvents[i][0] === name) sentEvents.splice(i, 1);
  return found;
}
// The value of the cell at room position (x, z) in a hazard:update.
function cellAt(h, x, z) {
  const c = Math.floor((x - h.originXZ[0]) / h.cellSizeM);
  const r = Math.floor((z - h.originXZ[1]) / h.cellSizeM);
  return c >= 0 && r >= 0 && c < h.cols && r < h.rows ? h.cells[r * h.cols + c] : undefined;
}
// The tiles in a list of map:store events, by key; a later one replaces an earlier one.
function tilesOf(stores) {
  const tiles = new Map();
  for (const s of stores) for (const t of s.tiles) tiles.set(`${t.x},${t.z}`, t);
  return tiles;
}
const keysOf = (stores) => [...tilesOf(stores).keys()].sort();

let firstRun; // the name of the first run; hub.get(firstRun) is its map

test('a session starts with a window of 4 x 4 tiles around the room origin', () => {
  init(ctx);
  assert.equal(taken('map:request').length, 1, 'the hub is asked for the map it stored last');
  frames(3000);
  const updates = taken('hazard:update');
  assert.equal(updates.length, 1, 'the room model stands still: one update');
  const h = updates[0];
  assert.deepEqual([h.cols, h.rows, h.cellSizeM], [COLS, COLS, SCAN.cellM]);
  assert.deepEqual(h.originXZ, [-2 * TILE_M, -2 * TILE_M]);
  assert.equal(h.cells.length, COLS * COLS);
  assert.equal(cellAt(h, 0, 0), 0, 'floor');
  assert.equal(cellAt(h, 0, -3.05), 1, 'the wall');
  assert.equal(cellAt(h, 0, 5), 255, 'beyond the corridor: not seen');
  assert.equal(cellAt(h, 12.75, 0), 0, 'floor up to the edge of the window');
  assert.deepEqual([h.stats.archived, h.stats.windowXZ], [0, h.originXZ]);
});

test('the map goes to the hub in tiles: only tiles that hold something, each 64 x 64 cells as runs', () => {
  const stores = taken('map:store');
  assert.equal(stores.length, 1);
  const s = stores[0];
  firstRun = s.run;
  assert.deepEqual([s.cellSizeM, s.tileCells, s.source], [SCAN.cellM, T, 'room-scan']);
  assert.deepEqual(Object.keys(s).sort(), ['cellSizeM', 'run', 'source', 'stats', 'tileCells', 'tiles']);
  // The corridor crosses the window from x = -9.95 on, in the two rows of tiles either side of z = 0.
  assert.deepEqual(keysOf(stores), ['-1,-1', '-1,0', '-2,-1', '-2,0', '0,-1', '0,0', '1,-1', '1,0']);
  for (const t of s.tiles) assert.ok(decodeRuns(t.runs, T * T), `tile ${t.x},${t.z} is a whole tile`);
  const wallTile = decodeRuns(s.tiles.find((t) => t.x === 0 && t.z === -1).runs, T * T);
  assert.equal(wallTile.filter((v) => v === 1).length, T, 'one row of wall across the tile');
  frames(5000);
  assert.equal(taken('map:store').length, 0, 'nothing changed: nothing more is sent');
});

test('walking a tile on moves the window; the ground beyond the old edge is mapped and stored', () => {
  walkTo(7);
  const updates = taken('hazard:update');
  const h = updates.at(-1);
  assert.deepEqual(h.originXZ, [-TILE_M, -2 * TILE_M], 'one tile on in x, centred on the border nearest to the wearer');
  assert.deepEqual([h.cols, h.rows], [COLS, COLS]);
  assert.equal(cellAt(h, 15, 0), 0, 'floor that was outside the first window');
  assert.equal(cellAt(h, 15, -3.05), 1);
  assert.equal(cellAt(h, 0, 0), 0, 'and what was there before, at the same room position');
  assert.equal(cellAt(h, -8, 0), undefined, 'the tiles behind are no longer in the window');
  assert.deepEqual([h.stats.archived, h.stats.windowXZ], [2, h.originXZ], 'they are kept: two tiles of corridor');
  // Only the new ground is news to the hub: the tiles that left were stored as they are.
  assert.deepEqual(keysOf(taken('map:store')), ['2,-1', '2,0']);
});

test('walking back brings the archived tiles into the window again', () => {
  walkTo(-0.5);
  const h = taken('hazard:update').at(-1);
  assert.deepEqual(h.originXZ, [-2 * TILE_M, -2 * TILE_M]);
  assert.equal(cellAt(h, -8, 0), 0);
  assert.equal(cellAt(h, -8, -3.05), 1);
  assert.equal(h.stats.archived, 2, 'now the two tiles at the far end are the ones kept outside');
  assert.equal(taken('map:store').length, 0, 'the hub has all of it already');
  assert.equal(hub.get(firstRun).size, 10);
});

test('a stored map that lines up fills what this session has not seen, also outside the window', () => {
  // A new session in the same room coordinates. The hub hands back the first run, in which
  // (as if seen by live depth then) a crate stood in a side room this session has no model of.
  const crate = new Uint8Array(T * T).fill(255);
  for (let r = 10; r < 16; r++) crate.fill(1, r * T + 20, r * T + 26);
  const tiles = [...hub.get(firstRun).values(), { x: 0, z: 1, runs: encodeRuns(crate) }];
  head[0] = 0;
  hooks.start();
  assert.equal(taken('map:request').length, 1);
  on['map:stored']({ run: firstRun, cellSizeM: SCAN.cellM, tileCells: T, tiles, savedAt: 'earlier' });
  frames(3000);
  const h = taken('hazard:update').at(-1);
  assert.equal(cellAt(h, 2.05, TILE_M + 1.05), 1, 'the crate from the stored map');
  assert.equal(cellAt(h, 0, 0), 0);
  assert.equal(h.stats.stored, 36, 'cells taken from the stored map: the crate, nothing else was unknown to this scan');
  // This run's map on the hub holds the crate, and the stored tiles the window does not reach.
  const s = tilesOf(taken('map:store'));
  assert.notEqual(lastRun, firstRun, 'a new session is a new run: the first run stays on the hub as it was');
  assert.deepEqual([...s.keys()].sort(), ['-1,-1', '-1,0', '-2,-1', '-2,0', '0,-1', '0,0', '0,1', '1,-1', '1,0', '2,-1', '2,0']);
  assert.equal(decodeRuns(s.get('0,1').runs, T * T).filter((v) => v === 1).length, 36);
  assert.deepEqual(s.get('2,0').runs, hub.get(firstRun).get('2,0').runs, 'carried over as it was stored');
});

test('a stored map from other room coordinates is not used', () => {
  // The same map, as if the headset had started a tile (6.4 m) from where it started then.
  const shifted = [...hub.get(firstRun).values()].map((t) => ({ ...t, z: t.z + 1 }));
  hooks.start();
  taken('map:store');
  on['map:stored']({ run: 'elsewhere-0', cellSizeM: SCAN.cellM, tileCells: T, tiles: shifted });
  frames(3000);
  const h = taken('hazard:update').at(-1);
  assert.equal(h.stats.stored, 0);
  assert.equal(cellAt(h, 0, TILE_M - 3.05), 255, 'no wall where the stored map would put one');
  assert.deepEqual(keysOf(taken('map:store')), ['-1,-1', '-1,0', '-2,-1', '-2,0', '0,-1', '0,0', '1,-1', '1,0']);
});

test('when the link comes back, the hub says what it has of this run and the rest is sent again', () => {
  walkTo(7); // two tiles of this run are outside the window now
  assert.deepEqual(keysOf(taken('map:store')), ['2,-1', '2,0']);
  // The hub has only one tile of this run: everything else was sent while the link was down.
  on['map:stored']({ run: lastRun, cellSizeM: SCAN.cellM, tileCells: T, tiles: [hub.get(lastRun).get('0,0')] });
  frames(3000);
  assert.deepEqual(keysOf(taken('map:store')), ['-1,-1', '-1,0', '-2,-1', '-2,0', '0,-1', '1,-1', '1,0', '2,-1', '2,0'], 'all but the tile the hub has');
  frames(5000);
  assert.equal(taken('map:store').length, 0);
});

test('with ?remember=0 the stored map is neither asked for nor used; the map is still stored', () => {
  SCAN.remember = false;
  try {
    head[0] = 0;
    taken('map:request');
    taken('map:store');
    hooks.start();
    assert.equal(taken('map:request').length, 0);
    const crate = new Uint8Array(T * T).fill(255).fill(1, 0, 200);
    on['map:stored']({ run: firstRun, cellSizeM: SCAN.cellM, tileCells: T, tiles: [...hub.get(firstRun).values(), { x: 0, z: 1, runs: encodeRuns(crate) }] });
    frames(3000);
    const h = taken('hazard:update').at(-1);
    assert.equal(h.stats.stored, 0);
    assert.equal(cellAt(h, 0.05, TILE_M + 0.05), 255);
    assert.equal(keysOf(taken('map:store')).length, 8);
  } finally {
    SCAN.remember = true;
  }
});

test('map:stored that is not a map of these tiles is ignored', () => {
  for (const bad of [null, {}, { run: 'x', cellSizeM: 0.1, tileCells: 32, tiles: [] }, { run: 'x', cellSizeM: 0.2, tileCells: T, tiles: [] }, { run: 'x', cellSizeM: 0.1, tileCells: T, tiles: 'no' }, { run: 'x', cellSizeM: 0.1, tileCells: T, tiles: [{ x: 0, z: 0, runs: [1, 5] }] }]) {
    assert.doesNotThrow(() => on['map:stored'](bad));
  }
});
