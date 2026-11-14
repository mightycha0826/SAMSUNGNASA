// Which experience the wearer chose on the start page.
//
//   mars   the Mars map: NASA terrain on the palm, route planning between the base and the
//          survey site, and the wearer's walking mirrored on the map
//   field  the field map: the headset's own scan of the room becomes the map; the wearer marks
//          a spot by voice ("Mark target") and is guided back to it by arrows on the floor
//
// Modules read `mode.current` and listen for `app:mode` { mode } on the bus.

import { bus } from './bus.js';

export const mode = { current: 'mars' };

export function setMode(next) {
  if (next !== 'mars' && next !== 'field') return;
  if (mode.current === next) return;
  mode.current = next;
  bus.emit('app:mode', { mode: next });
}
