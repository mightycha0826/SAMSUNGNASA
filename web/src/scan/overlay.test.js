// node --test src/scan/overlay.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { initOverlay } from './overlay.js';
import { setMode } from '../core/mode.js';

test('obstacles are drawn as a solid rim around a faint inside; the picture follows the grid it is given', () => {
  const on = {};
  let mesh;
  initOverlay({ bus: { on: (name, fn) => (on[name] = fn) }, scene: { add: (m) => (mesh = m) } }, { edgeRGBA: [255, 0, 0, 200], fillRGBA: [255, 0, 0, 50] });
  const emit = (cols, rows, cells) => on['hazard:update']({ originXZ: [-1, -2], cellSizeM: 0.5, cols, rows, cells: Uint8Array.from(cells) });
  const X = 1;
  const U = 255;
  // A block 4 wide and 3 deep against two borders, and one cell at the right end of the first
  // row: next to the block's left column in the array, but not on the floor.
  emit(8, 5, [
    X, X, X, X, 0, 0, 0, X,
    X, X, X, X, 0, U, 0, 0,
    X, X, X, X, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  const alpha = (col, row, cols = 8) => mesh.material.map.image.data[(row * cols + col) * 4 + 3];
  assert.deepEqual([alpha(1, 1), alpha(2, 1)], [50, 50]); // inside
  assert.equal(alpha(0, 1), 200); // on the grid's border: rim, whatever sits at the end of the row above
  assert.deepEqual([alpha(3, 1), alpha(1, 0), alpha(2, 2), alpha(7, 0)], [200, 200, 200, 200]); // rim
  assert.deepEqual([alpha(4, 1), alpha(5, 1), alpha(0, 3)], [0, 0, 0]); // floor and unknown are not drawn
  // Cell [0, 0] lies at originXZ and the picture covers the grid.
  assert.deepEqual([mesh.scale.x, mesh.scale.z, mesh.position.x, mesh.position.z], [4, 2.5, 1, -0.75]);

  // Shown in field mode only.
  assert.equal(mesh.visible, false);
  setMode('field');
  on['app:mode']();
  assert.equal(mesh.visible, true);

  // Another grid size (web/src/nav/browser.test.cjs feeds several): a new picture, no error.
  emit(3, 2, [X, X, X, X, X, X]);
  assert.equal(mesh.material.map.image.data.length, 3 * 2 * 4);
  assert.ok([0, 1, 2].every((col) => alpha(col, 0, 3) === 200 && alpha(col, 1, 3) === 200));
});
