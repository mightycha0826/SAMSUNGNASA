// Which readings the status card shows. Plain arithmetic: node --test src/hud/importance.test.js
//
// The card has room for a few readings, and most of what could be shown is not worth a glance
// most of the time. So every reading gets a number, its importance, and the card shows:
//   - the pinned ones, always, each in its own fixed place: what has to be watched all the
//     time (battery, oxygen, ambient temperature). Their importance is the maximum by definition.
//   - of the rest, those whose importance is at least `showAbove`, the most important first,
//     and at most `slots` of them. So the number on show changes: a reading comes up when it
//     starts to matter and goes when it stops.
//
// Importance of a reading that is not pinned:
//     base                  how much it matters when nothing is wrong (set per reading)
//   + warn or crit          it is out of range: this outweighs any base
//   + trendMax x trend      it is moving toward the side where it goes out of range (0..1)
// A reading that does not apply now (the distance to a destination when there is none) is left
// out whatever its number.
//
// Readings must not swap in and out at every flicker of a number: one that is on show stays
// unless another beats it by more than stayBonus, and it keeps its place on the card.

export const IMPORTANCE = { warn: 50, crit: 100, trendMax: 20, stayBonus: 8, slots: 3, showAbove: 31 };

/**
 * How fast a reading has been moving toward the side where it goes out of range: 0 (not at
 * all, or away from it) to 1 (a quarter of its range within the window).
 * @param {number[]} history oldest first; gaps (null, NaN) are skipped
 * @param {number} bad +1 when high is bad, -1 when low is bad, 0 when both ends are
 * @param {number} span the reading's range, in its own unit
 */
export function trend(history, bad, span, window = 30) {
  const h = history.filter(Number.isFinite).slice(-window);
  if (h.length < 4 || !(span > 0)) return 0;
  const third = Math.max(1, Math.floor(h.length / 3));
  const mean = (a) => a.reduce((sum, v) => sum + v, 0) / a.length;
  const delta = mean(h.slice(-third)) - mean(h.slice(0, third));
  const toward = bad === 0 ? Math.abs(delta) : delta * bad;
  return Math.max(0, Math.min(1, toward / (span * 0.25)));
}

/** The importance of one reading: { pinned, base, state: '' | 'warn' | 'crit', trend: 0..1, active }. */
export function importance(m, K = IMPORTANCE) {
  if (m.pinned) return Infinity;
  if (m.active === false) return -Infinity;
  return (m.base ?? 0) + (m.state === 'crit' ? K.crit : m.state === 'warn' ? K.warn : 0) + K.trendMax * (m.trend ?? 0);
}

/**
 * What the card shows: { pinned: [...], ranked: [...] }, both lists of the readings given.
 * Pinned ones come in the order they were given. Ranked ones are the most important of the
 * rest (at least `showAbove`, at most `slots`); one that was shown before (`shownIds`, in the order of its places) keeps its
 * place, and a new one takes the place that came free.
 */
export function choose(metrics, shownIds = [], K = IMPORTANCE) {
  const pinned = metrics.filter((m) => m.pinned);
  const rest = metrics
    .filter((m) => !m.pinned && importance(m, K) > -Infinity)
    .map((m) => ({ m, score: importance(m, K) + (shownIds.includes(m.id) ? K.stayBonus : 0) }))
    .filter(({ score }) => score >= (K.showAbove ?? -Infinity))
    .sort((a, b) => b.score - a.score)
    .slice(0, K.slots)
    .map(({ m }) => m);
  const ranked = new Array(Math.min(K.slots, rest.length)).fill(null);
  const fresh = [];
  for (const m of rest) {
    const place = shownIds.indexOf(m.id);
    if (place >= 0 && place < ranked.length && !ranked[place]) ranked[place] = m;
    else fresh.push(m);
  }
  for (let i = 0; i < ranked.length; i++) ranked[i] ??= fresh.shift();
  return { pinned, ranked };
}
