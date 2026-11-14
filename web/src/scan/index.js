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
//   - This is the room as the headset last scanned it, not live depth. A chair moved after the
//     scan is not seen until the headset updates its room model.
//   - If the headset has no room scan, nothing arrives and every cell stays "not seen". The
//     wearer has to run Space Setup once (Settings > Environment setup).
//
// ctx and frame: see the comment in map/index.js.

import { startMockHazard } from '../mock/hazard.js';

export const SCAN = {
  sizeM: 16, // the grid covers sizeM x sizeM, centred where the session started
  cellM: 0.1,
  floorBandM: 0.15, // surfaces below this height are floor
  headM: 1.9, // surfaces above this height do not block walking
  sampleM: 0.07, // spacing of the points sampled on each triangle
  trianglesPerFrame: 1500, // budget, so a large room mesh does not stall a frame
  emitMs: 600,
};

let ctx;
let cells;
let cols;
let origin;
let dirty = false;
let lastEmit = 0;
const seen = new Map(); // XRMesh / XRPlane -> lastChangedTime already rasterised
const jobs = []; // triangles waiting to be rasterised: { m: Float32Array(16), v, idx, at }
let stats = { meshes: 0, planes: 0, obstacles: 0, floor: 0 };

function reset() {
  cols = Math.round(SCAN.sizeM / SCAN.cellM);
  cells = new Uint8Array(cols * cols).fill(255);
  origin = [-SCAN.sizeM / 2, -SCAN.sizeM / 2];
  seen.clear();
  jobs.length = 0;
  dirty = true;
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
  const n = Math.max(1, Math.ceil(Math.max(ab, ac) / SCAN.sampleM));
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n - i; j++) {
      const u = i / n;
      const v = j / n;
      markLocal(m, ax + (bx - ax) * u + (cx - ax) * v, ay + (by - ay) * u + (cy - ay) * v, az + (bz - az) * u + (cz - az) * v);
    }
  }
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
  window.__scan = { stats: () => ({ ...stats, queued: jobs.length }) };
}

export function update(frame) {
  const { xrFrame, refSpace, time } = frame;
  if (!xrFrame || !refSpace || ctx.mock.hazard) return;

  const meshes = xrFrame.detectedMeshes;
  const planes = xrFrame.detectedPlanes;
  if (meshes) {
    for (const mesh of meshes) {
      if (seen.get(mesh) === mesh.lastChangedTime) continue;
      const pose = xrFrame.getPose(mesh.meshSpace, refSpace);
      if (!pose) continue;
      seen.set(mesh, mesh.lastChangedTime);
      queueMesh(pose, mesh.vertices, mesh.indices);
    }
  }
  if (planes) {
    for (const plane of planes) {
      if (seen.get(plane) === plane.lastChangedTime) continue;
      const pose = xrFrame.getPose(plane.planeSpace, refSpace);
      if (!pose) continue;
      seen.set(plane, plane.lastChangedTime);
      queuePlane(pose, plane.polygon);
    }
  }
  work();

  if (dirty && !jobs.length && time - lastEmit >= SCAN.emitMs) {
    dirty = false;
    lastEmit = time;
    let obstacles = 0;
    let floor = 0;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === 1) obstacles++;
      else if (cells[i] === 0) floor++;
    }
    stats = { meshes: meshes?.size ?? 0, planes: planes?.size ?? 0, obstacles, floor };
    ctx.bus.emit('hazard:update', {
      originXZ: [...origin],
      cellSizeM: SCAN.cellM,
      cols,
      rows: cols,
      cells: cells.slice(),
      ts: Date.now(),
      source: 'room-scan',
      stats,
    });
  }
}
