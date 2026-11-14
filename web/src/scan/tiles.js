// The floor in tiles, so the field map has no edge. Pure arithmetic, no three.js and no browser:
// node --test src/scan/tiles.test.js
//
// The floor of the world is cut into square tiles of TILES.cells x TILES.cells cells (6.4 m at
// 10 cm cells). Tile (tx, tz) covers x from tx * 6.4 m up to, not including, (tx + 1) * 6.4 m,
// and z likewise; tx and tz are negative behind and to the left of the room origin.
//
// The scan (index.js) works on a dense window of TILES.window x TILES.window tiles that starts
// on a tile border and follows the wearer (follow). When the window moves, the tiles that fall
// out of it are kept in an archive and the ones that come in are taken back from it
// (moveWindow), so the map is as large as the ground the wearer has covered. The hub stores
// the same tiles, one by one (memory.js, jetson/marswalk/maps.py).

const UNKNOWN = 255; // a cell nothing is known about, as in grid.js (which builds on this file)

export const TILES = {
  cells: 64, // cells per side of a tile
  window: 4, // tiles per side of the dense window (even, so its centre is a tile border)
};

/** The archive's and the hub's name for tile (tx, tz). */
export const tileKey = (tx, tz) => `${tx},${tz}`;

/** [tx, tz] back from a key, or null when it is not one. */
export function parseKey(key) {
  const found = /^(-?\d+),(-?\d+)$/.exec(key);
  return found ? [Number(found[1]), Number(found[2])] : null;
}

/** The tile that holds cell number `cell` along one axis. Cell -1 is in tile -1, not in tile 0. */
export const tileOfCell = (cell, tileCells = TILES.cells) => Math.floor(cell / tileCells);

/** Where a position in metres lies along one axis, in tiles: 1.5 is the middle of tile 1. */
export const inTiles = (m, cellM, tileCells = TILES.cells) => m / (cellM * tileCells);

/**
 * How far from the window's centre the head may be, in tiles, before the window moves. With a
 * window of four tiles that leaves 1.4 tiles (9 m) of map on every side of the wearer, about
 * what the palm map shows around them (10 m).
 */
export const FOLLOW_SLACK = 0.6;

/**
 * Where the window starts along one axis, in tiles, for a head at `headT` (inTiles).
 * It stays where it is while the head is within FOLLOW_SLACK of its centre. Once the head is
 * farther out, the window is put down again with its centre on the tile border nearest to the
 * head. It does not move back and forth: right after a move the head is within half a tile of
 * the centre, and it takes most of a tile of walking, in either direction, before the window
 * moves again.
 * @param start where it starts now, or null when there is no window yet
 */
export function follow(start, headT, windowTiles = TILES.window) {
  const half = windowTiles / 2;
  if (start !== null && headT >= start + half - FOLLOW_SLACK && headT < start + half + FOLLOW_SLACK) return start;
  return Math.round(headT) - half;
}

/** Tile (i, j) of a window, counted from the window's first tile, copied out. */
export function cutTile(win, cols, i, j, tileCells = TILES.cells) {
  const tile = new Uint8Array(tileCells * tileCells);
  for (let r = 0; r < tileCells; r++) {
    const from = (j * tileCells + r) * cols + i * tileCells;
    tile.set(win.subarray(from, from + tileCells), r * tileCells);
  }
  return tile;
}

/** A tile written into a window at tile position (i, j). */
export function pasteTile(win, cols, i, j, tile, tileCells = TILES.cells) {
  for (let r = 0; r < tileCells; r++) {
    win.set(tile.subarray(r * tileCells, (r + 1) * tileCells), (j * tileCells + r) * cols + i * tileCells);
  }
}

/**
 * Move the content of a cols x rows array by whole cells, in place: what was at column
 * c + dCols, row r + dRows is at (c, r) afterwards, and cells with nothing to take get `fill`.
 * Works on any typed array, so the live grid moves its counters with it (grid.js).
 */
