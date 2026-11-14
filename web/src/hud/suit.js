// The right hand: the wearer's vital signs and the suit's, at a glance.
//
// Open right palm turned up: a figure of the wearer turns slowly over the palm, as on the
// display of a powered suit in the films. It floats as the map does over the left palm
// (core/hologram.js): a little above the palm, a little away from the wearer and a little
// toward the middle of the body, with a cone of light rising to it from the palm.
//
// The readings use the map's "cylinder" in their own way. The map has one caption card on the
// side of its cylinder; here an imaginary cylinder stands around the figure, wide enough to
// clear its arms, and every reading is a chip of its own: three to the wearer's left of the
// cylinder and three to the right, each standing out from the cylinder's side like a wing,
// square to the wearer, with a thin line to the part of the figure it belongs to. As the
// wearer moves around the hand the chips go around the cylinder, so they are always seen
// straight on and never in front of the figure.
//
// Each reading belongs to a part of the figure, and that part turns orange or red when the
// reading is out of range:
//     head      oxygen (tank level, %)          simulated: there is no oxygen sensor
//               head temperature                simulated
//     torso     body temperature (deg C)        simulated
//               heart rate (bpm)                simulated: there is no pulse sensor
//     arms      arm temperature                 simulated
//     legs      leg temperature                 simulated
//     arms+legs suit pressure (kPa)             simulated: there is no pressure sensor
//     backpack  battery (%)                     the headset's own battery (navigator.getBattery)
//   There is no sensor on the body: every body temperature is simulated (HUD.suit.body). The
//   one real temperature, the sensor on the Jetson, is the air around the wearer: it is shown
//   on its own chip as "Ambient", with no line to the figure, and the simulated body warms a
//   little when it is hot, so heating the sensor shows here too. Simulated readings say "sim".
//   ?simO2=12, ?simPressure=24, ?simHeart=160 and ?simBody=38.5 set values from the address,
//   window.__hud.suit.set({ o2, pressureKpa, heart, bodyC, battery, headC, armsC, legsC }) from the console.
//
// The figure is a scanned human body: artifacts/hud-male/hud_male_blue.glb (role D), made from
// Blender Studio's Human Base Meshes, "Body Male - Realistic", CC0. It is one mesh, so the parts
// that change colour are told apart by where a point of it lies (MODEL below): head above the
// neck, legs below the hips, arms outside a line from the shoulder down along the torso, and
// the torso is the rest. The file comes with the app (the hub serves it); until it has loaded,
// and if it cannot be, a stand-in built here from smooth solids is shown.
//
// Receives: telemetry:update

import * as THREE from 'three';
import { HUD } from './config.js';
import { T } from './tokens.js';
import { suitStates, worst } from './suit-limits.js';
import { makePalmState } from '../core/palm.js';
import { makeBeam, floatOverPalm } from '../core/hologram.js';
import { drawVitalChip } from './draw.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import modelUrl from '../../../artifacts/hud-male/hud_male_blue.glb?url';

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

// Where the parts of the scanned body lie, in its own metres (1.80 m tall, feet at 0, arms
// held a little away from the sides). Measured on the mesh: the neck is narrowest at 1.52 m;
// below 1.23 m there is a gap between torso and arm whose middle runs from x = 0.20 at 1.23 m
// to 0.32 at 0.78 m; the hands end at 0.78 m and the legs part at about 0.86 m.
const MODEL = { heightM: 1.8, neckM: 1.52, hipM: 0.86, armX: 0.2, armFromM: 1.23, armSlope: 0.27, blendM: 0.025 };

