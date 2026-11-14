// Room-scale path planning on the scanned floor grid (hazard:update, docs/INTERFACES.md).
// Pure functions, no browser or three.js: they run in Node tests as well.
//
//   grid   { originXZ: [x, z], cellSizeM, cols, rows, cells: Uint8Array }   0 free, 1 obstacle, 255 unknown
//   points [x, z] in room metres

export const PLAN = {
  clearanceM: 0.3, // the route keeps this far from obstacles where it can (about half a body width)
  squeezeM: 0.3, // the narrowest gap a person can still get through, walking sideways
  squeezeCost: 4, // walking right beside an obstacle costs up to 1 + this: a wide way is taken unless it is some 3 m longer
  unknownCost: 3, // a step on floor nobody has seen costs three steps on floor that is known clear, as on the Mars map (nav: unknown terrain risk x3): a route through known ground is taken unless it is three times as long
  snapM: 0.8, // a start or goal on an obstacle may move this far to free floor
  // Waypoints on the way (planVia): the route goes through a waypoint when that makes it hardly
  // longer: by at most viaExtraShare of the direct route, or viaExtraM if that is more. Several
  // waypoints may be taken, as long as all of them together stay within that.
  viaExtraShare: 0.1,
  viaExtraM: 0.5,
  viaMinM: 0.6, // a waypoint this near the start or the goal is not a stop on the way
  viaMax: 6, // at most this many stops
};

const cellOf = (g, x, z) => [Math.floor((x - g.originXZ[0]) / g.cellSizeM), Math.floor((z - g.originXZ[1]) / g.cellSizeM)];
const centre = (g, c, r) => [g.originXZ[0] + (c + 0.5) * g.cellSizeM, g.originXZ[1] + (r + 0.5) * g.cellSizeM];
const inside = (g, c, r) => c >= 0 && r >= 0 && c < g.cols && r < g.rows;

/** 1 within the clearance of an obstacle: where the route prefers not to go (see crowding). */
export function inflate(grid, clearanceM = PLAN.clearanceM) {
  const { cols, rows, cells } = grid;
  const k = Math.ceil(clearanceM / grid.cellSizeM);
  const out = new Uint8Array(cols * rows);
  const offsets = [];
  for (let dr = -k; dr <= k; dr++) for (let dc = -k; dc <= k; dc++) if (dc * dc + dr * dr <= k * k) offsets.push([dc, dr]);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (cells[r * cols + c] !== 1) continue;
      for (const [dc, dr] of offsets) {
        const cc = c + dc;
        const rr = r + dr;
        if (cc >= 0 && rr >= 0 && cc < cols && rr < rows) out[rr * cols + cc] = 1;
      }
    }
  }
  return out;
}

// The four lines through a cell: across, along and the two diagonals.
const AXES = [[1, 0], [0, 1], [1, 1], [1, -1]];

/**
 * 1 where walking is not possible at all: obstacles, and floor in a gap narrower than squeezeM.
 * A real gap of squeezeM shows up in the grid as one cell fewer when its sides fall inside
 * cells (30 cm between two walls can be 2 free cells of 10 cm), so that many free cells pass.
 * The edge of the grid does not count as a wall.
 */
export function impassable(grid, squeezeM = PLAN.squeezeM) {
  const { cols, rows, cells } = grid;
  const need = Math.max(1, Math.round(squeezeM / grid.cellSizeM) - 1); // free cells a gap must have
  const out = new Uint8Array(cols * rows);
  // Free cells from (c, r) in one direction before an obstacle, or -1 when none is met within reach.
  const reach = (c, r, dc, dr) => {
    for (let k = 1; k <= need; k++) {
      const cc = c + dc * k;
      const rr = r + dr * k;
      if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) return -1;
      if (cells[rr * cols + cc] === 1) return k - 1;
    }
    return -1;
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (cells[i] === 1) {
        out[i] = 1;
        continue;
      }
      for (const [dc, dr] of AXES) {
        const a = reach(c, r, dc, dr);
        const b = a < 0 ? -1 : reach(c, r, -dc, -dr);
        if (a >= 0 && b >= 0 && 1 + a + b < need) {
          out[i] = 1; // walled in on both sides of this line, with too little room between
          break;
        }
      }
    }
  }
  return out;
}

/**
 * How much more a step onto each cell costs for being close to an obstacle: 1 beyond the
 * clearance, rising to 1 + squeezeCost right beside one. The route keeps its distance where
 * there is room and still goes through a narrow gap when that is the way.
 */
