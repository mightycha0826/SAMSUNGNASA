// scan — field obstacle map from the headset's view of the room (role A).
//
// Sends: hazard:update (docs/INTERFACES.md section 3): a floor grid in room coordinates,
//        0 = passable, 1 = obstacle, 255 = not seen yet. At most twice a second, only on change.
//
// Where the data comes from: the room geometry the Quest 3 already keeps (Space Setup), read
// through WebXR `mesh-detection` (the room mesh and furniture volumes) and `plane-detection`
// (walls, tables, the floor). Every surface between FLOOR_BAND_M and HEAD_M above the floor
// blocks the cell under it; surfaces near the floor mark the cell as passable.
//
// Limits, stated plainly:
//   - The room scan is the room as the headset last scanned it. A chair moved after the scan is
//     not in it until the headset updates its room model.
//   - If the headset has no room scan, nothing arrives from it and every cell stays "not seen".
//     The wearer has to run Space Setup once (Settings > Environment setup).
//
// Live depth (when the session has `depth-sensing`: field mode, or ?depth=1): twice a second
// the depth image of the left eye is laid over the same cells (depth.js, grid.js). It adds what
// stands within depthRangeM of the wearer now, so a chair put down after the scan appears.
// What it has marked stays on the map when the wearer walks away or looks elsewhere: an
// obstacle is only taken off again once the sensor sees clear floor where it stood. It never
// clears structure that came from the room scan. Not yet checked on the headset.
//
// The map has no edge (tiles.js). The floor is cut into tiles of 6.4 m, and the grid that is
// worked on and sent is a window of 4 x 4 tiles (25.6 m) around the wearer. When the wearer has
// walked about a tile from its centre, the window is moved by whole tiles; the tiles that fall
// out of it are kept (the archive) and come back when the wearer returns. `hazard:update` is
// always the window, so its originXZ changes when the window moves. Not yet checked on the headset.
//
// Where the wearer has walked is clear floor: the cells under them are freed at once and the
// room scan cannot block them again (standAt).
//
// The map is kept on the Jetson (memory.js): the tiles that changed go to the hub as
// `map:store` (at most every storeMs) and the hub writes them to disk. When a session starts
// the hub hands back the map it stored last (`map:stored`); once the new scan lines up with
// it, it fills in what this session has not seen yet. ?remember=0 turns the handing back off.
//
// Known gap: Space Setup stores a wall as one rectangle, so an open doorway is closed in the grid.
//
// The obstacles also glow red on the real floor in field mode (overlay.js).
//
// ctx and frame: see the comment in map/index.js.

import { mode } from '../core/mode.js';
import { startMockHazard } from '../mock/hazard.js';
import { createGrid, mergeLayers, viewOf } from './grid.js';
import { readDepth } from './depth.js';
import { initOverlay } from './overlay.js';
import { encodeRuns, decodeTiles, linesUp, fillUnknown } from './memory.js';
import { TILES, tileKey, parseKey, inTiles, follow, cutTile, assemble, moveWindow } from './tiles.js';

