// map — 손바닥 지도, 레이어 표시 (D, 안현상)
//
// 받는 이벤트: layers:ready, layer:toggle, nav:route, nav:position, hazard:update(P1),
//              waypoint:set { id, label, cell: [col, row] }, waypoint:remove { id }
// What stands on the map (the wearer, the target, waypoints, the picked place, the route) has
// the shapes the field map uses (core/markers.js), so the two maps read alike.
// 보내는 이벤트: 없음
// 형식: docs/INTERFACES.md 3장
//
// ctx (init에서 받는 것):
//   ctx.bus        이벤트 버스 (core/bus.js). 다른 모듈과는 이것으로만 대화한다
//   ctx.scene      THREE.Scene for presentation; its display scale is not a map distance.
//   ctx.camera     THREE.PerspectiveCamera. AR에서는 헤드셋 위치를 따라간다
//   ctx.renderer   THREE.WebGLRenderer (renderer.xr 로 손·컨트롤러에 접근)
//   ctx.xr         XR 상태: session, presenting, refSpace, enabledFeatures,
//                  has("hand-tracking"), onSessionStart(fn), onSessionEnd(fn)
//   ctx.mock       가짜로 도는 부분: { data, link, hazard, any, speed }
//   ctx.assetUrl   레이어의 file 이름 → 불러올 주소 (목 모드의 가짜 이미지 포함)
//   ctx.config     core/config.js 의 설정
//
// frame (update에서 받는 것):
//   frame.time     시작 후 지난 시간 (ms)
//   frame.dt       앞 프레임과의 간격 (초)
//   frame.xrFrame  XRFrame. AR 세션 밖(PC 화면)에서는 null
//   frame.refSpace local-floor 기준 공간. 세션 밖에서는 null
//   frame.session  XRSession 또는 null
//
// 이미지 레이어는 ctx.assetUrl(layer.file) 로 주소를 얻는다 (목 모드에서도 같은 코드로 돈다).
// 숫자 격자는 layers:ready 의 grids.topo, grids.slope (Float32Array, 인덱스 row * cols + col).

import * as THREE from 'three';
import { MAP, rampColor } from './config.js';
import { mapPoint, range, sampleHeight, terrainArrays } from './terrain.js';
import { PALM, leftPalm, handOpen, makePalmState } from '../core/palm.js';
import { makeBeam, updateBeam as aimBeam, makeCaption, writeCaption, placeCaption as putCaption, fadeBeyondCircle } from '../core/hologram.js';
import { createGridFrame, worldToCell, cellToWorld } from '../nav/coordinates.js';
import { MARK, makeYou, makeTarget, makeWaypoint, makePin, setLabel, place } from '../core/markers.js';
import { makeRibbon, GUIDE } from '../field/guide.js';

let ctx, root, surface, data, arrays, transform, label, currentMarker;
let activeLayer = null, request = 0, generation = 0, shownSince = null, controllerShown = false;
let routePoints = [], routeBand = null, targetMarker = null, off = [], textures = new Map();
// Waypoints the wearer marked (hud): id -> { id, label, cell }, and the marker of each on the map as it is built now.
const marked = new Map(), markedMarkers = new Map();
const lookDir = new THREE.Vector3();
const position = new THREE.Vector3(), wristQuat = new THREE.Quaternion(), normal = new THREE.Vector3();
const palmState = makePalmState();
const tiltQuat = new THREE.Quaternion(), tiltAxis = new THREE.Vector3(), upAxis = new THREE.Vector3(0, 1, 0);
let beam = null;

