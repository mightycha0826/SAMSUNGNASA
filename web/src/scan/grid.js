// Live layer of the floor grid: what the depth sensor sees right now, on the same cells as the
// room scan (room.js). Pure arithmetic, no three.js and no WebXR: node --test src/scan/grid.test.js
//
// The room scan only ever adds structure. This layer can also take it away again: a cell turns
// into an obstacle once something has been seen standing in it in setScans reads in a row, and
// back into floor once the sensor has seen nothing but floor there clearScans times.
//
// Matrices come as WebXR gives them: Float32Array(16), column-major.
//   P = projectionMatrix,  M = transform.matrix (eye -> room coordinates)

import { shiftCells } from './tiles.js';

export const PASSABLE = 0;
export const OBSTACLE = 1;
export const UNKNOWN = 255;

/**
 * cfg: thingMinM, headM, floorNoiseM, minPoints, setScans, clearScans, forgetScans, and for
 * settling: settleScans, giveUpScans, leaveM, vantageM, depthRangeM, bodyM, viewHalfDeg (SCAN in index.js).
 *
 * Settling (cfg.settleScans > 0): a cell that has been read settleScans times in a row with the
 * same answer is settled and is not read any more: points that fall into it are dropped. So is
 * a cell that stayed in view giveUpScans times without ever giving an answer (behind something,
 * under the lower edge of the image). The sensor's time then goes to cells that are still open,
 * and unsettledInView says when there are none in view, so the caller can skip the read.
 * A settled cell is opened again when the wearer comes back after having been more than leaveM
 * away from it. A given-up one is also opened as soon as the wearer looks from somewhere else
 * or in another direction (view.sig changes): it may be in the picture now.
 *
 * The grid is a window on a floor without an edge (tiles.js): `shift` moves it by whole cells
 * with everything it knows about the cells that stay, and `restore` lays back cells that were
 * in it before.
 */
