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
//   - The palm map shows the ground around the wearer, and how much of it depends on where
//     the map is held: brought toward the middle of the view it shows more (FIELD.spanRangeM,
//     up to 24 m across), held off to the side it shows less, larger. On it is only
//     what the headset has scanned (`hazard:update` from scan/): clear floor and structure.
//     Ground the headset knows nothing about is left empty, with no frame around the map.
//     (It used to show the Mars image there, which read as floor that had been seen.)
//     The scan arrives at most twice a second, and with live depth (on by default in this mode,
//     core/xr.js) it includes what was put down or taken away a moment ago: the map follows.
//     The scanned ground still rises and falls with the Mars terrain under the wearer.
//   - It is the same kind of object as the Mars map (core/hologram.js): a relief floating over
//     the palm with a beam from the hand, the Mars terrain as its ground and the scanned
//     structure standing on it, and everything written about it on the caption card that goes
//     around the map's cylinder. Nothing is written on the map surface.
//   - What moves on the map (the wearer, the target, waypoints, the route) floats above its
//     surface, in the shapes both maps share (core/markers.js).
//   - The target is where the route leads: a place picked on the map with the pointer, or a
//     waypoint ("Navigate" on its card). The way there is planned around the scanned structure
//     and shown twice: as arrows on the real floor and as a line on the map. "Navigate" /
//     "Stop" turn the guidance on and off; "Navigate" with no target goes to the waypoint
//     marked last. The route passes every waypoint that lies nearly on the way (planner.js).
//   - Waypoints are places that were marked (hud/: "Mark waypoint" where the wearer stands, or
//     a place picked on the map), each with a name. They are blue, on the map and in the room.
//
// Receives: layers:ready, hazard:update, voice:command, app:mode, map:pick,
//           field:target { point: [x, z] room metres | null, label? } (hud: the target is set or deleted)
//           waypoint:set { id, label, room: [x, z] | cell: [col, row] }, waypoint:remove { id }
// Sends:    nav:position { point: [x, 0, z] in map metres, source: 'headset' }
//           nav:route (field mode only; targetId 'mark', points in room coordinates), voice:say

import * as THREE from 'three';
import { mode } from '../core/mode.js';
import { makePalmState } from '../core/palm.js';
import { makeBeam, makeCaption, writeCaption, placeCaption, floatOverPalm, fadeBeyondCircle } from '../core/hologram.js';
import { MAP } from '../map/config.js';
import { sampleHeight } from '../map/terrain.js';
import { createGridFrame, cellToWorld, worldToCell } from '../nav/coordinates.js';
import { planVia, PLAN } from './planner.js';
import { createGuide, makeRibbon, GUIDE } from './guide.js';
import { MARK, makeYou, makeTarget, makeWaypoint, makePin, setLabel, place } from '../core/markers.js';

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
  spanM: 20, // the palm map shows spanM x spanM around the wearer (PC view, and until the map has been looked at)
  // In the headset the range follows where the map is held: [off to the side, in the middle of
  // the view] in metres across. More than 24 m would show nothing more: the scan's window is 25.6 m.
  spanRangeM: [10, 24],
  spanAtDeg: [34, 10], // the map's centre this far from the line of sight: the first range, the second range; between them it glides
  spanRate: 5, // how fast the range follows (1/s)
  mapM: MAP.widthM, // size of the palm map (m): the same as the Mars map
  mapPx: 512,
  segments: 128, // the map surface is a grid of this many quads per side, raised into a relief
  structureM: 1.0, // scanned structure stands this tall on the map, in room metres (the scan has no heights)
  reliefMaxM: 3, // the Mars terrain under the wearer rises and falls at most this much on the map (room metres)
  redrawMs: 200,
  showRouteBeyondM: 1.0, // the route appears once the wearer is this far from the target
  arrivedM: 0.5,
  replanMs: 500,
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
let grid = null; // latest hazard:update
let gridCanvas = null; // the scan drawn at grid resolution
const head = new THREE.Vector3();
let heading = 0; // radians, 0 = facing -z (north on the map), clockwise positive
const headStart = new THREE.Vector3();
let haveHead = false;
let wantSpan = FIELD.spanM; // the range the map should show, following where it is held
let span = FIELD.spanM; // the range it was last drawn with: markers and picking go by this
let target = null; // THREE.Vector3 on the floor, or null
let targetLabel = ''; // its name, when it was set from a waypoint
// Marked places: id -> { id, label, room: [x, z] } (field mode) or { id, label, cell } (Mars mode).
const waypoints = new Map();
const passed = new Set(); // waypoints the wearer has been at on the way to this target
let viaSaid = ''; // the stops last announced
let picked = false; // a place is picked on the map and its card is up (hud): "Navigate" then means that place
let lastWaypointDraw = 0;
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
  const you = makeYou();
  you.name = 'field-map-you';
  const goal = makeTarget();
  goal.name = 'field-map-target';
  // The route: a band just above the surface, rising and falling with it.
  const route_ = makeRibbon(96, flat(new THREE.MeshBasicMaterial({ color: GUIDE.path, opacity: 0.95, side: THREE.DoubleSide })));
  route_.mesh.name = 'field-map-route';
  route_.mesh.renderOrder = 21;
  route_.mesh.visible = false;
  root.add(route_.mesh, goal, you);
  return { you, goal, route: route_, waypoints: new Map() }; // waypoints: id -> marker
}

