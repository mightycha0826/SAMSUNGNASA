// node --test src/scan/memory.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeRuns, decodeRuns, decodeTiles, compare, linesUp, fillUnknown } from './memory.js';

const N = 60;
// A room: unknown everywhere, a square of walls with floor inside, shifted by (dx, dz) cells.
function room(dx = 0, dz = 0) {
  const cells = new Uint8Array(N * N).fill(255);
  for (let r = 10; r <= 50; r++) {
    for (let c = 10; c <= 50; c++) {
      const cc = c + dx;
      const rr = r + dz;
      if (cc < 0 || rr < 0 || cc >= N || rr >= N) continue;
      cells[rr * N + cc] = r === 10 || r === 50 || c === 10 || c === 50 ? 1 : 0;
    }
  }
  return cells;
}

test('runs: there and back', () => {
  const cells = room();
  const runs = encodeRuns(cells);
  assert.ok(runs.length < 400, `a room should be a few hundred numbers, got ${runs.length}`);
  assert.deepEqual(decodeRuns(runs, N * N), cells);
});

test('runs: anything that is not a whole grid of 0, 1, 255 is refused', () => {
  assert.equal(decodeRuns([0, 10], N * N), null); // too short
  assert.equal(decodeRuns([0, N * N + 1], N * N), null); // too long
  assert.equal(decodeRuns([7, N * N], N * N), null); // not a cell value
  assert.equal(decodeRuns([0, -1, 0, N * N + 1], N * N), null);
  assert.equal(decodeRuns('x', N * N), null);
});

test('stored tiles come back by their key; what is not a whole tile is left out', () => {
  const tile = new Uint8Array(16).fill(255).fill(1, 3, 7);
  const tiles = decodeTiles(
    [
      { x: -2, z: 5, runs: encodeRuns(tile) },
      { x: 0, z: 0, runs: [0, 16] },
      { x: 1, z: 0, runs: [0, 15] }, // a cell short
      { x: 1.5, z: 0, runs: [0, 16] }, // not a tile
      { z: 0, runs: [0, 16] },
      null,
    ],
    4,
  );
  assert.deepEqual([...tiles.keys()], ['-2,5', '0,0']);
  assert.deepEqual(tiles.get('-2,5'), tile);
  assert.equal(decodeTiles('x', 4).size, 0);
});

test('the same room lines up, also one cell off', () => {
  assert.equal(linesUp(room(), room(), N, N), true);
  assert.equal(linesUp(room(), room(1, 0), N, N), true);
});

test('a room seen from another origin does not line up', () => {
  const c = compare(room(), room(6, 4), N, N);
  assert.ok(c.score < 0.5, JSON.stringify(c));
  assert.equal(linesUp(room(), room(6, 4), N, N), false);
});

test('too little seen so far: not yet', () => {
  const current = new Uint8Array(N * N).fill(255);
  for (let c = 10; c <= 40; c++) current[10 * N + c] = 1; // 31 cells of one wall
  assert.equal(linesUp(room(), current, N, N), false);
  for (let r = 10; r <= 50; r++) current[r * N + 10] = 1; // and a second wall
  assert.equal(linesUp(room(), current, N, N), true);
});

test('the stored map only fills what the new scan has not seen', () => {
  const stored = room();
  stored[30 * N + 30] = 1; // a chair seen earlier, in the middle of the floor
  stored[20 * N + 20] = 1; // another one
  const current = new Uint8Array(N * N).fill(255);
  current[20 * N + 20] = 0; // the new scan sees clear floor where the second chair stood
  const filled = fillUnknown(current, stored);
  assert.equal(current[30 * N + 30], 1, 'the chair nobody has looked at since is still there');
  assert.equal(current[20 * N + 20], 0, 'what is seen now wins');
  assert.ok(filled > 1000);
});
