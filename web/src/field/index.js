// field — where the wearer really is, the local field map, and guidance on the floor.
//
// The premise: the wearer stands at a known place on Mars. Everything the headset tracks is laid
// over the NASA map at that place.
//
// In both modes
//   - The head position tracked by the headset moves the wearer's marker on the Mars map
//     (`nav:position`). In Mars mode a step is magnified (WALK.marsScale) so that walking across
//     a room crosses a visible part of the 2 km map; in field mode it is 1 : 1.
//
// In field mode (the second button on the start page)
//   - The palm map is the Mars map zoomed in to FIELD.spanM around the wearer, 1 : 1 with the
//     room. At this scale the orbital image is a blur of a few dozen pixels; that is the point.
//   - Where the headset has scanned the room (`hazard:update` from scan/), the map is rewritten
//     with what is really there: structure and clear floor. Outside the scanned area the map is
//     still the Mars data. To the map it is as if a structure had appeared on Mars.
//     The scan arrives at most twice a second, and with live depth (on by default in this mode,
//     core/xr.js) it includes what was put down or taken away a moment ago: the map follows.
//   - It is the same kind of object as the Mars map (core/hologram.js): a relief floating over
//     the palm with a beam from the hand, the Mars terrain as its ground and the scanned
//     structure standing on it, and everything written about it on the caption card that goes
//     around the map's cylinder. Nothing is written on the map surface.
//   - "Mark target" (voice or the command menu) sets the target where the wearer stands. Away
//     from it, the way back is planned around the scanned structure and shown twice: as arrows
//     on the real floor and as a line on the map. "Navigate" / "Stop" turn the guidance on and
//     off; saying "Mark target" again moves the target.
//
// Receives: layers:ready, hazard:update, voice:command, app:mode
// Sends:    nav:position { point: [x, 0, z] in map metres, source: 'headset' }
//           nav:route (field mode only; targetId 'mark', points in room coordinates), voice:say

import * as THREE from 'three';
import { mode } from '../core/mode.js';
import { makePalmState } from '../core/palm.js';
import { makeBeam, makeCaption, writeCaption, placeCaption, floatOverPalm } from '../core/hologram.js';
import { MAP } from '../map/config.js';
import { sampleHeight } from '../map/terrain.js';
import { createGridFrame, cellToWorld, worldToCell } from '../nav/coordinates.js';
import { planPath } from './planner.js';

const q = new URLSearchParams(location.search);

export const WALK = {
  /** Mars mode: one real metre moves the map marker this many metres */
  marsScale: Number(q.get('walkScale')) || 100,
  /** Which waypoint the wearer stands on when the session starts */
  startAt: q.get('fieldAt') || 'base',
  emitMs: 200,
};

export const FIELD = {
  spanM: 20, // the palm map shows spanM x spanM around the wearer
  mapM: MAP.widthM, // size of the palm map (m): the same as the Mars map
  mapPx: 512,
  segments: 128, // the map surface is a grid of this many quads per side, raised into a relief
  structureM: 1.0, // scanned structure stands this tall on the map, in room metres (the scan has no heights)
  reliefMaxM: 3, // the Mars terrain under the wearer rises and falls at most this much on the map (room metres)
  redrawMs: 200,
  showRouteBeyondM: 1.0, // the route appears once the wearer is this far from the target
  arrivedM: 0.5,
  replanMs: 500,
  arrowEveryM: 0.4,
  maxArrows: 160,
};

let ctx;
let group; // everything this module draws in the room
let arrows;
let beacon;
let beaconLabel;
let palmMap; // { root, surface, canvas, g, tex, caption, beam, mask }
const floatState = { shownSince: null };
let topo = null; // Float32Array of the Mars terrain heights (layers:ready grids.topo)
const palmState = makePalmState();

