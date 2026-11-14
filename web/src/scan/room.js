// Room layer of the floor grid: the room as the headset last scanned it (Space Setup), read
// through WebXR `mesh-detection` (the room mesh and furniture volumes) and `plane-detection`
// (walls, tables, the floor) and rasterised into cells. No three.js: node --test src/scan/room.test.js
//
// This layer only ever adds: every surface between floorBandM and headM above the floor blocks
// the cell under it for good, and a surface near the floor makes the cell passable until
// something is found standing on it. Taking things away again is the live layer's job (grid.js).

import { PASSABLE, OBSTACLE, UNKNOWN } from './grid.js';

/** cfg: cellM, floorBandM, headM, sampleM, trianglesPerFrame, rescanMs (SCAN in index.js). */
export function createRoom(cols, rows, originXZ, cfg) {
  const cells = new Uint8Array(cols * rows).fill(UNKNOWN);
  const seen = new Map(); // XRMesh / XRPlane -> { changed: its lastChangedTime when last looked at, at: when that was, print: its fingerprint }
  const jobs = []; // triangles waiting to be rasterised: { m: Float32Array(16), v, idx, at }
  const counts = { meshes: 0, planes: 0 };
  let marked = false; // a cell was set during this work()

  function mark(x, y, z) {
    const c = Math.floor((x - originXZ[0]) / cfg.cellM);
    const r = Math.floor((z - originXZ[1]) / cfg.cellM);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return;
    const i = r * cols + c;
    if (y > cfg.floorBandM && y < cfg.headM) {
      if (cells[i] !== OBSTACLE) {
        cells[i] = OBSTACLE;
        marked = true;
      }
    } else if (y <= cfg.floorBandM && cells[i] === UNKNOWN) {
      cells[i] = PASSABLE; // floor seen and nothing on it (so far)
      marked = true;
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
    const n = Math.min(400, Math.max(1, Math.ceil(Math.max(ab, ac) / cfg.sampleM)));
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
    return !last || (last.changed !== thing.lastChangedTime && time - last.at >= cfg.rescanMs);
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

  return {
    cells,

    /** How many meshes and planes the headset reported in the last frame given to collect(). */
    get counts() {
      return counts;
    },

    /** Triangle jobs still waiting: the cells are incomplete while this is not 0. */
    get pending() {
      return jobs.length;
    },

    /** Queue the meshes and planes of this frame that are due and are not what they were. Call every frame. */
    collect(xrFrame, refSpace, time) {
      const meshes = xrFrame.detectedMeshes;
      const planes = xrFrame.detectedPlanes;
      counts.meshes = meshes?.size ?? 0;
      counts.planes = planes?.size ?? 0;
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
    },

    /** Rasterise queued triangles, at most trianglesPerFrame of them. True when the cells may have changed. */
    work() {
      marked = false;
      let budget = cfg.trianglesPerFrame;
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
      return marked;
    },
  };
}
