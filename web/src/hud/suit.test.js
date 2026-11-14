// node --test src/hud/suit.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

import { suitStates, worst } from './suit-limits.js';

const K = {
  o2: { warn: 30, crit: 15 },
  pressureKpa: { nominal: 29.6, warnLow: 27, critLow: 25, warnHigh: 32 },
  battery: { warn: 30, crit: 15 },
  heart: { critLow: 40, warnLow: 50, warnHigh: 120, critHigh: 150 },
  bodyTemp: { critLow: 35, warnLow: 35.5, warnHigh: 37.8, critHigh: 39 },
};
const fine = { o2: 98, pressureKpa: 29.6, heart: 72, battery: 80, charging: false, torsoC: 36.8, headC: 36.9, armsC: 36.2, legsC: 36.0 };
const states = (change) => suitStates({ ...fine, ...change }, K);

test('all readings in range: nothing is marked', () => {
  assert.deepEqual(Object.values(states({})).filter(Boolean), []);
});

test('each reading has its own limits', () => {
  assert.equal(states({ o2: 29 }).o2, 'warn');
  assert.equal(states({ o2: 14 }).o2, 'crit');
  assert.equal(states({ pressureKpa: 26.5 }).pressure, 'warn');
  assert.equal(states({ pressureKpa: 33 }).pressure, 'warn');
  assert.equal(states({ pressureKpa: 24 }).pressure, 'crit');
  assert.equal(states({ heart: 130 }).heart, 'warn');
  assert.equal(states({ heart: 45 }).heart, 'warn');
  assert.equal(states({ heart: 160 }).heart, 'crit');
  assert.equal(states({ torsoC: 38 }).temp, 'warn');
  assert.equal(states({ torsoC: 39.2 }).temp, 'crit');
  assert.equal(states({ legsC: 35.2 }).legsTemp, 'warn', 'too cold counts as well');
  assert.equal(states({ legsC: 34.5 }).legsTemp, 'crit');
  assert.equal(states({ battery: 20 }).battery, 'warn');
  assert.equal(states({ battery: 9 }).battery, 'crit');
});

test('a battery on the charger is not a problem, and a missing reading is not one either', () => {
  assert.equal(states({ battery: 5, charging: true }).battery, '');
  assert.equal(states({ battery: null }).battery, '');
  assert.equal(states({ torsoC: null }).temp, '');
});

test('a part shows the worse of the readings that belong to it', () => {
  assert.equal(worst('', 'warn'), 'warn');
  assert.equal(worst('warn', 'crit', ''), 'crit');
  assert.equal(worst('', ''), '');
});
