// node --test src/hud/pointer.test.js
// The pointer's arithmetic and its press logic, driven by a simulated ray (no headset).

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPointer, pickHit, rayOnPanel } from './pointer.js';

const K = {
  hands: ['right'], ownRay: false, shoulderDownM: 0.2, shoulderSideM: 0.16, maxM: 3, margin: 0.06,
  pinchOnM: 0.018, pinchOffM: 0.035, pinchFarM: 0.075, repeatMs: 300,
  smoothMin: 9, smoothMax: 60, smoothTravel: 0.04, stick: 0.3, snap: 0.7, cursorM: 0.0075, beamStartM: 0.06,
};

// A 0.4 m x 0.2 m panel with a 400 x 200 canvas, facing +z, centred at (0, 1.2, -0.5).
function makePanel(z = -0.5) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.2));
  mesh.position.set(0, 1.2, z);
  return { mesh, wM: 0.4, hM: 0.2, canvas: { width: 400, height: 200 } };
}
// Two buttons side by side with a 20 px gap: A 20..190, B 210..380, both y 50..150.
const HITS = [
  { id: 'A', x: 20, y: 50, w: 170, h: 100 },
  { id: 'B', x: 210, y: 50, w: 170, h: 100 },
];
// A ray from the given origin through the panel point at canvas pixel (px, py).
function rayTo(panel, origin, px, py) {
  const target = new THREE.Vector3((px / 400 - 0.5) * 0.4, (0.5 - py / 200) * 0.2, 0).applyMatrix4(panel.mesh.matrixWorld);
  const dir = target.sub(new THREE.Vector3(...origin)).normalize();
  return { origin, dir: dir.toArray() };
}

function setup() {
  const panel = makePanel();
  panel.mesh.updateWorldMatrix(true, false);
  const pressed = [];
  const targets = [{ id: 'menu', panel, hits: () => HITS, press: (id) => pressed.push(id) }];
  const scene = new THREE.Scene();
  const pointer = createPointer({ scene, camera: new THREE.PerspectiveCamera(), xr: { onSessionStart() {} } }, K);
  let now = 0;
  const step = (sim, frames = 1) => {
    let out;
    for (let i = 0; i < frames; i++) {
      pointer.simulate(sim);
      now += 16;
      out = pointer.update({ xrFrame: null, refSpace: null, session: null }, targets, now, 0.016);
    }
    return out.get('menu');
  };
  return { panel, pointer, pressed, step, advance: (ms) => { now += ms; } };
}
const HAND = [0.25, 1.0, 0.1]; // to the right of and below the panel, 60 cm in front of it

test('rayOnPanel: canvas pixel under the ray, in metres along it', () => {
  const panel = makePanel();
  const hit = rayOnPanel(panel, new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(0, 0, -1), 3, 0.06);
  assert.ok(Math.abs(hit.t - 0.5) < 1e-6);
  assert.ok(Math.abs(hit.x - 200) < 1e-3 && Math.abs(hit.y - 100) < 1e-3);
  const { origin, dir } = rayTo(panel, HAND, 300, 60);
  const oblique = rayOnPanel(panel, new THREE.Vector3(...origin), new THREE.Vector3(...dir), 3, 0.06);
  assert.ok(Math.abs(oblique.x - 300) < 1e-3 && Math.abs(oblique.y - 60) < 1e-3);
});

test('rayOnPanel: nothing from behind, pointing away, beyond reach or off the panel', () => {
  const panel = makePanel();
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  assert.equal(rayOnPanel(panel, v(0, 1.2, -1), v(0, 0, 1), 3, 0.06), null); // from behind
  assert.equal(rayOnPanel(panel, v(0, 1.2, 0), v(0, 0, 1), 3, 0.06), null); // pointing away
  assert.equal(rayOnPanel(panel, v(0, 1.2, 4), v(0, 0, -1), 3, 0.06), null); // too far
  assert.equal(rayOnPanel(panel, v(0.5, 1.2, 0), v(0, 0, -1), 3, 0.06), null); // beside it
});

test('rayOnPanel: follows a panel that is turned and scaled', () => {
  const panel = makePanel();
  panel.mesh.rotation.y = 0.6;
  panel.mesh.scale.setScalar(0.5);
  panel.mesh.updateWorldMatrix(true, false);
  const { origin, dir } = rayTo(panel, HAND, 120, 150);
  const hit = rayOnPanel(panel, new THREE.Vector3(...origin), new THREE.Vector3(...dir), 3, 0.06);
  assert.ok(Math.abs(hit.x - 120) < 1e-3 && Math.abs(hit.y - 150) < 1e-3);
});

