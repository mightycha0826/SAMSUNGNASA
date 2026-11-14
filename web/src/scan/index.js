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
// Live depth (only with ?depth=1, which asks the session for `depth-sensing`): twice a second
// the depth image of the left eye is laid over the same cells (depth.js, grid.js). It adds what
// stands within depthRangeM of the wearer now and takes it away again once only floor is seen
// there, so a chair put down after the scan appears, and clears within a few seconds of being
// taken away, or once it has been out of sight for forgetScans reads. It never clears structure
// that came from the room scan. Not yet checked on the headset.
//
// Known gap: Space Setup stores a wall as one rectangle, so an open doorway is closed in the grid.
//
// The obstacles are also outlined in red on the real floor in field mode (overlay.js).
//
// ctx and frame: see the comment in map/index.js.

import { mode } from '../core/mode.js';
import { startMockHazard } from '../mock/hazard.js';
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
  floorNoiseM: 0.1, // a depth point within this height of y = 0 counts as floor (the real floor can sit a few cm off)
  minPoints: 3, // samples needed in a cell before a read says anything about it
  setScans: 2, // reads that must see an obstacle before it counts (2 = 1 s): not someone walking past
  clearScans: 3, // floor-only reads before a live obstacle is cleared (3 = 1.5 s)
  forgetScans: 40, // reads out of sight before a live obstacle is forgotten (40 = 20 s): it may have walked away

  // Outline on the floor, [r, g, b, a] 0-255.
  edgeRGBA: [255, 48, 48, 230], // cells on the rim of an obstacle
  fillRGBA: [255, 48, 48, 70], // cells inside it
};

let ctx;
let cells;
let cols;
let origin;
let dirty = false;
let lastEmit = 0;
const seen = new Map(); // XRMesh / XRPlane -> { changed: its lastChangedTime when rasterised, at: when that was }
const jobs = []; // triangles waiting to be rasterised: { m: Float32Array(16), v, idx, at }
let stats = { meshes: 0, planes: 0, obstacles: 0, floor: 0, depth: 0 };
let live; // what live depth sees, on the same cells
let depthOn = false; // this session has depth-sensing and reading it has not failed
let depthSeen = false; // the live layer holds what a recent read saw
let lastDepth = 0; // time of the last read that got an image
let waitFrom = 0; // time of the first read in a row that got none
let said = {}; // what has been reported once this session
let sent = null; // the cells of the last hazard:update
let started = 0; // time of the session's first frame
let space = null; // the reference space whose 'reset' is being listened to

function reset() {
  cols = Math.round(SCAN.sizeM / SCAN.cellM);
  cells = new Uint8Array(cols * cols).fill(255);
  origin = [-SCAN.sizeM / 2, -SCAN.sizeM / 2];
  seen.clear();
  jobs.length = 0;
  dirty = true;
  live = createGrid(cols, cols, SCAN.cellM, origin, SCAN);
  depthOn = ctx.xr.has('depth-sensing') === true;
  depthSeen = false;
  waitFrom = started = 0;
  said = {};
  sent = null;
}

function mark(x, y, z) {
  const c = Math.floor((x - origin[0]) / SCAN.cellM);
  const r = Math.floor((z - origin[1]) / SCAN.cellM);
  if (c < 0 || r < 0 || c >= cols || r >= cols) return;
  const i = r * cols + c;
  if (y > SCAN.floorBandM && y < SCAN.headM) {
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
  // At most 400 steps (28 m, more than the grid's diagonal): one vertex at infinity must not hang the frame.
  const n = Math.min(400, Math.max(1, Math.ceil(Math.max(ab, ac) / SCAN.sampleM)));
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
  // With depth-sensing three.js would draw a mesh that hides every virtual object behind real
  // surfaces (the reason depth is off by default, core/xr.js), and would leave clearing the
  // frame to that mesh. The scan only wants the numbers: no mesh, and the usual clear.
  ctx.renderer.xr.getDepthSensingMesh = () => null;
  ctx.renderer.xr.hasDepthSensing = () => false;
  initOverlay(ctx, SCAN);
  window.__scan = { stats: () => ({ ...stats, queued: jobs.length }) };
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

  const meshes = xrFrame.detectedMeshes;
  const planes = xrFrame.detectedPlanes;
  if (meshes) {
    for (const mesh of meshes) {
      if (!due(mesh, time)) continue;
      const pose = xrFrame.getPose(mesh.meshSpace, refSpace);
      if (!pose) continue;
      seen.set(mesh, { changed: mesh.lastChangedTime, at: time });
      queueMesh(pose, mesh.vertices, mesh.indices);
    }
  }
  if (planes) {
    for (const plane of planes) {
      if (!due(plane, time)) continue;
      const pose = xrFrame.getPose(plane.planeSpace, refSpace);
      if (!pose) continue;
      seen.set(plane, { changed: plane.lastChangedTime, at: time });
      queuePlane(pose, plane.polygon);
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
      // Nothing read for a while (headset off, menu up, no images): what was marked may be gone.
      if (depthSeen && time - lastDepth > 5000) {
        live = createGrid(cols, cols, SCAN.cellM, origin, SCAN);
        depthSeen = false;
        dirty = true;
      }
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
      live = createGrid(cols, cols, SCAN.cellM, origin, SCAN);
      dirty = true;
      console.error('[scan] live depth switched off:', err);
    }
  }

  // Not in the frame that read depth: the read and the consumers of the event each take time.
  if (dirty && !read && !jobs.length && time - lastEmit >= SCAN.emitMs) {
    dirty = false;
    const { cells: merged, ...counts } = mergeLayers(cells, live.cells);
    // A live cell can change without changing what is sent (floor seen where the room scan
    // already has floor, flicker on a cell the room scan blocks): nothing to say then.
    if (sent && merged.every((cell, i) => cell === sent[i])) return;
    sent = merged;
    lastEmit = time;
    stats = { meshes: meshes?.size ?? 0, planes: planes?.size ?? 0, ...counts };
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
}
