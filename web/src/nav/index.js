// Planetary navigation: all positions and route metrics use the map's metre frame.
// Device poses and unregistered local scans are never treated as map positions.
import { Navigation } from './controller.js';
import { cellToWorld, containsCell } from './coordinates.js';
import { createPlanningPanel } from './panel.js';
import { mode } from '../core/mode.js';

let ctx, navigation, panel, off = [];
export function init(context) {
  dispose(); ctx = context;
  const worker = new Worker(new URL('./planner.worker.js', import.meta.url), { type: 'module' });
  navigation = new Navigation({ bus: ctx.bus, worker, enabled: mode.current === 'mars',
    onRoute: route => panel?.update(route, navigation?.analysis) });
  panel = createPlanningPanel({
    plan(start, targetId) {
      if (!navigation.enabled || !navigation.transform || !containsCell(navigation.transform, start)) return false;
      navigation.setPosition(cellToWorld(navigation.transform, start));
      ctx.bus.emit('nav:request', { targetId }); return true;
    },
    stop() { navigation.cancel(); },
  });
  off.push(ctx.bus.on('layers:ready', data => {
    panel.load(data.layerSet);
    if (navigation.transform && navigation.enabled && !ctx.xr.session) {
      const base = data.layerSet.waypoints?.find(w => w.id === 'base') ?? data.layerSet.waypoints?.[0];
      if (base && containsCell(navigation.transform, base.cell)) navigation.setPosition(cellToWorld(navigation.transform, base.cell));
    }
  }));
  off.push(ctx.xr.onSessionStart(() => navigation.setPosition(null)),
    ctx.xr.onSessionEnd(() => navigation.setPosition(null)));
}
export function update(frame) { if (navigation) { panel.setVisible(!frame.session && navigation.enabled); navigation.tick(); } }
export function dispose() {
  off.forEach(fn => fn()); off = [];
  navigation?.dispose(); navigation = null; panel?.dispose(); panel = null; ctx = null;
}