export const SCAN = {
  cellM: 0.1, // the window is TILES.window x TILES.cells of these per side (tiles.js): 25.6 m
  followMs: 250, // how often the window is checked against where the wearer stands
  floorBandM: 0.15, // surfaces below this height are floor
  headM: 1.9, // surfaces above this height do not block walking
  sampleM: 0.07, // spacing of the points sampled on each triangle
  trianglesPerFrame: 1500, // budget, so a large room mesh does not stall a frame
  rescanMs: 10000, // a mesh or plane that says it changed is not rasterised again sooner than this
  emitMs: 600,

  // Live depth. Starting values: tune them on the headset.
  depthMs: 350, // read the depth image this often, while there is something new to see (see settleScans)
  depthSamples: 192, // samples per side taken from it (the image is about 320 x 320); fewer and far floor cells get too few
  depthRangeM: 2.5, // cells farther than this from the headset, along the floor, are left alone (floor there is 3 m from the eye)
  bodyM: 0.8, // cells this close to the headset, along the floor, are the wearer's own hands and body
  floorNoiseM: 0.15, // a depth point within this height of y = 0 counts as floor (the real floor can sit a few cm off)
  thingMinM: 0.25, // a depth point counts as a thing from this height: a 4 % depth error lifts a floor point 7 cm
  minPoints: 3, // samples needed in a cell before a read says anything about it
  setScans: 2, // reads in a row that must see an obstacle before it counts (2 = 1 s): not someone walking past
  clearScans: 3, // floor-only reads before a live obstacle is cleared (3 = 1.5 s)
  // Settling (grid.js): what has been read often enough is left alone, so the reads go to what is new.
  settleScans: new URLSearchParams(globalThis.location?.search ?? '').get('settle') === '0' ? 0 : 6, // same answer this many reads in a row (6 = 2 s): settled. ?settle=0 turns settling off
  giveUpScans: 12, // in view this many reads without an answer (behind something): settled too
  leaveM: 4, // a settled cell is read again when the wearer returns after being this far from it
  vantageM: 1, // a cell that gave no answer is read again when the wearer has moved about this far (or turned, or tilted the head)
  viewHalfDeg: 40, // half the width of what the depth image sees, for deciding what was in view
  forgetScans: 0, // reads out of sight before a live obstacle is forgotten; 0 = never: the map keeps what it has seen

  walkedM: 0.25, // where the wearer stands, the floor within this radius is clear (about half a body width)

  // The map on the Jetson.
  storeMs: 2000, // a changed map goes to the hub at most this often
  remember: new URLSearchParams(globalThis.location?.search ?? '').get('remember') !== '0', // take the stored map back

  // Highlight on the floor (overlay.js), [r, g, b] 0-255.
  glowRGB: [255, 48, 48], // the fill
  glintRGB: [255, 214, 208], // where the travelling light and the sparks are brightest
};

let ctx;
let cells; // the room scan, on the window
let walked; // 0 where the wearer has stood, 255 elsewhere: the room scan may not block those cells again
let cols; // cells per side of the window
let origin; // room coordinates of the window's cell [0, 0]
let originTile; // the same in tiles: the window's first tile
const archive = new Map(); // tiles outside the window: tileKey -> { room, live }, each Uint8Array(tile)
let lastFollow = 0; // time the window was last checked against the head
let dirty = false;
let lastEmit = 0;
const seen = new Map(); // XRMesh / XRPlane -> { changed: its lastChangedTime when rasterised, at: when that was }
const jobs = []; // triangles waiting to be rasterised: { m: Float32Array(16), v, idx, at }
let stats = { meshes: 0, planes: 0, obstacles: 0, floor: 0, depth: 0 };
let reads = 0; // depth reads made
let skips = 0; // depth reads not made because everything in view was settled
let live; // what live depth sees, on the same cells
let depthOn = false; // this session has depth-sensing and reading it has not failed
let depthSeen = false; // the live layer holds what a recent read saw
let lastDepth = 0; // time of the last read that got an image
let waitFrom = 0; // time of the first read in a row that got none
let said = {}; // what has been reported once this session
let sent = null; // the cells of the last hazard:update
let started = 0; // time of the session's first frame
let space = null; // the reference space whose 'reset' is being listened to
// The map on the Jetson. A run is one stretch in one set of room coordinates: a page load, and
// a new one after every recentre, so a map in old coordinates is not overwritten by the next.
const page = Date.now().toString(36);
let runNo = 0;
let run = `${page}-0`;
let stored = null; // the hub's last map from another run, when it has these tiles: tileKey -> Uint8Array(tile)
let storedWin = null; // the part of it under the window, as one grid; null when none of it is
let trusted = false; // the stored map lines up with this session's scan and is being used
let toStore = false; // the map changed since it last went to the hub
let lastStore = 0;
// Only tiles that changed are sent, so this side keeps count of what the hub has of this run.
const hubHas = new Map(); // tileKey -> the tile's runs as text, as last sent (or as the hub said it has)
const outbox = new Map(); // tileKey -> runs: tiles the hub does not have like this yet; they go with the next map:store
let restDue = false; // every tile outside the window has to be compared with what the hub has

