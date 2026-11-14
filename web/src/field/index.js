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
//   - What moves on the map (the wearer, the target, the route) floats above its surface.
//   - "Mark target" (voice or the command menu) sets the target where the wearer stands. Away
//     from it, the way back is planned around the scanned structure and shown twice: as arrows
//     on the real floor and as a line on the map. "Navigate" / "Stop" turn the guidance on and
//     off; saying "Mark target" again moves the target.
//
// Receives: layers:ready, hazard:update, voice:command, app:mode,
//           field:target { point: [x, z] room metres } (a place picked on the map with the pointer)
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
import { createGuide, makeRibbon, GUIDE } from './guide.js';

const q = new URLSearchParams(location.search);

export const WALK = {
  /** Mars mode: one real metre moves the map marker at most this many metres. Without
   *  ?walkScale= the scale is set for each route so that it is routeRoomM of real walking
   *  (fitRoute): a 20 m route and a 390 m route are both a few steps across the room. */
  marsScale: Number(q.get('walkScale')) || 100,
  scaleFixed: q.has('walkScale'),
  routeRoomM: 3,
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
  markerLiftM: 0.014, // the wearer's arrow and the target float this far above the map's surface (m on the map)
};

let ctx;
let group; // everything this module draws in the room
let fx; // guidance in the room: the path on the floor and the marker at its end (guide.js)
let marsScale = WALK.marsScale; // Mars mode: map metres per real metre, as it is now (fitRoute)
let marsRoute = null; // Mars mode: the planned route, { points: [[x, z] map metres], targetId, distanceM }
let fitNext = false; // the next Mars route is a new request: set the scale for it
let lastMarsLay = 0;
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
// What moves on the map floats above it as objects of its own: the wearer's arrow, the target,
// the route. Painted into the map's picture they were draped over the relief like a slide
// projected onto a hand: half on a wall's top, half on the floor beside it.
function makeMapMarkers(root) {
  const flat = (material) => Object.assign(material, { depthTest: false, transparent: true });
  // The wearer: an arrowhead pointing where they face (north on the map is -z), with a dark rim.
  const head_ = new THREE.Shape();
  head_.moveTo(0, 0.0085);
  head_.lineTo(0.006, -0.0065);
  head_.lineTo(0, -0.003);
  head_.lineTo(-0.006, -0.0065);
  head_.closePath();
  const arrowShape = new THREE.ShapeGeometry(head_).rotateX(-Math.PI / 2);
  const you = new THREE.Group();
  you.name = 'field-map-you';
  const rim = new THREE.Mesh(arrowShape, flat(new THREE.MeshBasicMaterial({ color: 0x0b0d10, side: THREE.DoubleSide })));
  rim.scale.setScalar(1.3);
  rim.position.y = -0.0003;
  const body = new THREE.Mesh(arrowShape, flat(new THREE.MeshBasicMaterial({ color: 0x5bdbba, side: THREE.DoubleSide })));
  const youStem = new THREE.Mesh(new THREE.CylinderGeometry(0.0004, 0.0004, 1, 6).translate(0, -0.5, 0), flat(new THREE.MeshBasicMaterial({ color: 0x5bdbba, opacity: 0.7 })));
  you.add(rim, body, youStem);

  // The target: a diamond on a stem, the colour of the marker in the room.
  const goal = new THREE.Group();
  goal.name = 'field-map-target';
  const gemShape = new THREE.OctahedronGeometry(0.0055).scale(0.75, 1.2, 0.75);
  const gem = new THREE.Mesh(gemShape, flat(new THREE.MeshBasicMaterial({ color: GUIDE.target })));
  const gemRim = new THREE.LineSegments(new THREE.EdgesGeometry(gemShape), flat(new THREE.LineBasicMaterial({ color: 0xffffff })));
  const goalStem = new THREE.Mesh(new THREE.CylinderGeometry(0.0004, 0.0004, 1, 6).translate(0, -0.5, 0), flat(new THREE.MeshBasicMaterial({ color: GUIDE.target, opacity: 0.8 })));
  goal.add(gem, gemRim, goalStem);

  // The route: a band just above the surface, rising and falling with it.
  const route_ = makeRibbon(96, flat(new THREE.MeshBasicMaterial({ color: GUIDE.path, opacity: 0.95, side: THREE.DoubleSide })));
  route_.mesh.name = 'field-map-route';

  for (const [object, order] of [[route_.mesh, 21], [goal, 23], [you, 24]]) {
    object.traverse((o) => {
      o.renderOrder = order;
      o.frustumCulled = false;
    });
    object.visible = false;
    root.add(object);
  }
  return { you, youStem, goal, goalStem, route: route_ };
}

