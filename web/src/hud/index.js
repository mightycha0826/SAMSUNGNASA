// hud — 상태창, 비상 모드, 레이어 전환 UI (F, 길윤석)
//
// 받는 이벤트: layers:ready, layer:toggle, env:update, telemetry:update, alert:raise, alert:clear,
//              nav:route, voice:command (intent가 alert.ack, mode.set일 때)
// 테두리: critical 경보는 빨강, warn 경보는 같은 테두리를 주황으로 점멸한다.
// 보내는 이벤트: layer:toggle (탭을 누를 때, 그리고 layers:ready 직후 기본 레이어 한 번),
//                mode:change (critical 경보가 생기면 emergency, 모두 풀리면 원래 모드)
// 형식: docs/INTERFACES.md 3장. 디자인: mockups/hud-mockup.html, design-system/point
//
// 파일:
//   config.js   크기·위치·주기 숫자 (조정은 여기서)
//   strings.js  화면 글자 (en / ko)
//   tokens.js   색·글꼴 (포인트 디자인 시스템 다크 테마)
//   draw.js     캔버스에 그리는 함수
//   index.js    이벤트를 받아 상태를 바꾸고, 패널을 장면에 놓는다
//
// AR 세션 안에서는 HTML이 보이지 않아서, 캔버스에 그린 그림을 눈앞 1m 평면에 붙인다.
// 레이어는 한 번에 하나만 켠다 (목업의 결정). 탭을 누르면 앞 레이어를 끄고 새 레이어를 켠다.
//
// 헤드셋에서 미확인: 글자 크기와 가독성, 반투명 카드, 손바닥 방향 판정, 검지로 탭 누르기.

import * as THREE from 'three';
import { HUD } from './config.js';
import { STRINGS } from './strings.js';
import { T, loadFont } from './tokens.js';
import { drawStatus, drawBanner, drawAlert, drawLayers, drawEdge } from './draw.js';
import { leftPalm, makePalmState } from '../core/palm.js';

const S = STRINGS[HUD.lang];
const UNIT = HUD.distanceM * Math.tan(Math.PI / 180); // 1도의 길이 (m)
const MODES = ['normal', 'night', 'record'];

let ctx;
const state = {
  suit: { temp: null, source: null },
  env: null,
  nav: { status: null, targetId: null, distanceM: 0 },
  alerts: new Map(), // id -> { level, message, ts }
  acked: false,
  layerSet: null,
  grids: {},
  activeLayer: null,
  toast: null, // { msg, until }
  baseMode: 'normal',
  mode: 'normal',
};
const dirty = { status: true, banner: true, layers: true };

// ---- 패널 ----
let rigid; // 카메라에 붙는 묶음 (비상 테두리, 그리고 followRate가 0이면 카드도)
let cards; // 상태창·경보 카드 묶음
let pStatus, pBanner, pAlert, pLayers, pEdge;
let layerHits = [];
let layersOnPalm = false;
const palmState = makePalmState();
// Fingertip feedback on the layer menu: which tab is under the finger, how close it is, and
// which tab was just pressed.
const touch = { hoverId: null, cursor: null, pressedId: null, pressedUntil: 0 };
let audio = null;

/** Short click, so a press is heard as well as seen. */
function clickSound() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state !== 'running') audio.resume();
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1250, t);
    osc.frequency.exponentialRampToValueAtTime(700, t + 0.06);
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.1);
  } catch {
    /* no audio: the visual feedback is enough */
  }
}

function tabAt(x, y) {
  return layerHits.find((h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) ?? null;
}

function makePanel(wDeg, hDeg, pxW = Math.round(wDeg * HUD.pxPerDeg), pxH = Math.round(hDeg * HUD.pxPerDeg)) {
  const canvas = document.createElement('canvas');
  canvas.width = pxW;
  canvas.height = pxH;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wDeg * UNIT, hDeg * UNIT), mat);
  mesh.renderOrder = 1000;
  return { canvas, g: canvas.getContext('2d'), tex, mat, mesh, wM: wDeg * UNIT, hM: hDeg * UNIT };
}

/** 목업 화면 좌표(왼쪽 위 기준, 도)의 사각형을 눈앞 평면 위에 놓는다. */
function place(panel, leftDeg, topDeg, wDeg, hDeg) {
  panel.mesh.position.set((leftDeg + wDeg / 2 - HUD.stage.wDeg / 2) * UNIT, (HUD.stage.hDeg / 2 - topDeg - hDeg / 2) * UNIT, -HUD.distanceM);
  panel.mesh.quaternion.identity();
  panel.mesh.scale.setScalar(1);
}