const tileM = () => SCAN.cellM * TILES.cells;
const originOf = (tile) => [tile[0] * tileM(), tile[1] * tileM()];
const storedUnder = (tile) => stored && assemble((key) => stored.get(key), tile);

function reset() {
  cols = TILES.cells * TILES.window;
  cells = new Uint8Array(cols * cols).fill(255);
  walked = new Uint8Array(cols * cols).fill(255);
  // Around the room origin, where a session starts. If the wearer is somewhere else (a space
  // that kept its origin from before), the first look at the head moves the window there.
  originTile = [follow(null, 0), follow(null, 0)];
  origin = originOf(originTile);
  archive.clear();
  lastFollow = 0;
  seen.clear();
  jobs.length = 0;
  dirty = true;
  live = createGrid(cols, cols, SCAN.cellM, origin, SCAN);
  depthOn = ctx.xr.has('depth-sensing') === true;
  depthSeen = false;
  waitFrom = started = 0;
  said = {};
  sent = null;
  // New coordinates (a session start or a recentre): a new run, and the stored map has to
  // prove itself again. Ask the hub for its latest; the answer comes as map:stored.
  run = `${page}-${runNo++}`;
  trusted = false;
  toStore = false;
  hubHas.clear();
  outbox.clear();
  restDue = false;
  storedWin = storedUnder(originTile);
  if (SCAN.remember) ctx.bus.emit('map:request', {});
}

/**
 * Move the window when the wearer has walked out of its two middle tiles (tiles.js: follow).
 * Both layers move; the tiles that leave go to the archive and to the hub.
 */
function followHead(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return;
  const next = [follow(originTile[0], inTiles(x, SCAN.cellM)), follow(originTile[1], inTiles(z, SCAN.cellM))];
  if (next[0] === originTile[0] && next[1] === originTile[1]) return;
  const nextOrigin = originOf(next);
  const { left } = moveWindow({ room: cells, live: live.cells, walked }, originTile, next, archive, {
    live: {
      shift: (dCols, dRows) => live.shift(dCols, dRows, nextOrigin),
      paste: (col, row, tile) => live.restore(col, row, TILES.cells, tile),
    },
  });
  originTile = next;
  origin = nextOrigin;
  storedWin = storedUnder(originTile);
  for (const key of left) offer(key, restTile(key));
  if (outbox.size) toStore = true;
  // mark() drops what falls outside the window, so the room scan of the ground that just came
  // in was never rasterised (or only as far as the archive has it). Forgetting what has been
  // rasterised queues every mesh and plane again. shortcut: that is the whole room model on
  // every move, trianglesPerFrame a frame, and no hazard:update goes out until the queue is
  // empty. If that shows as a pause when walking, queue only what reaches into the new tiles.
  seen.clear();
  sent = null; // the next hazard:update is a window somewhere else: nothing to compare it with
  dirty = true;
  console.info('[scan] window moved to', origin, 'tiles kept outside it:', archive.size);
}

