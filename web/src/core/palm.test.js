// node --test src/core/palm.test.js
// The maps come up over the left palm at PALM.upDot (core/hologram.js); the layer menu stands
// beside them and has to come up at the same hand tilt.
import test from 'node:test';
import assert from 'node:assert/strict';

test('the layer menu comes up at the same hand tilt as the maps: one number, PALM.upDot', async () => {
  globalThis.location ??= { search: '' }; // hud/config.js reads the address bar as it loads
  const { PALM } = await import('./palm.js');
  const { HUD } = await import('../hud/config.js');
  assert.equal(typeof PALM.upDot, 'number');
  assert.equal(HUD.layers.palmUpDot, PALM.upDot);
});