/** Put the floating markers where they belong on the map as it is drawn now. Every frame while the map shows. */
function placeMapMarkers() {
  const { you, youStem, goal, goalStem, route: band } = palmMap.markers;
  const centre = palmMap.centre;
  if (!centre) return;
  const perRoomM = FIELD.mapM / FIELD.spanM;
  const edge = FIELD.mapM / 2 - 0.006;
  const lift = FIELD.markerLiftM;
  // Room position -> map position, kept inside the map, and the surface's height there.
  const onMap = (x, z) => {
    const mx = Math.max(-edge, Math.min(edge, (x - centre[0]) * perRoomM));
    const mz = Math.max(-edge, Math.min(edge, (z - centre[1]) * perRoomM));
    const y = surfaceY(mx, mz);
    return [mx, Number.isFinite(y) ? y : 0, mz];
  };

  const [hx, hy, hz] = onMap(head.x, head.z);
  you.visible = true;
  you.position.set(hx, hy + lift, hz);
  you.rotation.y = -heading;
  youStem.scale.y = lift;

  goal.visible = !!target;
  if (target) {
    const [tx, ty, tz] = onMap(target.x, target.z);
    goal.position.set(tx, ty + lift + 0.006, tz);
    goal.rotation.y = performance.now() / 900;
    goalStem.scale.y = lift + 0.006;
    goalStem.rotation.y = -goal.rotation.y;
  }

  const shown = guiding && route.points.length > 1;
  band.mesh.visible = shown;
  if (shown) {
    band.set(route.points.map(([x, z]) => {
      const [mx, my, mz] = onMap(x, z);
      return [mx, my + lift * 0.45, mz];
    }), 0.0024);
  }
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
  return { root, surface, canvas, g: canvas.getContext('2d'), tex, caption, beam, mask: new Uint8Array((N + 1) * (N + 1)), markers: makeMapMarkers(root) };
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

  // The route, the target and the wearer are not painted here: they float above the map (makeMapMarkers).

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
  palmMap.centre = [head.x, head.z]; // the place in the room that the middle of the map stands for
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
  fx.target(target);
  lastPlan = 0;
  say('Target marked.');
}

/** The target at a place picked on the map (hud): like "Mark target", but there instead of here. */
function setTargetAt(x, z) {
  target = new THREE.Vector3(x, 0, z);
  guiding = true;
  fx.target(target);
  lastPlan = 0;
  say('Target set.');
}

// ---- picking a place on the field map (hud/index.js points a hand's ray at it) ----
const rayFrom = new THREE.Vector3();
const rayStep = new THREE.Vector3();
const probe = new THREE.Vector3();
const toLocal = new THREE.Matrix4();
let pin = null;

/** Height of the map's surface at a point of its own frame (from its vertices), or NaN off the map. */
function surfaceY(x, z) {
  const N = FIELD.segments;
  const c = (x / FIELD.mapM + 0.5) * N;
  const r = (z / FIELD.mapM + 0.5) * N;
  if (!(c >= 0 && r >= 0 && c <= N && r <= N)) return NaN;
  const pos = palmMap.surface.geometry.attributes.position;
  const c0 = Math.min(N - 1, Math.floor(c));
  const r0 = Math.min(N - 1, Math.floor(r));
  const tx = c - c0;
  const tz = r - r0;
  const at = (cc, rr) => pos.getY(rr * (N + 1) + cc);
  return (at(c0, r0) * (1 - tx) + at(c0 + 1, r0) * tx) * (1 - tz) + (at(c0, r0 + 1) * (1 - tx) + at(c0 + 1, r0 + 1) * tx) * tz;
}

/**
 * Where a ray meets the field map: { room: [x, z] (the place in the room it stands for),
 * point: Vector3 where the ray meets the map, t: metres along the ray }, or null when the map
 * is not shown or the ray misses. The surface is a height field: the ray is walked in small
 * steps until it goes under it, and the crossing is narrowed down (as map/index.js does).
 */
