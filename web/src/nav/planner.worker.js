import { buildTerrain, combineCosts } from './costs.js';
import { GoalTree } from './goal-tree.js';
import { Search } from './planner.js';

let terrain = null, hazard = null, field = null, version = 0, job = null;
let scheduled = false, setupError = '', waypoints = [], trees = new Map(), preferred = null;
const workQueue = new MessageChannel();
workQueue.port1.onmessage = run;
function rebuild() { trees = new Map(waypoints.map(w => [w.id, new GoalTree(field, w.cell)])); }
// MessageChannel yields to incoming scans without nested setTimeout's 4ms clamp.
function schedule() { if (!scheduled) { scheduled = true; workQueue.port2.postMessage(null); } }
function run() {
  scheduled = false;
  if (job) {
    const tree = trees.get(job.targetId);
    if (tree.done) {
      self.postMessage({ type: 'result', id: job.id, version, ...tree.path(job.start) }); job = null;
    } else {
      // A busy cache must not delay live guidance. A* obtains the current exact
      // 8-way route; destination-wide repair continues afterwards for reuse.
      job.search ??= new Search(field, job.start, tree.goal);
      job.search.step(2048, 6);
      if (job.search.done) {
        self.postMessage({ type: 'result', id: job.id, version, ...job.search.result }); job = null;
      }
      schedule(); return;
    }
  }
  // Requested destination first; other destination caches warm in the background.
  const entry = preferred && !trees.get(preferred)?.done ? [preferred, trees.get(preferred)] : [...trees.entries()].find(([, t]) => !t.done);
  const active = entry?.[1];
  if (!active) return;
  if (!active.done) active.step(2048, 6);
  // A small edit near a bottleneck can invalidate most of the tree. Bound the
  // expensive repair work, then use the cheaper full reverse Dijkstra pass.
  if (!active.done && !active.initial && active.stats.expanded > field.costs.length / 4) {
    trees.set(entry[0], new GoalTree(field, active.goal)); schedule(); return;
  }
  if ([...trees.values()].some(t => !t.done)) schedule();
}
self.onmessage = ({ data: m }) => {
  try {
    if (m.type === 'setup') {
      job = null; version = m.version; setupError = ''; preferred = null;
      terrain = buildTerrain(m.layerSet, m.grids); field = combineCosts(terrain, hazard);
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
    } else if (m.type === 'cancel') job = null; // Keep warming destination caches.
    else if (m.type === 'plan') {
      job = null;
      if (!field || setupError || !trees.has(m.targetId)) self.postMessage({ type: 'result', id: m.id, version, status: 'blocked', points: [], reason: setupError || 'invalid-target' });
      else { preferred = m.targetId; job = { id: m.id, targetId: m.targetId, start: m.start }; schedule(); }
    }
  } catch (err) {
    job = null; setupError = err.message; field = null; trees.clear();
    self.postMessage({ type: 'error', id: m.id, version, reason: err.message });
  }
};