function placeLayersFixed() {
  const L = HUD.layers;
  cards.add(pLayers.mesh);
  place(pLayers, L.fixedLeftDeg, HUD.stage.hDeg - L.fixedBottomDeg - 15.5, L.wDeg, L.hDeg);
  layersOnPalm = false;
}

// ---- 이름 ----
const layerLabel = (id) => {
  const layer = state.layerSet?.layers.find((l) => l.id === id);
  return S.layers[id] ?? layer?.label ?? id ?? '—';
};
const waypointLabel = (id) => {
  const wp = state.layerSet?.waypoints?.find((w) => w.id === id);
  return S.waypoints[id] ?? wp?.label ?? id ?? '';
};

// ---- 표시용 값 ----
function statusVM() {
  const linkLost = state.alerts.has('link-lost');
  const suitAlert = state.alerts.get('suit-temp');
  const t = state.suit.temp;
  const suitState = linkLost || t === null ? 'stale' : suitAlert?.level === 'critical' ? 'crit' : suitAlert ? 'warn' : '';
  const G = HUD.suitGauge;
  const suit = {
    label: S.suit,
    value: t === null ? '—' : t.toFixed(1),
    word: suitState === 'stale' ? '' : suitState === 'crit' ? S.word.crit : suitState === 'warn' ? S.word.warn : S.word.normal,
    state: suitState,
    tag: linkLost ? S.lastValue : state.suit.source,
    fill: t === null ? 0 : Math.max(0, Math.min(1, (t - G.min) / (G.max - G.min))),
  };

  const nav = state.nav;
  const target = nav.targetId ? waypointLabel(nav.targetId) : '';
  const dist = { label: target && nav.status !== 'cancelled' ? S.distanceTo(target) : S.distance, value: '—', unit: '', word: '', state: '' };
  if (nav.status === 'ok') Object.assign(dist, { value: nav.distanceM.toFixed(1), unit: 'm' });
  else if (nav.status === 'arrived') Object.assign(dist, { value: '0.0', unit: 'm', word: S.arrived });
  else if (nav.status === 'blocked') Object.assign(dist, { word: S.blocked, state: 'warn' });
  else if (nav.status === 'cancelled') dist.word = S.noRoute;

  const env = [];
  const e = state.env;
  const radAlert = state.alerts.get('radiation');
  env.push({
    k: S.radiation,
    v: e?.radiationUGyPerDay != null ? String(Math.round(e.radiationUGyPerDay)) : '—',
    unit: S.radUnit,
    tag: e?.radiationIsFixedValue ? S.published : null,
    state: radAlert ? (radAlert.level === 'critical' ? 'crit' : 'warn') : '',
  });
  // 높이: 현재 위치의 격자 좌표를 알려 주는 이벤트가 아직 없어, 조사 지점(site1)의 지형 높이를 보여 준다.
  const ls = state.layerSet;
  const site = ls?.waypoints?.find((w) => w.id === 'site1');
  const topo = state.grids.topo;
  if (ls && site && topo) {
    const h = topo[site.cell[1] * ls.grid.cols + site.cell[0]];
    if (Number.isFinite(h)) env.push({ k: S.elevation, v: h.toFixed(0), unit: 'm' });
  }
  if (ls?.site?.geologicUnit?.code) env.push({ k: S.geoUnit, v: ls.site.geologicUnit.code });
  if (e?.pressurePa != null) env.push({ k: S.pressure, v: String(Math.round(e.pressurePa)), unit: 'Pa' });
  if (e?.airTempK != null) env.push({ k: S.airTemp, v: (e.airTempK - 273.15).toFixed(1).replace('-', '−'), unit: '°C' });

  const foot = {
    layerLabel: S.layer,
    layer: state.activeLayer ? layerLabel(state.activeLayer) : '—',
    sol: e ? `Sol ${e.sol} · ${e.localTime}` : '',
  };
  return { suit, dist, env, foot };
}

function sortedAlerts() {
  return [...state.alerts.entries()]
    .map(([id, a]) => ({ id, ...a }))
    .sort((a, b) => (b.level === 'critical') - (a.level === 'critical') || b.ts - a.ts);
}

