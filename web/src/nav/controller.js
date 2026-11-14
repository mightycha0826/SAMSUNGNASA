import { NAV } from './config.js';
import { createGridFrame, cellToWorld, worldToCell, containsCell, remainingPath } from './coordinates.js';
import { buildTerrain, hazardField, validateHazard, sameHazard, hazardAffectsRoute } from './costs.js';
import { segmentCost } from './planner.js';
import { analyzeRoute } from './analysis.js';

// No DOM/Three dependency: navigation state can be tested with a fake Worker and bus.
export class Navigation {
  constructor({ bus, worker, now = Date.now, onRoute = () => {}, onPosition = () => {} }) {
    Object.assign(this, { bus, worker, now, onRoute, onPosition });
    this.off = []; this.version = 0; this.serial = 0; this.pending = null;
    this.targetId = null; this.position = null; this.route = []; this.critical = new Set();
    this.hazard = null; this.hfield = null;
    this.lastPlanAt = -Infinity; this.lastPublishAt = -Infinity; this.dirty = false;
    this.lastStatus = null; this.blockReason = ''; this.warned = false; this.stats = null;
    this.searchStart = null; this.analysis = null;
    const on = (name, fn) => this.off.push(bus.on(name, fn));
    on('layers:ready', data => this.load(data));
    on('nav:request', ({ targetId }) => this.request(targetId));
    // The wearer's position in map metres, from the headset's tracking (field/index.js).
    on('nav:position', ({ point }) => this.setPosition(point));
    on('hazard:update', h => this.updateHazard(h));
    on('voice:command', ({ intent }) => { if (intent === 'nav.stop') this.cancel(); });
    on('alert:raise', ({ id, level }) => {
      if (id === 'route-blocked') return;
      if (level === 'critical') {
        const first = !this.critical.size;
        this.critical.add(id);
        if (first || this.targetId !== 'base') this.request('base');
      } else this.critical.delete(id);
    });
    on('alert:clear', ({ id }) => this.critical.delete(id));
    worker.onmessage = ({ data }) => this.result(data);
    worker.onerror = () => { this.pending = null; this.fail('planner-error'); };
  }
  load(data) {
    this.invalidate(); this.data = data; this.transform = null; this.terrainField = null;
    this.route = []; this.onRoute({ status: 'cancelled', points: [] });
    try {
      this.transform = createGridFrame(data.layerSet);
      const terrain = buildTerrain(data.layerSet, data.grids);
      this.terrainField = { ...terrain, costs: terrain.base };
    } catch (err) { this.transform = null; this.terrainField = null; this.fail(err.message || 'invalid-grid'); return; }
    if (this.hazard?.frameId !== this.transform.frameId) { this.hazard = null; this.hfield = null; }
    this.analysis = null;
    this.worker.postMessage({ type: 'setup', version: ++this.version, ...data, hazard: this.hazard });
    if (this.targetId) this.dirty = true;
  }
  invalidate() {
    this.serial++; this.pending = null;
    this.worker.postMessage({ type: 'cancel' });
  }
  publish(status, points = [], distanceM = 0, reason = '') {
    this.lastStatus = status; this.blockReason = reason; this.lastPublishAt = this.now();
    const payload = { status, targetId: this.targetId, points, distanceM, reason };
    this.onRoute(payload); this.bus.emit('nav:route', payload);
  }
  clearWarning() {
    if (this.warned) { this.warned = false; this.bus.emit('alert:clear', { id: 'route-blocked' }); }
  }
  fail(reason) {
    this.route = []; this.analysis = null;
    if (this.lastStatus !== 'blocked' || this.blockReason !== reason) this.publish('blocked', [], 0, reason);
    if (!this.warned && this.targetId) {
      this.warned = true;
      this.bus.emit('alert:raise', { id: 'route-blocked', level: 'warn', message: `Route unavailable: ${reason}`, ts: this.now() });
    }
  }
  request(targetId) {
    const hadRoute = this.route.length > 0 || this.lastStatus === 'ok';
    this.invalidate(); this.targetId = this.critical.size ? 'base' : targetId;
    this.route = [];
    if (hadRoute) this.publish('cancelled', [], 0, 'new-request');
    else this.onRoute({ status: 'cancelled', points: [] });
    this.lastPlanAt = -Infinity; this.dirty = true;
    this.tick();
  }
  cancel() {
    this.invalidate(); this.route = []; this.dirty = false;
    this.clearWarning(); this.publish('cancelled'); this.targetId = null;
  }
  setPosition(position) {
    this.position = position?.length === 3 && position.every(Number.isFinite) ? position.slice() : null;
    this.onPosition(this.position);
    if (!this.position && this.targetId) { this.invalidate(); this.fail('tracking-lost'); this.dirty = true; }
    if (this.position && this.targetId && !this.route.length && this.searchStart &&
        Math.hypot(this.position[0] - this.searchStart[0], this.position[2] - this.searchStart[2]) >= NAV.offRouteM) this.dirty = true;
  }
  updateHazard(h) {
    // Unregistered local scans cannot modify a planetary map. An input provider
    // must first supply this map's frameId and positions in its metre frame.
    if (!validateHazard(h) || !this.transform || h.frameId !== this.transform.frameId ||
        (this.hazard && h.ts < this.hazard.ts)) return;
    const changed = !sameHazard(this.hazard, h);
    const wasPending = this.pending !== null;
    const rest = this.position && this.route.length ? remainingPath(this.route, this.position).points : [];
    let affected = false;
    // Snapshot owns its bytes; A may reuse its typed array on the next scan.
    this.hazard = { ...h, originXZ: h.originXZ.slice(), cells: h.cells.slice() };
    if (changed) {
      const next = hazardField(this.hazard);
      affected = hazardAffectsRoute(this.hfield, next, rest, (this.transform?.sx ?? 0) / 2, (this.transform?.sz ?? 0) / 2);
      this.hfield = next;
      this.worker.postMessage({ type: 'hazard', version: ++this.version, hazard: this.hazard });
      this.invalidate();
    }
    if (this.targetId && changed && (affected || wasPending || !this.route.length)) {
      this.dirty = true;
      if (rest.length && !this.routeClear(rest)) { this.route = []; this.publish('blocked', [], 0, 'obstacle-changed'); }
    }
  }
  routeClear(points) {
    if (this.terrainField && this.transform) {
      const cells = points.map(p => worldToCell(this.transform, p));
      if (cells.length === 1 && !Number.isFinite(segmentCost(this.terrainField, cells[0], cells[0]))) return false;
      for (let i = 1; i < cells.length; i++) if (!Number.isFinite(segmentCost(this.terrainField, cells[i - 1], cells[i]))) return false;
    }
    if (!this.hfield) return true;
    const f = this.hfield;
    const convert = p => [(p[0] - f.originXZ[0]) / f.sx - 0.5, (p[2] - f.originXZ[1]) / f.sz - 0.5];
    // Outside the sensor coverage is unknown (cost 3), not an obstacle. Split
    // each segment at the coverage rectangle before testing its inside portion.
    const test = (a, b) => {
      let lo = 0, hi = 1;
      for (const [v, d, min, max] of [[a[0], b[0] - a[0], -0.5, f.cols - 0.500000001], [a[1], b[1] - a[1], -0.5, f.rows - 0.500000001]]) {
        if (!d) { if (v < min || v > max) return true; }
        else { const p = (min - v) / d, q = (max - v) / d; lo = Math.max(lo, Math.min(p, q)); hi = Math.min(hi, Math.max(p, q)); }
      }
      if (lo > hi) return true;
      const at = t => [Math.max(-0.5, Math.min(f.cols - 0.500000001, a[0] + (b[0] - a[0]) * t)),
        Math.max(-0.5, Math.min(f.rows - 0.500000001, a[1] + (b[1] - a[1]) * t))];
      return Number.isFinite(segmentCost(f, at(lo), at(hi)));
    };
    if (points.length === 1) return test(convert(points[0]), convert(points[0]));
    for (let i = 1; i < points.length; i++) if (!test(convert(points[i - 1]), convert(points[i]))) return false;
    return true;
  }
  result(m) {
    if (m.type === 'error') {
      if (m.version === this.version) { this.pending = null; this.dirty = false; this.fail(m.reason || 'planner-error'); }
      return;
    }
    if (m.type !== 'result' || m.id !== this.pending || m.version !== this.version || !this.targetId) return;
    this.pending = null;
    this.stats = m.stats;
    if (m.status !== 'ok') { this.fail(m.reason || 'no-path'); return; }
    const route = m.points.map(p => cellToWorld(this.transform, p));
    if (!this.position || !route.length) { this.dirty = true; return; }
    const rest = remainingPath(route, this.position);
    if (rest.deviationM > NAV.offRouteM || !this.routeClear(rest.points)) { this.dirty = true; return; }
    this.route = route; this.analysis = analyzeRoute(this.data, m.points, m.cost); this.clearWarning();
    this.progress(true);
  }
  progress(force = false) {
    if (!this.position || !this.route.length || !this.targetId) return;
    const rest = remainingPath(this.route, this.position);
    const end = this.route.at(-1);
    if (!this.routeClear(rest.points)) {
      this.invalidate(); this.route = []; this.dirty = true; this.publish('blocked', [], 0, 'route-changed'); return;
    }
    if (Math.hypot(this.position[0] - end[0], this.position[2] - end[2]) <= NAV.arrivalM && this.routeClear([this.position, end])) {
      const targetId = this.targetId;
      this.invalidate(); this.route = []; this.dirty = false; this.clearWarning();
      this.publish('arrived', [end]); this.targetId = null; this.arrivedTargetId = targetId; return;
    }
    if (rest.deviationM > NAV.offRouteM) this.dirty = true;
    if (force || this.now() - this.lastPublishAt >= NAV.publishIntervalMs)
      this.publish('ok', rest.points, rest.distanceM);
  }
  tick() {
    if (!this.targetId) return;
    if (!this.transform) { this.fail('data-not-ready'); return; }
    if (!this.position) { this.fail('tracking-lost'); return; }
    const start = worldToCell(this.transform, this.position);
    if (!containsCell(this.transform, start)) { this.fail('outside-map'); this.dirty = true; return; }
    if (this.pending !== null && this.searchStart &&
        Math.hypot(this.position[0] - this.searchStart[0], this.position[2] - this.searchStart[2]) >= NAV.offRouteM) {
      this.invalidate(); this.dirty = true;
    }
    this.progress();
    if (!this.targetId || !this.dirty || this.pending !== null || this.now() - this.lastPlanAt < NAV.replanIntervalMs) return;
    const wp = this.data.layerSet.waypoints?.find(w => w.id === this.targetId);
    if (!wp || !containsCell(this.transform, wp.cell)) { this.dirty = false; this.fail('invalid-target'); return; }
    this.pending = ++this.serial; this.lastPlanAt = this.now(); this.dirty = false;
    this.searchStart = this.position.slice();
    this.worker.postMessage({ type: 'plan', id: this.pending, start, targetId: wp.id });
  }
  dispose() { this.off.forEach(off => off()); this.worker.terminate(); this.route = []; }
}