export function pickOnFieldMap(origin, direction, maxM = 3) {
  if (mode.current !== 'field' || !palmMap?.root.visible || !palmMap.centre) return null;
  const { root } = palmMap;
  root.updateWorldMatrix(true, false);
  toLocal.copy(root.matrixWorld).invert();
  rayFrom.copy(origin).applyMatrix4(toLocal);
  rayStep.copy(origin).add(direction).applyMatrix4(toLocal).sub(rayFrom);
  const over = (t) => {
    probe.copy(rayFrom).addScaledVector(rayStep, t);
    return probe.y - surfaceY(probe.x, probe.z);
  };
  const STEPS = 160;
  let before = NaN;
  let tBefore = 0;
  for (let i = 0; i <= STEPS; i++) {
    const t = (maxM * i) / STEPS;
    const gap = over(t);
    if (before > 0 && gap <= 0) {
      let a = tBefore;
      let b = t;
      for (let k = 0; k < 8; k++) {
        const mid = (a + b) / 2;
        if (over(mid) > 0) a = mid;
        else b = mid;
      }
      probe.copy(rayFrom).addScaledVector(rayStep, b);
      const y = surfaceY(probe.x, probe.z);
      if (!Number.isFinite(y)) return null;
      const perRoomM = FIELD.mapM / FIELD.spanM;
      return {
        room: [palmMap.centre[0] + probe.x / perRoomM, palmMap.centre[1] + probe.z / perRoomM],
        point: root.localToWorld(new THREE.Vector3(probe.x, y, probe.z)),
        t: b,
      };
    }
    before = gap;
    tBefore = t;
  }
  return null;
}

/** Where a place of the room is on the field map right now (for a card that stands over it), or null. */
export function fieldPlaceOnMap(room) {
  if (mode.current !== 'field' || !palmMap?.root.visible || !palmMap.centre) return null;
  const perRoomM = FIELD.mapM / FIELD.spanM;
  const x = (room[0] - palmMap.centre[0]) * perRoomM;
  const z = (room[1] - palmMap.centre[1]) * perRoomM;
  const y = surfaceY(x, z);
  return Number.isFinite(y) ? palmMap.root.localToWorld(new THREE.Vector3(x, y, z)) : null;
}

/** Put the pin on a place of the room as the map shows it, or take it away (null). Call every frame: the map scrolls under the wearer. */
export function showFieldPick(room) {
  if (!palmMap) return;
  if (!pin) {
    pin = new THREE.Group();
    pin.name = 'field-map-pick';
    const material = new THREE.MeshBasicMaterial({ color: 0xb9c3ff, depthTest: false, transparent: true });
    const head_ = new THREE.Mesh(new THREE.SphereGeometry(0.004, 12, 8), material);
    head_.position.y = 0.016;
    const stem = new THREE.Mesh(new THREE.ConeGeometry(0.0026, 0.014, 8).rotateX(Math.PI), material);
    stem.position.y = 0.007;
    for (const m of [head_, stem]) {
      m.renderOrder = 22;
      pin.add(m);
    }
    palmMap.root.add(pin);
  }
  const at = room && fieldPlaceOnMap(room);
  pin.visible = !!at;
  if (at) pin.position.copy(palmMap.root.worldToLocal(at));
}

function clearTarget() {
  target = null;
  guiding = false;
  fx.target(null);
  fx.clear();
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
    fx.clear();
    publishRoute('cancelled', performance.now(), true);
  }
}

function guide(now) {
  if (!target) return;
  const dist = Math.hypot(target.x - head.x, target.z - head.z);
  fx.label('Target', `${dist.toFixed(1)} m`, dist <= 0.8);
  if (!guiding) return;
  if (dist < FIELD.arrivedM) {
    fx.clear();
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
      fx.clear();
      if (lastStatus !== 'blocked') say('No clear way to the target.');
      publishRoute('blocked', now);
      return;
    }
    if (lastStatus !== 'ok') say(`Target is ${Math.max(1, Math.round(dist))} metres away. Follow the arrows.`);
    publishRoute('ok', now);
  }
  fx.lay(route.points);
}

// ---------- Mars mode: the planned route on the real floor ----------
// The route D plans on the Mars map (slope and terrain only: the room's furniture plays no part)
// is laid on the floor the same way as in field mode. One real metre stands for marsScale
// metres on Mars; the scale is set for each new route so that it is a few steps long.

/**
 * Set the scale so that a route of `distanceM` is WALK.routeRoomM of real walking (at most
 * WALK.marsScale to one). The wearer's place on Mars stays where it is: tracking is anchored
 * again at this spot.
 */