/** The hub's answer to map:request: the newest map it has stored (link.js forwards map.stored). */
function takeStored(m) {
  if (!m || m.tileCells !== TILES.cells || Math.abs(m.cellSizeM - SCAN.cellM) > 1e-6 || !Array.isArray(m.tiles)) return;
  if (m.run === run) {
    // This run's own map: the answer to the request the link makes when it comes back. It says
    // what really arrived, so tiles sent while the link was down are sent again.
    hubHas.clear();
    for (const t of m.tiles) if (Array.isArray(t?.runs)) hubHas.set(tileKey(t.x, t.z), t.runs.join());
    restDue = toStore = true;
    return;
  }
  if (hubHas.size) {
    // The hub's newest map is not this run, though tiles of it were sent: send them all again.
    // (When the hub has no map at all it does not answer, and tiles lost before the first
    // connection are then sent only when they next change.)
    hubHas.clear();
    restDue = toStore = true;
  }
  if (!SCAN.remember) return;
  const tiles = decodeTiles(m.tiles, TILES.cells);
  if (!tiles.size) return console.warn('[scan] the stored map from the hub has no tiles');
  stored = tiles;
  storedWin = storedUnder(originTile);
  trusted = false;
  dirty = true;
  console.info('[scan] stored map from the hub:', m.run, m.savedAt ?? '', tiles.size, 'tiles');
}

/**
 * What the hub should have of a tile outside the window: this run's layers from the archive,
 * and under them the stored map once it is trusted. Null when nothing is known there.
 */
function restTile(key) {
  const entry = archive.get(key);
  const under = trusted ? stored?.get(key) : null;
  if (!entry) return under ?? null;
  const { cells: tile } = mergeLayers(entry.room, entry.live);
  if (under) fillUnknown(tile, under);
  return tile;
}

/** Put a tile in the outbox if the hub does not have it like this. */
function offer(key, tile) {
  const runs = tile ? encodeRuns(tile) : [255, TILES.cells * TILES.cells];
  // A tile the hub has never heard of is, to the hub, a tile nothing is known about.
  if (runs.join() === (hubHas.get(key) ?? `255,${TILES.cells * TILES.cells}`)) outbox.delete(key);
  else outbox.set(key, runs);
}

const inWindow = ([tx, tz]) => tx >= originTile[0] && tz >= originTile[1] && tx < originTile[0] + TILES.window && tz < originTile[1] + TILES.window;

/** Send the tiles that changed to the hub (link.js forwards map:store). */
function store(time) {
  toStore = false;
  lastStore = time;
  if (restDue) {
    restDue = false;
    for (const key of new Set([...archive.keys(), ...(trusted && stored ? stored.keys() : [])])) {
      if (!inWindow(parseKey(key))) offer(key, restTile(key));
    }
  }
  // The window as it was last sent to the app: it has the stored map under it where that is trusted.
  if (sent) {
    for (let j = 0; j < TILES.window; j++) {
      for (let i = 0; i < TILES.window; i++) offer(tileKey(originTile[0] + i, originTile[1] + j), cutTile(sent, cols, i, j));
    }
  }
  if (!outbox.size) return;
  const tiles = [];
  for (const [key, runs] of outbox) {
    const [x, z] = parseKey(key);
    tiles.push({ x, z, runs });
    hubHas.set(key, runs.join());
  }
  outbox.clear();
  ctx.bus.emit('map:store', {
    run,
    cellSizeM: SCAN.cellM,
    tileCells: TILES.cells,
    tiles,
    source: depthSeen ? 'room-scan+depth' : 'room-scan',
    stats,
  });
}

/**
 * Where the wearer stands there is no obstacle: the cells under them are clear floor at once,
 * in both layers, and the room scan may not block them again (a doorway that was shut when the
 * room was scanned stays open once someone has walked through it). Live depth still can: a
 * chair put there afterwards is found.
 */
function standAt(x, z) {
  const k = Math.ceil(SCAN.walkedM / SCAN.cellM);
  const c0 = Math.floor((x - origin[0]) / SCAN.cellM);
  const r0 = Math.floor((z - origin[1]) / SCAN.cellM);
  for (let r = r0 - k; r <= r0 + k; r++) {
    for (let c = c0 - k; c <= c0 + k; c++) {
      if (c < 0 || r < 0 || c >= cols || r >= cols) continue;
      const dx = origin[0] + (c + 0.5) * SCAN.cellM - x;
      const dz = origin[1] + (r + 0.5) * SCAN.cellM - z;
      if (dx * dx + dz * dz > SCAN.walkedM * SCAN.walkedM) continue;
      const i = r * cols + c;
      walked[i] = 0;
      if (cells[i] !== 0) {
        cells[i] = 0;
        dirty = true;
      }
    }
  }
  if (live.freeAround(x, z, SCAN.walkedM)) dirty = true;
}

