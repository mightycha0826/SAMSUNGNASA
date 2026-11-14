// Exact raster traversal for collision tests, plus 8-way A*/Dijkstra searches: A* is the Worker's
// live answer while a destination tree is unfinished (planner.worker.js); plan() and the Dijkstra
// variant are used by the tests and the benchmark to check the cached goal-tree planner.

const EPS = 1e-10;

export function segmentCost(field, a, b, limit = Infinity, stats = null) {
  if (stats) stats.segments++;
  const { cols, rows, costs, sx, sz } = field;
  const ax = a[0] + 0.5, ay = a[1] + 0.5, bx = b[0] + 0.5, by = b[1] + 0.5;
  if (![ax, ay, bx, by].every(Number.isFinite) || ax < 0 || ay < 0 || bx < 0 || by < 0 ||
      ax >= cols || bx >= cols || ay >= rows || by >= rows) return Infinity;
  let c = Math.floor(ax), r = Math.floor(ay), t = 0, total = 0;
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx * sx, dy * sz);
  const sc = Math.sign(dx), sr = Math.sign(dy);
  const txStep = dx ? 1 / Math.abs(dx) : Infinity, tyStep = dy ? 1 / Math.abs(dy) : Infinity;
  let tx = dx ? ((sc > 0 ? c + 1 : c) - ax) / dx : Infinity;
  let ty = dy ? ((sr > 0 ? r + 1 : r) - ay) / dy : Infinity;
  const blocked = (x, y) => x < 0 || x >= cols || y < 0 || y >= rows || !Number.isFinite(costs[y * cols + x]);
  for (let guard = 0; guard <= cols + rows + 4; guard++) {
    if (blocked(c, r)) return Infinity;
    // A line exactly on a cell boundary must not skim the blocked side.
    if (!dx && Math.abs(ax - Math.round(ax)) < EPS && c > 0 && blocked(c - 1, r)) return Infinity;
    if (!dy && Math.abs(ay - Math.round(ay)) < EPS && r > 0 && blocked(c, r - 1)) return Infinity;
    const next = Math.min(1, tx, ty);
    total += Math.max(0, next - t) * len * costs[r * cols + c];
    if (stats) stats.cells++;
    if (total > limit + EPS) return Infinity;
    if (next >= 1 - EPS) return total;
    const cx = tx <= ty + EPS, cy = ty <= tx + EPS;
    if (cx && cy && (blocked(c + sc, r) || blocked(c, r + sr))) return Infinity;
    if (cx) { c += sc; tx += txStep; }
    if (cy) { r += sr; ty += tyStep; }
    t = next;
  }
  return Infinity;
}

class Heap {
  constructor(n, compare) { this.ids = new Int32Array(n); this.pos = new Int32Array(n).fill(-1); this.size = 0; this.compare = compare; }
  swap(a, b) { const v = this.ids[a]; this.ids[a] = this.ids[b]; this.ids[b] = v; this.pos[this.ids[a]] = a; this.pos[v] = b; }
  push(id) {
    let p = this.pos[id];
    if (p < 0) { p = this.size++; this.ids[p] = id; this.pos[id] = p; }
    while (p > 0) { const q = (p - 1) >> 1; if (!this.compare(this.ids[p], this.ids[q])) break; this.swap(p, q); p = q; }
  }
  pop() {
    const id = this.ids[0]; this.pos[id] = -1;
    if (--this.size > 0) {
      this.ids[0] = this.ids[this.size]; this.pos[this.ids[0]] = 0;
      let p = 0;
      for (;;) {
        const l = p * 2 + 1, r = l + 1;
        if (l >= this.size) break;
        const q = r < this.size && this.compare(this.ids[r], this.ids[l]) ? r : l;
        if (!this.compare(this.ids[q], this.ids[p])) break;
        this.swap(p, q); p = q;
      }
    }
    return id;
  }
}