export function createGrid(cols, rows, cellM, originXZ, cfg) {
  const n = cols * rows;
  let origin = [originXZ[0], originXZ[1]]; // room coordinates of cell [0, 0]; moves with shift
  const cells = new Uint8Array(n).fill(UNKNOWN);
  const sightings = new Uint8Array(n); // reads so far that saw an obstacle here, up to setScans
  const hold = new Uint8Array(n); // floor-only reads still needed before the obstacle is cleared
  const unseen = new Uint8Array(n); // reads since the cell last got a point, up to forgetScans (when that is on)
  const obstacle = new Uint16Array(n); // points that fell into the cell during this read
  const floor = new Uint16Array(n);
  const settled = new Uint8Array(n); // 1: read often enough, left alone until the wearer comes back
  const same = new Uint8Array(n); // reads in a row that gave the answer the cell already has
  const idle = new Uint8Array(n); // reads in a row in which the cell was in view and gave no answer
  const away = new Uint8Array(n); // the wearer has been more than leaveM from this settled cell
  const gaveUp = new Int32Array(n); // for a cell settled without an answer: the view.sig it was given up from, else 0
  const settling = cfg.settleScans > 0;
  let settledCount = 0;
  const cosHalf = Math.cos(((cfg.viewHalfDeg ?? 40) * Math.PI) / 180);

  // Whether cell i is where the depth image can see it from `view` { x, z, dirX, dirZ }: within
  // range along the floor and within viewHalfDeg of where the wearer faces. (dirX, dirZ) is the
  // facing direction on the floor, unit length, or 0, 0 when looking straight down or up.
  function inView(i, view) {
    const dx = origin[0] + ((i % cols) + 0.5) * cellM - view.x;
    const dz = origin[1] + (Math.floor(i / cols) + 0.5) * cellM - view.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < cfg.bodyM ** 2 || d2 > cfg.depthRangeM ** 2) return false;
    if (!view.dirX && !view.dirZ) return true;
    return dx * view.dirX + dz * view.dirZ >= cosHalf * Math.sqrt(d2);
  }

  // Rows and columns that hold every cell within depthRangeM of the wearer.
  function reach(view) {
    const k = Math.ceil(cfg.depthRangeM / cellM) + 1;
    const c = Math.floor((view.x - origin[0]) / cellM);
    const r = Math.floor((view.z - origin[1]) / cellM);
    return [Math.max(0, c - k), Math.min(cols - 1, c + k), Math.max(0, r - k), Math.min(rows - 1, r + k)];
  }

  function settle(i, sig = 0) {
    settled[i] = 1;
    settledCount++;
    away[i] = 0;
    gaveUp[i] = sig;
  }

  return {
    cells,

    /** Add one point in room coordinates to the current read. */
    add(x, y, z) {
      const col = Math.floor((x - origin[0]) / cellM);
      const row = Math.floor((z - origin[1]) / cellM);
      if (!(col >= 0 && row >= 0 && col < cols && row < rows)) return; // also drops NaN
      const i = row * cols + col;
      if (settled[i]) return; // read often enough: nothing more to learn here for now
      if (y > cfg.thingMinM && y < cfg.headM) obstacle[i]++;
      // Between floorNoiseM and thingMinM a noisy depth point could be either: it counts as neither.
      else if (Math.abs(y) <= cfg.floorNoiseM) floor[i]++;
    },

    /**
     * Fold the current read into the cells. True when a cell changed.
     * A cell where the read is unclear (too few points, or floor with a little of something
     * else) keeps its state. So does a cell that was not seen: an obstacle stays on the map
     * until the sensor sees clear floor where it stood. Only with cfg.forgetScans > 0 is an
     * obstacle forgotten after that many reads out of sight.
     * @param view the wearer's view for this read (viewOf); needed for giving up on cells
     */
    commit(view = null) {
      let changed = false;
      for (let i = 0; i < n; i++) {
        if (settled[i]) continue;
        let next = cells[i];
        const answered = obstacle[i] >= cfg.minPoints || (floor[i] >= cfg.minPoints && obstacle[i] === 0);
        if (obstacle[i] >= cfg.minPoints) {
          // Seen in setScans reads in a row before it counts: someone walking past and stray depth do not.
          if (sightings[i] < cfg.setScans) sightings[i]++;
          if (sightings[i] === cfg.setScans) {
            hold[i] = cfg.clearScans;
            next = OBSTACLE;
          }
        } else if (floor[i] >= cfg.minPoints && obstacle[i] === 0) {
          sightings[i] = 0;
          if (hold[i]) hold[i]--;
          next = hold[i] ? OBSTACLE : PASSABLE;
        } else if (next !== OBSTACLE) {
          sightings[i] = 0; // not seen as a thing in this read: the count starts over
        }
        if (obstacle[i] || floor[i]) unseen[i] = 0;
        else if (cfg.forgetScans > 0 && unseen[i] < cfg.forgetScans && ++unseen[i] === cfg.forgetScans) {
          sightings[i] = hold[i] = 0;
          if (next === OBSTACLE) next = UNKNOWN;
        }
        if (settling) {
          // The read says what the cell already is: a thing seen where an obstacle stands,
          // bare floor seen where the floor is clear. (A first sighting of something on clear
          // floor is an answer too, but the opposite one.)
          const thing = obstacle[i] >= cfg.minPoints;
          if (answered && next === cells[i] && next === (thing ? OBSTACLE : PASSABLE)) {
            idle[i] = 0;
            if (++same[i] >= cfg.settleScans) settle(i);
          } else if (answered || next !== cells[i]) {
            same[i] = idle[i] = 0; // still changing, or an obstacle being confirmed
          } else if (view && cfg.giveUpScans > 0 && inView(i, view)) {
            if (++idle[i] >= cfg.giveUpScans) settle(i, view.sig || 1); // in view all this time and nothing to see
          }
        }
        if (next !== cells[i]) {
          cells[i] = next;
          changed = true;
        }
        obstacle[i] = floor[i] = 0;
      }
      return changed;
    },

    /**
     * Open settled cells again where the wearer has come back: call before each read.
     * Returns how many were opened.
     */
    reopen(view) {
      if (!settledCount) return 0;
      let opened = 0;
      const leave2 = cfg.leaveM ** 2;
      const range2 = cfg.depthRangeM ** 2;
      for (let i = 0; i < n; i++) {
        if (!settled[i]) continue;
        const dx = origin[0] + ((i % cols) + 0.5) * cellM - view.x;
        const dz = origin[1] + (Math.floor(i / cols) + 0.5) * cellM - view.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > leave2) away[i] = 1;
        else if (d2 <= range2 && (away[i] || (gaveUp[i] && gaveUp[i] !== (view.sig || 1)))) {
          settled[i] = same[i] = idle[i] = away[i] = 0;
          settledCount--;
          opened++;
        }
      }
      return opened;
    },

    /** True when a cell the depth image can see from `view` is still open: worth a read. */
    unsettledInView(view) {
      if (!settling) return true;
      const [c0, c1, r0, r1] = reach(view);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const i = r * cols + c;
          if (!settled[i] && inView(i, view)) return true;
        }
      }
      return false;
    },

    /**
     * Move the window: what was at column c + dCols, row r + dRows is at (c, r) afterwards, and
     * cell [0, 0] stands at `nextOriginXZ`. A cell that stays keeps its state and every counter.
     * A cell that comes in is unknown and open, with nothing counted.
     */
    shift(dCols, dRows, nextOriginXZ) {
      shiftCells(cells, cols, rows, dCols, dRows, UNKNOWN);
      for (const a of [sightings, hold, unseen, obstacle, floor, settled, same, idle, away, gaveUp]) shiftCells(a, cols, rows, dCols, dRows, 0);
      origin = [nextOriginXZ[0], nextOriginXZ[1]];
      settledCount = 0;
      for (let i = 0; i < n; i++) settledCount += settled[i];
    },

    /**
     * The wearer has stood here: every cell within `radiusM` of (x, z) is clear floor, now,
     * whatever was believed before. The cells stay open, so something put down there later is
     * still found. True when a cell changed.
     */
    freeAround(x, z, radiusM) {
      const k = Math.ceil(radiusM / cellM);
      const c0 = Math.floor((x - origin[0]) / cellM);
      const r0 = Math.floor((z - origin[1]) / cellM);
      let changed = false;
      for (let r = r0 - k; r <= r0 + k; r++) {
        for (let c = c0 - k; c <= c0 + k; c++) {
          if (!(c >= 0 && r >= 0 && c < cols && r < rows)) continue;
          const dx = origin[0] + (c + 0.5) * cellM - x;
          const dz = origin[1] + (r + 0.5) * cellM - z;
          if (dx * dx + dz * dz > radiusM * radiusM) continue;
          const i = r * cols + c;
          if (cells[i] !== PASSABLE) {
            cells[i] = PASSABLE;
            changed = true;
          }
          sightings[i] = hold[i] = same[i] = idle[i] = 0;
          if (settled[i]) {
            settled[i] = away[i] = gaveUp[i] = 0;
            settledCount--;
          }
        }
      }
      return changed;
    },

    /**
     * Lay back a square of cells that were in the window before (`values`, side x side, at
     * column col, row row). What is known comes back settled and marked as left behind: it
     * is not read from where the wearer stands now, and is opened like any cell the wearer
     * returns to once it is within depth range again (reopen). An obstacle comes back as one
     * that was confirmed, so it still takes clearScans reads of bare floor to remove it.
     */
    restore(col, row, side, values) {
      for (let r = 0; r < side; r++) {
        for (let c = 0; c < side; c++) {
          if (!(col + c >= 0 && row + r >= 0 && col + c < cols && row + r < rows)) continue;
          const i = (row + r) * cols + col + c;
          const value = values[r * side + c];
          if (settled[i]) settledCount--;
          cells[i] = value;
          sightings[i] = value === OBSTACLE ? cfg.setScans : 0;
          hold[i] = value === OBSTACLE ? cfg.clearScans : 0;
          unseen[i] = obstacle[i] = floor[i] = same[i] = idle[i] = gaveUp[i] = 0;
          settled[i] = away[i] = value === UNKNOWN ? 0 : 1;
          if (settled[i]) settledCount++;
        }
      }
    },

    get settledCount() {
      return settledCount;
    },

    /** Room coordinates of cell [0, 0]. */
    get originXZ() {
      return [origin[0], origin[1]];
    },
  };
}