function mark(x, y, z) {
  const c = Math.floor((x - origin[0]) / SCAN.cellM);
  const r = Math.floor((z - origin[1]) / SCAN.cellM);
  if (c < 0 || r < 0 || c >= cols || r >= cols) return;
  const i = r * cols + c;
  if (y > SCAN.floorBandM && y < SCAN.headM) {
    if (walked[i] === 0) return; // the wearer has stood here: whatever the room model says, it is not in the way
    if (cells[i] !== 1) {
      cells[i] = 1;
      dirty = true;
    }
  } else if (y <= SCAN.floorBandM && cells[i] === 255) {
    cells[i] = 0; // floor seen and nothing on it (so far)
    dirty = true;
  }
}

// Transform a local point by a column-major 4x4 matrix and mark it.
function markLocal(m, x, y, z) {
  mark(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
}

// Sample a triangle (local coordinates) densely enough that no cell under it is missed.
function rasterTriangle(m, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const ab = Math.hypot(bx - ax, by - ay, bz - az);
  const ac = Math.hypot(cx - ax, cy - ay, cz - az);
  // At most 550 steps (38 m, more than the window's diagonal): one vertex at infinity must not hang the frame.
  const n = Math.min(550,Math.max(1, Math.ceil(Math.max(ab, ac) / SCAN.sampleM)));
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n - i; j++) {
      const u = i / n;
      const v = j / n;
      markLocal(m, ax + (bx - ax) * u + (cx - ax) * v, ay + (by - ay) * u + (cy - ay) * v, az + (bz - az) * u + (cz - az) * v);
    }
  }
}

// A mesh or plane is rasterised when it is new or says it changed, but the same one not more
// often than rescanMs: the spec lets a browser move lastChangedTime every frame, and each time
// would queue the whole room again, so the queue would never empty and nothing would be sent.
function due(thing, time) {
  const last = seen.get(thing);
  return !last || (last.changed !== thing.lastChangedTime && time - last.at >= SCAN.rescanMs);
}

// The browser may say a mesh or plane changed when its shape is what it was (the Quest moves
// lastChangedTime for a room that stands still). A cheap fingerprint of the shape and of where
// it stands tells: the same one is not rasterised again.
function fingerprint(pose, values) {
  let sum = values.length;
  const step = Math.max(1, Math.floor(values.length / 64));
  for (let i = 0; i < values.length; i += step) sum = (sum * 31 + Math.round(values[i] * 1000)) | 0;
  for (const v of pose.transform.matrix) sum = (sum * 31 + Math.round(v * 1000)) | 0;
  return sum;
}

/** True when this mesh or plane has to be rasterised: new, or really different from last time. */
function changed(thing, pose, values, time) {
  const print = fingerprint(pose, values);
  const same = seen.get(thing)?.print === print;
  seen.set(thing, { changed: thing.lastChangedTime, at: time, print });
  return !same;
}

function queueMesh(pose, vertices, indices) {
  jobs.push({ m: Float32Array.from(pose.transform.matrix), v: vertices, idx: indices, at: 0 });
}

// An XRPlane is a polygon in its own x-z plane: fan-triangulate it.
function queuePlane(pose, polygon) {
  const n = polygon.length;
  if (n < 3) return;
  const v = new Float32Array(n * 3);
  polygon.forEach((p, i) => v.set([p.x, p.y, p.z], i * 3));
  const idx = [];
  for (let i = 1; i < n - 1; i++) idx.push(0, i, i + 1);
  jobs.push({ m: Float32Array.from(pose.transform.matrix), v, idx: Uint32Array.from(idx), at: 0 });
}