let layerSet = null;
let frameT = null; // D's map metre frame
let anchorMap = null; // map metres where the session started
let optical = null; // HTMLImageElement of the optical layer
let grid = null; // latest hazard:update
let gridCanvas = null; // the scan drawn at grid resolution
const head = new THREE.Vector3();
let heading = 0; // radians, 0 = facing -z (north on the map), clockwise positive
const headStart = new THREE.Vector3();
let haveHead = false;
let target = null; // THREE.Vector3 on the floor, or null
let guiding = false;
let route = { points: [], distanceM: 0, blocked: false };
let lastPlan = 0;
let lastEmitPos = 0;
let lastEmitRoute = 0;
let lastDraw = 0;
let lastStatus = null;
let simulated = null; // PC testing: { x, z, heading }

const v = new THREE.Vector3();
const dummy = new THREE.Object3D();

// ---------- scene objects ----------
function makeArrows() {
  // A chevron lying on the floor, pointing along -z before it is rotated.
  const s = new THREE.Shape();
  s.moveTo(0, 0.11);
  s.lineTo(0.13, -0.05);
  s.lineTo(0.13, -0.11);
  s.lineTo(0, 0.05);
  s.lineTo(-0.13, -0.11);
  s.lineTo(-0.13, -0.05);
  s.closePath();
  const geometry = new THREE.ShapeGeometry(s);
  geometry.rotateX(-Math.PI / 2); // shape +y -> world -z
  const material = new THREE.MeshBasicMaterial({ color: 0x8e9dff, transparent: true, opacity: 0.95, depthTest: false, side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(geometry, material, FIELD.maxArrows);
  mesh.name = 'field-arrows';
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 20;
  return mesh;
}

function makeBeacon() {
  const g = new THREE.Group();
  g.name = 'field-target';
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.22, 0.3, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xf27a0a, transparent: true, opacity: 0.95, depthTest: false, side: THREE.DoubleSide }),
  );
  ring.position.y = 0.012;
  const dot = new THREE.Mesh(
    new THREE.CircleGeometry(0.06, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xf27a0a, transparent: true, depthTest: false, side: THREE.DoubleSide }),
  );
  dot.position.y = 0.012;
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 1.5, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xf27a0a, transparent: true, opacity: 0.45, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
  );
  pillar.position.y = 0.75;
  for (const m of [ring, dot, pillar]) {
    m.renderOrder = 21;
    g.add(m);
  }
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  beaconLabel = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  beaconLabel.scale.set(0.5, 0.125, 1);
  beaconLabel.position.y = 1.62;
  beaconLabel.renderOrder = 22;
  beaconLabel.userData = { canvas, tex, text: '' };
  g.add(beaconLabel);
  g.visible = false;
  return g;
}

function setBeaconLabel(text) {
  const u = beaconLabel.userData;
  if (u.text === text) return;
  u.text = text;
  const g = u.canvas.getContext('2d');
  g.clearRect(0, 0, 512, 128);
  g.fillStyle = 'rgba(20, 24, 32, 0.9)';
  g.beginPath();
  g.roundRect(4, 14, 504, 100, 30);
  g.fill();
  g.strokeStyle = '#f27a0a';
  g.lineWidth = 5;
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = '700 56px "Atkinson Hyperlegible", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 66);
  u.tex.needsUpdate = true;
}

function makePalmMap() {
  const root = new THREE.Group();
  root.name = 'field-map';
  root.visible = false;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = FIELD.mapPx;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // The surface lies flat: +x east, -z north, like the room it shows. Row 0 of its vertices is
  // the north edge and the top of the canvas. Its heights are set in updateRelief.
  const N = FIELD.segments;
  const geometry = new THREE.PlaneGeometry(FIELD.mapM, FIELD.mapM, N, N).rotateX(-Math.PI / 2);
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array((N + 1) * (N + 1) * 3).fill(1), 3));
  const surface = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, side: THREE.DoubleSide, toneMapped: false }));
  surface.name = 'field-map-surface';
  surface.frustumCulled = false; // its heights change without the bounding sphere being recomputed
  const beam = makeBeam('field-palm-beam');
  beam.visible = false;
  root.add(surface, beam);
  const caption = makeCaption(root, 'field-map-caption');
  return { root, surface, canvas, g: canvas.getContext('2d'), tex, caption, beam, mask: new Uint8Array((N + 1) * (N + 1)) };
}