export class Search {
  constructor(field, start, goal, { algorithm = 'astar' } = {}) {
    this.field = field; this.start = start; this.goal = goal; this.algorithm = algorithm;
    this.stats = { expanded: 0, segments: 0, cells: 0, elapsedMs: 0 };
    this.began = performance.now(); this.done = false; this.result = null;
    const n = field.cols * field.rows;
    const valid = p => p?.length === 2 && p.every(Number.isFinite) && p[0] >= -0.5 && p[1] >= -0.5 && p[0] < field.cols - 0.5 && p[1] < field.rows - 0.5;
    if (!valid(start) || !valid(goal)) return this.finish('blocked', [], 'outside-map');
    this.s = Math.round(start[1]) * field.cols + Math.round(start[0]);
    this.target = Math.round(goal[1]) * field.cols + Math.round(goal[0]);
    if (!Number.isFinite(field.costs[this.s]) || !Number.isFinite(field.costs[this.target])) return this.finish('blocked', [], 'start-or-target-blocked');
    this.g = new Float64Array(n).fill(Infinity);
    this.f = new Float64Array(n).fill(Infinity);
    this.parent = new Int32Array(n).fill(-1);
    this.closed = new Uint8Array(n);
    this.heap = new Heap(n, (a, b) => this.f[a] < this.f[b] || (this.f[a] === this.f[b] && (this.g[a] > this.g[b] || (this.g[a] === this.g[b] && a < b))));
    this.g[this.s] = segmentCost(field, start, this.point(this.s));
    if (!Number.isFinite(this.g[this.s])) return this.finish('blocked', [], 'start-connection-blocked');
    this.f[this.s] = this.g[this.s] + this.heuristic(this.s);
    this.parent[this.s] = this.s; this.heap.push(this.s);
  }
  point(id) { return [id % this.field.cols, Math.floor(id / this.field.cols)]; }
  heuristic(id) {
    if (this.algorithm === 'dijkstra') return 0;
    const p = this.point(id);
    return Math.hypot((p[0] - this.goal[0]) * this.field.sx, (p[1] - this.goal[1]) * this.field.sz) * this.field.min;
  }
  finish(status, points, reason = '', cost = Infinity) {
    this.done = true; this.stats.elapsedMs = performance.now() - this.began;
    this.result = { status, points, reason, cost, stats: this.stats };
  }
  step(maxExpansions = 256, budgetMs = 4) {
    const end = performance.now() + budgetMs;
    const { cols, rows, sx, sz } = this.field;
    for (let count = 0; !this.done && count < maxExpansions && performance.now() < end; count++) {
      if (!this.heap.size) { this.finish('blocked', [], 'no-path'); break; }
      const u = this.heap.pop(); this.closed[u] = 1; this.stats.expanded++;
      const up = this.point(u);
      if (u === this.target) {
        const tail = segmentCost(this.field, up, this.goal, Infinity, this.stats);
        if (!Number.isFinite(tail)) { this.finish('blocked', [], 'target-connection-blocked'); break; }
        const points = [this.goal.slice()];
        let v = u;
        for (let guard = 0; guard <= cols * rows; guard++) {
          points.push(this.point(v));
          if (v === this.s) break;
          v = this.parent[v];
        }
        points.push(this.start.slice()); points.reverse();
        const unique = points.filter((p, i) => !i || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > EPS);
        const compact = [];
        for (const p of unique) {
          const b = compact.at(-1), a = compact.at(-2);
          if (a && a.every(Number.isInteger) && b.every(Number.isInteger) &&
              (b[0] - a[0]) * (p[1] - b[1]) === (b[1] - a[1]) * (p[0] - b[0])) compact[compact.length - 1] = p;
          else compact.push(p);
        }
        this.finish('ok', compact, '', this.g[u] + tail); break;
      }
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dc && !dr) continue;
        const c = up[0] + dc, r = up[1] + dr;
        if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
        const v = r * cols + c, vp = [c, r];
        if (v === this.s || !Number.isFinite(this.field.costs[v])) continue;
        // For neighbouring cell centres, the edge crosses each cell over
        // exactly half its length. Diagonal corner clearance is still checked.
        if (dc && dr && (!Number.isFinite(this.field.costs[up[1] * cols + c]) ||
            !Number.isFinite(this.field.costs[r * cols + up[0]]))) continue;
        const local = Math.hypot(dc * sx, dr * sz) * (this.field.costs[u] + this.field.costs[v]) / 2;
        let best = this.g[u] + local, parent = u;
        if (best + EPS < this.g[v]) {
          this.g[v] = best; this.f[v] = best + this.heuristic(v); this.parent[v] = parent;
          this.closed[v] = 0; this.heap.push(v);
        }
      }
    }
    return this.result;
  }
}

export function plan(field, start, goal, options) {
  const search = new Search(field, start, goal, options);
  while (!search.done) search.step(100000, Infinity);
  return search.result;
}