// The beam from the palm and the caption on the map's cylinder are shared with the field map
// (core/hologram.js), so the two maps look and behave alike.
const updateBeam = apex => aimBeam(beam, apex, MAP.widthM);
function disposeObject(object) {
  object?.traverse(o => { o.geometry?.dispose(); if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose(); });
  object?.removeFromParent();
}
// The caption is a card standing on the side of an imaginary cylinder whose top face is the map
// (core/hologram.js: the same card, placed the same way, as on the field map).
function makeLabel() { return makeCaption(root, 'map-caption'); }
function placeCaption() { if (label) putCaption(label, root, ctx.camera, MAP.widthM); }
function caption(note = '') {
  if (!label || !data) return;
  const layer = data.layerSet.layers.find(l => l.id === activeLayer);
  writeCaption(label, [
    `${data.layerSet.mock ? 'SYNTHETIC · ' : ''}${data.layerSet.site?.name ?? 'Terrain map'} · N ↑`,
    `${layer?.labelEn ?? layer?.label ?? 'Terrain'} · ${layer?.mission ?? ''} ${layer?.instrument ?? ''}`,
    `Map extent ${transform.width} × ${transform.depth} m · ${transform.cellSizeM} m/cell`,
    note || (activeLayer === 'thermal' ? 'Relative brightness · not temperature' : 'Teal: you · orange diamond: target · blue: waypoints · violet: route'),
    'Route distances use map metres. Display size does not affect planning.',
    layer?.credit ?? (data.layerSet.mock ? 'Synthetic example, not NASA observations' : 'Data sources: layerset.json'),
  ]);
}
function lineForCells(cells, color, name) {
  const vertices = []; let previous = null;
  for (const cell of cells) {
    const p = mapPoint(data.grids.topo, data.layerSet.grid, cell, arrays.min, MAP.widthM, 0.0012);
    if (p && previous) vertices.push(...previous, ...p);
    previous = p;
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  // The terrain is drawn in the transparent pass, so anything meant to lie on top of it must be
  // transparent too and come later in the order; otherwise the terrain paints over it.
  const line = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
  line.name = name; line.renderOrder = 4; root.add(line); return line;
}
/** The surface point of a cell in the map's frame, [x, y, z], or null off the terrain. */
const onMap = cell => mapPoint(data.grids.topo, data.layerSet.grid, cell, arrays.min, MAP.widthM, 0);
function drawRoute() {
  if (!data || !arrays || !routeBand) return;
  const cells = [];
  for (let i = 1; i < routePoints.length; i++) {
    const a = worldToCell(transform, routePoints[i - 1]), b = worldToCell(transform, routePoints[i]);
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
    for (let k = 0; k <= steps; k++) cells.push([a[0] + (b[0] - a[0]) * k / steps, a[1] + (b[1] - a[1]) * k / steps]);
  }
  // A band just above the terrain, as on the field map: readable on a 25 cm map in the headset.
  let points = [];
  for (const cell of cells) {
    const p = mapPoint(data.grids.topo, data.layerSet.grid, cell, arrays.min, MAP.widthM, MARK.youLiftM * 0.45);
    if (p && (!points.length || Math.hypot(p[0] - points[points.length - 1][0], p[2] - points[points.length - 1][2]) > 1e-5)) points.push(p);
  }
  if (points.length > ROUTE_SEGMENTS) { const every = Math.ceil(points.length / ROUTE_SEGMENTS); points = points.filter((_, i) => i % every === 0 || i === points.length - 1); }
  routeBand.mesh.visible = points.length > 1;
  routeBand.set(points.length > 1 ? points : [], 0.0024);
  // The target: where the route ends.
  const end = routePoints.length > 1 ? onMap(worldToCell(transform, routePoints[routePoints.length - 1])) : null;
  if (targetMarker) { targetMarker.visible = false; if (end) place(targetMarker, ...end, MARK.targetLiftM); }
}
const ROUTE_SEGMENTS = 480;
function setCurrent(point) {
  if (!data || !arrays || !currentMarker) return;
  const p = onMap(worldToCell(transform, point));
  currentMarker.visible = false; if (p) place(currentMarker, ...p, MARK.youLiftM);
}
/** Keep the markers of the marked waypoints in step with the list, on the map as it is built now. */
function syncMarked() {
  for (const [id, marker] of markedMarkers) if (!marked.has(id) || marker.parent !== root) { marker.removeFromParent(); markedMarkers.delete(id); }
  if (!data || !arrays) return;
  for (const w of marked.values()) {
    let marker = markedMarkers.get(w.id);
    if (!marker) { marker = makeWaypoint(w.label); marker.name = `map-marked-${w.id}`; root.add(marker); markedMarkers.set(w.id, marker); }
    setLabel(marker, w.label);
    const p = onMap(w.cell);
    marker.visible = false; if (p) place(marker, ...p, MARK.waypointLiftM);
  }
}
/** Every frame: the wearer's arrow points where they face (north on the map is -z), the target turns. */
function tickMarkers() {
  if (!root?.visible || !data) return;
  if (currentMarker) { ctx.camera.getWorldDirection(lookDir); currentMarker.rotation.y = -Math.atan2(lookDir.x, -lookDir.z); }
  if (targetMarker?.visible) targetMarker.rotation.y = performance.now() / 900;
}
function numericTexture(id) {
  const grid = data.grids[id]; if (!grid) throw new Error(`missing-${id}`);
  const bounds = range(grid), out = new Uint8Array(grid.length * 4);
  for (let i = 0; i < grid.length; i++) {
    out.set(rampColor(id, (grid[i] - bounds.min) / (bounds.max - bounds.min || 1)), i * 4);
    out[i * 4 + 3] = Number.isFinite(grid[i]) ? 255 : 0;
  }
  const tex = new THREE.DataTexture(out, data.layerSet.grid.cols, data.layerSet.grid.rows);
  tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = THREE.LinearFilter; tex.needsUpdate = true; return tex;
}
async function imageTexture(layer) {
  const source = await new THREE.TextureLoader().loadAsync(ctx.assetUrl(layer.file));
  const img = source.image;
  const max = Math.min(MAP.textureMaxSize, ctx.renderer.capabilities.maxTextureSize);
  const factor = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(img.width * factor)); canvas.height = Math.max(1, Math.round(img.height * factor));
  const g = canvas.getContext('2d', { willReadFrequently: layer.id === 'thermal' });
  g.imageSmoothingEnabled = layer.id !== 'thermal'; g.drawImage(img, 0, 0, canvas.width, canvas.height); source.dispose();
  if (layer.id === 'thermal') {
    const pixels = g.getImageData(0, 0, canvas.width, canvas.height);
    const palette = Array.from({ length: 256 }, (_, i) => rampColor('thermal', i / 255));
    for (let i = 0; i < pixels.data.length; i += 4) pixels.data.set(palette[pixels.data[i]], i);
    g.putImageData(pixels, 0, 0);
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  if (layer.id === 'thermal') {
    texture.generateMipmaps = false; texture.minFilter = texture.magFilter = THREE.NearestFilter;
  } else texture.anisotropy = Math.min(4, ctx.renderer.capabilities.getMaxAnisotropy());
  return texture;
}
async function selectLayer(id, visible) {
  if (!visible) {
    if (activeLayer === id) { activeLayer = null; request++; if (surface) { surface.material.map = null; surface.material.needsUpdate = true; } caption(); }
    return;
  }
  const layer = data?.layerSet.layers.find(l => l.id === id);
  if (!layer || !surface) return;
  activeLayer = id; const serial = ++request, epoch = generation; caption('Loading layer…');
  try {
    let texture = textures.get(id);
    if (!texture) {
      texture = layer.format === 'float32' ? numericTexture(id) : await imageTexture(layer);
      if (epoch !== generation) { texture.dispose(); return; }
      if (textures.has(id)) texture.dispose(); else textures.set(id, texture);
      texture = textures.get(id);
    }
    if (serial !== request || epoch !== generation) return;
    surface.material.map = texture; surface.material.needsUpdate = true; caption();
  } catch (err) {
    if (serial === request && epoch === generation) { surface.material.map = null; surface.material.needsUpdate = true; caption(`Layer unavailable: ${layer.labelEn ?? layer.label}`); }
    console.warn('[map] 레이어 로드 실패:', id, err.message);
  }
}
function clearData() {
  generation++; request++;
  for (const texture of textures.values()) texture.dispose(); textures.clear();
  if (label) label.userData.texture.dispose();
  if (root) for (const child of [...root.children]) disposeObject(child);
  surface = label = currentMarker = routeBand = targetMarker = beam = null; data = arrays = transform = null; markedMarkers.clear();
  routePoints = []; activeLayer = null;
}
function load(payload) {
  clearData(); data = payload;
  try {
    transform = createGridFrame(data.layerSet); arrays = terrainArrays(data.grids.topo, data.layerSet.grid);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(arrays.positions, 3)); geometry.setAttribute('uv', new THREE.BufferAttribute(arrays.uv, 2));
    geometry.setIndex(arrays.indices); geometry.computeVertexNormals();
    surface = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, alphaTest: 0.01 }));
    fadeBeyondCircle(surface.material, MAP.widthM); // the map dissolves outside the circle its hologram stands on
    surface.name = 'map-terrain'; root.add(surface);
    lineForCells(data.traverse?.points?.map(p => p.cell) ?? [], 0xf27a0a, 'map-curiosity-traverse');
    // The places the data names (base, survey site, the nearby point): waypoints, as the ones the wearer marks.
    for (const wp of data.layerSet.waypoints ?? []) {
      const p = onMap(wp.cell);
      if (!p) continue;
      const marker = makeWaypoint(String(wp.labelEn ?? wp.label ?? wp.id).split(' · ')[0]);
      marker.name = `map-waypoint-${wp.id}`; root.add(marker); place(marker, ...p, MARK.waypointLiftM);
    }
    routeBand = makeRibbon(ROUTE_SEGMENTS, new THREE.MeshBasicMaterial({ color: GUIDE.path, opacity: 0.95, side: THREE.DoubleSide, depthTest: false, transparent: true }));
    routeBand.mesh.name = 'map-planned-route'; routeBand.mesh.renderOrder = 21; routeBand.mesh.visible = false; root.add(routeBand.mesh);
    targetMarker = makeTarget(); targetMarker.name = 'map-target'; root.add(targetMarker);
    currentMarker = makeYou(); currentMarker.name = 'map-explorer'; root.add(currentMarker);
    const base = data.layerSet.waypoints?.find(w => w.id === 'base');
    if (base) setCurrent(cellToWorld(transform, base.cell));
    syncMarked();
    label = makeLabel(); caption();
  } catch (err) { console.warn('[map] 지형을 표시할 수 없습니다:', err.message); }
}
// ---- picking a place on the map (hud/index.js points a hand's ray at it) ----
const rayFrom = new THREE.Vector3(), rayStep = new THREE.Vector3(), probe = new THREE.Vector3(), toLocal = new THREE.Matrix4();
let pin = null;
/** The cell under a point of the map's own frame, and the terrain's height there (map frame), or null off the map. */
function cellAt(x, z) {
  const grid = data.layerSet.grid, depth = MAP.widthM * grid.rows / grid.cols;
  const cell = [(x / MAP.widthM + 0.5) * grid.cols - 0.5, (0.5 - z / depth) * grid.rows - 0.5];
  const h = sampleHeight(data.grids.topo, grid, cell[0], cell[1]);
  return Number.isFinite(h) ? { cell, y: (h - arrays.min) * MAP.widthM / (grid.cols * grid.cellSizeM) } : null;
}
/**
 * Where a ray meets the terrain of the map: { cell: [col, row], point: Vector3 in room
 * coordinates, t: metres along the ray }, or null when the map is not shown or the ray misses.
 * The terrain is a height field, so the ray is walked in small steps until it goes under the
 * surface, and the crossing is then narrowed down: no triangle is tested.
 */
