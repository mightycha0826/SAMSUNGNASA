// The right hand: the suit at a glance, and the emergency button.
//
// Right palm up: a small figure of the suit turns slowly over the palm, as on the display of a
// powered suit in the films, with its readings around it. Each reading belongs to a part of
// the figure, and that part turns orange or red when the reading is out of range:
//     helmet    oxygen (tank level, %)          simulated: there is no oxygen sensor
//               head temperature                simulated
//     torso     suit temperature (deg C)        the real sensor on the Jetson (telemetry:update)
//               heart rate (bpm)                simulated: there is no pulse sensor
//     arms      arm temperature                 simulated
//     legs      leg temperature                 simulated
//     arms+legs suit pressure (kPa)             simulated: there is no pressure sensor
//     backpack  battery (%)                     the headset's own battery (navigator.getBattery)
//   There is one temperature sensor, on the torso. The other three temperatures follow it at a
//   fixed distance (a head runs a little cooler than the chest, limbs cooler still), so they
//   move when the real one moves, and they are marked "sim" like every other simulated reading.
//   ?simO2=12, ?simPressure=24 and ?simHeart=160 set values from the address,
//   window.__hud.suit.set({ o2, pressureKpa, heart, battery, headC, armsC, legsC }) from the console.
//
// Back of the right hand turned to the eyes, as when reading a watch: the emergency button.
//   The LEFT hand points at it and pinches (the right hand cannot point at its own back): the
//   first pinch arms it, the second sends the rescue signal. Arming first keeps a stray pinch
//   from calling for help. A hand that is pointing has its fingers away from the wearer, and a
//   watch is read with the fingers across the body, which is how the two are told apart.
//   Sending emits `rescue:signal`; link.js passes it to the hub, which tells the other headsets
//   and the monitor page and answers with `rescue:state`. The crew is virtual: the hub's
//   acknowledgement is simulated and says so. Without a hub (mock mode) it is simulated here.
//
// Receives: telemetry:update, nav:position, rescue:state
// Sends:    rescue:signal { active, position, suitTempC, batteryPct }

import * as THREE from 'three';
import { HUD } from './config.js';
import { T } from './tokens.js';
import { drawSuit, drawSos } from './draw.js';
import { mock } from '../core/config.js';
import { suitStates, worst } from './suit-limits.js';

const HOLO = '#7fd4ff'; // the figure when all is well

const back = new THREE.Vector3();
const fingers = new THREE.Vector3();
const toHead = new THREE.Vector3();
const headPos = new THREE.Vector3();
const palm = new THREE.Vector3();
const tmp = new THREE.Vector3();
const quat = new THREE.Quaternion();

/** The figure: simple solids with their edges drawn, one group per part that can change colour. */
function makeFigure() {
  const root = new THREE.Group();
  root.name = 'suit-figure';
  const spinner = new THREE.Group();
  root.add(spinner);
  const parts = {};
  const part = (name) => {
    const fill = new THREE.MeshBasicMaterial({ color: HOLO, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    const line = new THREE.LineBasicMaterial({ color: HOLO, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
    parts[name] = { fill, line, state: '' };
    return (geometry, x, y, z, tiltZ = 0) => {
      const mesh = new THREE.Mesh(geometry, fill);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 1), line);
      for (const o of [mesh, edges]) {
        o.position.set(x, y, z);
        o.rotation.z = tiltZ;
        o.renderOrder = 1002;
        o.frustumCulled = false;
        spinner.add(o);
      }
    };
  };
  // Heights are fractions of the figure: feet at 0, top of the helmet at 1.
  part('head')(new THREE.IcosahedronGeometry(0.095, 1), 0, 0.9, 0);
  const torso = part('torso');
  torso(new THREE.BoxGeometry(0.3, 0.34, 0.17), 0, 0.63, 0);
  torso(new THREE.BoxGeometry(0.26, 0.1, 0.15), 0, 0.41, 0);
  part('pack')(new THREE.BoxGeometry(0.24, 0.3, 0.1), 0, 0.65, -0.14);
  const arms = part('arms');
  arms(new THREE.CylinderGeometry(0.045, 0.04, 0.36, 6), -0.215, 0.6, 0, -0.12);
  arms(new THREE.CylinderGeometry(0.045, 0.04, 0.36, 6), 0.215, 0.6, 0, 0.12);
  const legs = part('legs');
  legs(new THREE.CylinderGeometry(0.06, 0.05, 0.36, 6), -0.08, 0.18, 0);
  legs(new THREE.CylinderGeometry(0.06, 0.05, 0.36, 6), 0.08, 0.18, 0);
  // A ring under the feet, like the plate a hologram stands on.
  const plate = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.CircleGeometry(0.36, 40).rotateX(-Math.PI / 2), 1), new THREE.LineBasicMaterial({ color: HOLO, transparent: true, opacity: 0.5, depthTest: false }));
  plate.renderOrder = 1002;
  plate.frustumCulled = false;
  root.add(plate);
  return { root, spinner, parts };
}

