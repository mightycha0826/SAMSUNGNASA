// Where each reading's tile goes, and how it gets there. Plain arithmetic: node --test src/hud/layout.test.js
//
// The readings are not one card in a corner. Each is a tile of its own, and the tiles stand in
// two columns, left and right of what the wearer is looking at:
//   - in order of importance: the first tile is top right, the second top left, the third
//     second right, and so on. So the columns are always level, or the right one has one more:
//     when the number is odd, the right side has the say.
//   - a reading in a critical state (or one that asks for it: `focus`, the ambient temperature
//     as soon as its alert sounds) leaves its column and comes to the middle, under the line
//     of sight, larger than the others. Only one at a time, the most important; when it is back
//     in range it returns to its column.
//   - when a reading is added or dropped, the others close up and the columns level out again.
//   - a tile's size follows its importance (sizeOf): what matters more is larger. The columns
//     stay tidy all the same: inner edges on one line, no gaps, no overlaps.
//
// Tiles move on a spring: fast, with a small overshoot, so a change is seen without the tiles
// crossing the view for long. While a tile moves it stretches a little along the way.

/**
 * How large a reading's tile is drawn, from how much it matters: 1 is the size of a pinned
 * reading with nothing wrong. A pinned reading out of range grows; another reading is between
 * `min` (it only just matters enough to be shown) and `max` (it matters as much as a warning).
 * @param m { pinned, state } and `score`, its importance (importance.js)
 * @param Z { min, max, fromScore, toScore, warn } (HUD.dash.size)
 */
export function sizeOf(m, Z) {
  if (m.pinned) return m.state === 'warn' || m.state === 'crit' ? Z.warn : 1;
  const t = Math.max(0, Math.min(1, ((m.score ?? 0) - Z.fromScore) / (Z.toScore - Z.fromScore)));
  return Z.min + (Z.max - Z.min) * t;
}

/**
 * @param {{ id: string, state?: string, focus?: boolean, hDeg: number, scale?: number }[]} readings in order of
 *        importance, most important first; `scale` is the size of its tile (sizeOf), 1 if not given
 * @param K { tileWDeg, innerDeg, topDeg, gapDeg, focus: { yDeg, scale } } (HUD.dash)
 * @returns Map id -> { side: 'left' | 'right' | 'centre', x, y, scale }: x in degrees right of
 *          the middle of the view to the tile's middle, y in degrees below the top edge of the
 *          view to the tile's top edge
 *
 * Tiles of different sizes still make two tidy columns: in each column the tiles' inner edges
 * (the ones toward the middle of the view) stand on one line, innerDeg from the middle, and
 * each tile starts where the one above it ends.
 */
export function arrange(readings, K) {
  const out = new Map();
  const focus = readings.find((r) => r.focus || r.state === 'crit') ?? null;
  const tops = { right: K.topDeg, left: K.topDeg };
  let n = 0;
  for (const r of readings) {
    if (r === focus) {
      out.set(r.id, { side: 'centre', x: 0, y: K.focus.yDeg, scale: K.focus.scale });
      continue;
    }
    const side = n++ % 2 === 0 ? 'right' : 'left';
    const scale = r.scale ?? 1;
    const middle = K.innerDeg + (K.tileWDeg * scale) / 2;
    out.set(r.id, { side, x: side === 'left' ? -middle : middle, y: tops[side], scale });
    tops[side] += r.hDeg * scale + K.gapDeg;
  }
  return out;
}

/**
 * One step of a spring toward `target`: s = { x, v } is moved in place. Small steps inside, so
 * a long frame does not blow it up.
 * @param K { stiffness, damping }: 260 and 22 settle in about a quarter of a second with an overshoot of a few percent
 */
export function spring(s, target, dt, K) {
  let left = Math.min(dt, 0.1);
  while (left > 1e-6) {
    const h = Math.min(left, 1 / 240);
    s.v += (-K.stiffness * (s.x - target) - K.damping * s.v) * h;
    s.x += s.v * h;
    left -= h;
  }
  if (Math.abs(s.x - target) < 1e-4 && Math.abs(s.v) < 1e-3) {
    s.x = target;
    s.v = 0;
  }
  return s;
}

/**
 * How a tile is stretched while it moves: [along x, along y], 1 at rest. It grows along the
 * way it travels and thins across it, by at most `amount` at speed `fullAt` (degrees a second).
 */
export function stretch(vx, vy, amount, fullAt) {
  const speed = Math.hypot(vx, vy);
  if (speed < 1e-6) return [1, 1];
  const k = amount * Math.min(1, speed / fullAt);
  const ax = Math.abs(vx) / speed;
  const ay = Math.abs(vy) / speed;
  return [1 + k * (ax - ay * 0.5), 1 + k * (ay - ax * 0.5)];
}