// ---------- map drawing ----------
// Scan colours: structure, and floor the headset has seen to be clear.
const STRUCTURE = [255, 169, 77, 240];
const CLEAR = [60, 70, 86, 215];

function drawGridCanvas() {
  if (!grid) return;
  gridCanvas ??= document.createElement('canvas');
  gridCanvas.width = grid.cols;
  gridCanvas.height = grid.rows;
  const g = gridCanvas.getContext('2d');
  const img = g.createImageData(grid.cols, grid.rows);
  for (let i = 0; i < grid.cells.length; i++) {
    const c = grid.cells[i] === 1 ? STRUCTURE : grid.cells[i] === 0 ? CLEAR : null;
    if (c) img.data.set(c, i * 4);
  }
  g.putImageData(img, 0, 0);
}

function drawPalmMap() {
  const { g, canvas, tex } = palmMap;
  const W = canvas.width;
  const span = FIELD.spanM;
  const k = W / span; // pixels per metre
  const toPx = (x, z) => [(x - head.x) * k + W / 2, (z - head.z) * k + W / 2];
  g.save();
  g.clearRect(0, 0, W, W);
  g.fillStyle = '#3a2a22';
  g.fillRect(0, 0, W, W);

  // 1. Mars data under the wearer: the optical image, cut out 1 : 1 around the position on Mars.
  if (optical && frameT && anchorMap) {
    const cx = anchorMap[0] + (head.x - headStart.x);
    const cz = anchorMap[2] + (head.z - headStart.z);
    const pxPerM = optical.naturalWidth / frameT.width;
    const sw = span * pxPerM;
    const sx = (cx + frameT.width / 2) * pxPerM - sw / 2;
    const sy = (cz + frameT.depth / 2) * (optical.naturalHeight / frameT.depth) - sw / 2;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(optical, sx, sy, sw, sw, 0, 0, W, W);
    g.fillStyle = 'rgba(120, 60, 30, 0.22)'; // a hint of Mars colour on the grey orbital image
    g.fillRect(0, 0, W, W);
    // Cells of the Mars layers (4 m): how coarse the orbital data is at walking scale.
    g.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    g.lineWidth = 1;
    const cell = frameT.sx;
    const x0 = Math.floor((cx - span / 2 + frameT.width / 2) / cell) * cell - frameT.width / 2;
    const z0 = Math.floor((cz - span / 2 + frameT.depth / 2) / cell) * cell - frameT.depth / 2;
    g.beginPath();
    for (let x = x0; x < cx + span / 2; x += cell) {
      const px = (x - cx) * k + W / 2;
      g.moveTo(px, 0);
      g.lineTo(px, W);
    }
    for (let z = z0; z < cz + span / 2; z += cell) {
      const pz = (z - cz) * k + W / 2;
      g.moveTo(0, pz);
      g.lineTo(W, pz);
    }
    g.stroke();
  }

  // 2. What the headset scanned replaces the Mars data, only where it was scanned.
  if (grid && gridCanvas) {
    const [gx, gz] = toPx(grid.originXZ[0], grid.originXZ[1]);
    g.imageSmoothingEnabled = false;
    g.drawImage(gridCanvas, gx, gz, grid.cols * grid.cellSizeM * k, grid.rows * grid.cellSizeM * k);
  }

  // 3. Route and target.
  if (guiding && route.points.length > 1) {
    g.strokeStyle = '#8e9dff';
    g.lineWidth = 7;
    g.lineJoin = g.lineCap = 'round';
    g.beginPath();
    route.points.forEach(([x, z], i) => {
      const [px, pz] = toPx(x, z);
      if (i) g.lineTo(px, pz);
      else g.moveTo(px, pz);
    });
    g.stroke();
  }
  if (target) {
    const [tx, tz] = toPx(target.x, target.z);
    const px = Math.max(16, Math.min(W - 16, tx));
    const pz = Math.max(16, Math.min(W - 16, tz));
    g.fillStyle = '#f27a0a';
    g.strokeStyle = '#ffffff';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(px, pz - 15);
    g.lineTo(px + 13, pz);
    g.lineTo(px, pz + 15);
    g.lineTo(px - 13, pz);
    g.closePath();
    g.fill();
    g.stroke();
  }

  // 4. The wearer: always in the middle, pointing where they face.
  g.save();
  g.translate(W / 2, W / 2);
  g.rotate(heading);
  g.fillStyle = '#5bdbba';
  g.strokeStyle = '#0b0d10';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, -17);
  g.lineTo(12, 13);
  g.lineTo(0, 6);
  g.lineTo(-12, 13);
  g.closePath();
  g.fill();
  g.stroke();
  g.restore();

  g.restore();
  tex.needsUpdate = true;
}

