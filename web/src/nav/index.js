// Planetary navigation: all positions and route metrics use the map's metre frame.
// Unregistered local scans are never treated as map data. The wearer's map position is supplied in
// map metres (nav:position from field/, or the panel's start cell).
import { Navigation } from './controller.js';
import { cellToWorld, containsCell } from './coordinates.js';
import { createPlanningPanel } from './panel.js';

let ctx, navigation, panel, off = [];
export function init(context) {
  dispose(); ctx = context;
  const worker = new Worker(new URL('./planner.worker.js', import.meta.url), { type: 'module' });
  navigation = new Navigation({ bus: ctx.bus, worker, onRoute: route => panel?.update(route, navigation?.analysis) });
  panel = createPlanningPanel({
    plan(start, targetId) {
      if (!navigation.transform || !containsCell(navigation.transform, start)) return false;
      navigation.setPosition(cellToWorld(navigation.transform, start));
      ctx.bus.emit('nav:request', { targetId }); return true;
    },
    stop() { navigation.cancel(); },
  });
  off.push(ctx.bus.on('layers:ready', data => {
    panel.load(data.layerSet);
    if (navigation.transform) {
      const base = data.layerSet.waypoints?.find(w => w.id === 'base') ?? data.layerSet.waypoints?.[0];
      if (base && containsCell(navigation.transform, base.cell)) navigation.setPosition(cellToWorld(navigation.transform, base.cell));
    }
  }));
}
export function update(frame) { if (navigation) { panel.setVisible(!frame.session); navigation.tick(); } }
export function dispose() {
  off.forEach(fn => fn()); off = [];
  navigation?.dispose(); navigation = null; panel?.dispose(); panel = null; ctx = null;
}
