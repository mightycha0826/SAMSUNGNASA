// What the hub keeps of the field map, and when a stored map may be laid back under a new scan.
// Pure arithmetic: node --test src/scan/memory.test.js
//
// The scan (index.js) sends every change of the obstacle grid to the Jetson hub, which writes
// it to disk (jetson/maps/). When a session starts, the hub hands back the map it stored last.
// Room coordinates are only the same as before if the headset kept its origin, and nothing
// says whether it did. So the stored map is used only once the new scan has seen enough of the
// same obstacles in the same places (linesUp), and then only for cells the new scan knows
// nothing about (fillUnknown): what the headset sees now always wins.

import { OBSTACLE, PASSABLE, UNKNOWN } from './grid.js';

export const MEMORY = {
  minHits: 100, // obstacle cells that must be found again before a stored map is trusted (1 m2 of wall line)
  minScore: 0.8, // share of the comparable obstacle cells that must agree
};

/** Cells as runs of equal values: [value, count, value, count, ...]. A scan is mostly long runs. */
export function encodeRuns(cells) {
  const runs = [];
  for (let i = 0; i < cells.length; ) {
    let j = i + 1;
    while (j < cells.length && cells[j] === cells[i]) j++;
    runs.push(cells[i], j - i);
    i = j;
  }
  return runs;
}

/** The cells back from runs, or null when the runs are not n cells of 0, 1 and 255. */
export function decodeRuns(runs, n) {
  if (!Array.isArray(runs) || runs.length % 2) return null;
  const cells = new Uint8Array(n);
  let at = 0;
  for (let k = 0; k < runs.length; k += 2) {
    const value = runs[k];
    const count = runs[k + 1];
    if (!(value === PASSABLE || value === OBSTACLE || value === UNKNOWN) || !(Number.isInteger(count) && count > 0) || at + count > n) return null;
    cells.fill(value, at, at + count);
    at += count;
  }
  return at === n ? cells : null;
}

/** True when the 3 x 3 cells around (c, r) hold an obstacle: tracking can sit a cell off. */
function obstacleNear(cells, cols, rows, c, r) {
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const cc = c + dc;
      const rr = r + dr;
      if (cc >= 0 && rr >= 0 && cc < cols && rr < rows && cells[rr * cols + cc] === OBSTACLE) return true;
    }
  }
  return false;
}

/**
 * How well two maps of the same grid agree on where the obstacles are.
 * hits: obstacle cells of one that the other also has (within a cell). misses: obstacle cells of
 * one where the other saw clear floor. Cells the other knows nothing about say nothing.
 */
export function compare(stored, current, cols, rows) {
  let hits = 0;
  let misses = 0;
  const tally = (a, b) => {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (a[i] !== OBSTACLE) continue;
        if (obstacleNear(b, cols, rows, c, r)) hits++;
        else if (b[i] === PASSABLE) misses++;
      }
    }
  };
  tally(stored, current);
  tally(current, stored);
  return { hits, misses, score: hits + misses ? hits / (hits + misses) : 0 };
}

/** True when the stored map is in the same room coordinates as what is being scanned now. */
export function linesUp(stored, current, cols, rows, cfg = MEMORY) {
  const { hits, score } = compare(stored, current, cols, rows);
  return hits >= cfg.minHits && score >= cfg.minScore;
}

/** Lay the stored map under the current one: only cells the current scan has not seen. Returns how many. */
export function fillUnknown(current, stored) {
  let filled = 0;
  for (let i = 0; i < current.length; i++) {
    if (current[i] === UNKNOWN && stored[i] !== UNKNOWN) {
      current[i] = stored[i];
      filled++;
    }
  }
  return filled;
}
