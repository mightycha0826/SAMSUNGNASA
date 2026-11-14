// map — 손바닥 지도, 레이어 표시 (D, 안현상)
//
// 받는 이벤트: layers:ready, layer:toggle, nav:route, hazard:update(P1)
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
import { mapPoint, range, terrainArrays } from './terrain.js';
import { PALM, leftPalm, makePalmState } from '../core/palm.js';
import { makeBeam, updateBeam as aimBeam, makeCaption, writeCaption, placeCaption as putCaption } from '../core/hologram.js';
import { createGridFrame, worldToCell, cellToWorld } from '../nav/coordinates.js';

let ctx, root, surface, data, arrays, transform, label, currentMarker;
let activeLayer = null, request = 0, generation = 0, shownSince = null, controllerShown = false;
let routePoints = [], routeLine, off = [], textures = new Map();
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
    note || (activeLayer === 'thermal' ? 'Relative brightness · not temperature' : 'Teal: start · orange: Curiosity · violet: planned route'),
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
function drawRoute() {
  disposeObject(routeLine); routeLine = null;
  if (!data || !arrays) return;
  const cells = [];
  for (let i = 1; i < routePoints.length; i++) {
    const a = worldToCell(transform, routePoints[i - 1]), b = worldToCell(transform, routePoints[i]);
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
    for (let k = 0; k <= steps; k++) cells.push([a[0] + (b[0] - a[0]) * k / steps, a[1] + (b[1] - a[1]) * k / steps]);
  }
  // A tube instead of a one-pixel line: readable on a 25 cm map in the headset.
  const points = [];
  for (const cell of cells) {
    const p = mapPoint(data.grids.topo, data.layerSet.grid, cell, arrays.min, MAP.widthM, 0.0025);
    if (p && (!points.length || points[points.length - 1].distanceToSquared(normal.fromArray(p)) > 1e-9)) points.push(new THREE.Vector3().fromArray(p));
  }
  if (points.length < 2) return;
  const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false, 'centripetal'), Math.min(400, points.length * 2), 0.0013, 6, false);
  routeLine = new THREE.Mesh(tube, new THREE.MeshBasicMaterial({ color: 0x8e9dff, depthTest: false, transparent: true }));
  routeLine.name = 'map-planned-route'; routeLine.renderOrder = 5; root.add(routeLine);
}
function setCurrent(point) {
  if (!data || !arrays || !currentMarker) return;
  const p = mapPoint(data.grids.topo, data.layerSet.grid, worldToCell(transform, point), arrays.min, MAP.widthM, 0.003);
  currentMarker.visible = !!p; if (p) currentMarker.position.fromArray(p);
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
  surface = label = currentMarker = routeLine = beam = null; data = arrays = transform = null;
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
    surface.name = 'map-terrain'; root.add(surface);
    lineForCells(data.traverse?.points?.map(p => p.cell) ?? [], 0xf27a0a, 'map-curiosity-traverse');
    for (const wp of data.layerSet.waypoints ?? []) {
      const p = mapPoint(data.grids.topo, data.layerSet.grid, wp.cell, arrays.min, MAP.widthM, 0.002);
      if (!p) continue;
      const marker = new THREE.Mesh(new THREE.ConeGeometry(0.003, 0.01, 8), new THREE.MeshBasicMaterial({ color: wp.id === 'base' ? 0xf27a0a : 0xffffff, depthTest: false, transparent: true }));
      marker.position.fromArray(p); marker.position.y += 0.005; marker.name = `map-waypoint-${wp.id}`; marker.renderOrder = 6; root.add(marker);
    }
    currentMarker = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 12, 8), new THREE.MeshBasicMaterial({ color: 0x5bdbba, depthTest: false, transparent: true }));
    currentMarker.name = 'map-explorer'; currentMarker.renderOrder = 7; root.add(currentMarker);
    const base = data.layerSet.waypoints?.find(w => w.id === 'base');
    if (base) setCurrent(cellToWorld(transform, base.cell)); else currentMarker.visible = false;
    label = makeLabel(); caption();
  } catch (err) { console.warn('[map] 지형을 표시할 수 없습니다:', err.message); }
}
export function init(context) {
  dispose(); ctx = context; root = new THREE.Group(); root.name = 'palm-map'; ctx.scene.add(root);
  root.position.set(0, 0.85, 0); root.scale.setScalar(MAP.desktopScale); root.rotation.x = MAP.desktopTiltRad;
  off.push(ctx.bus.on('layers:ready', load), ctx.bus.on('layer:toggle', ({ id, visible }) => { void selectLayer(id, visible); }),
    ctx.bus.on('nav:position', ({ point }) => setCurrent(point)), ctx.bus.on('nav:route', event => {
      if (event.frame === 'room') return; // field-mode routes are in room coordinates, not map metres
      if (event.points?.length) setCurrent(event.points[0]);
      routePoints = event.status === 'ok' ? event.points : []; drawRoute(); caption();
    }));
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
    const up = normal.set(0, 1, 0).applyQuaternion(wristQuat).y < MAP.palmUpDot;
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