// Is there scanned structure within `reach` metres of this room position?
function structureNear(x, z, reach) {
  const cell = grid.cellSizeM;
  const c0 = Math.max(0, Math.floor((x - reach - grid.originXZ[0]) / cell));
  const c1 = Math.min(grid.cols - 1, Math.floor((x + reach - grid.originXZ[0]) / cell));
  const r0 = Math.max(0, Math.floor((z - reach - grid.originXZ[1]) / cell));
  const r1 = Math.min(grid.rows - 1, Math.floor((z + reach - grid.originXZ[1]) / cell));
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (grid.cells[r * grid.cols + c] === 1) return true;
  return false;
}

// Height of the Mars terrain under a room position, in metres as the data has it; NaN if unknown.
const mapPoint = [0, 0, 0];
function terrainHeight(x, z) {
  mapPoint[0] = anchorMap[0] + (x - headStart.x);
  mapPoint[2] = anchorMap[2] + (z - headStart.z);
  // Beyond the edge of the Mars data the last known height carries on: no cliff at the map's rim.
  const [c, r] = worldToCell(frameT, mapPoint);
  return sampleHeight(topo, layerSet.grid, Math.max(0, Math.min(frameT.cols - 1, c)), Math.max(0, Math.min(frameT.rows - 1, r)));
}

// Raise the map surface into a relief: the Mars terrain as the ground, at true scale, and the
// scanned structure standing on it. The ground right next to structure is darkened, so walls
// and furniture read as solid shapes from above.
function updateRelief() {
  const { surface, mask } = palmMap;
  const N = FIELD.segments;
  const side = N + 1;
  const step = FIELD.spanM / N;
  const scale = FIELD.mapM / FIELD.spanM; // map metres per room metre
  const pos = surface.geometry.attributes.position;
  const col = surface.geometry.attributes.color;
  const terrain = !!(topo && frameT && anchorMap && layerSet?.grid);
  // The ground is drawn relative to where the wearer stands: the map's centre is at height 0.
  const here = terrain ? terrainHeight(head.x, head.z) : NaN;
  const ground = (x, z) => {
    const h = terrainHeight(x, z) - here;
    return Number.isFinite(h) ? Math.max(-FIELD.reliefMaxM, Math.min(FIELD.reliefMaxM, h)) : 0;
  };
  for (let r = 0; r < side; r++) {
    const z = head.z + (r / N - 0.5) * FIELD.spanM;
    for (let c = 0; c < side; c++) {
      mask[r * side + c] = grid && structureNear(head.x + (c / N - 0.5) * FIELD.spanM, z, step / 2) ? 1 : 0;
    }
  }
  for (let r = 0; r < side; r++) {
    const z = head.z + (r / N - 0.5) * FIELD.spanM;
    for (let c = 0; c < side; c++) {
      const i = r * side + c;
      const base = Number.isFinite(here) ? ground(head.x + (c / N - 0.5) * FIELD.spanM, z) : 0;
      pos.setY(i, (base + (mask[i] ? FIELD.structureM : 0)) * scale);
      const beside = !mask[i] && ((c > 0 && mask[i - 1]) || (c < N && mask[i + 1]) || (r > 0 && mask[i - side]) || (r < N && mask[i + side]));
      const shade = beside ? 0.45 : 1;
      col.setXYZ(i, shade, shade, shade);
    }
  }
  pos.needsUpdate = true;
  col.needsUpdate = true;
}

