// Radiation alert (role B, P1). Decided from the env.json samples that the loader replays as
// `env:update` (docs/INTERFACES.md section 3, alert id "radiation").
//
// Thresholds are dose rates in µGy/day. For scale: Curiosity RAD measured about 152-157 µGy/day
// at the survey site on sol 4200 (docs/DATA.md), and published quiet-time values for Gale Crater
// are about 180-225 µGy/day. So ordinary values raise nothing; an alert means a real rise such
// as a solar particle event. Change them with ?radWarn= and ?radCrit=.

import { bus } from './bus.js';

const q = new URLSearchParams(location.search);
export const RADIATION = {
  warnUGyPerDay: Number(q.get('radWarn')) || 300,
  criticalUGyPerDay: Number(q.get('radCrit')) || 600,
  /** The alert clears only below this fraction of the warn threshold, so it does not flap. */
  clearRatio: 0.9,
};

const MESSAGES = { warn: 'Radiation is rising', critical: 'Radiation is critical' };
const RANK = { null: 0, warn: 1, critical: 2 };

export function initRadiation() {
  let level = null;
  bus.on('env:update', ({ radiationUGyPerDay: r }) => {
    if (typeof r !== 'number' || Number.isNaN(r)) return;
    const target =
      r >= RADIATION.criticalUGyPerDay ? 'critical' : r >= RADIATION.warnUGyPerDay ? 'warn' : null;
    if (level && r < RADIATION.warnUGyPerDay * RADIATION.clearRatio) {
      level = null;
      bus.emit('alert:clear', { id: 'radiation' });
      return;
    }
    if (target && RANK[target] > RANK[level]) {
      level = target;
      bus.emit('alert:raise', { id: 'radiation', level, message: MESSAGES[level], ts: Date.now() });
      // Spoken by the hub; the suit-temperature alert is spoken by the hub on its own.
      bus.emit('voice:say', { text: MESSAGES[level], priority: level === 'critical' ? 'urgent' : 'normal' });
    }
  });
}