test('pickHit: the hovered button keeps the hover a little past its edge', () => {
  assert.equal(pickHit(HITS, 100, 100, null, K), 'A');
  // x = 205 is in the gap, nearer to B: a fresh cursor takes B, a cursor that was on A keeps A
  assert.equal(pickHit(HITS, 205, 100, null, K), 'B');
  assert.equal(pickHit(HITS, 205, 100, 'A', K), 'A');
  // clearly inside B: the hover moves
  assert.equal(pickHit(HITS, 260, 100, 'A', K), 'B');
});

test('pickHit: the gap between buttons is never dead, far outside is', () => {
  assert.equal(pickHit(HITS, 198, 100, null, K), 'A');
  assert.equal(pickHit(HITS, 100, 185, null, K), 'A'); // 35 px under A, within snap
  assert.equal(pickHit(HITS, 100, 199, null, K), 'A');
  assert.equal(pickHit([{ id: 'A', x: 20, y: 50, w: 170, h: 40 }], 100, 199, null, K), null);
});

test('pointing hovers, a pinch presses once, and the fingers must open before the next', () => {
  const { panel, step, pressed, advance } = setup();
  let r = step({ ...rayTo(panel, HAND, 100, 100), down: false }, 20);
  assert.deepEqual([r.hoverId, r.engaged], ['A', true]);
  assert.deepEqual(pressed, []);
  r = step({ ...rayTo(panel, HAND, 100, 100), down: true }, 30); // held for half a second
  assert.deepEqual(pressed, ['A']);
  step({ ...rayTo(panel, HAND, 100, 100), down: false }, 2);
  advance(400);
  step({ ...rayTo(panel, HAND, 300, 100), down: false }, 30);
  step({ ...rayTo(panel, HAND, 300, 100), down: true }, 2);
  assert.deepEqual(pressed, ['A', 'B']);
});

test('a double signal for one pinch (system select and joints) presses once', () => {
  const { panel, step, pressed } = setup();
  step({ ...rayTo(panel, HAND, 100, 100), down: false }, 20);
  step({ ...rayTo(panel, HAND, 100, 100), down: true }, 1);
  step({ ...rayTo(panel, HAND, 100, 100), down: false }, 1); // one source lets go for a frame
  step({ ...rayTo(panel, HAND, 100, 100), down: true }, 1); // and the other reports it again
  assert.deepEqual(pressed, ['A']);
});

test('the press lands on the button under the cursor even if the hand twitches as it pinches', () => {
  const { panel, step, pressed } = setup();
  step({ ...rayTo(panel, HAND, 150, 100), down: false }, 30); // resting on A, 40 px from its edge
  // the pinch drags the ray 60 px toward B for the frame in which it closes
  step({ ...rayTo(panel, HAND, 210, 100), down: true }, 1);
  assert.deepEqual(pressed, ['A']);
});

test('a deliberate move to the next button is followed within a few frames', () => {
  const { panel, step } = setup();
  step({ ...rayTo(panel, HAND, 100, 100), down: false }, 20);
  const r = step({ ...rayTo(panel, HAND, 300, 100), down: false }, 6); // about 0.1 s
  assert.equal(r.hoverId, 'B');
});

test('pinching next to the menu, or with no ray on it, presses nothing', () => {
  const { panel, step, pressed, pointer } = setup();
  let r = step({ origin: HAND, dir: [0, 0, 1], down: true }, 5);
  assert.deepEqual([r.hoverId, r.engaged], [null, false]);
  r = step({ ...rayTo(panel, HAND, 100, 100), down: true }, 20); // sweeping onto it while still pinched
  assert.equal(r.hoverId, 'A');
  assert.deepEqual(pressed, []);
  r = step(null, 1);
  assert.deepEqual([r.hoverId, r.engaged], [null, false]);
  assert.equal(pointer.debug()[0].cursor, false);
});

test('a hidden menu is not hit; of two menus the nearer one takes the ray', () => {
  const { panel, step } = setup();
  panel.mesh.visible = false;
  assert.equal(step({ ...rayTo(panel, HAND, 100, 100), down: false }, 5).engaged, false);

  const near = makePanel(-0.3);
  const far = makePanel(-0.6);
  near.mesh.updateWorldMatrix(true, false);
  far.mesh.updateWorldMatrix(true, false);
  const pointer = createPointer({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), xr: { onSessionStart() {} } }, K);
  pointer.simulate({ origin: [0, 1.2, 0.2], dir: [0, 0, -1], down: false });
  const out = pointer.update({}, [
    { id: 'far', panel: far, hits: () => HITS, press() {} },
    { id: 'near', panel: near, hits: () => HITS, press() {} },
  ], 16, 0.016);
  assert.deepEqual([out.get('near').engaged, out.get('far').engaged], [true, false]);
});