// Everything written about the field map: on the card around the map's cylinder, as on the Mars map.
function writeFieldCaption() {
  const stats = grid?.stats;
  const live = grid?.source === 'room-scan+depth';
  const source = !grid ? 'Waiting for the room scan' : grid.source ? `Room scan${live ? ' + live depth' : ''} · Quest 3` : 'Scan · simulated obstacle';
  let note = 'Orange: scanned structure · say "Mark target" where you stand';
  if (target) {
    const d = Math.hypot(target.x - head.x, target.z - head.z).toFixed(1);
    note = !guiding ? `Target ${d} m · guidance off` : lastStatus === 'blocked' ? `Target ${d} m · no clear way through` : `Target ${d} m · violet: the way back`;
  }
  writeCaption(palmMap.caption, [
    `${layerSet?.mock ? 'SYNTHETIC · ' : ''}Field map · ${FIELD.spanM} m around you · N ↑`,
    source,
    `Map extent ${FIELD.spanM} × ${FIELD.spanM} m · ${grid ? grid.cellSizeM : 0.1} m/cell · 1 : 1 with the room`,
    note,
    stats ? `${stats.obstacles} structure cells${live ? `, ${stats.depth} seen by live depth just now` : ''} · teal: you` : 'Teal: you · orange diamond: target',
    'Outside the scan: MRO HiRISE optical on the USGS 1 m terrain (orbital data)',
  ]);
}

// ---------- guidance ----------
function say(text, priority = 'normal') {
  ctx.bus.emit('voice:say', { text, priority });
}

function publishRoute(status, now, force = false) {
  if (!force && status === lastStatus && now - lastEmitRoute < 250) return;
  lastStatus = status;
  lastEmitRoute = now;
  ctx.bus.emit('nav:route', {
    status,
    targetId: 'mark',
    points: status === 'ok' ? route.points.map(([x, z]) => [x, 0, z]) : [],
    distanceM: status === 'ok' ? route.distanceM : 0,
    reason: status === 'blocked' ? 'no way through the scanned structure' : '',
    frame: 'room',
  });
}

function markTarget() {
  if (!haveHead) {
    say('Position not tracked yet.');
    return;
  }
  target = new THREE.Vector3(head.x, 0, head.z);
  guiding = true;
  beacon.position.copy(target);
  beacon.visible = true;
  lastPlan = 0;
  say('Target marked.');
}

function clearTarget() {
  target = null;
  guiding = false;
  beacon.visible = false;
  arrows.count = 0;
  route = { points: [], distanceM: 0, blocked: false };
  publishRoute('cancelled', performance.now(), true);
}

function onVoice({ intent }) {
  if (mode.current !== 'field') return;
  if (intent === 'nav.mark') markTarget();
  else if (intent === 'nav.start') {
    if (!target) say('No target yet. Say mark target where you want to return.');
    else {
      guiding = true;
      lastPlan = 0;
    }
  } else if (intent === 'nav.stop') {
    guiding = false;
    arrows.count = 0;
    publishRoute('cancelled', performance.now(), true);
  }
}