export function crowding(grid, clearanceM = PLAN.clearanceM, squeezeCost = PLAN.squeezeCost) {
  const { cols, rows, cells } = grid;
  const k = Math.ceil(clearanceM / grid.cellSizeM);
  const out = new Float32Array(cols * rows).fill(1);
  if (!(k > 0 && squeezeCost > 0)) return out;
  const offsets = [];
  for (let dr = -k; dr <= k; dr++) {
    for (let dc = -k; dc <= k; dc++) {
      const d = Math.hypot(dc, dr);
      if (d > 0 && d <= k) offsets.push([dc, dr, 1 + (squeezeCost * (k + 1 - d)) / k]);
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (cells[r * cols + c] !== 1) continue;
      for (const [dc, dr, w] of offsets) {
        const cc = c + dc;
        const rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
        const j = rr * cols + cc;
        if (w > out[j]) out[j] = w;
      }
    }
  }
  return out;
}

function nearestFree(grid, blocked, c, r, maxCells) {
  if (inside(grid, c, r) && !blocked[r * grid.cols + c]) return [c, r];
  for (let d = 1; d <= maxCells; d++) {
    let best = null;
    let bestD = Infinity;
    for (let dr = -d; dr <= d; dr++) {
      for (let dc = -d; dc <= d; dc++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== d) continue;
        const cc = c + dc;
        const rr = r + dr;
        if (!inside(grid, cc, rr) || blocked[rr * grid.cols + cc]) continue;
        const dist = dc * dc + dr * dr;
        if (dist < bestD) {
          bestD = dist;
          best = [cc, rr];
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * True when the straight segment between two cells crosses no blocked cell, and none that costs
 * more than maxCrowd (so a shortcut never hugs a wall the path had kept away from, and never
 * crosses unseen floor the path had gone around).
 */
function clear(grid, blocked, a, b, crowd, maxCrowd) {
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2);
  for (let i = 0; i <= n; i++) {
    const c = Math.round(a[0] + ((b[0] - a[0]) * i) / (n || 1));
    const r = Math.round(a[1] + ((b[1] - a[1]) * i) / (n || 1));
    if (!inside(grid, c, r)) return false;
    const j = r * grid.cols + c;
    if (blocked[j] || crowd[j] > maxCrowd + 1e-6) return false;
  }
  return true;
}

class Heap {
  constructor() {
    this.items = [];
  }
  push(key, value) {
    const a = this.items;
    a.push([key, value]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top?.[1];
  }
  get size() {
    return this.items.length;
  }
}

/**
 * Shortest walkable path from start to goal.
 * Returns { points: [[x, z], ...], distanceM, blocked: false } or { points: [], blocked: true }.
 * Without a grid (nothing scanned yet) the path is the straight line.
 */
/**
 * What every search on a grid needs, worked out once: where nobody can walk, and what a step
 * onto each cell costs, per metre: more beside an obstacle, and more on floor nobody has seen.
 * The search uses the cost, and so does the straightening afterwards: a shortcut across unseen
 * floor must not undo a way around it that the search chose. planPath works it out itself;
 * planVia, which plans several legs on one grid, passes it on (opts.prepared).
 */
export function prepare(grid, opts = {}) {
  const P = { ...PLAN, ...opts };
  const blocked = impassable(grid, P.squeezeM);
  const crowd = crowding(grid, P.clearanceM, P.squeezeCost);
  for (let i = 0; i < crowd.length; i++) if (grid.cells[i] === 255) crowd[i] *= P.unknownCost;
  return { blocked, crowd };
}

/**
 * The route from start to goal, through every waypoint that lies nearly on the way.
 * `stops`: [{ id, at: [x, z] }]. A waypoint is taken when going through it makes the route
 * hardly longer (PLAN.viaExtraShare / viaExtraM, counted for all stops together against the
 * direct route); the one that costs least is taken first, at the place in the order where it
 * costs least, and so on while the allowance lasts.
 * Returns what planPath returns, plus `via`: the ids of the stops, in the order they are passed.
 */
export function planVia(grid, start, goal, stops = [], opts = {}) {
  const P = { ...PLAN, ...opts };
  const prepared = grid?.cells?.length ? prepare(grid, P) : undefined;
  const plan = (a, b) => planPath(grid, a, b, { ...opts, prepared });
  const direct = plan(start, goal);
  if (direct.blocked || !stops.length) return { ...direct, via: [] };
  const far = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const allowance = Math.max(P.viaExtraM, direct.distanceM * P.viaExtraShare);
  const left = stops.filter((w) => far(w.at, start) >= P.viaMinM && far(w.at, goal) >= P.viaMinM);
  const chain = [{ at: start }, { at: goal }]; // the places passed, in order
  const legs = [direct]; // legs[k] leads from chain[k] to chain[k + 1]
  let extra = 0;
  while (left.length && chain.length - 2 < P.viaMax) {
    let best = null;
    for (const w of left) {
      for (let k = 0; k < legs.length; k++) {
        // The straight-line detour is the least this stop can cost here: most are ruled out without a search.
        const least = far(chain[k].at, w.at) + far(w.at, chain[k + 1].at) - legs[k].distanceM;
        if (extra + least > allowance || (best && least >= best.cost)) continue;
        const to = plan(chain[k].at, w.at);
        if (to.blocked) continue;
        const from = plan(w.at, chain[k + 1].at);
        if (from.blocked) continue;
        const cost = to.distanceM + from.distanceM - legs[k].distanceM;
        if (extra + cost <= allowance && (!best || cost < best.cost)) best = { w, k, to, from, cost };
      }
    }
    if (!best) break;
    chain.splice(best.k + 1, 0, best.w);
    legs.splice(best.k, 1, best.to, best.from);
    left.splice(left.indexOf(best.w), 1);
    extra += Math.max(0, best.cost);
  }
  const points = [];
  for (const leg of legs) for (const p of leg.points) {
    const last = points[points.length - 1];
    if (!last || far(last, p) > 1e-6) points.push(p);
  }
  return { points, distanceM: legs.reduce((sum, leg) => sum + leg.distanceM, 0), blocked: false, via: chain.slice(1, -1).map((w) => w.id) };
}

export function planPath(grid, start, goal, opts = {}) {
  const P = { ...PLAN, ...opts };
  const straight = () => ({ points: [start, goal], distanceM: Math.hypot(goal[0] - start[0], goal[1] - start[1]), blocked: false });
  if (!grid?.cells?.length) return straight();

  const { blocked, crowd } = opts.prepared ?? prepare(grid, P);
  const snap = Math.ceil(P.snapM / grid.cellSizeM);
  const s0 = cellOf(grid, start[0], start[1]);
  const g0 = cellOf(grid, goal[0], goal[1]);
  // Outside the scanned area there is nothing to plan around.
  if (!inside(grid, s0[0], s0[1]) || !inside(grid, g0[0], g0[1])) return straight();
  const s = nearestFree(grid, blocked, s0[0], s0[1], snap);
  const g = nearestFree(grid, blocked, g0[0], g0[1], snap);
  if (!s || !g) return { points: [], distanceM: 0, blocked: true };

  const { cols, rows, cells } = grid;
  const N = cols * rows;
  const cost = new Float32Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const done = new Uint8Array(N);
  const si = s[1] * cols + s[0];
  const gi = g[1] * cols + g[0];
  const h = (i) => Math.hypot((i % cols) - g[0], Math.floor(i / cols) - g[1]);
  const heap = new Heap();
  cost[si] = 0;
  heap.push(h(si), si);
  const STEPS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (heap.size) {
    const i = heap.pop();
    if (done[i]) continue;
    done[i] = 1;
    if (i === gi) break;
    const c = i % cols;
    const r = (i - c) / cols;
    for (const [dc, dr, w] of STEPS) {
      const cc = c + dc;
      const rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
      const j = rr * cols + cc;
      if (done[j] || blocked[j]) continue;
      // no cutting corners between two blocked cells
      if (dc && dr && (blocked[r * cols + cc] || blocked[rr * cols + c])) continue;
      const step = w * crowd[j];
      if (cost[i] + step < cost[j]) {
        cost[j] = cost[i] + step;
        from[j] = i;
        heap.push(cost[j] + h(j), j);
      }
    }
  }
  if (!done[gi]) return { points: [], distanceM: 0, blocked: true };

  const path = [];
  for (let i = gi; i !== -1; i = from[i]) path.push([i % cols, Math.floor(i / cols)]);
  path.reverse();
  // String pulling: drop every cell that can be skipped in a straight line, as long as the
  // shortcut crosses no cell that costs more than the stretch of path it replaces: it comes no
  // closer to an obstacle, and it does not leave known floor for unseen floor.
  const at = ([c, r]) => crowd[r * cols + c];
  const kept = [path[0]];
  let anchor = 0;
  let worst = Math.max(at(path[0]), path.length > 1 ? at(path[1]) : 1);
  for (let i = 2; i < path.length; i++) {
    worst = Math.max(worst, at(path[i]));
    if (!clear(grid, blocked, path[anchor], path[i], crowd, worst)) {
      kept.push(path[i - 1]);
      anchor = i - 1;
      worst = Math.max(at(path[i - 1]), at(path[i]));
    }
  }
  kept.push(path[path.length - 1]);

  const points = kept.map(([c, r]) => centre(grid, c, r));
  // Exact ends where the wearer and the target really are, when those cells were free.
  if (s[0] === s0[0] && s[1] === s0[1]) points[0] = start;
  else points.unshift(start);
  if (g[0] === g0[0] && g[1] === g0[1]) points[points.length - 1] = goal;
  let distanceM = 0;
  for (let i = 1; i < points.length; i++) distanceM += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return { points, distanceM, blocked: false };
}
