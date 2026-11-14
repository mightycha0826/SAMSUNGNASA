// scan — field obstacle map from the headset's view of the room (role A).
//
// Sends: hazard:update (docs/INTERFACES.md section 3): a floor grid in room coordinates,
//        0 = passable, 1 = obstacle, 255 = not seen yet. At most twice a second, only on change.
//
// Two layers on the same cells, merged when the grid is sent (mergeLayers in grid.js).
//
// The room scan (room.js): the room geometry the Quest 3 already keeps (Space Setup), read
// through WebXR `mesh-detection` (the room mesh and furniture volumes) and `plane-detection`
// (walls, tables, the floor). Every surface between floorBandM and headM above the floor blocks
// the cell under it; surfaces near the floor mark the cell as passable. Its limits:
//   - It is the room as the headset last scanned it. A chair moved after the scan is not in it
//     until the headset updates its room model.
//   - If the headset has no room scan, nothing arrives from it and every cell stays "not seen".
//     The wearer has to run Space Setup once (Settings > Environment setup).
//   - Space Setup stores a wall as one rectangle, so an open doorway is closed in the grid.
//
// Live depth (the layer is in grid.js, depth.js reads the image; only in a session that has
// `depth-sensing`, which core/xr.js decides whether to ask for): twice a second the depth image
// of the left eye is laid over the same cells. It adds what stands within depthRangeM of the
// wearer now and takes it away again once only floor is seen there, so a chair put down after
// the scan appears, and clears within a few seconds of being taken away, or once it has been out
// of sight for forgetScans reads. It never clears structure that came from the room scan. Not
// yet checked on the headset.
//
// The obstacles are also outlined in red on the real floor in field mode (overlay.js).
//
// ctx and frame: see the comment in map/index.js.

import { mode } from '../core/mode.js';
import { startMockHazard } from '../mock/hazard.js';
import { createRoom } from './room.js';
import { createGrid, mergeLayers } from './grid.js';
import { readDepth } from './depth.js';
import { initOverlay } from './overlay.js';

export const SCAN = {
  sizeM: 16, // the grid covers sizeM x sizeM, centred where the session started
  cellM: 0.1,
  floorBandM: 0.15, // surfaces below this height are floor
  headM: 1.9, // surfaces above this height do not block walking
  sampleM: 0.07, // spacing of the points sampled on each triangle
  trianglesPerFrame: 1500, // budget, so a large room mesh does not stall a frame
  rescanMs: 10000, // a mesh or plane that says it changed is not rasterised again sooner than this
  emitMs: 600,

  // Live depth. Starting values: tune them on the headset.
  depthMs: 500, // read the depth image this often
  depthSamples: 192, // samples per side taken from it (the image is about 320 x 320); fewer and far floor cells get too few
  depthRangeM: 2.5, // cells farther than this from the headset, along the floor, are left alone (floor there is 3 m from the eye)
  bodyM: 0.8, // cells this close to the headset, along the floor, are the wearer's own hands and body
  floorNoiseM: 0.15, // a depth point within this height of y = 0 counts as floor (the real floor can sit a few cm off)
  thingMinM: 0.25, // a depth point counts as a thing from this height: a 4 % depth error lifts a floor point 7 cm
  minPoints: 3, // samples needed in a cell before a read says anything about it
  setScans: 2, // reads in a row that must see an obstacle before it counts (2 = 1 s): not someone walking past
  clearScans: 3, // floor-only reads before a live obstacle is cleared (3 = 1.5 s)
  forgetScans: 40, // reads out of sight before a live obstacle is forgotten (40 = 20 s): it may have walked away

  // Outline on the floor, [r, g, b, a] 0-255.
  edgeRGBA: [255, 48, 48, 230], // cells on the rim of an obstacle
  fillRGBA: [255, 48, 48, 70], // cells inside it
};

let ctx;
let cols;
let origin;
let room; // the room scan: what the headset stored at Space Setup
let live; // what live depth sees now, on the same cells
let dirty = false; // a layer changed since the grid was last sent
let lastEmit = 0;
let sent = null; // the cells of the last hazard:update
let stats = { meshes: 0, planes: 0, obstacles: 0, floor: 0, depth: 0 };
let depthOn = false; // this session has depth-sensing and reading it has not failed
let depthSeen = false; // the live layer holds what a recent read saw
let lastDepth = 0; // time of the last read that got an image
let waitFrom = 0; // time of the first read in a row that got none
let said = {}; // what has been reported once this session
let started = 0; // time of the session's first frame
let space = null; // the reference space whose 'reset' is being listened to

