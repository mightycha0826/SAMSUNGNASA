import { segmentCost } from './planner.js';

// Reverse Dijkstra precomputes all starts for one destination. A zero-heuristic
// Lifelong Planning A* repair then reuses those distances after cost changes.
class IndexedQueue {
  constructor(n) {
    this.ids = new Int32Array(n); this.pos = new Int32Array(n).fill(-1);
    this.keys = new Float64Array(n).fill(Infinity); this.size = 0;
  }
  less(a, b) { return this.keys[a] < this.keys[b] || (this.keys[a] === this.keys[b] && a < b); }
  swap(a, b) {
    const id = this.ids[a]; this.ids[a] = this.ids[b]; this.ids[b] = id;
    this.pos[id] = b; this.pos[this.ids[a]] = a;
  }
  up(p) {
    while (p > 0) { const q = (p - 1) >> 1; if (!this.less(this.ids[p], this.ids[q])) break; this.swap(p, q); p = q; }
    return p;
  }
  down(p) {
    for (;;) {
      const l = 2 * p + 1, r = l + 1;
      if (l >= this.size) return;
      const q = r < this.size && this.less(this.ids[r], this.ids[l]) ? r : l;
      if (!this.less(this.ids[q], this.ids[p])) return;
      this.swap(p, q); p = q;
    }
  }
  remove(id) {
    const p = this.pos[id]; if (p < 0) return;
    this.pos[id] = -1;
    if (p < --this.size) {
      this.ids[p] = this.ids[this.size]; this.pos[this.ids[p]] = p;
      this.down(this.up(p));
    }
  }
  set(id, key) {
    let p = this.pos[id]; this.keys[id] = key;
    if (p < 0) { p = this.size++; this.ids[p] = id; this.pos[id] = p; }
    this.down(this.up(p));
  }
  pop() { const id = this.ids[0]; this.remove(id); return id; }
}

export class GoalTree {
  constructor(field, goal) {
    this.field = field; this.goal = goal.slice();
    const { cols, rows } = field, n = cols * rows;
    if (goal.length !== 2 || !goal.every(Number.isInteger) || goal[0] < 0 || goal[1] < 0 || goal[0] >= cols || goal[1] >= rows)
      throw Error('invalid-target');
    this.target = goal[1] * cols + goal[0];
    this.g = new Float64Array(n).fill(Infinity);
    this.rhs = new Float64Array(n).fill(Infinity);
    this.queue = new IndexedQueue(n); this.mark = new Uint8Array(n);
    this.initial = true; this.stats = { expanded: 0, changed: 0, mode: 'precompute' };
    this.distances = [field.sx, field.sz, Math.hypot(field.sx, field.sz)];
    if (Number.isFinite(field.costs[this.target])) { this.g[this.target] = 0; this.queue.set(this.target, 0); }
  }
  get done() { return !this.initial && !this.queue.size; }
  point(id) { return [id % this.field.cols, Math.floor(id / this.field.cols)]; }
  edge(u, v, dc, dr) {
    const { costs, cols } = this.field;
    if (dc && dr && (!Number.isFinite(costs[u + dc]) || !Number.isFinite(costs[u + dr * cols]))) return Infinity;
    return this.distances[dc && dr ? 2 : dc ? 0 : 1] * (costs[u] + costs[v]) / 2;
  }
  update(u) {
    const { cols, rows, costs } = this.field, c = u % cols, r = Math.floor(u / cols);
    let best = Infinity;
    if (Number.isFinite(costs[u])) {
      if (u === this.target) best = 0;
      else for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if ((!dc && !dr) || c + dc < 0 || c + dc >= cols || r + dr < 0 || r + dr >= rows) continue;
        const v = u + dr * cols + dc;
        best = Math.min(best, this.edge(u, v, dc, dr) + this.g[v]);
      }
    }
    this.rhs[u] = best;
    if (this.g[u] === best) this.queue.remove(u);
    else this.queue.set(u, Math.min(this.g[u], best));
  }
  applyChanges(field, changed) {
    if (this.initial) throw Error('precompute-in-progress');
    this.field = field; this.stats = { expanded: 0, changed: changed.length, mode: 'repair' };
    const { cols, rows } = field, affected = [];
    // Include diagonal side-cell dependencies, deduplicating touched vertices.
    for (const id of changed) {
      const c = id % cols, r = Math.floor(id / cols);
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (c + dc < 0 || c + dc >= cols || r + dr < 0 || r + dr >= rows) continue;
        const u = id + dr * cols + dc;
        if (!this.mark[u]) { this.mark[u] = 1; affected.push(u); }
      }
    }
    for (const u of affected) { this.mark[u] = 0; this.update(u); }
  }
  step(maxExpansions = 1024, budgetMs = 4) {
    const deadline = performance.now() + budgetMs, { cols, rows } = this.field;
    let count = 0;
    while (this.queue.size && count < maxExpansions && performance.now() < deadline) {
      const u = this.queue.pop(), c = u % cols, r = Math.floor(u / cols);
      count++; this.stats.expanded++;
      if (!this.initial) {
        if (this.g[u] > this.rhs[u]) this.g[u] = this.rhs[u];
        else { this.g[u] = Infinity; this.update(u); }
      }
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if ((!dc && !dr) || c + dc < 0 || c + dc >= cols || r + dr < 0 || r + dr >= rows) continue;
        const v = u + dr * cols + dc;
        if (this.initial) {
          const next = this.g[u] + this.edge(u, v, dc, dr);
          if (next < this.g[v]) { this.g[v] = next; this.queue.set(v, next); }
        } else this.update(v);
      }
    }
    if (this.initial && !this.queue.size) { this.rhs.set(this.g); this.initial = false; }
    return this.done;
  }
  path(start) {
    const fail = reason => ({ status: 'blocked', reason, points: [], cost: Infinity });
    if (!this.done) return fail('precompute-in-progress');
    const { cols, rows } = this.field;
    if (!start?.every(Number.isFinite) || start.length !== 2 || start[0] < -0.5 || start[1] < -0.5 || start[0] >= cols - 0.5 || start[1] >= rows - 0.5) return fail('outside-map');
    let u = Math.round(start[1]) * cols + Math.round(start[0]);
    const connector = segmentCost(this.field, start, this.point(u));
    if (!Number.isFinite(connector)) return fail('start-blocked');
    if (!Number.isFinite(this.g[u])) return fail('no-path');
    const cost = connector + this.g[u], points = [start.slice()];
    const append = p => {
      const b = points.at(-1), a = points.at(-2);
      if (p[0] === b[0] && p[1] === b[1]) return;
      if (a && a.every(Number.isInteger) && b.every(Number.isInteger) &&
          (b[0] - a[0]) * (p[1] - b[1]) === (b[1] - a[1]) * (p[0] - b[0])) points[points.length - 1] = p;
      else points.push(p);
    };
    append(this.point(u));
    for (let guard = 0; u !== this.target && guard < cols * rows; guard++) {
      const c = u % cols, r = Math.floor(u / cols);
      let best = Infinity, next = -1;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if ((!dc && !dr) || c + dc < 0 || c + dc >= cols || r + dr < 0 || r + dr >= rows) continue;
        const v = u + dr * cols + dc, total = this.edge(u, v, dc, dr) + this.g[v];
        if (total < best) { best = total; next = v; }
      }
      if (next < 0 || !(this.g[next] < this.g[u])) return fail('inconsistent-tree');
      u = next; append(this.point(u));
    }
    if (u !== this.target) return fail('inconsistent-tree');
    return { status: 'ok', reason: '', points, cost, stats: { ...this.stats } };
  }
}
