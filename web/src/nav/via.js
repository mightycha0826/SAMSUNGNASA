// Waypoints on the way: which marked waypoints a route should pass, and in what order.
//
// The planner keeps, for every destination, the cost of reaching it from every cell (a goal
// tree). So the cost of any leg between two places that have a tree is one lookup, and the
// question "does going through this waypoint make the route hardly more costly?" needs no
// search. The measure is the planner's own: metres weighted by slope and by unknown ground.
//
// No DOM and no worker here: node --test src/nav/navigation.test.js
import { NAV } from './config.js';

/**
 * @param costTo (stop, cell) -> cost of going from `cell` to that stop (Infinity if it cannot be reached)
 * @param start  [col, row] where the route begins
 * @param goal   { id, cell } the destination
 * @param stops  [{ id, cell }] the waypoints that may be passed
 * @returns { order: [stop, ...] the waypoints to pass, in order (may be empty), cost, direct }
 */
export function chooseStops(costTo, start, goal, stops, K = NAV, cellM = 1) {
  const direct = costTo(goal, start);
  if (!Number.isFinite(direct) || !stops.length) return { order: [], cost: direct, direct };
  const far = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) * cellM;
  const allowance = Math.max(K.viaExtraCost, direct * K.viaExtraShare);
  const left = stops.filter((w) => far(w.cell, start) >= K.viaMinM && far(w.cell, goal.cell) >= K.viaMinM);
  const chain = [{ cell: start }, goal]; // the places passed, in order
  const legs = [direct]; // legs[k]: the cost from chain[k] to chain[k + 1]
  let extra = 0;
  while (left.length && chain.length - 2 < K.viaMax) {
    let best = null;
    for (const w of left) {
      for (let k = 0; k < legs.length; k++) {
        const to = costTo(w, chain[k].cell);
        const from = costTo(chain[k + 1], w.cell);
        const cost = to + from - legs[k];
        if (Number.isFinite(cost) && extra + cost <= allowance && (!best || cost < best.cost)) best = { w, k, to, from, cost };
      }
    }
    if (!best) break;
    chain.splice(best.k + 1, 0, best.w);
    legs.splice(best.k, 1, best.to, best.from);
    left.splice(left.indexOf(best.w), 1);
    extra += Math.max(0, best.cost);
  }
  return { order: chain.slice(1, -1), cost: direct + extra, direct };
}
