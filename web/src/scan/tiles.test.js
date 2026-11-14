// node --test src/scan/tiles.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { TILES, tileKey, parseKey, tileOfCell, inTiles, follow, cutTile, pasteTile, shiftCells, assemble, moveWindow } from './tiles.js';

const T = TILES.cells;
const COLS = T * TILES.window;
const U = 255;

// A window in which every cell says where in the world it is: a different value in each tile,
// and inside a tile a pattern that tells a row from a column. Values stay below 255 (unknown).
function worldValue(col, row) {
  const tx = Math.floor(col / T);
  const tz = Math.floor(row / T);
  return (((tx + 50) * 7 + (tz + 50) * 13) % 16) * 15 + ((col - tx * T) % 5) + 3 * ((row - tz * T) % 3);
}
// The window that starts on tile `origin`, filled from the world.
function windowAt(origin) {
  const win = new Uint8Array(COLS * COLS);
  for (let r = 0; r < COLS; r++) for (let c = 0; c < COLS; c++) win[r * COLS + c] = worldValue(origin[0] * T + c, origin[1] * T + r);
  return win;
}

test('tiles: a cell or a position belongs to one tile, also on the negative side', () => {
  assert.equal(tileOfCell(0), 0);
  assert.equal(tileOfCell(63), 0);
  assert.equal(tileOfCell(64), 1);
  assert.equal(tileOfCell(-1), -1, 'the cell left of the origin is in tile -1, not in tile 0');
  assert.equal(tileOfCell(-64), -1);
  assert.equal(tileOfCell(-65), -2);
  assert.equal(Math.floor(inTiles(6.39, 0.1)), 0);
  assert.equal(Math.floor(inTiles(6.41, 0.1)), 1);
  assert.equal(Math.floor(inTiles(-0.01, 0.1)), -1);
  assert.equal(Math.floor(inTiles(-6.41, 0.1)), -2);
  assert.ok(Math.abs(inTiles(-9.6, 0.1) + 1.5) < 1e-9, 'the middle of tile -2');
});

test('tiles: keys there and back', () => {
  assert.equal(tileKey(-3, 12), '-3,12');
  assert.deepEqual(parseKey('-3,12'), [-3, 12]);
  assert.deepEqual(parseKey(tileKey(0, -1)), [0, -1]);
  for (const bad of ['', '1', '1,2,3', 'a,b', '1.5,2', '1, 2']) assert.equal(parseKey(bad), null, `"${bad}"`);
});

test('the window starts around the wearer and stays while the wearer is in its two middle tiles', () => {
  assert.equal(follow(null, 0), -2, 'a session starts at the origin: two tiles either side');
  assert.equal(follow(null, inTiles(-7, 0.1)), -3, 'centred on the tile border nearest to the head');
  for (const headT of [-1, -0.5, 0, 0.5, 0.999]) assert.equal(follow(-2, headT), -2, `head at ${headT} tiles`);
  assert.equal(follow(-2, 1), -1, 'into the last tile: the window moves one tile on');
  assert.equal(follow(-2, -1.001), -3, 'and the same the other way');
  assert.equal(follow(-2, 7.4), 5, 'a jump (the headset found itself somewhere else) lands centred too');
});

test('the window does not move back and forth at a tile border', () => {
  // Walk in +x across the border that moves the window, then pace half a metre either side of it.
  let start = follow(null, 0);
  let moves = 0;
  const walk = (x) => {
    const next = follow(start, inTiles(x, 0.1));
    if (next !== start) moves++;
    start = next;
  };
  for (let x = 0; x <= 6.6; x += 0.1) walk(x);
  assert.equal(moves, 1);
  for (let i = 0; i < 50; i++) walk(6.4 + (i % 2 ? 0.5 : -0.5));
  assert.equal(moves, 1, 'pacing over the border that moved it does not move it again');
  // It takes a whole tile from the new centre, in either direction.
  walk(6.4 - 6.3);
  walk(6.4 + 6.3);
  assert.equal(moves, 1);
  walk(6.4 + 6.5);
  assert.equal(moves, 2);
});

test('a tile cut out of a window and pasted into another is the same cells', () => {
  const win = windowAt([-2, -2]);
  const tile = cutTile(win, COLS, 3, 1);
  assert.equal(tile.length, T * T);
  assert.equal(tile[0], worldValue(1 * T, -1 * T));
  assert.equal(tile[5 * T + 9], worldValue(1 * T + 9, -1 * T + 5));
  const other = new Uint8Array(COLS * COLS).fill(U);
  pasteTile(other, COLS, 0, 2, tile);
  assert.deepEqual(cutTile(other, COLS, 0, 2), tile);
  assert.equal(other.filter((v) => v !== U).length, tile.filter((v) => v !== U).length, 'nothing written outside the tile');
});

test('a window taken apart into tiles and laid together again is the same window', () => {
  const origin = [-3, 1];
  const win = windowAt(origin);
  const tiles = new Map();
  for (let j = 0; j < TILES.window; j++) {
    for (let i = 0; i < TILES.window; i++) tiles.set(tileKey(origin[0] + i, origin[1] + j), cutTile(win, COLS, i, j));
  }
  assert.equal(tiles.size, 16);
  assert.deepEqual(assemble((key) => tiles.get(key), origin), win);
  // One tile over, the tiles the map does not have are unknown.
  const beside = assemble((key) => tiles.get(key), [origin[0] + 1, origin[1]]);
  assert.deepEqual(cutTile(beside, COLS, 0, 0), cutTile(win, COLS, 1, 0));
  assert.ok(cutTile(beside, COLS, 3, 2).every((v) => v === U));
  assert.equal(assemble((key) => tiles.get(key), [40, 40]), null, 'no tile under the window: nothing to lay');
});