export function pickOnMap(origin, direction, maxM = 3) {
  if (!root?.visible || !data || !arrays) return null;
  root.updateWorldMatrix(true, false);
  toLocal.copy(root.matrixWorld).invert();
  rayFrom.copy(origin).applyMatrix4(toLocal);
  rayStep.copy(origin).add(direction).applyMatrix4(toLocal).sub(rayFrom); // one metre of the ray, in the map's frame
  const under = t => {
    probe.copy(rayFrom).addScaledVector(rayStep, t);
    const at = cellAt(probe.x, probe.z);
    return at ? probe.y - at.y : NaN;
  };
  const STEPS = 160;
  let before = NaN, tBefore = 0;
  for (let i = 0; i <= STEPS; i++) {
    const t = maxM * i / STEPS, gap = under(t);
    if (before > 0 && gap <= 0) {
      let a = tBefore, b = t;
      for (let k = 0; k < 8; k++) { const mid = (a + b) / 2; if (under(mid) > 0) a = mid; else b = mid; }
      probe.copy(rayFrom).addScaledVector(rayStep, b);
      const at = cellAt(probe.x, probe.z);
      if (!at) return null;
      return { cell: at.cell, point: root.localToWorld(new THREE.Vector3(probe.x, at.y, probe.z)), t: b };
    }
    before = gap; tBefore = t;
  }
  return null;
}
/** Where a cell of the map is in the room right now (for a card that stands over it), or null. */
export function mapCellInRoom(cell) {
  if (!root?.visible || !data || !arrays) return null;
  const p = mapPoint(data.grids.topo, data.layerSet.grid, cell, arrays.min, MAP.widthM, 0);
  return p ? root.localToWorld(new THREE.Vector3().fromArray(p)) : null;
}
/** Put the pin on a cell of the map, or take it away (null). */
export function showPick(cell) {
  if (!root || !data || !arrays) return;
  if (pin && pin.parent !== root) pin = null; // the map was rebuilt
  if (!cell) { if (pin) pin.visible = false; return; }
  const p = onMap(cell);
  if (!p) return;
  if (!pin) { pin = makePin(); pin.name = 'map-pick'; root.add(pin); }
  pin.position.fromArray(p); pin.visible = true;
}
/** The cell of a point in map metres ([x, 0, z], as nav:position gives it), or null before the data is there (hud: "Mark waypoint"). */
export function cellOfMapPoint(point) {
  return transform && point ? worldToCell(transform, point) : null;
}
/** Where the route on the map ends, as a cell, or null when there is none (hud: picking the target). */
export function mapTargetCell() {
  return transform && routePoints.length > 1 ? worldToCell(transform, routePoints[routePoints.length - 1]) : null;
}

