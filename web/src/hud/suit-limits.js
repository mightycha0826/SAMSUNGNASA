// When a suit reading is out of range. Plain arithmetic, no browser: node --test src/hud/suit.test.js

/** '' | 'warn' | 'crit' for each reading (K = HUD.suit, gauge = HUD.suitGauge in config.js). */
export function suitStates(r, K, gauge) {
  const low = (v, lim) => (v == null ? '' : v < lim.crit ? 'crit' : v < lim.warn ? 'warn' : '');
  const p = r.pressureKpa;
  const P = K.pressureKpa;
  const hot = (v) => (v == null ? '' : v >= gauge.crit ? 'crit' : v >= gauge.warn ? 'warn' : '');
  const h = r.heart;
  const B = K.heart;
  return {
    o2: low(r.o2, K.o2),
    pressure: p == null ? '' : p < P.critLow ? 'crit' : p < P.warnLow || p > P.warnHigh ? 'warn' : '',
    heart: h == null ? '' : h < B.critLow || h > B.critHigh ? 'crit' : h < B.warnLow || h > B.warnHigh ? 'warn' : '',
    temp: hot(r.suitTempC),
    headTemp: hot(r.headC),
    armsTemp: hot(r.armsC),
    legsTemp: hot(r.legsC),
    battery: r.charging ? '' : low(r.battery, K.battery),
  };
}

/** The worse of several states. */
export const worst = (...states) => (states.includes('crit') ? 'crit' : states.includes('warn') ? 'warn' : '');