function bannerVM() {
  const list = sortedAlerts();
  const top = list[0];
  let alert = null;
  if (top) {
    const crit = top.level === 'critical';
    alert = {
      level: top.level,
      title: S.alerts[top.id]?.[top.level] ?? top.message ?? top.id,
      sub: crit ? (state.acked ? S.acked : S.returning) : top.id === 'link-lost' ? S.showingLast : '',
      more: list.length > 1 ? `+${list.length - 1}` : null,
    };
  }
  return { alert, toast: state.toast?.msg ?? null };
}

function layersVM() {
  const layers = state.layerSet?.layers ?? [];
  const pressedId = performance.now() < touch.pressedUntil ? touch.pressedId : null;
  const tabs = layers.map((l) => ({
    id: l.id,
    label: layerLabel(l.id),
    active: l.id === state.activeLayer,
    hover: l.id === touch.hoverId,
    pressed: l.id === pressedId,
  }));
  const layer = layers.find((l) => l.id === state.activeLayer);
  let legend = null;
  if (layer) {
    const numeric = layer.format === 'float32' && layer.min != null && layer.max != null;
    const fmt = (v) => `${Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)} ${layer.unit ?? ''}`.trim();
    legend = {
      rampId: layer.id,
      min: numeric ? fmt(layer.min) : S.low,
      max: numeric ? fmt(layer.max) : S.high,
      note: layer.kind === 'thermal' ? S.relative : null,
      src: [layer.mission, layer.instrument].filter(Boolean),
      keys: S.keys,
    };
  }
  return { tabs, legend, cursor: touch.cursor };
}

// ---- 상태 변경 ----
function hasCritical() {
  for (const a of state.alerts.values()) if (a.level === 'critical') return true;
  return false;
}

/** 비상 테두리의 등급: critical이 하나라도 있으면 critical, 아니면 warn이 있을 때 warn, 없으면 null */
function frameLevel() {
  if (hasCritical()) return 'critical';
  return state.alerts.size ? 'warn' : null;
}

function updateMode() {
  const mode = hasCritical() ? 'emergency' : state.baseMode;
  if (mode === state.mode) return;
  state.mode = mode;
  ctx.bus.emit('mode:change', { mode });
}

function showToast(msg) {
  state.toast = { msg, until: performance.now() + HUD.toastMs };
  dirty.banner = true;
}

function selectLayer(id) {
  if (id === state.activeLayer) return;
  if (state.activeLayer) ctx.bus.emit('layer:toggle', { id: state.activeLayer, visible: false });
  ctx.bus.emit('layer:toggle', { id, visible: true });
}

function wire(bus) {
  bus.on('layers:ready', ({ layerSet, grids }) => {
    state.layerSet = layerSet;
    state.grids = grids ?? {};
    dirty.status = dirty.layers = true;
    // 기본 레이어를 한 번 알린다. 다른 모듈의 layers:ready 처리가 끝난 뒤에 나가게 한 박자 늦춘다.
    queueMicrotask(() => {
      if (state.activeLayer) return;
      const first = layerSet.layers.find((l) => l.id === 'optical') ?? layerSet.layers[0];
      if (first) selectLayer(first.id);
    });
  });
  bus.on('layer:toggle', ({ id, visible }) => {
    if (visible) state.activeLayer = id;
    else if (state.activeLayer === id) state.activeLayer = null;
    dirty.status = dirty.layers = true;
  });
  bus.on('env:update', (e) => {
    state.env = e;
    dirty.status = true;
  });
  bus.on('telemetry:update', ({ suitTempC, source }) => {
    if (typeof suitTempC === 'number') state.suit.temp = suitTempC;
    state.suit.source = source ?? null;
    dirty.status = true;
  });
  bus.on('alert:raise', ({ id, level, message, ts }) => {
    const before = state.alerts.get(id);
    if (before?.level !== level) state.acked = false; // 새 경보나 등급이 바뀐 경보는 다시 점멸
    state.alerts.set(id, { level, message, ts: ts ?? Date.now() });
    dirty.status = dirty.banner = true;
    updateMode();
  });
  bus.on('alert:clear', ({ id }) => {
    if (!state.alerts.delete(id)) return;
    if (!state.alerts.size) state.acked = false;
    dirty.status = dirty.banner = true;
    updateMode();
  });
  bus.on('nav:route', ({ status, targetId, distanceM }) => {
    const prev = state.nav;
    if (status === 'arrived' && prev.status !== 'arrived') showToast(S.arrivedAt(waypointLabel(targetId ?? prev.targetId)));
    else if (status === 'cancelled' && prev.status !== 'cancelled') showToast(S.guidanceEnded);
    // 같은 목적지로 가는 길이 눈에 띄게 길어졌으면 돌아가는 길로 바뀐 것이다.
    else if (status === 'ok' && prev.status === 'ok' && prev.targetId === targetId && distanceM > prev.distanceM + 0.3) showToast(S.recalculated);
    state.nav = { status, targetId: targetId ?? prev.targetId, distanceM: distanceM ?? 0 };
    dirty.status = true;
  });
  bus.on('voice:command', ({ intent, slots, text }) => {
    // Show what the voice assistant heard, so the wearer knows the command was taken.
    if (text) showToast(`\u201C${String(text).trim().replace(/[.!?]+$/, '')}\u201D`);
    if (intent === 'alert.ack' && state.alerts.size) {
      state.acked = true; // 점멸을 멈춘다. 테두리와 경보 카드는 alert:clear까지 남는다.
      dirty.banner = true;
    } else if (intent === 'mode.set' && MODES.includes(slots?.mode)) {
      state.baseMode = slots.mode;
      updateMode();
    }
  });
}

