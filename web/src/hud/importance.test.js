// node --test src/hud/importance.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { IMPORTANCE, trend, importance, choose } from './importance.js';

const ids = (list) => list.map((m) => m.id);
const battery = { id: 'battery', pinned: true };
const oxygen = { id: 'o2', pinned: true };
const heart = { id: 'heart', base: 35, state: '' };
const radiation = { id: 'radiation', base: 32, state: '' };
const pressure = { id: 'pressure', base: 30, state: '' };
const air = { id: 'air', base: 12, state: '' };
const route = { id: 'route', base: 70, state: '', active: false };

test('pinned readings are always shown, in the order given, whatever else happens', () => {
  const all = [battery, oxygen, heart, { ...radiation, state: 'crit' }, { ...pressure, state: 'crit' }, { ...air, state: 'crit' }];
  assert.deepEqual(ids(choose(all).pinned), ['battery', 'o2']);
  assert.equal(importance(battery), Infinity);
});

test('with nothing wrong, the readings with the highest base take the free places', () => {
  assert.deepEqual(ids(choose([battery, heart, radiation, pressure, air, route]).ranked), ['heart', 'radiation']);
});

test('a reading that does not apply is left out; once it applies it takes a place', () => {
  assert.equal(importance(route), -Infinity);
  assert.deepEqual(ids(choose([heart, radiation, pressure, { ...route, active: true }]).ranked), ['route', 'heart']);
});

test('out of range outweighs any base: a minor reading in trouble comes up', () => {
  const picked = choose([heart, radiation, pressure, { ...air, state: 'warn' }]).ranked;
  assert.ok(ids(picked).includes('air'));
  assert.ok(importance({ ...air, state: 'warn' }) > importance(heart));
  assert.ok(importance({ ...air, state: 'crit' }) > importance({ ...heart, state: 'warn' }));
});

test('a reading on show keeps its place: a small lead does not swap it out, a clear one does', () => {
  const shown = ['heart', 'radiation'];
  // pressure creeps past radiation by less than the stay bonus: radiation stays
  const creeping = { ...pressure, trend: (IMPORTANCE.stayBonus - 3) / IMPORTANCE.trendMax + 2 / IMPORTANCE.trendMax };
  assert.ok(importance(creeping) > importance(radiation));
  assert.deepEqual(ids(choose([heart, radiation, creeping], shown).ranked), ['heart', 'radiation']);
  // pressure goes out of range: it replaces the least important one, in that one's place
  assert.deepEqual(ids(choose([heart, radiation, { ...pressure, state: 'warn' }], shown).ranked), ['heart', 'pressure']);
  // and what stays does not move to another place
  assert.deepEqual(ids(choose([radiation, heart, { ...pressure, state: 'warn' }], ['radiation', 'heart']).ranked), ['pressure', 'heart']);
});

test('trend: only movement toward the bad side counts', () => {
  const rising = Array.from({ length: 30 }, (_, i) => 20 + i * 0.3); // 9 degrees in the window
  assert.ok(trend(rising, +1, 20) > 0.9, 'a temperature rising fast');
  assert.equal(trend(rising, -1, 20), 0, 'rising is no trouble for a reading whose low end is bad');
  assert.ok(trend(rising.slice().reverse(), 0, 20) > 0.9, 'either way counts when both ends are bad');
  assert.equal(trend([70, 71, 70, 72, 71, 70, 71, 70, 71], 0, 110), 0.0 + trend([70, 71, 70, 72, 71, 70, 71, 70, 71], 0, 110));
  assert.ok(trend([70, 71, 70, 72, 71, 70, 71, 70, 71], 0, 110) < 0.05, 'noise is not a trend');
  assert.equal(trend([1, 2], +1, 10), 0, 'too little history');
  assert.equal(trend([null, NaN, 1, 2, 3, 4, 5, 6], +1, 20) > 0, true, 'gaps are skipped');
});
