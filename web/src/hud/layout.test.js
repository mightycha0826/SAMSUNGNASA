// node --test src/hud/layout.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { arrange, spring, stretch } from './layout.js';

const K = { columnDeg: 19, topDeg: 18, gapDeg: 0.6, focus: { yDeg: 31, scale: 1.2 } };
const tiles = (n, crit = null) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, hDeg: 4, state: i === crit ? 'crit' : '' }));
const sides = (map) => {
  const count = { left: 0, right: 0, centre: 0 };
  for (const p of map.values()) count[p.side]++;
  return count;
};

test('the columns are level, or the right one has one more, for any number of readings', () => {
  for (let n = 0; n <= 9; n++) {
    const c = sides(arrange(tiles(n), K));
    assert.equal(c.left + c.right, n);
    assert.ok(c.right === c.left || c.right === c.left + 1, `${n} readings: ${c.left} left, ${c.right} right`);
  }
});

test('the most important readings are at the top: first top right, second top left', () => {
  const at = arrange(tiles(5), K);
  assert.deepEqual([at.get('r0').side, at.get('r0').y], ['right', 18]);
  assert.deepEqual([at.get('r1').side, at.get('r1').y], ['left', 18]);
  assert.deepEqual([at.get('r2').side, at.get('r2').y], ['right', 18 + 4 + 0.6]);
  assert.ok(Math.abs(at.get('r4').y - (18 + 2 * 4.6)) < 1e-9);
  assert.equal(at.get('r0').x, 19);
  assert.equal(at.get('r1').x, -19);
});

test('tiles of different heights stack without gaps or overlaps', () => {
  const at = arrange([{ id: 'a', hDeg: 4 }, { id: 'b', hDeg: 6 }, { id: 'c', hDeg: 5.5 }, { id: 'd', hDeg: 4 }], K);
  assert.equal(at.get('c').y, 18 + 4 + 0.6); // under a
  assert.equal(at.get('d').y, 18 + 6 + 0.6); // under b
});

test('a critical reading comes to the middle, and the rest level out without it', () => {
  const at = arrange(tiles(5, 0), K); // the first one is critical
  assert.deepEqual(at.get('r0'), { side: 'centre', x: 0, y: 31, scale: 1.2 });
  assert.deepEqual(sides(at), { left: 2, right: 2, centre: 1 });
  assert.deepEqual([at.get('r1').side, at.get('r1').y], ['right', 18], 'the next one takes the top right place');
  // Only one at a time: the most important of two critical ones.
  const two = arrange([{ id: 'a', hDeg: 4, state: 'crit' }, { id: 'b', hDeg: 4, state: 'crit' }, { id: 'c', hDeg: 4 }], K);
  assert.equal(two.get('a').side, 'centre');
  assert.equal(two.get('b').side, 'right');
});

test('the spring gets there fast, overshoots a little, and comes to rest exactly', () => {
  const S = { stiffness: 260, damping: 22 };
  const s = { x: 0, v: 0 };
  let peak = 0;
  let at90 = null;
  for (let t = 0; t < 2; t += 1 / 72) {
    spring(s, 10, 1 / 72, S);
    peak = Math.max(peak, s.x);
    if (at90 === null && s.x >= 9) at90 = t;
  }
  assert.ok(at90 !== null && at90 < 0.2, `90 % of the way after ${at90} s`);
  assert.ok(peak > 10.05 && peak < 11, `overshoot to ${peak.toFixed(2)}`);
  assert.deepEqual([s.x, s.v], [10, 0]);
  // A frame of a tenth of a second does not send it flying.
  const slow = { x: 0, v: 0 };
  for (let k = 0; k < 20; k++) spring(slow, 10, 0.1, S);
  assert.ok(Math.abs(slow.x - 10) < 0.01);
});

test('a tile stretches along the way it moves, a little, and not at rest', () => {
  assert.deepEqual(stretch(0, 0, 0.06, 60), [1, 1]);
  const [sx, sy] = stretch(60, 0, 0.06, 60);
  assert.ok(Math.abs(sx - 1.06) < 1e-9 && Math.abs(sy - 0.97) < 1e-9);
  const [fx] = stretch(600, 0, 0.06, 60);
  assert.ok(Math.abs(fx - 1.06) < 1e-9, 'never more than the amount');
  const [, uy] = stretch(0, -30, 0.06, 60);
  assert.ok(uy > 1 && uy < 1.04);
});

test('a reading that asks for it comes to the middle before it is critical (the ambient temperature when its alert sounds)', () => {
  const list = [{ id: 'battery', hDeg: 4 }, { id: 'o2', hDeg: 4 }, { id: 'ambient', hDeg: 4, state: 'warn', focus: true }, { id: 'heart', hDeg: 4 }];
  const at = arrange(list, K);
  assert.equal(at.get('ambient').side, 'centre');
  assert.deepEqual(sides(at), { left: 1, right: 2, centre: 1 });
  // A critical reading earlier in the list still goes first.
  const both = arrange([{ id: 'o2', hDeg: 4, state: 'crit' }, ...list.slice(2)], K);
  assert.equal(both.get('o2').side, 'centre');
  assert.notEqual(both.get('ambient').side, 'centre');
});