// The same hologram skin for the scanned body, one mesh: each part has its own colour and
// strength, mixed over a couple of centimetres where two parts meet.
const BODY_VERTEX = `
uniform vec4 where; // neck height, hip height, arm line x, arm line start height (m)
uniform vec2 line; // arm line slope, blend width (m)
varying vec3 vNormal;
varying vec3 vToEye;
varying float vHeight;
varying vec4 vPart; // how much of head, torso, arms, legs this point is
void main() {
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vToEye = normalize(-view.xyz);
  vHeight = (modelMatrix * vec4(position, 1.0)).y;
  float w = line.y;
  float head = smoothstep(where.x - w, where.x + w, position.y);
  float armLine = where.z + max(0.0, where.w - position.y) * line.x;
  float arm = smoothstep(armLine - w, armLine + w, abs(position.x)) * (1.0 - head);
  float leg = (1.0 - smoothstep(where.y - w, where.y + w, position.y)) * (1.0 - arm);
  vPart = vec4(head, max(0.0, 1.0 - head - arm - leg), arm, leg);
  gl_Position = projectionMatrix * view;
}`;
const BODY_FRAGMENT = `
uniform vec3 colours[4];
uniform vec4 levels;
uniform float time;
varying vec3 vNormal;
varying vec3 vToEye;
varying float vHeight;
varying vec4 vPart;
void main() {
  vec3 colour = colours[0] * vPart.x + colours[1] * vPart.y + colours[2] * vPart.z + colours[3] * vPart.w;
  float level = dot(levels, vPart);
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
    parts[name] = { material, state: '', meshes: [] };
    const add = (geometry) => {
      const mesh = new THREE.Mesh(geometry, material);
      parts[name].meshes.push(mesh);
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
  /**
   * Put the scanned body in place of the stand-in's head, torso, arms and legs (the pack on
   * the back stays as it is). `meshes`: the body's meshes as loaded, in metres.
   */
  function useModel(meshes) {
    const colours = ['head', 'torso', 'arms', 'legs'].map((name) => parts[name].material.uniforms.colour.value.clone());
    const levels = new THREE.Vector4(1, 1, 1, 1);
    const time = { value: 0 };
    const material = new THREE.ShaderMaterial({
      uniforms: {
        colours: { value: colours },
        levels: { value: levels },
        time,
        where: { value: new THREE.Vector4(MODEL.neckM, MODEL.hipM, MODEL.armX, MODEL.armFromM) },
        line: { value: new THREE.Vector2(MODEL.armSlope, MODEL.blendM) },
      },
      vertexShader: BODY_VERTEX,
      fragmentShader: BODY_FRAGMENT,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
    });
    const body = new THREE.Group();
    body.name = 'suit-body';
    body.scale.setScalar(1 / MODEL.heightM); // the figure's own unit is its height
    for (const source of meshes) {
      const mesh = new THREE.Mesh(source.geometry, material);
      const depth = new THREE.Mesh(source.geometry, depthOnly); // the nearest surface only, as for the stand-in
      mesh.renderOrder = 9;
      depth.renderOrder = 8.5;
      mesh.frustumCulled = depth.frustumCulled = false;
      mesh.add(depth);
      body.add(mesh);
    }
    spinner.add(body);
    ['head', 'torso', 'arms', 'legs'].forEach((name, i) => {
      for (const mesh of parts[name].meshes) spinner.remove(mesh);
      parts[name].material.dispose();
      // The same handles the stand-in's parts had, now onto one entry each of the body's material.
      parts[name].material = {
        uniforms: {
          colour: { value: colours[i] },
          level: { get value() { return levels.getComponent(i); }, set value(v) { levels.setComponent(i, v); } },
          time,
        },
      };
      parts[name].meshes = [];
    });
    // The pack sits on the stand-in's back; the scanned back is a little further out.
    for (const mesh of parts.pack.meshes) mesh.position.z = -0.115;
  }

  return { root, spinner, parts, useModel };
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
  const base = { o2: num('simO2', 98), pressureKpa: num('simPressure', K.pressureKpa.nominal), heart: num('simHeart', 72), bodyC: num('simBody', K.body.core) };
  // Temperatures of single parts set by hand (set()), in place of the ones worked out from the body's.
  const fixed = { headC: null, armsC: null, legsC: null };
  const reading = { o2: base.o2, pressureKpa: base.pressureKpa, heart: base.heart, battery: null, charging: false, ambientC: null, tempSource: null, torsoC: null, headC: null, armsC: null, legsC: null };
  let batteryNote = 'not reported by this browser';
  let dirty = true;

  /** The simulated body: the torso at its base temperature, warmer when the air is hot; the other parts a set distance from it. */
  function simulateBody() {
    const B = K.body;
    const heat = reading.ambientC == null ? 0 : Math.max(0, reading.ambientC - B.fromAmbientC) * B.perAmbientC;
    const torso = base.bodyC + heat;
    const next = { torsoC: torso, headC: fixed.headC ?? torso + B.head, armsC: fixed.armsC ?? torso + B.arms, legsC: fixed.legsC ?? torso + B.legs };
    for (const [key, value] of Object.entries(next)) {
      const rounded = Number(value.toFixed(1));
      if (rounded !== reading[key]) dirty = true;
      reading[key] = rounded;
    }
  }
  simulateBody();

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
  // The sensor on the Jetson: the air around the wearer (the field is still called suitTempC).
  ctx.bus.on('telemetry:update', ({ suitTempC, source }) => {
    if (suitTempC !== reading.ambientC || source !== reading.tempSource) dirty = true;
    reading.ambientC = suitTempC ?? null;
    reading.tempSource = source ?? null;
    simulateBody();
  });

  // ---- the hologram ----
  const root = new THREE.Group();
  root.name = 'suit-view';
  root.visible = false;
  ctx.scene.add(root);
  const figure = makeFigure();
  figure.root.scale.setScalar(K.figureM);
  root.add(figure.root, makePlate(K.plateM));
  // The scanned body takes the stand-in's place as soon as it has loaded.
  let modelNote = 'loading';
  new GLTFLoader().load(
    modelUrl,
    (gltf) => {
      const meshes = [];
      gltf.scene.traverse((o) => o.isMesh && meshes.push(o));
      if (!meshes.length) {
        modelNote = 'no mesh in the file: stand-in kept';
        return;
      }
      figure.useModel(meshes);
      modelNote = `scanned body, ${meshes.reduce((n, m) => n + (m.geometry.index?.count ?? 0) / 3, 0)} triangles`;
      dirty = true;
    },
    undefined,
    (err) => {
      modelNote = `not loaded (${err?.message ?? err}): stand-in kept`;
      console.error('[suit] the body model could not be loaded:', err);
    },
  );
  // ---- the readings: chips beside the cylinder ----
  // side: -1 to the wearer's left of the cylinder, +1 to the right. partY: the height on the
  // figure (0 feet, 1 top of the head) its line goes to, or null for a reading that belongs to
  // no part. rows: a table of that many rows instead of one number.
  const UNITS_W = 9.8; // a chip is this many drawing units wide (draw.js: drawVitalChip)
  function makeChip(id, side, partY, rows = 0) {
    const units = rows ? 2.5 + rows * 1.75 + 0.5 : 5.2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(K.chipWM * K.pxPerM);
    canvas.height = Math.round((canvas.width * units) / UNITS_W);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const hM = (K.chipWM * units) / UNITS_W;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(K.chipWM, hM), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    mesh.renderOrder = 10;
    mesh.frustumCulled = false;
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: HOLO, transparent: true, opacity: 0.75, depthTest: false }));
    line.renderOrder = 9;
    line.frustumCulled = false;
    line.visible = partY != null;
    root.add(mesh, line);
    return { id, side, partY, hM, canvas, g: canvas.getContext('2d'), texture, mesh, line, sig: null };
  }
  const chips = [
    makeChip('o2', -1, 0.9),
    makeChip('heart', -1, 0.68),
    makeChip('pressure', -1, 0.3),
    makeChip('battery', 1, 0.72),
    makeChip('body', 1, 0.56, 4),
    makeChip('ambient', 1, null),
  ];
  const toViewer = new THREE.Vector3();
  const across = new THREE.Vector3();
  const facing = new THREE.Matrix4();
  const UP = new THREE.Vector3(0, 1, 0);

  /** Stand the chips to the wearer's left and right of the cylinder, square to the wearer. */
  function placeChips() {
    root.updateWorldMatrix(true, false);
    ctx.camera.getWorldPosition(toViewer);
    root.worldToLocal(toViewer);
    toViewer.y = 0; // around the figure's own upright axis
    if (toViewer.lengthSq() < 1e-8) toViewer.set(0, 0, 1);
    toViewer.normalize();
    across.crossVectors(UP, toViewer).normalize(); // to the wearer's right
    facing.makeBasis(across, UP, toViewer);
    for (const side of [-1, 1]) {
      const column = chips.filter((c) => c.side === side);
      const total = column.reduce((sum, c) => sum + c.hM, 0) + K.gapM * (column.length - 1);
      let top = K.figureM / 2 + total / 2; // the column is centred on the figure's middle
      for (const c of column) {
        const y = top - c.hM / 2;
        const inner = K.ringM + K.gapM; // where the chip's near edge meets the cylinder's side
        c.mesh.quaternion.setFromRotationMatrix(facing);
        c.mesh.position.copy(across).multiplyScalar(side * (inner + K.chipWM / 2));
        c.mesh.position.y = y;
        if (c.partY != null) {
          const at = c.line.geometry.attributes.position;
          at.setXYZ(0, across.x * side * inner, y, across.z * side * inner);
          at.setXYZ(1, across.x * side * 0.02, c.partY * K.figureM, across.z * side * 0.02);
          at.needsUpdate = true;
        }
        top -= c.hM + K.gapM;
      }
    }
  }

  /** What each chip shows now. */
  function chipVMs(z) {
    const show_ = (v, digits) => (v == null ? '—' : v.toFixed(digits));
    return {
      o2: { label: 'Oxygen', value: show_(reading.o2, 0), unit: '%', tag: 'sim', state: z.o2 },
      heart: { label: 'Heart rate', value: show_(reading.heart, 0), unit: 'bpm', tag: 'sim', state: z.heart },
      pressure: { label: 'Pressure', value: show_(reading.pressureKpa, 1), unit: 'kPa', tag: 'sim', state: z.pressure },
      battery: { label: 'Battery', value: show_(reading.battery, 0), unit: '%', tag: reading.battery == null ? 'n/a' : reading.charging ? 'charging' : 'headset', state: z.battery },
      body: {
        label: 'Body temp',
        unit: '°C',
        tag: 'sim',
        state: worst(z.temp, z.headTemp, z.armsTemp, z.legsTemp),
        rows: [
          { label: 'Head', value: show_(reading.headC, 1), state: z.headTemp },
          { label: 'Torso', value: show_(reading.torsoC, 1), state: z.temp },
          { label: 'Arms', value: show_(reading.armsC, 1), state: z.armsTemp },
          { label: 'Legs', value: show_(reading.legsC, 1), state: z.legsTemp },
        ],
      },
      // The one real temperature: the sensor on the suit, the air around the wearer.
      ambient: { label: 'Ambient', value: show_(reading.ambientC, 1), unit: '°C', tag: reading.ambientC == null ? 'n/a' : reading.tempSource === 'mock' ? 'mock' : 'sensor', state: reading.ambientC == null ? '' : reading.ambientC >= HUD.suitGauge.crit ? 'crit' : reading.ambientC >= HUD.suitGauge.warn ? 'warn' : '' },
    };
  }
  const beam = makeBeam('suit-beam');
  root.add(beam);
  const palmState = makePalmState();
  const floatState = { shownSince: null };
  let pinned = false; // PC: shown without a hand

  const colourOf = (state) => (state === 'crit' ? T.dangerLine : state === 'warn' ? T.point : HOLO);
  const show = (v, digits) => (v == null ? '—' : v.toFixed(digits));

  /** The readings in words, and the states behind them (console and tests). */
  function describe() {
    const z = suitStates(reading, HUD.suit);
    const wrong = [];
    const note = (state, text) => state && wrong.push(text);
    note(z.o2, `oxygen ${show(reading.o2, 0)} %`);
    note(z.heart, `heart rate ${show(reading.heart, 0)} bpm`);
    note(z.pressure, `pressure ${show(reading.pressureKpa, 1)} kPa`);
    note(z.headTemp, `head ${show(reading.headC, 1)} °C`);
    note(z.temp, `torso ${show(reading.torsoC, 1)} °C`);
    note(z.armsTemp, `arms ${show(reading.armsC, 1)} °C`);
    note(z.legsTemp, `legs ${show(reading.legsC, 1)} °C`);
    note(z.battery, `battery ${show(reading.battery, 0)} %`);
    const level = worst(...Object.values(z));
    const ambient = reading.ambientC == null ? 'no reading' : `${show(reading.ambientC, 1)} °C (${reading.tempSource === 'mock' ? 'mock' : 'sensor'})`;
    return {
      states: z,
      level,
      lines: [
        `VITALS · ${wrong.length ? `${wrong.length} out of range` : 'all in range'}`,
        `Oxygen ${show(reading.o2, 0)} % · Heart ${show(reading.heart, 0)} bpm · Pressure ${show(reading.pressureKpa, 1)} kPa   (sim)`,
        `Body °C · head ${show(reading.headC, 1)} · torso ${show(reading.torsoC, 1)} · arms ${show(reading.armsC, 1)} · legs ${show(reading.legsC, 1)}   (sim)`,
        wrong.length ? `Check: ${wrong.join(' · ')}` : 'Helmet, torso, arms, legs, pack: nothing to report',
        `Ambient ${ambient} · Battery ${show(reading.battery, 0)} % (${batteryNote})`,
        'sim = simulated, no sensor on the body. Ambient: the temperature sensor on the suit.',
      ],
    };
  }

  function redraw() {
    const z = suitStates(reading, HUD.suit);
    const vms = chipVMs(z);
    for (const c of chips) {
      const vm = vms[c.id];
      const sig = JSON.stringify(vm);
      if (sig !== c.sig) {
        c.sig = sig;
        drawVitalChip(c.g, c.canvas.width / UNITS_W, vm);
        c.texture.needsUpdate = true;
      }
      c.line.material.color.set(colourOf(vm.state));
    }
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
    placeChips();
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
    /** The readings as they are now, and which of them are out of range ('' | 'warn' | 'crit'): the status card shows some of them. */
    readings: () => reading,
    states: () => suitStates(reading, HUD.suit),
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
    /** Set readings by hand: set({ o2: 12, pressureKpa: 24, heart: 160, bodyC: 38.5, battery: 9, charging: false, legsC: 34 }). null gives a part's temperature back to the simulation. */
    set(values) {
      if (values.o2 != null) base.o2 = values.o2;
      if (values.pressureKpa != null) base.pressureKpa = values.pressureKpa;
      if (values.heart != null) base.heart = values.heart;
      if (values.bodyC != null) base.bodyC = values.bodyC;
      for (const key of ['headC', 'armsC', 'legsC']) if (values[key] !== undefined) fixed[key] = values[key];
      simulateBody();
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
    state: () => ({ reading: { ...reading }, ...describe(), shown: root.visible, model: modelNote }),
  };
}