function work() {
  let budget = SCAN.trianglesPerFrame;
  while (budget > 0 && jobs.length) {
    const job = jobs[0];
    const { m, v, idx } = job;
    while (budget > 0 && job.at < idx.length) {
      const a = idx[job.at] * 3;
      const b = idx[job.at + 1] * 3;
      const c = idx[job.at + 2] * 3;
      rasterTriangle(m, v[a], v[a + 1], v[a + 2], v[b], v[b + 1], v[b + 2], v[c], v[c + 1], v[c + 2]);
      job.at += 3;
      budget--;
    }
    if (job.at >= idx.length) jobs.shift();
  }
}

export function init(context) {
  ctx = context;
  reset();
  // Mock mode: the fake obstacle grid stands in for the scan.
  if (ctx.mock.hazard) startMockHazard(ctx.bus, { speed: ctx.mock.speed });
  ctx.xr.onSessionStart(() => reset());
  ctx.xr.onSessionEnd(() => { if (toStore) store(0); }); // the last changes, before the wearer takes the headset off
  ctx.bus.on('map:stored', takeStored);
  // With depth-sensing three.js would draw a mesh that hides every virtual object behind real
  // surfaces (the reason depth is off by default, core/xr.js), and would leave clearing the
  // frame to that mesh. The scan only wants the numbers: no mesh, and the usual clear.
  ctx.renderer.xr.getDepthSensingMesh = () => null;
  ctx.renderer.xr.hasDepthSensing = () => false;
  initOverlay(ctx, SCAN);
  window.__scan = {
    stats: () => ({ ...stats, queued: jobs.length, run, stored: !!stored, trusted, reads, skips, settled: live?.settledCount ?? 0, archived: archive.size, windowXZ: [...origin] }),
  };
}

