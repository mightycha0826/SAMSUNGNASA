// node --test src/scan/overlay.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { initOverlay, outlineField } from './overlay.js';
import { setMode } from '../core/mode.js';

const X = 1;
const U = 255;

test('the outline field is 128 between obstacle and floor, higher inside, lower outside', () => {
  // A block 4 wide and 3 deep against two borders of an 8 x 5 grid.
  const cells = Uint8Array.from([
    X, X, X, X, 0, 0, 0, 0,
    X, X, X, X, 0, U, 0, 0,
    X, X, X, X, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  const f = outlineField(cells, 8, 5, 2.5);
  const at = (col, row) => f[row * 8 + col];
  // The cell just inside the edge and the one just outside sit equally far either side of 128.
  assert.equal(at(3, 1) + at(4, 1), 255);
  assert.ok(at(3, 1) > 128 && at(4, 1) < 128);
  assert.ok(at(2, 1) > at(3, 1), 'deeper inside is higher');
  assert.ok(at(5, 1) < at(4, 1) && at(6, 1) < at(5, 1), 'farther outside is lower');
  assert.equal(at(7, 4), 0, 'far from any obstacle: nothing is drawn');
  assert.equal(at(5, 1), at(5, 2), 'unknown floor is outside like any other floor');
  // The grid's border is not an outline: a block against it stays "inside" up to the border.
  assert.ok(at(0, 0) >= at(1, 1));
});

test('a wall one cell wide still reaches above 128, so it gets its outline', () => {
  const cells = new Uint8Array(7 * 7);
  for (let r = 0; r < 7; r++) cells[r * 7 + 3] = X;
  const f = outlineField(cells, 7, 7, 2.5);
  assert.ok(f[3 * 7 + 3] > 128);
  assert.ok(f[3 * 7 + 2] < 128 && f[3 * 7 + 4] < 128);
  assert.equal(f[3 * 7 + 2], f[3 * 7 + 4]);
});

test('the highlight lies on the floor where the grid is and shows in field mode only', () => {
  const on = {};
  let mesh;
  initOverlay({ bus: { on: (name, fn) => (on[name] = fn) }, scene: { add: (m) => (mesh = m) } }, { glowRGB: [255, 48, 48], glintRGB: [255, 214, 208] });
  const emit = (cols, rows, cells) => on['hazard:update']({ originXZ: [-1, -2], cellSizeM: 0.5, cols, rows, cells: Uint8Array.from(cells) });
  emit(8, 5, new Array(40).fill(0).map((_, i) => (i < 4 ? X : 0)));
  const field = () => mesh.material.uniforms.field.value.image;
  assert.deepEqual([field().width, field().height, field().data.length], [8, 5, 40]);
  assert.ok(field().data[0] > 128 && field().data[39] === 0);
  // Cell [0, 0] lies at originXZ and the picture covers the grid.
  assert.deepEqual([mesh.scale.x, mesh.scale.z, mesh.position.x, mesh.position.z], [4, 2.5, 1, -0.75]);

  assert.equal(mesh.visible, false);
  setMode('field');
  on['app:mode']();
  assert.equal(mesh.visible, true);

  // Another grid size (web/src/nav/browser.test.cjs feeds several): a new picture, no error.
  emit(3, 2, [X, X, X, X, X, X]);
  assert.deepEqual([field().width, field().height, field().data.length], [3, 2, 6]);
  assert.ok(field().data.every((v) => v > 128));
});
