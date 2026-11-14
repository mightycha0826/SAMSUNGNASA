// When a suit reading is out of range. Plain arithmetic, no browser: node --test src/hud/suit.test.js

/** '' | 'warn' | 'crit' for each reading (K = HUD.suit in config.js). */
export function suitStates(r, K) {
  const low = (v, lim) => (v == null ? '' : v < lim.crit ? 'crit' : v < lim.warn ? 'warn' : '');
  const p = r.pressureKpa;
  const P = K.pressureKpa;
  // Body temperature: too warm (heat stress) or too cold, by the same limits for every part.
  const T = K.bodyTemp;
  const body = (v) => (v == null ? '' : v >= T.critHigh || v < T.critLow ? 'crit' : v >= T.warnHigh || v < T.warnLow ? 'warn' : '');
  const h = r.heart;
  const B = K.heart;
  return {
    o2: low(r.o2, K.o2),
    pressure: p == null ? '' : p < P.critLow ? 'crit' : p < P.warnLow || p > P.warnHigh ? 'warn' : '',
    heart: h == null ? '' : h < B.critLow || h > B.critHigh ? 'crit' : h < B.warnLow || h > B.warnHigh ? 'warn' : '',
    temp: body(r.torsoC),
    headTemp: body(r.headC),
    armsTemp: body(r.armsC),
    legsTemp: body(r.legsC),
    battery: r.charging ? '' : low(r.battery, K.battery),
  };
}

/** The worse of several states. */
export const worst = (...states) => (states.includes('crit') ? 'crit' : states.includes('warn') ? 'warn' : '');