export function init(context) {
  dispose(); ctx = context; root = new THREE.Group(); root.name = 'palm-map'; ctx.scene.add(root);
  root.position.set(0, 0.85, 0); root.scale.setScalar(MAP.desktopScale); root.rotation.x = MAP.desktopTiltRad;
  off.push(ctx.bus.on('layers:ready', load), ctx.bus.on('layer:toggle', ({ id, visible }) => { void selectLayer(id, visible); }),
    ctx.bus.on('nav:position', ({ point }) => setCurrent(point)), ctx.bus.on('nav:route', event => {
      if (event.frame === 'room') return; // field-mode routes are in room coordinates, not map metres
      if (event.points?.length) setCurrent(event.points[0]);
      routePoints = event.status === 'ok' ? event.points : []; drawRoute(); caption();
    }),
    ctx.bus.on('waypoint:set', w => { if (w?.id != null && w.cell) { marked.set(w.id, { id: w.id, label: w.label ?? '', cell: w.cell }); if (root) syncMarked(); } }),
    ctx.bus.on('waypoint:remove', ({ id }) => { if (marked.delete(id) && root) syncMarked(); }));
  off.push(ctx.xr.onSessionStart(session => {
    shownSince = null; controllerShown = false; root.visible = false; root.scale.setScalar(1); root.quaternion.identity();
    const select = event => { if (!event.inputSource.hand) controllerShown = !controllerShown; };
    session.addEventListener('select', select);
    const cleanup = () => session.removeEventListener('select', select);
    session.addEventListener('end', cleanup, { once: true }); off.push(cleanup);
  }), ctx.xr.onSessionEnd(() => {
    if (beam) beam.visible = false;
    root.visible = true; root.position.set(0, 0.85, 0); root.quaternion.identity(); root.rotation.x = MAP.desktopTiltRad;
    root.scale.setScalar(MAP.desktopScale); shownSince = null;
  }));
}
export function update(frame) {
  tickMarkers();
  if (root && data && !frame.session) placeCaption(); // PC view
  if (!root || !data || !arrays || !frame.session) return;
  const { xrFrame, refSpace, session, time, dt } = frame;
  if (!xrFrame || !refSpace) { root.visible = false; return; }
  const viewer = xrFrame.getViewerPose(refSpace);
  if (!viewer) { root.visible = false; return; }
  // A headset pose moves the displayed map, not the selected position on Mars.
  const left = [...session.inputSources].find(s => s.handedness === 'left' && s.hand);
  const joint = left?.hand.get('wrist');
  const wrist = joint ? xrFrame.getJointPose(joint, refSpace) : null;
  if (left) {
    if (!wrist) { root.visible = false; shownSince = null; return; }
    const q = wrist.transform.orientation; wristQuat.set(q.x, q.y, q.z, q.w);
    // The map shows over an open palm turned up; a hand that points or closes does not bring it up.
    palmState.open = handOpen(left.hand, xrFrame, refSpace, palmState.open);
    const up = normal.set(0, 1, 0).applyQuaternion(wristQuat).y < MAP.palmUpDot && palmState.open;
    if (!up) { shownSince = null; root.visible = false; return; }
    if (shownSince === null) shownSince = time;
    if (time - shownSince < MAP.holdMs) { root.visible = false; return; }
    // Float above and a little in front of the palm instead of sitting on the wrist.
    if (leftPalm(frame, ctx.camera, palmState)) position.copy(palmState.anchor);
    else { const p = wrist.transform.position; position.set(p.x, p.y + 0.06, p.z); }
    if (!beam) { beam = makeBeam(); root.add(beam); }
  } else {
    if (beam) beam.visible = false;
    shownSince = null;
    if (!controllerShown) { root.visible = false; return; }
    const source = [...session.inputSources].find(s => !s.hand && (s.gripSpace || s.targetRaySpace));
    const pose = source ? xrFrame.getPose(source.gripSpace ?? source.targetRaySpace, refSpace) : null;
    if (!pose) { root.visible = false; return; }
    const p = pose.transform.position; position.set(p.x, p.y + 0.08, p.z);
  }
  if (!root.visible) root.position.copy(position);
  else root.position.lerp(position, 1 - Math.exp(-MAP.followRate * dt));
  root.quaternion.identity(); root.visible = true;
  if (left) {
    // Lean the map toward the wearer: its up direction tips back along the line of sight.
    const tilt = THREE.MathUtils.degToRad(PALM.tiltDeg);
    tiltAxis.copy(upAxis).multiplyScalar(Math.cos(tilt)).addScaledVector(palmState.forward, -Math.sin(tilt));
    root.quaternion.copy(tiltQuat.setFromUnitVectors(upAxis, tiltAxis));
  }
  placeCaption();
  if (beam && left) {
    beam.visible = true;
    // palm position in the map's own (tilted) frame
    updateBeam(normal.copy(palmState.palm).sub(root.position).applyQuaternion(tiltQuat.invert()));
  }
}
export function dispose() {
  off.forEach(fn => fn()); off = []; clearData();
  beam = null; root?.removeFromParent(); root = null; ctx = null; shownSince = null; controllerShown = false;
}
