// node --test src/core/palm.test.js
// palmOf() calls a palm "up" below PALM.upDot, and the field map and the suit view come up on
// that (core/hologram.js). The layer menu stands beside the map and has to come up at the same
// hand tilt, so its limit is that number and not a copy of it.
import test from 'node:test';
import assert from 'node:assert/strict';

test('the layer menu comes up at PALM.upDot, the hand tilt at which the field map comes up', async () => {
  globalThis.location ??= { search: '' }; // hud/config.js reads the address bar as it loads
  const { PALM } = await import('./palm.js');
  const { HUD } = await import('../hud/config.js');
  assert.equal(typeof PALM.upDot, 'number');
  assert.equal(HUD.layers.palmUpDot, PALM.upDot);
});