/**
 * Where the wearer is and looks, from the head's matrix (column-major, head -> room):
 * x, z on the floor; dirX, dirZ the facing direction along the floor (0, 0 when looking nearly
 * straight up or down); sig, a number that changes when the wearer has moved about vantageM,
 * turned about 30 degrees or tilted the head about 20 degrees: a different picture.
 */
export function viewOf(m, vantageM = 1) {
  const fx = -m[8];
  const fy = -m[9];
  const fz = -m[10];
  const flat = Math.hypot(fx, fz);
  const level = flat > 0.2;
  const turn = level ? Math.round(Math.atan2(fx, fz) / (Math.PI / 6)) + 6 : 13; // 0..12, 13 = straight up or down
  const tilt = Math.round(Math.asin(Math.max(-1, Math.min(1, fy))) / (Math.PI / 9)) + 5; // 0..10
  const px = Math.round(m[12] / vantageM) + 512;
  const pz = Math.round(m[14] / vantageM) + 512;
  return { x: m[12], z: m[14], dirX: level ? fx / flat : 0, dirZ: level ? fz / flat : 0, sig: 1 + turn + 16 * (tilt + 16 * (px + 1024 * pz)) };
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
 * @param cfg depthSamples, depthRangeM, bodyM, cellM, thingMinM
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
      if (wy > cfg.thingMinM && !(along >= nearestThing && along <= farthestThing)) continue;
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
