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
// Live depth (when the session has `depth-sensing`: field mode, or ?depth=1): twice a second
// the depth image of the left eye is laid over the same cells (depth.js, grid.js). It adds what
// stands within depthRangeM of the wearer now, so a chair put down after the scan appears.
// What it has marked stays on the map when the wearer walks away or looks elsewhere: an
// obstacle is only taken off again once the sensor sees clear floor where it stood. It never
// clears structure that came from the room scan. Not yet checked on the headset.
//
// The map is kept on the Jetson (memory.js): every change goes to the hub as `map:store`
// (at most every storeMs) and the hub writes it to disk. When a session starts the hub hands
// back the map it stored last (`map:stored`); once the new scan lines up with it, it fills in
// what this session has not seen yet. ?remember=0 turns the handing back off.
//
// The obstacles also glow red on the real floor in field mode (overlay.js).
//
// ctx and frame: see the comment in map/index.js.

import { mode } from '../core/mode.js';
import { startMockHazard } from '../mock/hazard.js';
import { createRoom } from './room.js';
import { createGrid, mergeLayers, viewOf } from './grid.js';
import { readDepth } from './depth.js';
import { initOverlay } from './overlay.js';
import { encodeRuns, decodeRuns, linesUp, fillUnknown } from './memory.js';

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

  // The map on the Jetson.
  storeMs: 2000, // a changed map goes to the hub at most this often
  remember: new URLSearchParams(globalThis.location?.search ?? '').get('remember') !== '0', // take the stored map back

  // Highlight on the floor (overlay.js), [r, g, b] 0-255.
  glowRGB: [255, 48, 48], // the fill, the outline and the halo
  glintRGB: [255, 214, 208], // where the travelling light and the sparks are brightest
};

let ctx;
let cols;
let origin;
let room; // the room scan: what the headset stored at Space Setup (room.js)
let dirty = false; // a layer changed since the grid was last sent
let lastEmit = 0;
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
let stored = null; // the hub's last map, when it fits this grid: Uint8Array
let trusted = false; // the stored map lines up with this session's scan and is being used
let toStore = false; // the map changed since it last went to the hub
let lastStore = 0;

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
  // New coordinates (a session start or a recentre): a new run, and the stored map has to
  // prove itself again. Ask the hub for its latest; the answer comes as map:stored.
  run = `${page}-${runNo++}`;
  trusted = false;
  toStore = false;
  if (SCAN.remember) ctx.bus.emit('map:request', {});
}

/** The hub's stored map, if it is this grid: same cells, same size, same origin. */
function takeStored(m) {
  if (!SCAN.remember || !m || m.cols !== cols || m.rows !== cols || Math.abs(m.cellSizeM - SCAN.cellM) > 1e-6) return;
  if (Math.abs(m.originXZ?.[0] - origin[0]) > 1e-6 || Math.abs(m.originXZ?.[1] - origin[1]) > 1e-6) return;
  if (m.run === run) return; // what this run stored itself: nothing new in it
  const cellsBack = decodeRuns(m.runs, cols * cols);
  if (!cellsBack) return console.warn('[scan] the stored map from the hub is not a grid');
  stored = cellsBack;
  trusted = false;
  dirty = true;
  console.info('[scan] stored map from the hub:', m.run, m.savedAt ?? '');
}

/** Send the map to the hub (link.js forwards map:store). */
function store(time) {
  toStore = false;
  lastStore = time;
  ctx.bus.emit('map:store', {
    run,
    originXZ: [...origin],
    cellSizeM: SCAN.cellM,
    cols,
    rows: cols,
    runs: encodeRuns(sent),
    source: depthSeen ? 'room-scan+depth' : 'room-scan',
    stats,
  });
}

export function init(context) {
  ctx = context;
  reset();
  // Mock mode: the fake obstacle grid stands in for the scan.
  if (ctx.mock.hazard) startMockHazard(ctx.bus, { speed: ctx.mock.speed });
  ctx.xr.onSessionStart(() => reset());
  ctx.xr.onSessionEnd(() => { if (toStore && sent) store(0); }); // the last changes, before the wearer takes the headset off
  ctx.bus.on('map:stored', takeStored);
  // With depth-sensing three.js would draw a mesh that hides every virtual object behind real
  // surfaces, and would leave clearing the frame to that mesh. The scan only wants the numbers:
  // no mesh, and the usual clear.
  ctx.renderer.xr.getDepthSensingMesh = () => null;
  ctx.renderer.xr.hasDepthSensing = () => false;
  initOverlay(ctx, SCAN);
  window.__scan = { stats: () => ({ ...stats, queued: room.pending, run, stored: !!stored, trusted, reads, skips, settled: live?.settledCount ?? 0 }) };
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
  if (dirty && !read && !room.pending && time - lastEmit >= SCAN.emitMs) {
    if (!send(time)) return; // nothing new to say: the frame ends here, and a store that is due waits for the next one
  }
  if (toStore && sent && time - lastStore >= SCAN.storeMs) store(time);
}

// After a recentre every stored coordinate is in the old frame: start over. The space in use
// can be swapped during a session (?space=unbounded), so follow whichever one it is.
function followSpace(refSpace) {
  if (space !== refSpace) {
    space = refSpace;
    space.addEventListener('reset', reset);
  }
}

// Without a room scan the grid stays empty and a route runs straight through the furniture.
// Nothing else tells the wearer, so say it once, a few seconds in.
function warnIfNoRoom(time) {
  started ||= time;
  if (!said.noRoom && time - started > 3000) {
    said.noRoom = true;
    if (!room.counts.meshes && !room.counts.planes) {
      console.error('[scan] no room scan: run Space Setup in this room. Features:', ctx.xr.enabledFeatures);
      if (mode.current === 'field') ctx.bus.emit('voice:say', { text: 'No room scan. Run Space Setup first.', priority: 'normal' });
    }
  }
}

// Lay the depth image over the live layer when a read is due. True when this frame read one.
function readLive(frame) {
  const { xrFrame, refSpace, time } = frame;
  if (!(depthOn && time - lastDepth >= SCAN.depthMs)) return false;
  let read = false;
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
  return read;
}

// Merge the layers and send the grid when it differs from the last one sent. True when it was sent.
function send(time) {
  dirty = false;
  const { cells: merged, ...counts } = mergeLayers(room.cells, live.cells);
  // The map the hub kept from before: used once this session's scan has found enough of the
  // same obstacles in the same places, and only where this session has seen nothing yet.
  let kept = 0;
  if (stored) {
    if (!trusted && linesUp(stored, merged, cols, cols)) {
      trusted = true;
      console.info('[scan] the stored map lines up with this room: using it for what is not seen yet');
    }
    if (trusted) {
      kept = fillUnknown(merged, stored);
      counts.obstacles = counts.floor = 0;
      for (const cell of merged) {
        if (cell === 1) counts.obstacles++;
        else if (cell === 0) counts.floor++;
      }
    }
  }
  // A live cell can change without changing what is sent (floor seen where the room scan
  // already has floor, flicker on a cell the room scan blocks): nothing to say then.
  if (sent && merged.every((cell, i) => cell === sent[i])) return false;
  sent = merged;
  lastEmit = time;
  toStore = true;
  stats = { ...room.counts, ...counts, stored: kept, settled: live.settledCount, reads, skips };
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
  return true;
}