function layArrows(now) {
  const pts = route.points;
  let n = 0;
  if (guiding && pts.length > 1) {
    // Walk along the path and drop a chevron every arrowEveryM, starting a step ahead.
    let carried = FIELD.arrowEveryM * 0.8;
    const phase = ((now / 1000) * 1.2) % 1; // a slow ripple toward the target
    for (let i = 1; i < pts.length && n < FIELD.maxArrows; i++) {
      const [ax, az] = pts[i - 1];
      const [bx, bz] = pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-4) continue;
      const yaw = Math.atan2(-(bx - ax), -(bz - az)); // rotation about +y that turns -z toward the step
      let d = carried;
      while (d < len && n < FIELD.maxArrows) {
        const t = d / len;
        dummy.position.set(ax + (bx - ax) * t, 0.015, az + (bz - az) * t);
        dummy.rotation.set(0, yaw, 0);
        const pulse = 0.85 + 0.25 * Math.max(0, Math.sin((n * 0.35 - phase) * Math.PI * 2));
        dummy.scale.setScalar(pulse);
        dummy.updateMatrix();
        arrows.setMatrixAt(n++, dummy.matrix);
        d += FIELD.arrowEveryM;
      }
      carried = d - len;
    }
  }
  arrows.count = n;
  arrows.instanceMatrix.needsUpdate = true;
}

function guide(now) {
  if (!target) return;
  const dist = Math.hypot(target.x - head.x, target.z - head.z);
  setBeaconLabel(`TARGET · ${dist.toFixed(1)} m`);
  beaconLabel.visible = dist > 0.8;
  if (!guiding) return;
  if (dist < FIELD.arrivedM) {
    arrows.count = 0;
    if (lastStatus === 'ok') {
      publishRoute('arrived', now, true);
      say('You have arrived at the target.');
    }
    return;
  }
  if (dist < FIELD.showRouteBeyondM && lastStatus !== 'ok') return;
  if (now - lastPlan >= FIELD.replanMs) {
    lastPlan = now;
    route = planPath(grid, [head.x, head.z], [target.x, target.z]);
    if (route.blocked) {
      arrows.count = 0;
      if (lastStatus !== 'blocked') say('No clear way to the target.');
      publishRoute('blocked', now);
      return;
    }
    if (lastStatus !== 'ok') say(`Target is ${Math.max(1, Math.round(dist))} metres away. Follow the arrows.`);
    publishRoute('ok', now);
  }
  layArrows(now);
}

// ---------- position ----------
function readHead(frame) {
  if (simulated) {
    head.set(simulated.x, 1.6, simulated.z);
    heading = simulated.heading ?? 0;
    return true;
  }
  if (!frame.xrFrame || !frame.refSpace) return false;
  const pose = frame.xrFrame.getViewerPose(frame.refSpace);
  if (!pose) return false;
  const p = pose.transform.position;
  head.set(p.x, p.y, p.z);
  ctx.camera.getWorldDirection(v);
  heading = Math.atan2(v.x, -v.z);
  return true;
}

function startTracking() {
  headStart.copy(head);
  const wp = layerSet?.waypoints?.find((w) => w.id === WALK.startAt) ?? layerSet?.waypoints?.[0];
  anchorMap = frameT && wp ? cellToWorld(frameT, wp.cell) : null;
}

function emitPosition(now) {
  if (!anchorMap || now - lastEmitPos < WALK.emitMs) return;
  lastEmitPos = now;
  const s = mode.current === 'field' ? 1 : WALK.marsScale;
  ctx.bus.emit('nav:position', {
    point: [anchorMap[0] + (head.x - headStart.x) * s, 0, anchorMap[2] + (head.z - headStart.z) * s],
    source: 'headset',
    scale: s,
  });
}