export function update(frame) {
  const { xrFrame, refSpace, time } = frame;
  if (!xrFrame || !refSpace || ctx.mock.hazard) return;

  // After a recentre every stored coordinate is in the old frame: start over. The space in use
  // can be swapped during a session (?space=unbounded), so follow whichever one it is.
  if (space !== refSpace) {
    space = refSpace;
    space.addEventListener('reset', reset);
  }

  // Keep the window around the wearer. Not every frame: a step is far less than the tile of
  // margin the window has on every side.
  const at = xrFrame.getViewerPose(refSpace)?.transform.position;
  if (at && time - lastFollow >= SCAN.followMs) {
    lastFollow = time;
    followHead(at.x, at.z);
  }
  // Every frame: at walking pace a quarter of a second is a longer step than the body is wide.
  if (at && Number.isFinite(at.x) && Number.isFinite(at.z)) standAt(at.x, at.z);

  const meshes = xrFrame.detectedMeshes;
  const planes = xrFrame.detectedPlanes;
  if (meshes) {
    for (const mesh of meshes) {
      if (!due(mesh, time)) continue;
      const pose = xrFrame.getPose(mesh.meshSpace, refSpace);
      if (!pose) continue;
      if (changed(mesh, pose, mesh.vertices, time)) queueMesh(pose, mesh.vertices, mesh.indices);
    }
  }
  if (planes) {
    for (const plane of planes) {
      if (!due(plane, time)) continue;
      const pose = xrFrame.getPose(plane.planeSpace, refSpace);
      if (!pose) continue;
      if (changed(plane, pose, plane.polygon.flatMap((p) => [p.x, p.y, p.z]), time)) queuePlane(pose, plane.polygon);
    }
  }
  work();

  // Without a room scan the grid stays empty and a route runs straight through the furniture.
  // Nothing else tells the wearer, so say it once, a few seconds in.
  started ||= time;
  if (!said.noRoom && time - started > 3000) {
    said.noRoom = true;
    if (!meshes?.size && !planes?.size) {
      console.error('[scan] no room scan: run Space Setup in this room. Features:', ctx.xr.enabledFeatures);
      if (mode.current === 'field') ctx.bus.emit('voice:say', { text: 'No room scan. Run Space Setup first.', priority: 'normal' });
    }
  }

  let read = false;
  if (depthOn && time - lastDepth >= SCAN.depthMs) {
    try {
      // Where the wearer is and faces, on the floor: decides what is in view (grid.js).
      const head = xrFrame.getViewerPose(refSpace)?.transform.matrix;
      let view = null;
      if (head) {
        view = viewOf(head, SCAN.vantageM);
        live.reopen(view);
        // Everything the image could show has been read often enough: no read, the frame is free.
        if (!live.unsettledInView(view)) {
          skips++;
          lastDepth = time;
          waitFrom = 0;
          view = null;
        }
      }
      read = !!view && readDepth(ctx.renderer, frame, live, SCAN);
      if (read) {
        reads++;
        lastDepth = time;
        waitFrom = 0;
        depthSeen = true;
        if (live.commit(view)) dirty = true;
      } else if (!view) {
        // nothing to read this time (all settled), or no head pose yet
      } else if (!waitFrom) {
        waitFrom = time; // no image on this frame (the sensor is slower than the display): try the next
      } else if (time - waitFrom > 5000) {
        lastDepth = time; // none for 5 s: keep trying, but every depthMs and not every frame
        if (!said.noDepth) console.error('[scan] depth-sensing is on but no depth image arrives');
        said.noDepth = true;
      }
    } catch (err) {
      depthOn = false; // the room scan carries on without it; what it had marked stays on the map
      console.error('[scan] live depth switched off:', err);
    }
  }

  // Not in the frame that read depth: the read and the consumers of the event each take time.
  if (dirty && !read && !jobs.length && time - lastEmit >= SCAN.emitMs) {
    dirty = false;
    const { cells: merged, ...counts } = mergeLayers(cells, live.cells);
    // The map the hub kept from before: used once this session's scan has found enough of the
    // same obstacles in the same places, and only where this session has seen nothing yet.
    // Both are judged on the window: the part of the stored map that lies under it (storedWin,
    // laid together again whenever the window moves, so ground that comes in later is filled too).
    let kept = 0;
    if (storedWin) {
      if (!trusted && linesUp(storedWin, merged, cols, cols)) {
        trusted = true;
        restDue = toStore = true; // its tiles outside the window belong to this run's map on the hub as well
        console.info('[scan] the stored map lines up with this room: using it for what is not seen yet');
      }
      if (trusted) {
        kept = fillUnknown(merged, storedWin);
        counts.obstacles = counts.floor = 0;
        for (const cell of merged) {
          if (cell === 1) counts.obstacles++;
          else if (cell === 0) counts.floor++;
        }
      }
    }
    // A live cell can change without changing what is sent (floor seen where the room scan
    // already has floor, flicker on a cell the room scan blocks): nothing to say then.
    if (sent && merged.every((cell, i) => cell === sent[i])) return;
    sent = merged;
    lastEmit = time;
    toStore = true;
    // archived, windowXZ: how many tiles are kept outside the window and where the window is, for diagnosis.
    stats = { meshes: meshes?.size ?? 0, planes: planes?.size ?? 0, ...counts, stored: kept, settled: live.settledCount, reads, skips, archived: archive.size, windowXZ: [...origin] };
    ctx.bus.emit('hazard:update', {
      originXZ: [...origin],
      cellSizeM: SCAN.cellM,
      cols,
      rows: cols,
      cells: merged,
      ts: Date.now(),
      source: depthSeen ? 'room-scan+depth' : 'room-scan',
      stats,
    });
  }

  if (toStore && time - lastStore >= SCAN.storeMs) store(time);
}
