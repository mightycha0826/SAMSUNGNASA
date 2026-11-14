// The right hand: the wearer's vital signs and the suit's, at a glance.
//
// Open right palm turned up: a figure of the wearer turns slowly over the palm, as on the
// display of a powered suit in the films. It is the same kind of object as the map over the
// left palm (core/hologram.js): it floats a little above the palm, a little away from the
// wearer and a little toward the middle of the body, a cone of light rises to it from the
// palm, and everything written about it is on the caption card that goes around its
// "cylinder", just under the plate the figure stands on, always on the side facing the wearer.
//
// Each reading belongs to a part of the figure, and that part turns orange or red when the
// reading is out of range:
//     head      oxygen (tank level, %)          simulated: there is no oxygen sensor
//               head temperature                simulated
//     torso     suit temperature (deg C)        the real sensor on the Jetson (telemetry:update)
//               heart rate (bpm)                simulated: there is no pulse sensor
//     arms      arm temperature                 simulated
//     legs      leg temperature                 simulated
//     arms+legs suit pressure (kPa)             simulated: there is no pressure sensor
//     backpack  battery (%)                     the headset's own battery (navigator.getBattery)
//   There is one temperature sensor, on the torso. The other three temperatures follow it at a
//   fixed distance (a head runs a little cooler than the chest, limbs cooler still), so they
//   move when the real one moves. The caption marks every simulated reading "sim".
//   ?simO2=12, ?simPressure=24 and ?simHeart=160 set values from the address,
//   window.__hud.suit.set({ o2, pressureKpa, heart, battery, headC, armsC, legsC }) from the console.
//
// The figure is built here from smooth solids (a turned profile for the trunk, tapered limbs
// with round joints), not loaded from a file: the app has to work without any download.
//
// Receives: telemetry:update

import * as THREE from 'three';
import { HUD } from './config.js';
import { T } from './tokens.js';
import { suitStates, worst } from './suit-limits.js';
import { makePalmState } from '../core/palm.js';
import { makeBeam, makeCaption, writeCaption, placeCaption, floatOverPalm } from '../core/hologram.js';

const HOLO = '#7fd4ff'; // the figure when all is well
const Y = new THREE.Vector3(0, 1, 0);

// A hologram skin: bright where the surface turns away from the eye, faint where it faces it,
// with fine lines drifting upward. Drawn additively, so the body looks lit from within.
const SKIN_VERTEX = `
varying vec3 vNormal;
varying vec3 vToEye;
varying float vHeight;
void main() {
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vToEye = normalize(-view.xyz);
  vHeight = (modelMatrix * vec4(position, 1.0)).y;
  gl_Position = projectionMatrix * view;
}`;
const SKIN_FRAGMENT = `
uniform vec3 colour;
uniform float level;
uniform float time;
varying vec3 vNormal;
varying vec3 vToEye;
varying float vHeight;
void main() {
  float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vToEye))), 2.0);
  float lines = 0.86 + 0.14 * sin(vHeight * 1100.0 - time * 5.0);
  float alpha = (0.14 + 0.86 * rim) * level * lines;
  gl_FragColor = vec4(colour * (0.6 + 0.8 * rim), alpha);
  #include <colorspace_fragment>
}`;

/**
 * The figure: a standing person, feet at 0 and the top of the head at 1, facing +z.
 * One material per part that can change colour: head, torso, arms, legs, pack.
 */