/** Put the floating markers where they belong on the map as it is drawn now. Every frame while the map shows. */
function placeMapMarkers() {
  const { you, goal, route: band, waypoints: marks } = palmMap.markers;
  const centre = palmMap.centre;
  if (!centre) return;
  const perRoomM = FIELD.mapM / span;
  const edge = FIELD.mapM / 2 - 0.006;
  // Room position -> map position, kept inside the map, and the surface's height there.
  const onMap = (x, z) => {
    const mx = Math.max(-edge, Math.min(edge, (x - centre[0]) * perRoomM));
    const mz = Math.max(-edge, Math.min(edge, (z - centre[1]) * perRoomM));
    const y = surfaceY(mx, mz);
    return [mx, Number.isFinite(y) ? y : 0, mz];
  };

  const [hx, hy, hz] = onMap(head.x, head.z);
  place(you, hx, hy, hz, MARK.youLiftM);
  you.rotation.y = -heading;

  goal.visible = false;
  if (target) {
    place(goal, ...onMap(target.x, target.z), MARK.targetLiftM);
    goal.rotation.y = performance.now() / 900;
  }

  // Waypoints: one marker each, made when the waypoint appears and dropped when it goes. One
  // that lies beyond the map's circle is not shown (the target is kept at the edge instead:
  // it says which way to go).
  for (const [id, marker] of marks) {
    if (!waypoints.get(id)?.room) {
      marker.removeFromParent();
      marks.delete(id);
    }
  }
  for (const w of waypoints.values()) {
    if (!w.room) continue;
    let marker = marks.get(w.id);
    if (!marker) {
      marker = makeWaypoint(w.label);
      marker.name = `field-map-waypoint-${w.id}`;
      palmMap.root.add(marker);
      marks.set(w.id, marker);
    }
    setLabel(marker, w.label);
    const mx = (w.room[0] - centre[0]) * perRoomM;
    const mz = (w.room[1] - centre[1]) * perRoomM;
    const y = surfaceY(mx, mz);
    marker.visible = false;
    if (Math.hypot(mx, mz) <= FIELD.mapM * 0.47 && Number.isFinite(y)) place(marker, mx, y, mz, MARK.waypointLiftM);
  }

  const shown = guiding && route.points.length > 1;
  band.mesh.visible = shown;
  if (shown) {
    band.set(route.points.map(([x, z]) => {
      const [mx, my, mz] = onMap(x, z);
      return [mx, my + MARK.youLiftM * 0.45, mz];
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
  // alphaTest: the empty parts of the picture are not drawn at all (and hide nothing behind them).
  const surface = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, side: THREE.DoubleSide, toneMapped: false, transparent: true, alphaTest: 0.05 }));
  fadeBeyondCircle(surface.material, FIELD.mapM); // as the Mars map: it dissolves outside the hologram's circle
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
// [r, g, b, a] 0-255. Both let the room show through: the floor about half, structure only a little.
const STRUCTURE = [255, 169, 77, 215];
const CLEAR = [60, 70, 86, 115];

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
  const k = W / span; // pixels per metre
  const toPx = (x, z) => [(x - head.x) * k + W / 2, (z - head.z) * k + W / 2];
  g.save();
  // Only what the headset has scanned is drawn. Ground it knows nothing about is left empty:
  // there used to be the Mars image there as a stand-in floor, which read as floor that had
  // been seen. Nothing marks the edge of the map either: no frame around it.
  g.clearRect(0, 0, W, W);

  // What the headset scanned: clear floor and structure.
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
  const step = span / N;
  const scale = FIELD.mapM / span; // map metres per room metre
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
    const z = head.z + (r / N - 0.5) * span;
    for (let c = 0; c < side; c++) {
      mask[r * side + c] = grid && structureNear(head.x + (c / N - 0.5) * span, z, step / 2) ? 1 : 0;
    }
  }
  for (let r = 0; r < side; r++) {
    const z = head.z + (r / N - 0.5) * span;
    for (let c = 0; c < side; c++) {
      const i = r * side + c;
      const base = Number.isFinite(here) ? ground(head.x + (c / N - 0.5) * span, z) : 0;
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
  let note = 'Point at the map and pinch: set a target or a waypoint there';
  if (target) {
    const d = Math.hypot(target.x - head.x, target.z - head.z).toFixed(1);
    note = !guiding ? `Target ${d} m · guidance off` : lastStatus === 'blocked' ? `Target ${d} m · no clear way through` : `Target ${d} m · violet: the way there`;
  }
  writeCaption(palmMap.caption, [
    `${layerSet?.mock ? 'SYNTHETIC · ' : ''}Field map · ${Math.round(span)} m around you · N ↑`,
    source,
    `Map extent ${Math.round(span)} × ${Math.round(span)} m · ${grid ? grid.cellSizeM : 0.1} m/cell · hold it in the middle of your view to see farther`,
    note,
    `Teal: you · orange diamond: target · blue: waypoints${waypoints.size ? ` (${[...waypoints.values()].filter((w) => w.room).length})` : ''} · orange ground: structure or a drop`,
    'Only scanned ground is drawn; the rest is empty until the headset has seen it',
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

/** The target at a place of the room (hud: a place picked on the map, or a waypoint): guidance starts. */
function setTargetAt(x, z, label = '') {
  target = new THREE.Vector3(x, 0, z);
  targetLabel = label;
  passed.clear();
  viaSaid = '';
  guiding = true;
  fx.target(target);
  lastPlan = 0;
  say(label ? `Target set: ${label}.` : 'Target set.');
}

/** How many metres across the field map shows right now (hud: distances on the map). */
export const fieldSpan = () => span;

// The range follows where the map is held: toward the middle of the view it widens.
const lookAt_ = new THREE.Vector3();
const toMap = new THREE.Vector3();
function aimSpan(frame) {
  if (!frame.session || !palmMap.root.visible) return;
  ctx.camera.getWorldDirection(lookAt_);
  toMap.copy(palmMap.root.position).sub(ctx.camera.getWorldPosition(v));
  const off = THREE.MathUtils.radToDeg(toMap.angleTo(lookAt_));
  const [far, near] = FIELD.spanAtDeg;
  const t = THREE.MathUtils.smoothstep(off, near, far); // 0 in the middle of the view, 1 off to the side
  const goal = FIELD.spanRangeM[1] + (FIELD.spanRangeM[0] - FIELD.spanRangeM[1]) * t;
  wantSpan += (goal - wantSpan) * (1 - Math.exp(-FIELD.spanRate * Math.min(0.1, frame.dt ?? 0.016)));
}

/** Where the wearer stands in the room, [x, z], or null while the headset is not tracked (hud: "Mark waypoint"). */
export function fieldHere() {
  return haveHead ? [head.x, head.z] : null;
}

/** The target of field mode, [x, z] in the room, or null (hud: picking it on the map). */
export function fieldTarget() {
  return mode.current === 'field' && target ? [target.x, target.z] : null;
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
      const perRoomM = FIELD.mapM / span;
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
  const perRoomM = FIELD.mapM / span;
  const x = (room[0] - palmMap.centre[0]) * perRoomM;
  const z = (room[1] - palmMap.centre[1]) * perRoomM;
  const y = surfaceY(x, z);
  return Number.isFinite(y) ? palmMap.root.localToWorld(new THREE.Vector3(x, y, z)) : null;
}

/** Put the pin on a place of the room as the map shows it, or take it away (null). Call every frame: the map scrolls under the wearer. */
export function showFieldPick(room) {
  if (!palmMap) return;
  if (!pin) {
    pin = makePin();
    pin.name = 'field-map-pick';
    palmMap.root.add(pin);
  }
  const at = room && fieldPlaceOnMap(room);
  pin.visible = !!at;
  if (at) pin.position.copy(palmMap.root.worldToLocal(at));
}

function clearTarget() {
  target = null;
  targetLabel = '';
  guiding = false;
  fx.target(null);
  fx.clear();
  route = { points: [], distanceM: 0, blocked: false };
  publishRoute('cancelled', performance.now(), true);
}

function onVoice({ intent }) {
  if (mode.current !== 'field') return;
  if (intent === 'nav.start') {
    if (picked) return; // "Navigate" on the card over a picked place: the hud sets the target there
    if (target) {
      guiding = true;
      lastPlan = 0;
      return;
    }
    // No target: the waypoint marked last becomes it.
    const last = [...waypoints.values()].filter((w) => w.room).pop();
    if (last) setTargetAt(last.room[0], last.room[1], last.label);
    else say('No target yet. Point at the map to pick one, or mark a waypoint.');
  } else if (intent === 'nav.stop') {
    guiding = false;
    fx.clear();
    publishRoute('cancelled', performance.now(), true);
  }
}

function guide(now) {
  if (!target) return;
  const dist = Math.hypot(target.x - head.x, target.z - head.z);
  fx.label((targetLabel || 'Target').toUpperCase(), `${dist.toFixed(1)} m`, dist <= 0.8);
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
    // Through the waypoints that lie nearly on the way (planner.js: planVia), except those the
    // wearer has already been at on this way to the target: the route does not lead back to them.
    const stops = [];
    for (const w of waypoints.values()) {
      if (!w.room) continue;
      if (Math.hypot(w.room[0] - head.x, w.room[1] - head.z) < PLAN.viaMinM) passed.add(w.id);
      if (!passed.has(w.id)) stops.push({ id: w.id, at: w.room });
    }
    route = planVia(grid, [head.x, head.z], [target.x, target.z], stops);
    const via = (route.via ?? []).map((id) => waypoints.get(id)?.label ?? id).join(', ');
    if (via !== viaSaid) {
      viaSaid = via;
      if (via && !route.blocked) say(`The route passes ${via}.`);
    }
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

function onMarsRoute({ status, targetId, points, distanceM, frame, via }) {
  if (frame === 'room' || mode.current !== 'mars') return;
  // The marked waypoints the route passes (nav/via.js): said once when they change.
  const stops = status === 'ok' ? (via ?? []).map((id) => waypoints.get(id)?.label ?? id).join(', ') : viaSaid;
  if (stops !== viaSaid) {
    viaSaid = stops;
    if (stops) say(`The route passes ${stops}.`);
  }
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
  const name = String(waypoints.get(marsRoute.targetId)?.label ?? wp?.labelEn ?? wp?.label ?? (marsRoute.targetId === 'pick' ? 'Selected point' : marsRoute.targetId) ?? 'Destination').split(' · ')[0];
  fx.label(name.toUpperCase(), `${Math.round(marsRoute.distanceM)} m`, Math.hypot(ex - head.x, ez - head.z) <= 0.8);
}

// The waypoints as markers in the room. In field mode a waypoint is a place of the room; in
// Mars mode it is a cell of the Mars map, shown where that is in the room at the walking scale
// in use (so, like the route, it is only where a few steps reach it).
function showWaypointsInRoom(now) {
  if (now - lastWaypointDraw < 150) return;
  lastWaypointDraw = now;
  const field = mode.current === 'field';
  const list = [];
  if (haveHead) {
    for (const w of waypoints.values()) {
      let at = null;
      if (field && w.room) at = w.room;
      else if (!field && w.cell && frameT && anchorMap) {
        const m = cellToWorld(frameT, w.cell);
        at = marsToRoom([m[0], m[2]]);
      }
      if (at) list.push({ x: at[0], z: at[1], label: w.label, distanceM: Math.hypot(at[0] - head.x, at[1] - head.z) });
    }
  }
  fx.waypoints(list.sort((a, b) => a.distanceM - b.distanceM));
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
    wantSpan = FIELD.spanM; // the PC view has no hand to move the map with
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
    viaSaid = '';
    fitNext = true;
  });
  ctx.bus.on('field:target', ({ point, label }) => {
    if (mode.current !== 'field') return;
    if (point) setTargetAt(point[0], point[1], label ?? '');
    else {
      clearTarget(); // deleted on the map
      say('Target deleted.');
    }
  });
  ctx.bus.on('map:pick', (p) => {
    picked = !!p;
  });
  ctx.bus.on('waypoint:set', (w) => {
    if (w?.id == null) return;
    waypoints.set(w.id, { id: w.id, label: w.label ?? '', room: w.room ?? null, cell: w.cell ?? null });
    lastWaypointDraw = 0;
  });
  ctx.bus.on('waypoint:remove', ({ id }) => {
    waypoints.delete(id);
    lastWaypointDraw = 0;
  });
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

  // PC testing without a headset: __field.walk(x, z, headingDeg), __field.state()
  window.__field = {
    /** Where a ray meets the map: pick([ox, oy, oz], [dx, dy, dz]) (for tests). */
    pick: (o, d, maxM = 40) => pickOnFieldMap(new THREE.Vector3(...o), new THREE.Vector3(...d).normalize(), maxM),
    walk(x, z, headingDeg = 0) {
      simulated = { x, z, heading: THREE.MathUtils.degToRad(headingDeg) };
    },
    clear: clearTarget,
    state: () => ({ via: route.via ?? [], spanM: span, mode: mode.current, head: [head.x, head.z], target: target && [target.x, target.z], targetLabel, waypoints: [...waypoints.values()], waypointsInRoom: fx.waypointsShown, guiding, status: lastStatus, route: route.points.length, distanceM: route.distanceM, arrows: fx.arrows, targetShown: fx.targetShown, marsScale, marsRoute: marsRoute && { targetId: marsRoute.targetId, distanceM: marsRoute.distanceM, points: marsRoute.points.length } }),
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
  showWaypointsInRoom(now);
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
  aimSpan(frame);
  // Drawn again five times a second, and sooner while the range is changing, so that glides.
  const zooming = Math.abs(wantSpan - span) > 0.2;
  if (palmMap.root.visible && now - lastDraw > (zooming ? 50 : FIELD.redrawMs)) {
    lastDraw = now;
    span = zooming ? wantSpan : span;
    drawPalmMap();
    updateRelief();
    writeFieldCaption();
  }
  if (palmMap.root.visible) placeMapMarkers();
}
