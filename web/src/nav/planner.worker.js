import { buildTerrain, combineCosts } from './costs.js';
import { GoalTree } from './goal-tree.js';
import { Search } from './planner.js';
import { chooseStops } from './via.js';

let terrain = null, hazard = null, field = null, version = 0, job = null;
let scheduled = false, setupError = '', waypoints = [], trees = new Map(), preferred = null;
// Waypoints the wearer marked (id -> cell): each has a tree like a destination, so a route can
// be led through those that lie nearly on the way (via.js). `partial`: a route was answered
// while some tree was unfinished; the page is told when all are done, and may ask again.
const vias = new Map();
let partial = false;
const workQueue = new MessageChannel();
workQueue.port1.onmessage = run;
function rebuild() { trees = new Map([...waypoints, ...[...vias].map(([id, cell]) => ({ id, cell }))].map(w => [w.id, new GoalTree(field, w.cell)])); }
// The route of a job whose destination tree is done: through the marked waypoints that lie
// nearly on the way, each leg read from the tree of the place it leads to.
function answer(job, tree) {
  const direct = tree.path(job.start);
  if (direct.status !== 'ok' || !vias.size) return direct;
  const { cols } = field;
  const costTo = (stop, cell) => trees.get(stop.id).g[Math.round(cell[1]) * cols + Math.round(cell[0])];
  const stops = [];
  for (const [id, cell] of vias) {
    if (id === job.targetId || job.skip?.includes(id)) continue;
    if (trees.get(id)?.done) stops.push({ id, cell });
    else partial = true;
  }
  const { order } = chooseStops(costTo, job.start, { id: job.targetId, cell: tree.goal }, stops, undefined, Math.max(field.sx, field.sz));
  if (!order.length) return direct;
  const points = [];
  let cost = 0, from = job.start;
  for (const stop of [...order, { id: job.targetId }]) {
    const leg = trees.get(stop.id).path(from);
    if (leg.status !== 'ok') return direct;
    for (const p of leg.points) { const last = points.at(-1); if (!last || last[0] !== p[0] || last[1] !== p[1]) points.push(p); }
    cost += leg.cost; from = points.at(-1);
  }
  return { ...direct, points, cost, via: order.map(w => w.id) };
}
// MessageChannel yields to incoming scans without nested setTimeout's 4ms clamp.
function schedule() { if (!scheduled) { scheduled = true; workQueue.port2.postMessage(null); } }
function run() {
  scheduled = false;
  if (job) {
    const tree = trees.get(job.targetId);
    if (tree.done) {
      self.postMessage({ type: 'result', id: job.id, version, ...answer(job, tree) }); job = null;
    } else {
      // A busy cache must not delay live guidance. A* obtains the current exact
      // 8-way route; destination-wide repair continues afterwards for reuse.
      job.search ??= new Search(field, job.start, tree.goal);
      job.search.step(2048, 6);
      if (job.search.done) {
        if (vias.size) partial = true; // answered without the trees: no waypoint could be considered
        self.postMessage({ type: 'result', id: job.id, version, ...job.search.result }); job = null;
      }
      schedule(); return;
    }
  }
  // Requested destination first; other destination caches warm in the background.
  const entry = preferred && !trees.get(preferred)?.done ? [preferred, trees.get(preferred)] : [...trees.entries()].find(([, t]) => !t.done);
  const active = entry?.[1];
  if (!active) {
    if (partial) { partial = false; self.postMessage({ type: 'trees', version }); }
    return;
  }
  if (!active.done) active.step(2048, 6);
  // A small edit near a bottleneck can invalidate most of the tree. Bound the
  // expensive repair work, then use the cheaper full reverse Dijkstra pass.
  if (!active.done && !active.initial && active.stats.expanded > field.costs.length / 4) {
    trees.set(entry[0], new GoalTree(field, active.goal)); schedule(); return;
  }
  if ([...trees.values()].some(t => !t.done)) schedule();
  else if (partial) { partial = false; self.postMessage({ type: 'trees', version }); }
}
self.onmessage = ({ data: m }) => {
  try {
    if (m.type === 'setup') {
      job = null; version = m.version; setupError = ''; preferred = null; vias.clear(); partial = false;
      terrain = buildTerrain(m.layerSet, m.grids); hazard = m.hazard ?? null; field = combineCosts(terrain, hazard);
      waypoints = m.layerSet.waypoints ?? []; rebuild(); schedule();
    } else if (m.type === 'hazard') {
      job = null; hazard = m.hazard; version = m.version;
      if (terrain) {
        const next = combineCosts(terrain, hazard), changed = [];
        for (let i = 0; i < next.costs.length; i++) if (next.costs[i] !== field.costs[i]) changed.push(i);
        field = next;
        // Rebuild large rescans or incomplete initial trees; repair local changes.
        if (changed.length > field.costs.length / 5) rebuild();
        else if (changed.length) for (const [id, tree] of trees) {
          if (tree.initial) trees.set(id, new GoalTree(field, tree.goal));
          else tree.applyChanges(field, changed);
        }
        schedule();
      }
    } else if (m.type === 'waypoint') {
      // A destination added or moved while running (a point picked on the map). A route to it
      // is found by the direct search at once; its tree fills in behind for later requests.
      if (job?.targetId === m.id) job = null;
      waypoints = waypoints.filter(w => w.id !== m.id).concat({ id: m.id, cell: m.cell });
      if (field) { trees.set(m.id, new GoalTree(field, m.cell)); schedule(); }
    } else if (m.type === 'via') {
      // A waypoint the wearer marked: routes may be led through it. Its tree fills in behind.
      vias.set(m.id, m.cell);
      if (field && !(trees.has(m.id) && trees.get(m.id).goal[0] === m.cell[0] && trees.get(m.id).goal[1] === m.cell[1])) { trees.set(m.id, new GoalTree(field, m.cell)); schedule(); }
    } else if (m.type === 'unvia') {
      vias.delete(m.id);
      if (!waypoints.some(w => w.id === m.id) && job?.targetId !== m.id) trees.delete(m.id);
    } else if (m.type === 'cancel') job = null; // Keep warming destination caches.
    else if (m.type === 'plan') {
      job = null;
      if (!field || setupError || !trees.has(m.targetId)) self.postMessage({ type: 'result', id: m.id, version, status: 'blocked', points: [], reason: setupError || 'invalid-target' });
      else { preferred = m.targetId; job = { id: m.id, targetId: m.targetId, start: m.start, skip: m.skip ?? [] }; schedule(); }
    }
  } catch (err) {
    job = null; setupError = err.message; field = null; trees.clear();
    self.postMessage({ type: 'error', id: m.id, version, reason: err.message });
  }
};