// ---- 누르기 ----
const raycaster = new THREE.Raycaster();
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
let pokeArmed = true;

function pressAtUV(u, v) {
  const x = u * pLayers.canvas.width;
  const y = (1 - v) * pLayers.canvas.height;
  const hit = tabAt(x, y);
  if (hit) {
    touch.pressedId = hit.id;
    touch.pressedUntil = performance.now() + HUD.layers.pressFlashMs;
    dirty.layers = true;
    clickSound();
    selectLayer(hit.id);
  }
  return !!hit;
}

function pressAlongRay() {
  if (!pLayers.mesh.visible) return;
  const hit = raycaster.intersectObject(pLayers.mesh, false)[0];
  if (hit?.uv) pressAtUV(hit.uv.x, hit.uv.y);
}

function initInput() {
  // PC: 마우스 클릭
  const el = ctx.renderer.domElement;
  el.addEventListener('click', (ev) => {
    if (ctx.xr.presenting) return;
    const r = el.getBoundingClientRect();
    v1.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1, 0);
    raycaster.setFromCamera(v1, ctx.camera);
    pressAlongRay();
  });
  // AR: 컨트롤러 방아쇠 또는 손 집기 (가리키는 방향으로 누른다)
  for (const i of [0, 1]) {
    const c = ctx.renderer.xr.getController(i);
    c.addEventListener('select', () => {
      c.updateWorldMatrix(true, false);
      raycaster.ray.origin.setFromMatrixPosition(c.matrixWorld);
      raycaster.ray.direction.set(0, 0, -1).transformDirection(c.matrixWorld);
      pressAlongRay();
    });
  }
}