/**
 * @param ctx the module context (bus, scene, camera, xr)
 * @param tools { makePanel, followMenu, aim, showToast } from hud/index.js
 */
export function createSuit(ctx, { makePanel, followMenu, aim, showToast }) {
  const K = HUD.suit;
  const E = HUD.sos;
  const q = new URLSearchParams(location.search);
  const num = (name, fallback) => (q.has(name) && Number.isFinite(Number(q.get(name))) ? Number(q.get(name)) : fallback);

  // ---- readings ----
  const base = { o2: num('simO2', 98), pressureKpa: num('simPressure', K.pressureKpa.nominal), heart: num('simHeart', 72) };
  // Temperatures set by hand (set()), in place of the ones that follow the torso sensor.
  const fixed = { headC: null, armsC: null, legsC: null };
  const reading = { o2: base.o2, pressureKpa: base.pressureKpa, heart: base.heart, battery: null, charging: false, suitTempC: null, tempSource: null, headC: null, armsC: null, legsC: null };
  /** The three temperatures without a sensor: the torso's, less what that part usually runs cooler. */
  function followTorso() {
    for (const [key, below] of [['headC', K.cooler.head], ['armsC', K.cooler.arms], ['legsC', K.cooler.legs]]) {
      reading[key] = fixed[key] ?? (reading.suitTempC == null ? null : Number((reading.suitTempC - below).toFixed(1)));
    }
  }
  let batteryNote = 'n/a'; // until the browser has answered
  let position = null;
  let bodyDirty = true;

  navigator.getBattery?.()
    .then((b) => {
      const read = () => {
        reading.battery = Math.round(b.level * 100);
        reading.charging = b.charging;
        batteryNote = b.charging ? 'charging' : 'headset';
        bodyDirty = true;
      };
      read();
      b.addEventListener('levelchange', read);
      b.addEventListener('chargingchange', read);
    })
    .catch(() => {});
  ctx.bus.on('telemetry:update', ({ suitTempC, source }) => {
    if (suitTempC !== reading.suitTempC || source !== reading.tempSource) bodyDirty = true;
    reading.suitTempC = suitTempC ?? null;
    reading.tempSource = source ?? null;
    followTorso();
  });
  ctx.bus.on('nav:position', ({ point }) => {
    position = point ? [Number(point[0].toFixed(1)), Number(point[2].toFixed(1))] : null;
  });

  // ---- the suit view ----
  const pBody = makePanel(K.wDeg, K.hDeg);
  pBody.mesh.visible = false;
  pBody.mesh.name = 'suit-view';
  ctx.scene.add(pBody.mesh);
  const figure = makeFigure();
  // A child of the card, so it goes where the card goes; sized in metres whatever the card's scale.
  figure.root.scale.setScalar(K.figureM / K.scale);
  figure.root.position.set(0, -K.figureM / 2 / K.scale, 0.03 / K.scale);
  pBody.mesh.add(figure.root);
  const colourOf = (state) => (state === 'crit' ? T.dangerLine : state === 'warn' ? T.point : HOLO);

  function bodyVM() {
    const st8 = suitStates(reading, HUD.suit, HUD.suitGauge);
    const show = (v, digits) => (v == null ? '—' : v.toFixed(digits));
    return {
      states: st8,
      // toY: where each chip's line ends on the figure (helmet high, legs low).
      left: [
        { label: 'Oxygen', value: show(reading.o2, 0), unit: '%', tag: 'sim', state: st8.o2, toY: 0.24 },
        { label: 'Heart rate', value: show(reading.heart, 0), unit: 'bpm', tag: 'sim', state: st8.heart, toY: 0.42 },
        { label: 'Pressure', value: show(reading.pressureKpa, 1), unit: 'kPa', tag: 'sim', state: st8.pressure, toY: 0.66 },
      ],
      right: [
        {
          label: 'Temperature',
          unit: '°C',
          state: worst(st8.temp, st8.headTemp, st8.armsTemp, st8.legsTemp),
          toY: 0.4,
          rows: [
            { label: 'Head', value: show(reading.headC, 1), tag: 'sim', state: st8.headTemp },
            { label: 'Torso', value: show(reading.suitTempC, 1), tag: reading.tempSource === 'mock' ? 'mock' : reading.suitTempC == null ? '' : 'sensor', state: st8.temp },
            { label: 'Arms', value: show(reading.armsC, 1), tag: 'sim', state: st8.armsTemp },
            { label: 'Legs', value: show(reading.legsC, 1), tag: 'sim', state: st8.legsTemp },
          ],
        },
        { label: 'Battery', value: show(reading.battery, 0), unit: '%', tag: batteryNote, state: st8.battery, toY: 0.5 },
      ],
    };
  }

  function drawBody() {
    const vm = bodyVM();
    drawSuit(pBody.g, pBody.canvas.width / K.wDeg, vm);
    pBody.tex.needsUpdate = true;
    const z = vm.states;
    const of = {
      head: worst(z.o2, z.headTemp),
      torso: worst(z.temp, z.heart),
      arms: worst(z.pressure, z.armsTemp),
      legs: worst(z.pressure, z.legsTemp),
      pack: z.battery,
    };
    for (const [name, p] of Object.entries(figure.parts)) {
      p.state = of[name];
      p.fill.color.set(colourOf(p.state));
      p.line.color.set(colourOf(p.state));
    }
    bodyDirty = false;
  }

  // ---- the emergency button ----
  const pSos = makePanel(E.wDeg, E.hDeg);
  pSos.mesh.visible = false;
  pSos.mesh.name = 'sos-card';
  ctx.scene.add(pSos.mesh);
  const sos = { phase: 'idle', armedUntil: 0, sentAt: null, ack: null, hover: false, pressedUntil: 0, dirty: true, hits: [] };

  function sosVM(now) {
    const common = { title: 'Emergency', phase: sos.phase, hover: sos.hover, pressed: now < sos.pressedUntil, pulse: 0.5 + 0.5 * Math.sin(now / 160) };
    if (sos.phase === 'armed') return { ...common, button: 'SEND', lines: ['Pinch again to send', `${Math.max(0, Math.ceil((sos.armedUntil - now) / 1000))} s`] };
    if (sos.phase === 'sent') {
      const at = sos.sentAt.toLocaleTimeString('en-GB', { hour12: false });
      return { ...common, button: 'CANCEL', lines: [`Rescue signal sent ${at}`, sos.ack ?? 'Waiting for the crew…'] };
    }
    return { ...common, button: 'SOS', lines: ['Rescue signal', 'Left hand: point and pinch'] };
  }

  function setRescue(active, ack = null) {
    sos.phase = active ? 'sent' : 'idle';
    if (active && !sos.sentAt) sos.sentAt = new Date();
    if (!active) sos.sentAt = null;
    sos.ack = active ? ack : null;
    sos.dirty = true;
  }

  function send() {
    setRescue(true);
    ctx.bus.emit('rescue:signal', { active: true, position, suitTempC: reading.suitTempC, batteryPct: reading.battery });
    showToast('Rescue signal sent');
    // No hub to answer (mock mode): play the crew's part here, and say that it is played.
    if (mock.link) setTimeout(() => sos.phase === 'sent' && setRescue(true, 'Base crew notified (simulated)'), 4000);
  }

  function cancel() {
    setRescue(false);
    ctx.bus.emit('rescue:signal', { active: false, position });
    showToast('Rescue signal cancelled');
  }

  function pressSos() {
    const now = performance.now();
    sos.pressedUntil = now + HUD.layers.pressFlashMs;
    sos.dirty = true;
    if (sos.phase === 'idle') {
      sos.phase = 'armed';
      sos.armedUntil = now + E.armMs;
    } else if (sos.phase === 'armed') send();
    else cancel();
  }

  // The hub's word on our own signal (it also tells the other headsets, as an alert).
  ctx.bus.on('rescue:state', ({ active, acknowledged, by }) => {
    setRescue(!!active, acknowledged ? `${by ?? 'Crew'} notified` : null);
  });

  // ---- placing both over the right hand ----
  const st = { body: { shown: false, lastSeen: 0, moving: false }, sos: { shown: false, lastSeen: 0, moving: false } };
  let pinned = null; // PC: 'body' | 'sos' shown without a hand

  /**
   * @param right the right XRHand, or null
   * @param crowded the two wrists are too close for the tracking to be trusted
   * @param engaged a pointer is on the emergency button
   */
  function place(frame, now, dt, { right, crowded, engaged }) {
    if (pinned) return;
    const { xrFrame, refSpace } = frame;
    const wrist = right && xrFrame?.getJointPose?.(right.get('wrist'), refSpace);
    let palmUp = false;
    let watch = false;
    if (crowded) {
      palmUp = st.body.shown;
      watch = st.sos.shown;
    } else if (wrist) {
      const o = wrist.transform.orientation;
      const p = wrist.transform.position;
      quat.set(o.x, o.y, o.z, o.w);
      back.set(0, 1, 0).applyQuaternion(quat); // the back of the hand faces this way
      fingers.set(0, 0, -1).applyQuaternion(quat); // the fingers point this way
      palm.set(p.x, p.y, p.z);
      const knuckle = xrFrame.getJointPose?.(right.get('middle-finger-phalanx-proximal'), refSpace);
      if (knuckle) palm.lerp(tmp.set(knuckle.transform.position.x, knuckle.transform.position.y, knuckle.transform.position.z), 0.5);
      ctx.camera.getWorldPosition(headPos);
      toHead.subVectors(headPos, palm).normalize();
      palmUp = back.y < (st.body.shown ? K.palmUpDot + HUD.follow.gestureSlack : K.palmUpDot);
      // A watch is read with its face to the eyes and the fingers across the body; a hand that
      // points has its fingers away from the wearer.
      const slack = st.sos.shown ? 0.2 : 0;
      const awayFlat = tmp.set(-toHead.x, 0, -toHead.z);
      const away = awayFlat.lengthSq() > 1e-6 ? fingers.dot(awayFlat.normalize()) : 0;
      watch = !palmUp && back.dot(toHead) > E.faceDot - slack && away < E.maxAwayDot + slack;
    }
    const seen = !!wrist && !crowded;

    if (palmUp && seen) {
      aim.position.copy(palm);
      aim.position.y += K.liftM + K.figureM / 2;
      aim.lookAt(headPos.x, aim.position.y, headPos.z); // upright, turned to the wearer
    }
    followMenu(pBody, st.body, palmUp, crowded && st.body.shown, K.scale, now, dt, { handSeen: seen, other: seen && watch });

    if (watch && seen) {
      aim.position.copy(palm);
      aim.position.y += E.liftM;
      aim.lookAt(headPos);
    }
    followMenu(pSos, st.sos, watch, engaged || (crowded && st.sos.shown), E.scale, now, dt, { handSeen: seen, other: seen && palmUp });
  }

  /** Every frame: turn the figure, let the simulated readings breathe, redraw what changed. */
  let lastWobble = 0;
  let lastSosDraw = 0;
  function tick(now, dt) {
    if (now - lastWobble > 2000) {
      lastWobble = now;
      const o2 = Math.round(base.o2 + (Math.random() - 0.5) * 0.6);
      const kpa = Number((base.pressureKpa + (Math.random() - 0.5) * 0.08).toFixed(1));
      const heart = Math.round(base.heart + (Math.random() - 0.5) * 5);
      if (o2 !== reading.o2 || kpa !== reading.pressureKpa || heart !== reading.heart) bodyDirty = true;
      reading.o2 = o2;
      reading.pressureKpa = kpa;
      reading.heart = heart;
    }
    if (pBody.mesh.visible) {
      figure.spinner.rotation.y += (dt * Math.PI * 2) / K.turnS;
      if (bodyDirty) drawBody();
      // A part in trouble pulses, so it is seen from whichever side the figure shows.
      const beat = 0.55 + 0.45 * Math.sin(now / 180);
      for (const p of Object.values(figure.parts)) {
        p.fill.opacity = p.state === 'crit' ? 0.25 + 0.35 * beat : p.state === 'warn' ? 0.3 : 0.16;
        p.line.opacity = p.state === 'crit' ? 0.6 + 0.4 * beat : 0.95;
      }
    }
    if (sos.phase === 'armed' && now > sos.armedUntil) {
      sos.phase = 'idle';
      sos.dirty = true;
    }
    if (pSos.mesh.visible && (sos.dirty || (sos.phase === 'armed' && now - lastSosDraw > 100) || (sos.pressedUntil && now > sos.pressedUntil))) {
      if (now > sos.pressedUntil) sos.pressedUntil = 0;
      sos.hits = drawSos(pSos.g, pSos.canvas.width / E.wDeg, sosVM(now));
      pSos.tex.needsUpdate = true;
      sos.dirty = false;
      lastSosDraw = now;
    }
  }

  return {
    place,
    tick,
    /** The emergency button as a pointer target: pressed by the left hand, or a controller. */
    target: { id: 'sos', panel: pSos, hits: () => sos.hits, press: pressSos, hands: ['left'] },
    setHover(on) {
      if (on !== sos.hover) {
        sos.hover = on;
        sos.dirty = true;
      }
    },
    get sosShown() {
      return st.sos.shown;
    },
    /** No right hand in view any more (or no hands at all): both go, unless pinned. */
    hide() {
      if (pinned) return;
      st.body.shown = st.sos.shown = false;
      pBody.mesh.visible = pSos.mesh.visible = false;
    },
    // ---- console and tests ----
    /** PC: show('body' | 'sos' | null, [x, y, z]) puts one of them in the scene without a hand. */
    show(which, at = [0.6, 1.4, 0.3]) {
      pinned = which || null;
      for (const [name, panel, scale] of [['body', pBody, K.scale], ['sos', pSos, E.scale]]) {
        panel.mesh.visible = which === name;
        if (which !== name) continue;
        panel.mesh.position.fromArray(at);
        panel.mesh.lookAt(ctx.camera.getWorldPosition(headPos));
        panel.mesh.scale.setScalar(scale * 3);
      }
      bodyDirty = sos.dirty = true;
    },
    /** Set readings by hand: set({ o2: 12, pressureKpa: 24, heart: 160, battery: 9, charging: false, legsC: 36 }). null gives a temperature back to the sensor. */
    set(values) {
      if (values.o2 != null) base.o2 = values.o2;
      if (values.pressureKpa != null) base.pressureKpa = values.pressureKpa;
      if (values.heart != null) base.heart = values.heart;
      for (const key of ['headC', 'armsC', 'legsC']) if (values[key] !== undefined) fixed[key] = values[key];
      followTorso();
      reading.heart = base.heart;
      if (values.battery !== undefined) {
        reading.battery = values.battery;
        batteryNote = 'set by hand';
      }
      if (values.charging !== undefined) reading.charging = values.charging;
      reading.o2 = base.o2;
      reading.pressureKpa = base.pressureKpa;
      bodyDirty = true;
    },
    press: pressSos,
    state: () => ({ reading: { ...reading }, states: suitStates(reading, HUD.suit, HUD.suitGauge), sos: { phase: sos.phase, ack: sos.ack }, body: pBody.mesh.visible, sosCard: pSos.mesh.visible }),
  };
}