function makeFigure() {
  const root = new THREE.Group();
  root.name = 'suit-figure';
  const spinner = new THREE.Group();
  root.add(spinner);
  const parts = {};
  const dir = new THREE.Vector3();
  const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, depthTest: true });

  function part(name) {
    const material = new THREE.ShaderMaterial({
      uniforms: { colour: { value: new THREE.Color(HOLO) }, level: { value: 1 }, time: { value: 0 } },
      vertexShader: SKIN_VERTEX,
      fragmentShader: SKIN_FRAGMENT,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: true, // against the figure's own depth (below): only its outer skin is drawn
      depthWrite: false,
    });
    parts[name] = { material, state: '' };
    const add = (geometry) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 9;
      mesh.frustumCulled = false;
      // The solids overlap at every joint. Drawn as they are, each overlap would glow twice as
      // bright and the figure would look like a jointed doll. So every solid first writes only
      // its depth, and the skin is then drawn where it is the nearest surface: one smooth body.
      const depth = new THREE.Mesh(geometry, depthOnly);
      depth.renderOrder = 8.5;
      depth.frustumCulled = false;
      mesh.add(depth);
      spinner.add(mesh);
      return mesh;
    };
    return {
      /** A rounded solid: a sphere stretched to the half-sizes given. */
      blob(rx, ry, rz, x, y, z) {
        const mesh = add(new THREE.SphereGeometry(1, 20, 14));
        mesh.scale.set(rx, ry, rz);
        mesh.position.set(x, y, z);
      },
      /** A limb segment from a to b, ra thick at a and rb at b, with a round joint at each end. */
      limb(a, b, ra, rb) {
        const from = new THREE.Vector3(...a);
        const to = new THREE.Vector3(...b);
        const length = from.distanceTo(to);
        const mesh = add(new THREE.CylinderGeometry(rb, ra, length, 16, 1, true));
        mesh.position.copy(from).add(to).multiplyScalar(0.5);
        mesh.quaternion.setFromUnitVectors(Y, dir.subVectors(to, from).normalize());
        this.blob(ra, ra, ra, ...a);
        this.blob(rb, rb, rb, ...b);
      },
      /** A solid turned around the upright axis from a profile of [radius, height], then flattened front to back. */
      turned(profile, depth) {
        const mesh = add(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 28));
        mesh.scale.set(1, 1, depth);
      },
    };
  }

  const head = part('head');
  head.blob(0.058, 0.072, 0.066, 0, 0.925, 0.004);

  const torso = part('torso');
  // Hips, waist, chest, shoulders, the base of the neck: wider at the shoulders than at the hips.
  torso.turned(
    [[0.001, 0.452], [0.07, 0.456], [0.1, 0.49], [0.103, 0.53], [0.094, 0.585], [0.092, 0.62], [0.104, 0.68], [0.12, 0.745], [0.122, 0.785], [0.1, 0.815], [0.05, 0.832], [0.03, 0.845], [0.001, 0.848]],
    0.6,
  );
  torso.limb([0, 0.835, 0], [0, 0.872, 0.002], 0.028, 0.026); // neck

  const pack = part('pack');
  pack.blob(0.082, 0.115, 0.036, 0, 0.665, -0.088); // life support on the back

  const arms = part('arms');
  const legs = part('legs');
  for (const side of [-1, 1]) {
    // Arms hang a little away from the body, bent slightly at the elbow, hands by the thighs.
    const shoulder = [side * 0.138, 0.782, 0];
    const elbow = [side * 0.168, 0.605, -0.006];
    const wrist = [side * 0.176, 0.452, 0.022];
    arms.limb(shoulder, elbow, 0.038, 0.029);
    arms.limb(elbow, wrist, 0.029, 0.021);
    arms.blob(0.02, 0.042, 0.013, side * 0.178, 0.405, 0.028); // hand
    const hip = [side * 0.056, 0.468, 0];
    const knee = [side * 0.062, 0.262, 0.008];
    const ankle = [side * 0.062, 0.058, 0];
    legs.limb(hip, knee, 0.054, 0.038);
    legs.limb(knee, ankle, 0.038, 0.027);
    legs.blob(0.03, 0.022, 0.062, side * 0.064, 0.022, 0.032); // foot
  }
  return { root, spinner, parts };
}

/** The plate the figure stands on: two rings, the top face of the hologram's cylinder. */
function makePlate(widthM) {
  const group = new THREE.Group();
  for (const [r, opacity] of [[widthM / 2, 0.7], [widthM / 2 - 0.012, 0.3]]) {
    const ring = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(Array.from({ length: 64 }, (_, i) => new THREE.Vector3(Math.cos((i / 64) * Math.PI * 2) * r, 0, Math.sin((i / 64) * Math.PI * 2) * r))),
      new THREE.LineBasicMaterial({ color: HOLO, transparent: true, opacity, depthTest: false }),
    );
    ring.renderOrder = 8;
    ring.frustumCulled = false;
    group.add(ring);
  }
  return group;
}

/**
 * @param ctx the module context (bus, scene, camera)
 */