// 손 추적: 왼손 손바닥이 위를 보면 탭을 손목 옆에 띄우고, 오른손 검지 끝으로 누른다.
function updateHands(frame) {
  const { xrFrame, refSpace, session } = frame;
  let left = null;
  let right = null;
  if (xrFrame && refSpace && session) {
    for (const src of session.inputSources) {
      if (!src.hand) continue;
      if (src.handedness === 'left') left = src.hand;
      else if (src.handedness === 'right') right = src.hand;
    }
  }
  if (!left && !right) {
    // 손 추적이 없으면(PC, 컨트롤러) 화면 고정 자리에 둔다.
    if (layersOnPalm) placeLayersFixed();
    pLayers.mesh.visible = true;
    return;
  }

  const L = HUD.layers;
  const wrist = left && xrFrame.getJointPose?.(left.get('wrist'), refSpace);
  let palmUp = false;
  if (wrist) {
    const o = wrist.transform.orientation;
    v1.set(0, 1, 0).applyQuaternion(q1.set(o.x, o.y, o.z, o.w)); // 손등 방향
    palmUp = v1.y < L.palmUpDot;
  }
  pLayers.mesh.visible = palmUp;
  if (!palmUp) return;

  if (!layersOnPalm) {
    ctx.scene.add(pLayers.mesh);
    layersOnPalm = true;
  }
  // To the right of the floating map (core/palm.js), with a gap, facing the wearer.
  ctx.camera.getWorldPosition(v2);
  if (leftPalm(frame, ctx.camera, palmState)) {
    pLayers.mesh.position.copy(palmState.anchor).addScaledVector(palmState.right, L.palmOffsetRightM);
    pLayers.mesh.position.y += L.palmOffsetUpM;
  } else {
    const p = wrist.transform.position;
    pLayers.mesh.position.set(p.x, p.y + 0.1, p.z);
  }
  pLayers.mesh.lookAt(v2);
  pLayers.mesh.scale.setScalar(L.palmScale);

  // Right index fingertip: show where it points while it approaches, press when it touches.
  const tip = right && xrFrame.getJointPose?.(right.get('index-finger-tip'), refSpace);
  let hoverId = null;
  let cursor = null;
  if (tip) {
    pLayers.mesh.updateWorldMatrix(true, false);
    v1.set(tip.transform.position.x, tip.transform.position.y, tip.transform.position.z);
    pLayers.mesh.worldToLocal(v1);
    const dist = Math.abs(v1.z) * L.palmScale;
    const inside = Math.abs(v1.x) <= pLayers.wM / 2 && Math.abs(v1.y) <= pLayers.hM / 2;
    const u = v1.x / pLayers.wM + 0.5;
    const v = v1.y / pLayers.hM + 0.5;
    if (inside && dist < L.hoverDistM) {
      const x = u * pLayers.canvas.width;
      const y = (1 - v) * pLayers.canvas.height;
      cursor = { x, y, near: 1 - Math.min(1, dist / L.hoverDistM) };
      hoverId = tabAt(x, y)?.id ?? null;
    }
    if (inside && dist < L.pokeDistM) {
      if (pokeArmed) pressAtUV(u, v);
      pokeArmed = false;
    } else if (!inside || dist > L.pokeDistM * 2) {
      pokeArmed = true; // the finger has to pull back before it can press again
    }
  }
  if (cursor || touch.cursor || hoverId !== touch.hoverId) dirty.layers = true;
  touch.hoverId = hoverId;
  touch.cursor = cursor;
}

/** 탭 한 칸의 가운데가 화면 어디에 있는지 (CSS 픽셀). 테스트에서 클릭할 자리를 찾는 데 쓴다. */
function tabScreenXY(id) {
  const hit = layerHits.find((h) => h.id === id);
  if (!hit) return null;
  const u = (hit.x + hit.w / 2) / pLayers.canvas.width;
  const v = 1 - (hit.y + hit.h / 2) / pLayers.canvas.height;
  pLayers.mesh.updateWorldMatrix(true, false);
  v1.set((u - 0.5) * pLayers.wM, (v - 0.5) * pLayers.hM, 0).applyMatrix4(pLayers.mesh.matrixWorld).project(ctx.camera);
  const r = ctx.renderer.domElement.getBoundingClientRect();
  return { x: r.left + ((v1.x + 1) / 2) * r.width, y: r.top + ((1 - v1.y) / 2) * r.height };
}

// ---- 모듈 인터페이스 ----
export function init(context) {
  ctx = context;
  const { scene, camera } = ctx;
  scene.add(camera); // 카메라의 자식이 그려지려면 카메라가 장면에 들어 있어야 한다

  rigid = new THREE.Group();
  rigid.name = 'hud';
  camera.add(rigid);
  cards = new THREE.Group();
  if (HUD.followRate > 0) scene.add(cards);
  else rigid.add(cards);

  pStatus = makePanel(HUD.status.wDeg, HUD.status.hDeg);
  place(pStatus, HUD.status.leftDeg, HUD.status.topDeg, HUD.status.wDeg, HUD.status.hDeg);
  pBanner = makePanel(HUD.banner.wDeg, HUD.banner.hDeg);
  place(pBanner, (HUD.stage.wDeg - HUD.banner.wDeg) / 2, HUD.banner.topDeg, HUD.banner.wDeg, HUD.banner.hDeg);
  pLayers = makePanel(HUD.layers.wDeg, HUD.layers.hDeg);
  // Alert card: dead centre of the view.
  pAlert = makePanel(HUD.alert.wDeg, HUD.alert.hDeg);
  place(pAlert, (HUD.stage.wDeg - HUD.alert.wDeg) / 2, (HUD.stage.hDeg - HUD.alert.hDeg) / 2, HUD.alert.wDeg, HUD.alert.hDeg);
  cards.add(pStatus.mesh, pBanner.mesh, pAlert.mesh);
  placeLayersFixed();

  const E = HUD.edge;
  pEdge = makePanel(E.halfWDeg * 2, E.halfHDeg * 2, 512, Math.round((512 * E.halfHDeg) / E.halfWDeg));
  pEdge.mesh.position.set(0, 0, -HUD.distanceM);
  pEdge.mesh.renderOrder = 999;
  pEdge.mesh.visible = false;
  drawEdge(pEdge.g);
  pEdge.tex.needsUpdate = true;
  rigid.add(pEdge.mesh);

  wire(ctx.bus);
  initInput();
  loadFont().then(() => {
    dirty.status = dirty.banner = dirty.layers = true;
  });

  // 테스트와 콘솔에서 상태를 볼 수 있게 열어 둔다.
  window.__hud = { state, statusVM, bannerVM, layersVM, tabScreenXY, frameLevel };
}

