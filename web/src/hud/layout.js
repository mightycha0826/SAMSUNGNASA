// Where each reading's tile goes, and how it gets there. Plain arithmetic: node --test src/hud/layout.test.js
//
// The readings are not one card in a corner. Each is a tile of its own, and the tiles stand in
// two columns, left and right of what the wearer is looking at:
//   - in order of importance: the first tile is top right, the second top left, the third
//     second right, and so on. So the columns are always level, or the right one has one more:
//     when the number is odd, the right side has the say.
//   - a reading in a critical state leaves its column and comes to the middle, under the line
//     of sight, larger than the others. Only one at a time, the most important; when it is back
//     in range it returns to its column.
//   - when a reading is added or dropped, the others close up and the columns level out again.
//
// Tiles move on a spring: fast, with a small overshoot, so a change is seen without the tiles
// crossing the view for long. While a tile moves it stretches a little along the way.

/**
 * @param {{ id: string, state?: string, hDeg: number }[]} readings in order of importance, most important first
 * @param K { columnDeg, topDeg, gapDeg, focus: { yDeg, scale } } (HUD.dash)
 * @returns Map id -> { side: 'left' | 'right' | 'centre', x, y, scale }: x in degrees right of
 *          the middle of the view, y in degrees below its top edge to the tile's top edge
 */
export function arrange(readings, K) {
  const out = new Map();
  const focus = readings.find((r) => r.state === 'crit') ?? null;
  const tops = { right: K.topDeg, left: K.topDeg };
  let n = 0;
  for (const r of readings) {
    if (r === focus) {
      out.set(r.id, { side: 'centre', x: 0, y: K.focus.yDeg, scale: K.focus.scale });
      continue;
    }
    const side = n++ % 2 === 0 ? 'right' : 'left';
    out.set(r.id, { side, x: side === 'left' ? -K.columnDeg : K.columnDeg, y: tops[side], scale: 1 });
    tops[side] += r.hDeg + K.gapDeg;
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