function placePalmMap(frame) {
  const { root, beam, caption } = palmMap;
  if (!frame.session) {
    // PC view: where the Mars map stands in Mars mode, at the same size and tilt.
    floatState.shownSince = null;
    beam.visible = false;
    root.visible = true;
    root.position.set(0, 0.85, 0);
    root.quaternion.identity();
    root.rotation.x = MAP.desktopTiltRad;
    root.scale.setScalar(MAP.desktopScale);
  } else {
    // Headset: over the left palm, exactly as the Mars map floats (core/hologram.js).
    root.scale.setScalar(1);
    floatOverPalm(root, beam, frame, ctx.camera, palmState, floatState, { holdMs: MAP.holdMs, followRate: MAP.followRate, widthM: FIELD.mapM });
  }
  placeCaption(caption, root, ctx.camera, FIELD.mapM);
}

// ---------- module interface ----------
export function init(context) {
  ctx = context;
  group = new THREE.Group();
  group.name = 'field';
  arrows = makeArrows();
  beacon = makeBeacon();
  palmMap = makePalmMap();
  group.add(arrows, beacon, palmMap.root);
  ctx.scene.add(group);

  ctx.bus.on('layers:ready', ({ layerSet: ls, grids }) => {
    layerSet = ls;
    topo = grids?.topo?.length === ls.grid?.cols * ls.grid?.rows ? grids.topo : null;
    try {
      frameT = createGridFrame(ls);
    } catch {
      frameT = null;
    }
    const layer = ls.layers?.find((l) => l.id === 'optical');
    if (layer?.file) {
      const img = new Image();
      img.onload = () => {
        optical = img;
      };
      img.src = ctx.assetUrl(layer.file);
    }
    if (haveHead) startTracking();
  });
  ctx.bus.on('hazard:update', (h) => {
    grid = h;
    drawGridCanvas();
    lastPlan = 0; // the structure changed: plan again
  });
  ctx.bus.on('voice:command', onVoice);
  ctx.bus.on('app:mode', () => {
    if (mode.current !== 'field') clearTarget();
  });
  ctx.xr.onSessionStart(() => {
    haveHead = false; // the room frame starts over with the session
    floatState.shownSince = null;
    palmMap.root.visible = false;
    clearTarget();
  });

  // PC testing without a headset: __field.walk(x, z, headingDeg), __field.mark(), __field.state()
  window.__field = {
    walk(x, z, headingDeg = 0) {
      simulated = { x, z, heading: THREE.MathUtils.degToRad(headingDeg) };
    },
    mark: markTarget,
    clear: clearTarget,
    state: () => ({ mode: mode.current, head: [head.x, head.z], target: target && [target.x, target.z], guiding, status: lastStatus, route: route.points.length, distanceM: route.distanceM, arrows: arrows.count }),
    /** The map as drawn: caption text, how many surface vertices stand on structure, the tallest point (m on the map). */
    map: () => {
      const y = palmMap.surface.geometry.attributes.position;
      let top = -Infinity;
      let low = Infinity;
      for (let i = 0; i < y.count; i++) {
        top = Math.max(top, y.getY(i));
        low = Math.min(low, y.getY(i));
      }
      const centre = y.getY((FIELD.segments / 2) * (FIELD.segments + 1) + FIELD.segments / 2);
      return { visible: palmMap.root.visible, caption: palmMap.caption.userData.text.split('\n'), raised: palmMap.mask.reduce((n, m) => n + m, 0), topM: top, lowM: low, centreM: centre, source: grid?.source ?? null };
    },
  };
}

export function update(frame) {
  const now = performance.now();
  const tracked = readHead(frame);
  if (tracked && !haveHead) {
    haveHead = true;
    startTracking();
  }
  if (!tracked) haveHead = haveHead && !!simulated;
  if (haveHead) emitPosition(now);

  const field = mode.current === 'field';
  group.visible = field;
  if (!field) return;

  // In field mode the palm shows the field map, so the whole-Mars map steps aside.
  const mars = ctx.scene.getObjectByName('palm-map');
  if (mars) mars.visible = false;

  if (haveHead) guide(now);
  placePalmMap(frame);
  if (palmMap.root.visible && now - lastDraw > FIELD.redrawMs) {
    lastDraw = now;
    drawPalmMap();
    updateRelief();
    writeFieldCaption();
  }
}