test('shiftCells moves the content in place, in every direction, and fills what comes in', () => {
  const cols = 5;
  const rows = 4;
  const base = Uint8Array.from({ length: cols * rows }, (_, i) => i + 1);
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 1], [-2, -1], [3, -2], [-1, 3], [0, 0], [5, 0], [0, -4], [9, 9]]) {
    const a = base.slice();
    shiftCells(a, cols, rows, dc, dr, 99);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const inside = c + dc >= 0 && c + dc < cols && r + dr >= 0 && r + dr < rows;
        assert.equal(a[r * cols + c], inside ? base[(r + dr) * cols + c + dc] : 99, `shift ${dc}, ${dr} at ${c}, ${r}`);
      }
    }
  }
  const wide = Int32Array.from([1, 2, 3, 4]); // any typed array: the live grid's counters
  shiftCells(wide, 2, 2, 1, 0, 0);
  assert.deepEqual([...wide], [2, 0, 4, 0]);
});

test('moving the window archives the tiles that leave and gives them back on return', () => {
  const from = [-2, -2];
  const to = [-1, -2]; // one tile in +x
  const room = windowAt(from);
  const live = windowAt(from).map((v) => v ^ 1);
  const before = { room: room.slice(), live: live.slice() };
  const archive = new Map();

  const moved = moveWindow({ room, live }, from, to, archive);
  assert.deepEqual(moved.left, ['-2,-2', '-2,-1', '-2,0', '-2,1'], 'the column of tiles on the side walked away from');
  assert.deepEqual(moved.entered, ['2,-2', '2,-1', '2,0', '2,1']);
  assert.deepEqual([...archive.keys()], moved.left);
  assert.deepEqual(archive.get('-2,0').room, cutTile(before.room, COLS, 0, 2));
  assert.deepEqual(archive.get('-2,0').live, cutTile(before.live, COLS, 0, 2));
  // What stayed is where the world says it is, seen from the new origin; what came in is unknown.
  const expected = windowAt(to);
  for (let j = 0; j < TILES.window; j++) {
    for (let i = 0; i < TILES.window - 1; i++) assert.deepEqual(cutTile(room, COLS, i, j), cutTile(expected, COLS, i, j), `tile ${i}, ${j} stayed`);
    assert.ok(cutTile(room, COLS, 3, j).every((v) => v === U), 'new ground is unknown');
    assert.ok(cutTile(live, COLS, 3, j).every((v) => v === U));
  }

  // Back again: the archive hands the tiles back and no longer holds them.
  const back = moveWindow({ room, live }, to, from, archive);
  assert.deepEqual(back.entered, moved.left);
  assert.equal(archive.size, 0, 'the tiles that left on the way back were never seen: nothing to keep');
  assert.deepEqual(room, before.room);
  assert.deepEqual(live, before.live);
});

test('a diagonal move and a jump clear of the old window keep every tile that held something', () => {
  const from = [0, 0];
  const room = windowAt(from);
  const live = new Uint8Array(COLS * COLS).fill(U);
  const before = room.slice();
  const archive = new Map();
  const diagonal = moveWindow({ room, live }, from, [1, -1], archive);
  assert.equal(diagonal.left.length, 7, 'one row and one column of tiles');
  assert.equal(diagonal.entered.length, 7);
  assert.equal(archive.size, 7);
  assert.deepEqual(cutTile(room, COLS, 0, 1), cutTile(before, COLS, 1, 0), 'world tile 1, 0 is now the window tile 0, 1');
  // Far away: every tile leaves. The nine that stayed until now go into the archive as well.
  const jump = moveWindow({ room, live }, [1, -1], [20, 20], archive);
  assert.equal(jump.left.length, 16);
  assert.equal(archive.size, 16, 'the 16 tiles of the first window; the unknown ones in between are not kept');
  assert.ok(room.every((v) => v === U));
  // And all the way back: the first window, cell for cell.
  moveWindow({ room, live }, [20, 20], from, archive);
  assert.deepEqual(room, before);
  assert.equal(archive.size, 0);
});

test('a layer with state of its own is moved and laid back through its own functions', () => {
  const room = windowAt([0, 0]);
  const live = windowAt([0, 0]);
  const archive = new Map();
  const calls = [];
  const own = { live: { shift: (dc, dr) => calls.push(['shift', dc, dr]), paste: (col, row, tile) => calls.push(['paste', col, row, tile.length]) } };
  moveWindow({ room, live }, [0, 0], [0, 1], archive, own);
  assert.deepEqual(calls, [['shift', 0, T]]);
  calls.length = 0;
  moveWindow({ room, live }, [0, 1], [0, 0], archive, own);
  assert.deepEqual(calls, [['shift', 0, -T], ['paste', 0, 0, T * T], ['paste', T, 0, T * T], ['paste', 2 * T, 0, T * T], ['paste', 3 * T, 0, T * T]]);
});