export function update(frame) {
  if (!ctx) return;
  const now = performance.now();

  // PC 화면: 창이 좁으면 HUD 전체가 보이도록 줄인다. AR에서는 실제 크기 그대로.
  let s = 1;
  if (!ctx.xr.presenting) {
    const halfH = Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov / 2)) * HUD.distanceM;
    s = Math.min(1, (halfH * ctx.camera.aspect) / ((HUD.stage.wDeg / 2) * UNIT), halfH / ((HUD.stage.hDeg / 2) * UNIT));
  }
  rigid.scale.set(s, s, 1);
  // The alert frame runs around the whole viewport: on a PC screen that is the window edge,
  // in the headset it is the size set in HUD.edge.
  if (ctx.xr.presenting) pEdge.mesh.scale.set(1, 1, 1);
  else {
    const halfH = Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov / 2)) * HUD.distanceM;
    pEdge.mesh.scale.set((halfH * ctx.camera.aspect) / (HUD.edge.halfWDeg * UNIT) / s, halfH / (HUD.edge.halfHDeg * UNIT) / s, 1);
  }

  if (HUD.followRate > 0) {
    const k = 1 - Math.exp(-HUD.followRate * frame.dt);
    cards.position.lerp(ctx.camera.getWorldPosition(v1), k);
    cards.quaternion.slerp(ctx.camera.getWorldQuaternion(q1), k);
    cards.scale.set(s, s, 1);
  }

  updateHands(frame);
  if (touch.pressedId && now > touch.pressedUntil) {
    touch.pressedId = null;
    dirty.layers = true;
  }

  if (state.toast && now > state.toast.until) {
    state.toast = null;
    dirty.banner = true;
  }

  // 테두리: critical은 빨강, warn은 같은 테두리를 주황으로. 느리게 밝아졌다 어두워진다.
  // "경보 확인" 뒤에는 흐리게 멈춘다. mode:change(emergency)는 critical일 때만 보낸다.
  const level = frameLevel();
  pEdge.mesh.visible = !!level;
  if (level) {
    const E = HUD.edge;
    pEdge.mat.color.set(level === 'critical' ? T.dangerLine : T.point);
    const wave = 0.5 - 0.5 * Math.cos((2 * Math.PI * now) / 1000 / E.periodS);
    pEdge.mat.opacity = state.acked ? E.ackedOpacity : E.minOpacity + (1 - E.minOpacity) * wave;
  }

  if (dirty.status) {
    drawStatus(pStatus.g, HUD.pxPerDeg, statusVM(), HUD.suitGauge);
    pStatus.tex.needsUpdate = true;
    dirty.status = false;
  }
  if (dirty.banner) {
    const vm = bannerVM();
    drawBanner(pBanner.g, HUD.pxPerDeg, vm);
    pBanner.tex.needsUpdate = true;
    drawAlert(pAlert.g, HUD.pxPerDeg, vm);
    pAlert.tex.needsUpdate = true;
    pAlert.mesh.visible = !!vm.alert; // an empty panel in the centre would still cost a draw
    dirty.banner = false;
  }
  if (dirty.layers) {
    layerHits = drawLayers(pLayers.g, HUD.pxPerDeg, layersVM());
    pLayers.tex.needsUpdate = true;
    dirty.layers = false;
  }
}