export function createSuit(ctx) {
  const K = HUD.suit;
  const q = new URLSearchParams(location.search);
  const num = (name, fallback) => (q.has(name) && Number.isFinite(Number(q.get(name))) ? Number(q.get(name)) : fallback);

  // ---- readings ----
  const base = { o2: num('simO2', 98), pressureKpa: num('simPressure', K.pressureKpa.nominal), heart: num('simHeart', 72) };
  // Temperatures set by hand (set()), in place of the ones that follow the torso sensor.
  const fixed = { headC: null, armsC: null, legsC: null };
  const reading = { o2: base.o2, pressureKpa: base.pressureKpa, heart: base.heart, battery: null, charging: false, suitTempC: null, tempSource: null, headC: null, armsC: null, legsC: null };
  let batteryNote = 'not reported by this browser';
  let dirty = true;

  /** The three temperatures without a sensor: the torso's, less what that part usually runs cooler. */
  function followTorso() {
    for (const [key, below] of [['headC', K.cooler.head], ['armsC', K.cooler.arms], ['legsC', K.cooler.legs]]) {
      reading[key] = fixed[key] ?? (reading.suitTempC == null ? null : Number((reading.suitTempC - below).toFixed(1)));
    }
  }

  navigator.getBattery?.()
    .then((b) => {
      const read = () => {
        reading.battery = Math.round(b.level * 100);
        reading.charging = b.charging;
        batteryNote = b.charging ? 'headset, charging' : 'headset';
        dirty = true;
      };
      read();
      b.addEventListener('levelchange', read);
      b.addEventListener('chargingchange', read);
    })
    .catch(() => {});
  ctx.bus.on('telemetry:update', ({ suitTempC, source }) => {
    if (suitTempC !== reading.suitTempC || source !== reading.tempSource) dirty = true;
    reading.suitTempC = suitTempC ?? null;
    reading.tempSource = source ?? null;
    followTorso();
  });

  // ---- the hologram ----
  const root = new THREE.Group();
  root.name = 'suit-view';
  root.visible = false;
  ctx.scene.add(root);
  const figure = makeFigure();
  figure.root.scale.setScalar(K.figureM);
  root.add(figure.root, makePlate(K.plateM));
  const caption = makeCaption(root, 'suit-caption', K.caption);
  const beam = makeBeam('suit-beam');
  root.add(beam);
  const palmState = makePalmState();
  const floatState = { shownSince: null };
  let pinned = false; // PC: shown without a hand

  const colourOf = (state) => (state === 'crit' ? T.dangerLine : state === 'warn' ? T.point : HOLO);
  const show = (v, digits) => (v == null ? '—' : v.toFixed(digits));

  /** The six lines of the caption, and the states behind them. */
  function describe() {
    const z = suitStates(reading, HUD.suit, HUD.suitGauge);
    const wrong = [];
    const note = (state, text) => state && wrong.push(text);
    note(z.o2, `oxygen ${show(reading.o2, 0)} %`);
    note(z.heart, `heart rate ${show(reading.heart, 0)} bpm`);
    note(z.pressure, `pressure ${show(reading.pressureKpa, 1)} kPa`);
    note(z.headTemp, `head ${show(reading.headC, 1)} °C`);
    note(z.temp, `torso ${show(reading.suitTempC, 1)} °C`);
    note(z.armsTemp, `arms ${show(reading.armsC, 1)} °C`);
    note(z.legsTemp, `legs ${show(reading.legsC, 1)} °C`);
    note(z.battery, `battery ${show(reading.battery, 0)} %`);
    const level = worst(...Object.values(z));
    const torsoTag = reading.suitTempC == null ? '' : reading.tempSource === 'mock' ? ' (mock)' : ' (sensor)';
    return {
      states: z,
      level,
      lines: [
        `VITALS · ${wrong.length ? `${wrong.length} out of range` : 'all in range'}`,
        `Oxygen ${show(reading.o2, 0)} % · Heart ${show(reading.heart, 0)} bpm · Pressure ${show(reading.pressureKpa, 1)} kPa   (sim)`,
        `Temp °C · head ${show(reading.headC, 1)} · torso ${show(reading.suitTempC, 1)}${torsoTag} · arms ${show(reading.armsC, 1)} · legs ${show(reading.legsC, 1)}`,
        wrong.length ? `Check: ${wrong.join(' · ')}` : 'Helmet, torso, arms, legs, pack: nothing to report',
        `Battery ${show(reading.battery, 0)} % · ${batteryNote}`,
        'sim = simulated, no sensor. Head, arm and leg temperatures follow the torso sensor.',
      ],
    };
  }

  function redraw() {
    const d = describe();
    // The line to notice is orange as on the map; red when something is critical, quiet when all is well.
    writeCaption(caption, d.lines, { 3: d.level === 'crit' ? '#ff7a7a' : d.level === 'warn' ? '#f4b575' : '#8fd9a8' });
    const z = d.states;
    const of = {
      head: worst(z.o2, z.headTemp),
      torso: worst(z.temp, z.heart),
      arms: worst(z.pressure, z.armsTemp),
      legs: worst(z.pressure, z.legsTemp),
      pack: z.battery,
    };
    for (const [name, p] of Object.entries(figure.parts)) {
      p.state = of[name];
      p.material.uniforms.colour.value.set(colourOf(p.state));
    }
    dirty = false;
  }

  /**
   * Place the hologram over the right palm for this frame.
   * @param allowed false when the left hand has the say: the two hands are too close for the
   *                tracking to be trusted, or the right hand is being used as the pointer
   */
  function place(frame, allowed) {
    if (pinned) return;
    floatOverPalm(root, beam, frame, ctx.camera, palmState, floatState, { holdMs: K.holdMs, followRate: K.followRate, widthM: K.plateM, hand: 'right', allowed });
  }

  /** Every frame: turn the figure, let the simulated readings breathe, redraw what changed. */
  let lastWobble = 0;
  function tick(now, dt) {
    if (now - lastWobble > 2000) {
      lastWobble = now;
      const o2 = Math.round(base.o2 + (Math.random() - 0.5) * 0.6);
      const kpa = Number((base.pressureKpa + (Math.random() - 0.5) * 0.08).toFixed(1));
      const heart = Math.round(base.heart + (Math.random() - 0.5) * 5);
      if (o2 !== reading.o2 || kpa !== reading.pressureKpa || heart !== reading.heart) dirty = true;
      reading.o2 = o2;
      reading.pressureKpa = kpa;
      reading.heart = heart;
    }
    if (!root.visible) return;
    figure.spinner.rotation.y += (dt * Math.PI * 2) / K.turnS;
    if (dirty) redraw();
    placeCaption(caption, root, ctx.camera, K.plateM);
    // A part in trouble pulses, so it is noticed from whichever side the figure shows.
    const beat = 0.5 + 0.5 * Math.sin(now / 180);
    for (const p of Object.values(figure.parts)) {
      p.material.uniforms.time.value = (now / 1000) % 1000;
      p.material.uniforms.level.value = p.state === 'crit' ? 1.1 + 0.9 * beat : p.state === 'warn' ? 1.35 : 1;
    }
  }

  return {
    place,
    tick,
    /** No right hand in view (or no hands at all): the hologram goes, unless pinned. */
    hide() {
      if (!pinned) root.visible = false;
    },
    /** The headset's battery in percent, or null (for the rescue signal). */
    battery: () => reading.battery,
    // ---- console and tests ----
    /** PC: show(true, [x, y, z]) puts the hologram in the scene without a hand; show(false) takes it away. */
    show(on, at = [0.6, 1.2, 0.3]) {
      pinned = !!on;
      root.visible = pinned;
      if (!pinned) return;
      root.position.fromArray(at);
      root.quaternion.identity();
      root.scale.setScalar(3);
      beam.visible = false;
      dirty = true;
    },
    /** Set readings by hand: set({ o2: 12, pressureKpa: 24, heart: 160, battery: 9, charging: false, legsC: 36 }). null gives a temperature back to the sensor. */
    set(values) {
      if (values.o2 != null) base.o2 = values.o2;
      if (values.pressureKpa != null) base.pressureKpa = values.pressureKpa;
      if (values.heart != null) base.heart = values.heart;
      for (const key of ['headC', 'armsC', 'legsC']) if (values[key] !== undefined) fixed[key] = values[key];
      followTorso();
      if (values.battery !== undefined) {
        reading.battery = values.battery;
        batteryNote = 'set by hand';
      }
      if (values.charging !== undefined) reading.charging = values.charging;
      reading.o2 = base.o2;
      reading.pressureKpa = base.pressureKpa;
      reading.heart = base.heart;
      dirty = true;
    },
    state: () => ({ reading: { ...reading }, ...describe(), shown: root.visible }),
  };
}