function fitRoute(distanceM) {
  if (WALK.scaleFixed || !haveHead || !anchorMap || !(distanceM > 0)) return;
  const next = Math.max(1, Math.min(WALK.marsScale, distanceM / WALK.routeRoomM));
  if (Math.abs(next - marsScale) < marsScale * 0.05) return;
  anchorMap = [anchorMap[0] + (head.x - headStart.x) * marsScale, 0, anchorMap[2] + (head.z - headStart.z) * marsScale];
  headStart.copy(head);
  marsScale = next;
  console.info('[field] Mars walking scale: 1 m here is', marsScale.toFixed(1), 'm on Mars');
}

function onMarsRoute({ status, targetId, points, distanceM, frame }) {
  if (frame === 'room' || mode.current !== 'mars') return;
  if (status === 'ok' && points?.length > 1) {
    if (fitNext) {
      fitNext = false;
      fitRoute(distanceM);
    }
    marsRoute = { points: points.map((q_) => [q_[0], q_[2]]), targetId, distanceM };
    return;
  }
  marsRoute = null;
  fx.clear();
  if (status !== 'arrived') fx.target(null); // on arrival the marker stays, at the wearer's feet
}

/** Mars map metres -> where that is in the room, at the scale in use. */
const marsToRoom = ([x, z]) => [headStart.x + (x - anchorMap[0]) / marsScale, headStart.z + (z - anchorMap[2]) / marsScale];

function layMarsRoute(now) {
  if (!marsRoute || !haveHead || !anchorMap || now - lastMarsLay < 100) return;
  lastMarsLay = now;
  const pts = marsRoute.points.map(marsToRoom);
  pts[0] = [head.x, head.z]; // the route starts where the wearer is
  fx.lay(pts);
  const [ex, ez] = pts[pts.length - 1];
  fx.target({ x: ex, z: ez });
  const wp = layerSet?.waypoints?.find((w) => w.id === marsRoute.targetId);
  const name = String(wp?.labelEn ?? wp?.label ?? marsRoute.targetId ?? 'Destination').split(' · ')[0];
  fx.label(name, `${Math.round(marsRoute.distanceM)} m`, Math.hypot(ex - head.x, ez - head.z) <= 0.8);
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
  const s = mode.current === 'field' ? 1 : marsScale;
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
  fx = createGuide();
  palmMap = makePalmMap();
  group.add(palmMap.root);
  ctx.scene.add(group, fx.group); // the guidance is shown in both modes, the rest in field mode only

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
  ctx.bus.on('nav:route', onMarsRoute);
  ctx.bus.on('nav:request', () => {
    fitNext = true;
  });
  ctx.bus.on('field:target', ({ point }) => mode.current === 'field' && setTargetAt(point[0], point[1]));
  ctx.bus.on('app:mode', () => {
    if (mode.current !== 'field') clearTarget();
    marsRoute = null;
    marsScale = WALK.marsScale;
  });
  ctx.xr.onSessionStart(() => {
    haveHead = false; // the room frame starts over with the session
    floatState.shownSince = null;
    palmMap.root.visible = false;
    clearTarget();
    marsRoute = null;
    marsScale = WALK.marsScale;
  });

  // PC testing without a headset: __field.walk(x, z, headingDeg), __field.mark(), __field.state()
  window.__field = {
    /** Where a ray meets the map: pick([ox, oy, oz], [dx, dy, dz]) (for tests). */
    pick: (o, d, maxM = 40) => pickOnFieldMap(new THREE.Vector3(...o), new THREE.Vector3(...d).normalize(), maxM),
    walk(x, z, headingDeg = 0) {
      simulated = { x, z, heading: THREE.MathUtils.degToRad(headingDeg) };
    },
    mark: markTarget,
    clear: clearTarget,
    state: () => ({ mode: mode.current, head: [head.x, head.z], target: target && [target.x, target.z], guiding, status: lastStatus, route: route.points.length, distanceM: route.distanceM, arrows: fx.arrows, targetShown: fx.targetShown, marsScale, marsRoute: marsRoute && { targetId: marsRoute.targetId, distanceM: marsRoute.distanceM, points: marsRoute.points.length } }),
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

  fx.tick(now);
  const field = mode.current === 'field';
  group.visible = field;
  if (!field) {
    layMarsRoute(now); // Mars mode: the route D planned, on the floor
    return;
  }

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
  if (palmMap.root.visible) placeMapMarkers();
}
