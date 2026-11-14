// Live layer of the floor grid: what the depth sensor sees right now, on the same cells as the
// room scan in index.js. Pure arithmetic, no three.js and no WebXR: node --test src/scan/grid.test.js
//
// The room scan only ever adds structure. This layer can also take it away again: a cell turns
// into an obstacle once something has been seen standing in it setScans times, and back into
// floor once the sensor has seen nothing but floor there clearScans times.
//
// Matrices come as WebXR gives them: Float32Array(16), column-major.
//   P = projectionMatrix,  M = transform.matrix (eye -> room coordinates)

export const PASSABLE = 0;
export const OBSTACLE = 1;
export const UNKNOWN = 255;

/** cfg: floorBandM, headM, floorNoiseM, minPoints, setScans, clearScans, forgetScans (SCAN in index.js). */
export function createGrid(cols, rows, cellM, originXZ, cfg) {
  const n = cols * rows;
  const cells = new Uint8Array(n).fill(UNKNOWN);
  const sightings = new Uint8Array(n); // reads so far that saw an obstacle here, up to setScans
  const hold = new Uint8Array(n); // floor-only reads still needed before the obstacle is cleared
  const unseen = new Uint8Array(n); // reads since the cell last got a point, up to forgetScans
  const obstacle = new Uint16Array(n); // points that fell into the cell during this read
  const floor = new Uint16Array(n);

  return {
    cells,

    /** Add one point in room coordinates to the current read. */
    add(x, y, z) {
      const col = Math.floor((x - originXZ[0]) / cellM);
      const row = Math.floor((z - originXZ[1]) / cellM);
      if (!(col >= 0 && row >= 0 && col < cols && row < rows)) return; // also drops NaN
      const i = row * cols + col;
      if (y > cfg.floorBandM && y < cfg.headM) obstacle[i]++;
      // Between floorNoiseM and floorBandM a noisy depth point could be either: it counts as neither.
      else if (Math.abs(y) <= cfg.floorNoiseM) floor[i]++;
    },

    /**
     * Fold the current read into the cells. True when a cell changed.
     * A cell where the read is unclear (too few points, or floor with a little of something
     * else) keeps its state. So does a cell that was not seen, until it has been out of sight
     * for forgetScans reads: an obstacle is then forgotten, because what stood there (a person,
     * a chair that was carried off) may be gone and nothing would ever clear it.
     */
    commit() {
      let changed = false;
      for (let i = 0; i < n; i++) {
        let next = cells[i];
        if (obstacle[i] >= cfg.minPoints) {
          // Seen setScans times before it counts: someone walking past and stray depth do not.
          if (sightings[i] < cfg.setScans) sightings[i]++;
          if (sightings[i] === cfg.setScans) {
            hold[i] = cfg.clearScans;
            next = OBSTACLE;
          }
        } else if (floor[i] >= cfg.minPoints && obstacle[i] === 0) {
          sightings[i] = 0;
          if (hold[i]) hold[i]--;
          next = hold[i] ? OBSTACLE : PASSABLE;
        }
        if (obstacle[i] || floor[i]) unseen[i] = 0;
        else if (unseen[i] < cfg.forgetScans && ++unseen[i] === cfg.forgetScans) {
          sightings[i] = hold[i] = 0;
          if (next === OBSTACLE) next = UNKNOWN;
        }
        if (next !== cells[i]) {
          cells[i] = next;
          changed = true;
        }
        obstacle[i] = floor[i] = 0;
      }
      return changed;
    },
  };
}

/**
 * The cells to send: the room scan with the live layer on top. Live depth adds obstacles and
 * fills in floor the room scan knows nothing about; it never removes structure the room scan
 * put there (depth looks straight through glass, and misses thin things).
 * @returns cells, and counts: obstacles, floor, depth (cells live depth blocks right now)
 */
export function mergeLayers(room, live) {
  const cells = room.slice();
  let obstacles = 0;
  let floor = 0;
  let depth = 0;
  for (let i = 0; i < cells.length; i++) {
    if (live[i] === OBSTACLE) {
      cells[i] = OBSTACLE;
      depth++;
    } else if (live[i] === PASSABLE && cells[i] === UNKNOWN) cells[i] = PASSABLE;
    if (cells[i] === OBSTACLE) obstacles++;
    else if (cells[i] === PASSABLE) floor++;
  }
  return { cells, obstacles, floor, depth };
}

/**
 * Add one eye's depth image to the grid.
 * @param depthAt (u, v) -> distance from the camera plane in metres; u, v in 0..1 with (0, 0) at
 *                the bottom left of the image; 0 when unknown
 * @param cfg depthSamples, depthRangeM, bodyM, cellM, floorBandM
 */
export function addDepthView(grid, depthAt, P, M, cfg) {
  const s = cfg.depthSamples;
  const nearest = cfg.bodyM ** 2;
  const farthest = cfg.depthRangeM ** 2;
  const nearestThing = (cfg.bodyM + 2 * cfg.cellM) ** 2;
  const farthestThing = (cfg.depthRangeM - 2 * cfg.cellM) ** 2;
  for (let j = 0; j < s; j++) {
    for (let i = 0; i < s; i++) {
      const u = (i + 0.5) / s;
      const v = (j + 0.5) / s;
      const d = depthAt(u, v);
      if (!(d > 0)) continue;
      // Undo the projection: the eye-space point at screen position (-1..1) and depth d. Holds
      // for the off-centre frustum of a headset eye (P[8], P[9]).
      const x = (d * (2 * u - 1 + P[8])) / P[0];
      const y = (d * (2 * v - 1 + P[9])) / P[5];
      const wx = M[0] * x + M[4] * y - M[8] * d + M[12];
      const wz = M[2] * x + M[6] * y - M[10] * d + M[14];
      // Both limits are measured along the floor from the headset, so a cell is in or out for
      // the things standing in it and for the floor under them alike. Measured from the eye, a
      // chair would be marked farther out than the floor that later has to clear it.
      const along = (wx - M[12]) ** 2 + (wz - M[14]) ** 2;
      if (!(along >= nearest && along <= farthest)) continue; // the wearer's own body, or too far to trust
      const wy = M[1] * x + M[5] * y - M[9] * d + M[13];
      // Things count two cells inside those limits only. A cell the limit cuts through would be
      // marked from the strip that is in range, and that strip of floor is too thin to clear it.
      if (wy > cfg.floorBandM && !(along >= nearestThing && along <= farthestThing)) continue;
      grid.add(wx, wy, wz);
    }
  }
}

/**
 * Depth-buffer value (0..1) -> distance from the camera plane in metres, for a projection with
 * the planes near and far. A far plane that is infinite or not beyond near means there is none
 * (the Quest reports Infinity). 0 (no data) and 1 (nothing there) give 0.
 */
export function depthBufferToMeters(b, near, far) {
  if (!(b > 0 && b < 1)) return 0;
  return far > near && far !== Infinity ? (near * far) / (far - b * (far - near)) : near / (1 - b);
}