// Start over: at a new session, and after a recentre.
function reset() {
  cols = Math.round(SCAN.sizeM / SCAN.cellM);
  origin = [-SCAN.sizeM / 2, -SCAN.sizeM / 2];
  room = createRoom(cols, cols, origin, SCAN);
  dirty = true;
  live = createGrid(cols, cols, SCAN.cellM, origin, SCAN);
  depthOn = ctx.xr.has('depth-sensing') === true;
  depthSeen = false;
  waitFrom = started = 0;
  said = {};
  sent = null;
}

// Forget what live depth has marked.
function dropLive() {
  live = createGrid(cols, cols, SCAN.cellM, origin, SCAN);
  depthSeen = false;
  dirty = true;
}

export function init(context) {
  ctx = context;
  reset();
  // Mock mode: the fake obstacle grid stands in for the scan.
  if (ctx.mock.hazard) startMockHazard(ctx.bus, { speed: ctx.mock.speed });
  ctx.xr.onSessionStart(() => reset());
  // With depth-sensing three.js would draw a mesh that hides every virtual object behind real
  // surfaces (the reason core/xr.js does not ask for depth in every session), and would leave
  // clearing the frame to that mesh. The scan only wants the numbers: no mesh, and the usual clear.
  ctx.renderer.xr.getDepthSensingMesh = () => null;
  ctx.renderer.xr.hasDepthSensing = () => false;
  initOverlay(ctx, SCAN);
  window.__scan = { stats: () => ({ ...stats, queued: room.pending }) };
}

export function update(frame) {
  const { xrFrame, refSpace, time } = frame;
  if (!xrFrame || !refSpace || ctx.mock.hazard) return;

  followSpace(refSpace);
  room.collect(xrFrame, refSpace, time);
  if (room.work()) dirty = true;
  warnIfNoRoom(time);
  const read = readLive(frame);
  // Not in the frame that read depth: the read and the consumers of the event each take time.
  if (dirty && !read && !room.pending && time - lastEmit >= SCAN.emitMs) send(time);
}

// After a recentre every stored coordinate is in the old frame: start over. The space in use
// can be swapped during a session (?space=unbounded), so follow whichever one it is.
function followSpace(refSpace) {
  if (space === refSpace) return;
  space = refSpace;
  space.addEventListener('reset', reset);
}

// Without a room scan the grid stays empty and a route runs straight through the furniture.
// Nothing else tells the wearer, so say it once, a few seconds in.
function warnIfNoRoom(time) {
  started ||= time;
  if (said.noRoom || !(time - started > 3000)) return;
  said.noRoom = true;
  if (room.counts.meshes || room.counts.planes) return;
  console.error('[scan] no room scan: run Space Setup in this room. Features:', ctx.xr.enabledFeatures);
  if (mode.current === 'field') ctx.bus.emit('voice:say', { text: 'No room scan. Run Space Setup first.', priority: 'normal' });
}

// Lay the depth image over the live layer when one is due. True when this frame read one.
function readLive(frame) {
  const { time } = frame;
  if (!(depthOn && time - lastDepth >= SCAN.depthMs)) return false;
  let read = false;
  try {
    // Nothing read for a while (headset off, menu up, no images): what was marked may be gone.
    if (depthSeen && time - lastDepth > 5000) dropLive();
    read = readDepth(ctx.renderer, frame, live, SCAN);
    if (read) {
      lastDepth = time;
      waitFrom = 0;
      depthSeen = true;
      if (live.commit()) dirty = true;
    } else if (!waitFrom) {
      waitFrom = time; // no image on this frame (the sensor is slower than the display): try the next
    } else if (time - waitFrom > 5000) {
      lastDepth = time; // none for 5 s: keep trying, but every depthMs and not every frame
      if (!said.noDepth) console.error('[scan] depth-sensing is on but no depth image arrives');
      said.noDepth = true;
    }
  } catch (err) {
    depthOn = depthSeen = false; // the room scan carries on without it, and without what it had marked
    dropLive();
    console.error('[scan] live depth switched off:', err);
  }
  return read;
}

function send(time) {
  dirty = false;
  const { cells, ...counts } = mergeLayers(room.cells, live.cells);
  // A live cell can change without changing what is sent (floor seen where the room scan
  // already has floor, flicker on a cell the room scan blocks): nothing to say then.
  if (sent && cells.every((cell, i) => cell === sent[i])) return;
  sent = cells;
  lastEmit = time;
  stats = { ...room.counts, ...counts };
  ctx.bus.emit('hazard:update', {
    originXZ: [...origin],
    cellSizeM: SCAN.cellM,
    cols,
    rows: cols,
    cells,
    ts: Date.now(),
    source: depthSeen ? 'room-scan+depth' : 'room-scan',
    stats,
  });
}