export function shiftCells(a, cols, rows, dCols, dRows, fill) {
  if (!dCols && !dRows) return;
  if (Math.abs(dCols) >= cols || Math.abs(dRows) >= rows) {
    a.fill(fill);
    return;
  }
  // Rows are taken in the order in which the row read has not been written yet.
  const first = dRows > 0 ? 0 : rows - 1;
  const step = dRows > 0 ? 1 : -1;
  const c0 = Math.max(0, -dCols); // the columns that have something to take
  const c1 = Math.min(cols, cols - dCols);
  for (let r = first; r >= 0 && r < rows; r += step) {
    const at = r * cols;
    const src = r + dRows;
    if (src < 0 || src >= rows) {
      a.fill(fill, at, at + cols);
      continue;
    }
    a.copyWithin(at + c0, src * cols + c0 + dCols, src * cols + c1 + dCols);
    a.fill(fill, at, at + c0);
    a.fill(fill, at + c1, at + cols);
  }
}

/** A window laid together from tiles: `tileAt(key)` gives a tile's cells, or nothing. Null when no tile was there. */
export function assemble(tileAt, originTile, { cells: tileCells, window } = TILES) {
  const cols = tileCells * window;
  let win = null;
  for (let j = 0; j < window; j++) {
    for (let i = 0; i < window; i++) {
      const tile = tileAt(tileKey(originTile[0] + i, originTile[1] + j));
      if (!tile) continue;
      win ??= new Uint8Array(cols * cols).fill(UNKNOWN);
      pasteTile(win, cols, i, j, tile, tileCells);
    }
  }
  return win;
}

/**
 * Move a window from the tile it starts on (`from`) to another (`to`), with everything in it.
 *
 * layers: { name: Uint8Array } of window size, e.g. { room, live }. Each is shifted in place.
 * archive: Map of tileKey -> { name: Uint8Array(tile) }. A tile that leaves the window goes in
 *   with all its layers, unless nothing is known in any of them. A tile that comes in is laid
 *   back from the archive and taken out of it (the window holds it from then on); what the
 *   archive does not have comes in as UNKNOWN.
 * own: a layer that carries more than its cells (the live grid and its counters) names here how
 *   it is moved and laid back: { name: { shift(dCols, dRows), paste(col, row, tile) } }.
 *
 * Returns the keys of the tiles that left and of those that came in.
 */
export function moveWindow(layers, from, to, archive, own = {}, { cells: tileCells, window } = TILES) {
  const cols = tileCells * window;
  const names = Object.keys(layers);
  const outside = (start, tx, tz) => tx < start[0] || tz < start[1] || tx >= start[0] + window || tz >= start[1] + window;
  const left = [];
  const entered = [];

  for (let j = 0; j < window; j++) {
    for (let i = 0; i < window; i++) {
      const tx = from[0] + i;
      const tz = from[1] + j;
      if (!outside(to, tx, tz)) continue;
      left.push(tileKey(tx, tz));
      const entry = {};
      let known = false;
      for (const name of names) {
        entry[name] = cutTile(layers[name], cols, i, j, tileCells);
        known ||= entry[name].some((cell) => cell !== UNKNOWN);
      }
      if (known) archive.set(tileKey(tx, tz), entry);
    }
  }

  const dCols = (to[0] - from[0]) * tileCells;
  const dRows = (to[1] - from[1]) * tileCells;
  for (const name of names) {
    if (own[name]) own[name].shift(dCols, dRows);
    else shiftCells(layers[name], cols, cols, dCols, dRows, UNKNOWN);
  }

  for (let j = 0; j < window; j++) {
    for (let i = 0; i < window; i++) {
      const tx = to[0] + i;
      const tz = to[1] + j;
      if (!outside(from, tx, tz)) continue;
      const key = tileKey(tx, tz);
      entered.push(key);
      const entry = archive.get(key);
      if (!entry) continue;
      for (const name of names) {
        if (!entry[name]) continue;
        if (own[name]) own[name].paste(i * tileCells, j * tileCells, entry[name]);
        else pasteTile(layers[name], cols, i, j, entry[name], tileCells);
      }
      archive.delete(key);
    }
  }
  return { left, entered };
}
