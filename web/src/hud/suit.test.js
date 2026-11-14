// node --test src/hud/suit.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

import { suitStates, worst } from './suit-limits.js';

const K = {
  o2: { warn: 30, crit: 15 },
  pressureKpa: { nominal: 29.6, warnLow: 27, critLow: 25, warnHigh: 32 },
  battery: { warn: 30, crit: 15 },
  heart: { critLow: 40, warnLow: 50, warnHigh: 120, critHigh: 150 },
};
const gauge = { warn: 30, crit: 35 };
const fine = { o2: 98, pressureKpa: 29.6, heart: 72, battery: 80, charging: false, suitTempC: 24, headC: 23.4, armsC: 22.6, legsC: 22.1 };
const states = (change) => suitStates({ ...fine, ...change }, K, gauge);

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
  assert.equal(states({ suitTempC: 30 }).temp, 'warn');
  assert.equal(states({ suitTempC: 35 }).temp, 'crit');
  assert.equal(states({ legsC: 36 }).legsTemp, 'crit');
  assert.equal(states({ battery: 20 }).battery, 'warn');
  assert.equal(states({ battery: 9 }).battery, 'crit');
});

test('a battery on the charger is not a problem, and a missing reading is not one either', () => {
  assert.equal(states({ battery: 5, charging: true }).battery, '');
  assert.equal(states({ battery: null }).battery, '');
  assert.equal(states({ suitTempC: null }).temp, '');
});

test('a part shows the worse of the readings that belong to it', () => {
  assert.equal(worst('', 'warn'), 'warn');
  assert.equal(worst('warn', 'crit', ''), 'crit');
  assert.equal(worst('', ''), '');
});
