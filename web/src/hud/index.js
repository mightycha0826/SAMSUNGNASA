// hud — 상태창, 비상 모드, 레이어 전환 UI (F, 길윤석)
//
// 받는 이벤트: layers:ready, layer:toggle, env:update, telemetry:update, alert:raise, alert:clear,
//              nav:route, voice:command (intent가 alert.ack일 때), voice:commands, app:mode
// 테두리: critical 경보는 빨강, warn 경보는 같은 테두리를 주황으로 점멸한다.
// The same pulse also lights the whole view softly in that colour (HUD.wash).
// 보내는 이벤트: layer:toggle (탭을 누를 때, 그리고 layers:ready 직후 기본 레이어 한 번),
//                mode:change (critical 경보가 생기면 emergency, 모두 풀리면 원래 모드)
// 형식: docs/INTERFACES.md 3장. 디자인: mockups/hud-mockup.html, design-system/point
//
// 파일:
//   config.js   크기·위치·주기 숫자 (조정은 여기서)
//   strings.js  화면 글자 (en / ko)
//   tokens.js   색·글꼴 (포인트 디자인 시스템 다크 테마)
//   draw.js     캔버스에 그리는 함수
//   pointer.js  point and pinch: the ray from the hand, its cursor, the press
//   index.js    이벤트를 받아 상태를 바꾸고, 패널을 장면에 놓는다
//
// AR 세션 안에서는 HTML이 보이지 않아서, 캔버스에 그린 그림을 눈앞 1m 평면에 붙인다.
// 레이어는 한 번에 하나만 켠다 (목업의 결정). 탭을 누르면 앞 레이어를 끄고 새 레이어를 켠다.
//
// 헤드셋에서 미확인: 글자 크기와 가독성, 반투명 카드, 손바닥 방향 판정, 포인터로 탭 누르기 (pointer.js).

import * as THREE from 'three';
import { HUD } from './config.js';
import { STRINGS } from './strings.js';
import { T, loadFont } from './tokens.js';
import { drawStatus, drawBanner, drawAlert, drawAlertGlow, drawLayers, drawCommands } from './draw.js';
import { leftPalm, makePalmState } from '../core/palm.js';
import { mode } from '../core/mode.js';
import { createPointer } from './pointer.js';
import { createSuit } from './suit.js';
import { createRescue } from './rescue.js';
import { handOpen } from '../core/palm.js';
import { walkableNear, reachableFrom } from '../core/waypoints.js';
import { pickOnMap, mapCellInRoom, showPick } from '../map/index.js';

const S = STRINGS[HUD.lang];
const UNIT = HUD.distanceM * Math.tan(Math.PI / 180); // 1도의 길이 (m)

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
const dirty = { status: true, banner: true, layers: true, commands: true, pick: true };

// ---- 패널 ----
let rigid; // 카메라에 붙는 묶음 (비상 테두리, 그리고 followRate가 0이면 카드도)
let cards; // 상태창·경보 카드 묶음
let pStatus, pBanner, pAlert, pLayers, pEdge, pCommands;
let wash; // the soft light over the whole view while an alert rings
let layerHits = [];
let layersOnPalm = false;
const palmState = makePalmState();
/** True while the terrain map is in view: palm up in the headset, always on a PC screen. */
let mapInView = false;
// Pointer feedback on the layer menu: which tab the cursor is on and which was just pressed.
const touch = { hoverId: null, pressedId: null, pressedUntil: 0 };
// The same for the command menu over the back of the hand.
const cmdTouch = { hoverId: null, pressedId: null, pressedUntil: 0 };
let commandHits = [];
// What the hub can be told. The hub sends its own list (jetson/commands.json) when it connects;
// until then, and in mock mode, this list is shown. `mode` limits a command to the Mars map or
// the field map; the layer names are voice only, because the tabs beside the map do the same.
let commands = [
  { say: 'Status', intent: 'status.report', slots: {} },
  { say: 'Navigate', intent: 'nav.start', slots: { targetId: 'near' } },
  { say: 'Base', intent: 'nav.home', slots: {}, mode: 'mars' },
  { say: 'Mark target', intent: 'nav.mark', slots: {}, mode: 'field' },
  { say: 'Stop', intent: 'nav.stop', slots: {} },
  { say: 'Confirm', intent: 'alert.ack', slots: {} },
];
/** The commands that apply to the mode the wearer is in. */
const menuCommands = () => commands.filter((c) => !c.mode || c.mode === mode.current);
// Point and pinch (pointer.js): the ray from the pointing hand, its cursor and the press.
let pointer;
let pointerTargets = [];
// Which menus a pointer was on in the last frame: a menu that is being pointed at holds still.
const engaged = { layers: false, commands: false, pick: false };
let rescue = null; // the emergency button on the command card (rescue.js)
let leftOpen = false; // the left hand is held open: only then does it bring a menu up
// A place picked on the palm map with the pointer: a pin on the map and a small card over it
// with "Navigate" and "Cancel". Saying "Navigate" or "Cancel" does the same as pressing them.
let pick = null; // { cell: [col, row] } while the card is up
let pPick = null;
let pickHits = [];
const pickTouch = { hoverId: null, pressedId: null, pressedUntil: 0 };
const UP = new THREE.Vector3(0, 1, 0);
let lastSosDraw = 0;
let mapPointed = false; // the right hand's pointer is on the map this frame
let suit = null; // the right hand: the vitals hologram over the palm (suit.js)
// Test hook: keep the command menu up without a hand (PC).
let commandsPinned = false;
let audio = null;

function audioCtx() {
  audio ??= new (window.AudioContext || window.webkitAudioContext)();
  if (audio.state !== 'running') audio.resume();
  return audio;
}

// Alarm beep of the mockup: it sounds 0.1 s before each flash of the alert frame.
//   warn      one soft 880 Hz sine tone
//   critical  two sharp 2350 Hz square pulses through a low-pass filter (a piezo buzzer)
function alarmBeep(level) {
  if (!HUD.alarm.enabled) return;
  try {
    const ac = audioCtx();
    const t = ac.currentTime + 0.004;
    const G = HUD.alarm.gain;
    if (level === 'critical') {
      for (const [at, dur] of [[0, 0.105], [0.165, 0.135]]) {
        const osc = ac.createOscillator();
        const filter = ac.createBiquadFilter();
        const gain = ac.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(HUD.alarm.criticalHz, t + at);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(3400, t + at);
        gain.gain.setValueAtTime(0.0001, t + at);
        gain.gain.exponentialRampToValueAtTime(G * 1.1, t + at + 0.008);
        gain.gain.setValueAtTime(G * 1.1, t + at + dur - 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
        osc.connect(filter).connect(gain).connect(ac.destination);
        osc.start(t + at);
        osc.stop(t + at + dur + 0.015);
      }
    } else {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(HUD.alarm.warnHz, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(G, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      osc.connect(gain).connect(ac.destination);
      osc.start(t);
      osc.stop(t + 0.16);
    }
  } catch {
    /* no audio: the frame still flashes */
  }
}
// The running alarm: which level it is for, when it started, and how many beeps have sounded.
const alarm = { level: null, t0: 0, beeps: 0 };

/** Short click, so a press is heard as well as seen. */
function clickSound() {
  try {
    audioCtx();
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    // A soft, low "tock": a calm tone that drops a little and fades quickly.
    osc.frequency.setValueAtTime(330, t);
    osc.frequency.exponentialRampToValueAtTime(220, t + 0.09);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.18);
  } catch {
    /* no audio: the visual feedback is enough */
  }
}

function hitAt(hits, x, y) {
  return hits.find((h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) ?? null;
}
const tabAt = (x, y) => hitAt(layerHits, x, y);

function commandsVM() {
  const pressedId = performance.now() < cmdTouch.pressedUntil ? cmdTouch.pressedId : null;
  return {
    cols: HUD.commands.cols,
    title: S.voiceTitle ?? 'Commands',
    hint: S.voiceHint ?? 'Say it, or point and pinch',
    items: menuCommands().map((c) => ({ id: c.say, label: c.say, hover: c.say === cmdTouch.hoverId, pressed: c.say === pressedId })),
    sos: { id: SOS_ID, ...rescue.vm(performance.now()), hover: cmdTouch.hoverId === SOS_ID, pressed: pressedId === SOS_ID },
  };
}
const SOS_ID = '__sos';

function pickVM() {
  const pressedId = performance.now() < pickTouch.pressedUntil ? pickTouch.pressedId : null;
  const ls = state.layerSet;
  let hint = '';
  if (pick && ls) {
    const at = Math.round(pick.cell[1]) * ls.grid.cols + Math.round(pick.cell[0]);
    const h = state.grids.topo?.[at];
    const slope = state.grids.slope?.[at];
    hint = [pick.note || (Number.isFinite(h) ? `${h.toFixed(0)} m` : null), Number.isFinite(slope) ? `slope ${slope.toFixed(0)}°` : null].filter(Boolean).join(' · ');
  }
  return {
    cols: 2,
    title: 'Selected point',
    hint,
    items: ['Navigate', 'Cancel'].map((label) => ({ id: label, label, hover: label === pickTouch.hoverId, pressed: label === pressedId })),
  };
}

function selectPoint(cell) {
  // The planner closes ground steeper than 20 degrees, and much of this terrain is: the pick
  // goes to the nearest walkable cell, and the card says how far that was.
  const asked = [Math.round(cell[0]), Math.round(cell[1])];
  const ls = state.layerSet;
  // Reachable from the base over walkable slopes, worked out once per data set.
  if (ls && state.reachable?.for !== ls) {
    const base = ls.waypoints?.find((w) => w.id === 'base');
    state.reachable = { for: ls, cells: base ? reachableFrom(ls, state.grids.slope ?? null, base.cell) : null };
  }
  const walkable = ls ? walkableNear(ls, state.grids.slope ?? null, asked, { within: state.reachable?.cells ?? null, reachCells: 40 }) : asked;
  const to = walkable ?? asked;
  const movedM = ls ? Math.round(Math.hypot(to[0] - asked[0], to[1] - asked[1]) * ls.grid.cellSizeM) : 0;
  pick = { cell: to, note: !walkable ? 'no walkable ground near' : movedM ? `moved ${movedM} m to reachable ground` : '' };
  showPick(pick.cell);
  dirty.pick = true;
  clickSound();
  ctx.bus.emit('map:pick', { cell: pick.cell });
}

function clearPick(keepPin = false) {
  if (!pick) return;
  pick = null;
  if (!keepPin) showPick(null);
  pPick.mesh.visible = false;
  ctx.bus.emit('map:pick', null);
}

/** Go to the picked place: it becomes the destination `pick`, and the route is requested. */
function navigatePick() {
  if (!pick) return;
  ctx.bus.emit('nav:waypoint', { id: 'pick', cell: pick.cell, label: 'Selected point' });
  ctx.bus.emit('nav:request', { targetId: 'pick' });
  clearPick(true); // the card goes, the pin stays where the route leads
}

function pressPick(id) {
  pickTouch.pressedId = id;
  pickTouch.pressedUntil = performance.now() + HUD.layers.pressFlashMs;
  clickSound();
  if (id === 'Navigate') navigatePick();
  else clearPick();
}

/** Run a command from the menu exactly as if it had been spoken. `id` is what the button says. */
function runCommand(id) {
  const c = menuCommands().find((m) => m.say === id);
  if (c) ctx.bus.emit('voice:text', { text: c.say, intent: c.intent, slots: c.slots ?? {} });
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

/**
 * The alert light over the whole view: a sheet of colour fixed in front of the eyes, larger than
 * the field of view. It is a little weaker in the middle than toward the edges, so what the
 * wearer is looking at stays clear. Drawn under the HUD cards, over everything else.
 */
function makeWash() {
  const N = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = N;
  const g = canvas.getContext('2d');
  // The sheet is 3 m wide half a metre away; the view ends about 0.7 m from its centre, which
  // is where the gradient reaches full strength.
  const grad = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, (N / 2) * 0.47);
  grad.addColorStop(0, `rgba(255, 255, 255, ${HUD.wash.centre})`);
  grad.addColorStop(1, 'rgba(255, 255, 255, 1)');
  g.fillStyle = grad;
  g.fillRect(0, 0, N, N);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(3, 3),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false }),
  );
  mesh.name = 'hud-alert-wash';
  mesh.position.z = -0.5;
  mesh.renderOrder = 900; // after the map and the room, before the HUD cards (999 and up)
  mesh.frustumCulled = false;
  mesh.visible = false;
  return mesh;
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
  pLayers.mesh.quaternion.identity(); // it may come back turned from the palm
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
  return { tabs, legend };
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
    // A new alert, or one that got worse, rings again. One that eases (critical back to warn)
    // keeps the wearer's "Confirm": it must not start beeping again on its way down.
    if (!before || (level === 'critical' && before.level !== 'critical')) state.acked = false;
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
  bus.on('nav:route', ({ status, targetId, distanceM, frame }) => {
    const prev = state.nav;
    if (status === 'arrived' && prev.status !== 'arrived') showToast(S.arrivedAt(waypointLabel(targetId ?? prev.targetId)));
    else if (status === 'cancelled' && prev.status !== 'cancelled') showToast(S.guidanceEnded);
    // 같은 목적지로 가는 길이 눈에 띄게 길어졌으면 돌아가는 길로 바뀐 것이다.
    // (Not for the field map: there the distance grows simply because the wearer walks away.)
    else if (frame !== 'room' && status === 'ok' && prev.status === 'ok' && prev.targetId === targetId && distanceM > prev.distanceM + 0.3) showToast(S.recalculated);
    state.nav = { status, targetId: targetId ?? prev.targetId, distanceM: distanceM ?? 0 };
    dirty.status = true;
  });
  // The hub's own command list (jetson/commands.json), for the menu over the back of the hand.
  bus.on('voice:commands', ({ commands: list }) => {
    if (Array.isArray(list) && list.length) {
      commands = list.filter((c) => c?.say && c?.intent).slice(0, 12);
      dirty.commands = true;
    }
  });
  bus.on('voice:command', ({ intent, slots, text }) => {
    // Show what the voice assistant heard, so the wearer knows the command was taken.
    if (text) showToast(`\u201C${String(text).trim().replace(/[.!?]+$/, '')}\u201D`);
    if (intent === 'alert.ack' && state.alerts.size) {
      state.acked = true; // 점멸을 멈춘다. 테두리와 경보 카드는 alert:clear까지 남는다.
      dirty.banner = true;
    }
    // The card over a picked place: saying its buttons presses them. (link.js leaves the
    // route request to us while a place is picked.)
    if (pick && intent === 'nav.start') navigatePick();
    else if (pick && intent === 'nav.stop') clearPick();
  });
  // "Base" is a Mars-map command and "Mark target" a field-map one: the menu follows the mode.
  bus.on('app:mode', () => {
    dirty.commands = true;
  });
}

// ---- pressing ----
const raycaster = new THREE.Raycaster();
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const q1 = new THREE.Quaternion();

function pressLayer(id) {
  touch.pressedId = id;
  touch.pressedUntil = performance.now() + HUD.layers.pressFlashMs;
  dirty.layers = true;
  clickSound();
  selectLayer(id);
}

function pressCommand(id) {
  cmdTouch.pressedId = id;
  cmdTouch.pressedUntil = performance.now() + HUD.layers.pressFlashMs;
  dirty.commands = true;
  clickSound();
  if (id === SOS_ID) rescue.press();
  else runCommand(id);
}

function initInput() {
  // In the headset every press comes from the pointer (pointer.js): hands and controllers alike.
  pointer = createPointer(ctx, HUD.pointer);
  pointerTargets = [
    { id: 'layers', panel: pLayers, hits: () => layerHits, press: pressLayer },
    { id: 'commands', panel: pCommands, hits: () => commandHits, press: pressCommand },
    { id: 'pick', panel: pPick, hits: () => pickHits, press: pressPick },
  ];
  // PC: mouse click
  const el = ctx.renderer.domElement;
  // A click that ends a drag of the view is not a click on the map.
  let downAt = null;
  el.addEventListener('pointerdown', (ev) => (downAt = [ev.clientX, ev.clientY]));
  el.addEventListener('click', (ev) => {
    if (ctx.xr.presenting) return;
    const r = el.getBoundingClientRect();
    v1.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1, 0);
    raycaster.setFromCamera(v1, ctx.camera);
    for (const t of pointerTargets) {
      if (!t.panel.mesh.visible) continue;
      const hit = raycaster.intersectObject(t.panel.mesh, false)[0];
      const id = hit?.uv && hitAt(t.hits(), hit.uv.x * t.panel.canvas.width, (1 - hit.uv.y) * t.panel.canvas.height)?.id;
      if (id != null) {
        t.press(id);
        return;
      }
    }
    // Not on a menu: a place on the map, if the click was not the end of a drag.
    if (downAt && Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > 4) return;
    const hit = mode.current === 'mars' ? pickOnMap(raycaster.ray.origin, raycaster.ray.direction, 40) : null;
    if (hit) selectPoint(hit.cell);
  });
}

// Where a hand-attached menu should be this frame (filled before followMenu is called).
const aim = new THREE.Object3D();
// A menu that came up with a hand gesture is not glued to that hand. It appears beside the hand
// and then holds its place in the room; it only moves again when the hand has moved clearly away
// from it. So a left hand that jitters, or that the headset mis-tracks, does not move the buttons.
const steady = {
  layers: { shown: false, lastSeen: 0, moving: false },
  commands: { shown: false, lastSeen: 0, moving: false },
};

/**
 * Place a menu that a hand gesture brought up.
 *  - `held` (a pointer is on it, or the two hands are so close that the left one cannot be
 *    trusted): it does not move at all, and it does not close.
 *  - Otherwise it stays where it is until the hand is more than a dead zone away, then glides
 *    after it and stops again.
 *  - When the hand turns out of the gesture the menu goes almost at once (turnedMs), and at
 *    once when the hand turns into the other menu's gesture (`other`). When the hand is lost
 *    from view instead, it stays for lingerMs: tracking drops out for moments all the time.
 */
function followMenu(panel, st, wanted, held, scale, now, dt, { handSeen = false, other = false } = {}) {
  const F = HUD.follow;
  if (other && !wanted) st.shown = false; // the hand now shows the other menu: this one goes at once
  else if (held && st.shown) st.lastSeen = now;
  else if (wanted) {
    if (!st.shown) {
      panel.mesh.position.copy(aim.position);
      panel.mesh.quaternion.copy(aim.quaternion);
      st.moving = false;
    } else {
      const d = panel.mesh.position.distanceTo(aim.position);
      const turn = panel.mesh.quaternion.angleTo(aim.quaternion);
      if (d > F.deadZoneM || turn > THREE.MathUtils.degToRad(F.deadZoneDeg)) st.moving = true;
      if (st.moving) {
        const k = 1 - Math.exp(-F.rate * dt);
        panel.mesh.position.lerp(aim.position, k);
        panel.mesh.quaternion.slerp(aim.quaternion, k);
        if (d < F.settleM && turn < 0.05) st.moving = false;
      }
    }
    st.shown = true;
    st.lastSeen = now;
  } else if (st.shown && now - st.lastSeen > (handSeen ? F.turnedMs : F.lingerMs)) {
    st.shown = false; // quickly when the hand has turned away, slowly when it was only lost from view
  }
  panel.mesh.visible = st.shown;
  panel.mesh.scale.setScalar(scale);
}

const wristPos = new THREE.Vector3();

// Hand tracking. Left palm up: the layer menu floats beside the map. Left back-of-hand up: the
// command menu floats above the hand, facing the wearer. The left hand only brings the menus up;
// the right hand points at them from where it is and pinches (pointer.js).
function updateHands(frame) {
  const { xrFrame, refSpace, session } = frame;
  const now = performance.now();
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
    // No hand tracking (PC, controllers): the layer menu sits at its fixed place.
    if (layersOnPalm) placeLayersFixed();
    pLayers.mesh.visible = mode.current !== 'field';
    pLayers.mesh.scale.setScalar(1);
    if (!commandsPinned) pCommands.mesh.visible = false;
    steady.layers.shown = steady.commands.shown = false;
    suit.hide();
    mapInView = !ctx.xr.presenting; // the PC view always shows the map; with controllers we cannot tell
    return;
  }

  const L = HUD.layers;
  const C = HUD.commands;
  const F = HUD.follow;
  const wrist = left && xrFrame.getJointPose?.(left.get('wrist'), refSpace);
  const rightWrist = right && xrFrame.getJointPose?.(right.get('wrist'), refSpace);
  // With the two hands close together the cameras see one in front of the other and the left
  // hand's pose cannot be trusted: nothing is read from it then, and the menus hold still.
  let crowded = false;
  if (wrist && rightWrist) {
    const a = wrist.transform.position;
    const b = rightWrist.transform.position;
    crowded = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < F.crowdM;
  }
  // Gestures with hysteresis: once a menu is up, the hand may tip a good way before it goes.
  let palmUp = false;
  let backUp = false;
  if (crowded) {
    palmUp = steady.layers.shown;
    backUp = steady.commands.shown;
  } else if (wrist) {
    const o = wrist.transform.orientation;
    v1.set(0, 1, 0).applyQuaternion(q1.set(o.x, o.y, o.z, o.w)); // back-of-hand direction
    // A menu comes up only over an open hand: one that points, pinches or makes a fist has
    // turned for another reason. (A hand that relaxes a little stays "open": handOpen is sticky.)
    leftOpen = handOpen(left, xrFrame, refSpace, leftOpen);
    palmUp = leftOpen && v1.y < (steady.layers.shown ? L.palmUpDot + F.gestureSlack : L.palmUpDot);
    backUp = leftOpen && v1.y > (steady.commands.shown ? C.backUpDot - F.gestureSlack : C.backUpDot);
  }
  // The right hand's own two views (suit.js). While its emergency button is up, the left hand
  // is the one that points: its command card stays away so it does not pop up over the ray.
  // The right hand has one thing of its own, the vitals over its palm, and it is also the hand
  // that points. Where the two hands could get in each other's way the left one has the say:
  // the vitals stay away while the hands are too close for the tracking to be trusted, and
  // while the right hand's pointer is on a menu or on the map.
  suit.place(frame, !crowded && !pointer.busy().right && !mapPointed);
  // Palm up shows the map in both modes, so in both it sends the command card away at once.
  const mapUp = palmUp;
  // The layer menu belongs to the Mars map; in field mode the palm shows the field map alone.
  palmUp = palmUp && mode.current !== 'field';
  mapInView = palmUp;
  const seen = !!wrist && !crowded;

  ctx.camera.getWorldPosition(v2);
  if (palmUp && !crowded) {
    if (!layersOnPalm) {
      ctx.scene.add(pLayers.mesh);
      layersOnPalm = true;
    }
    // To the right of the floating map (core/palm.js), with a gap, facing the wearer.
    if (leftPalm(frame, ctx.camera, palmState)) {
      aim.position.copy(palmState.anchor).addScaledVector(palmState.right, L.palmOffsetRightM);
      aim.position.y += L.palmOffsetUpM;
    } else {
      const p = wrist.transform.position;
      aim.position.set(p.x, p.y + 0.1, p.z);
    }
    aim.lookAt(v2);
  }
  followMenu(pLayers, steady.layers, palmUp, engaged.layers || (crowded && steady.layers.shown), L.palmScale, now, frame.dt, { handSeen: seen, other: seen && backUp });

  if (backUp && !crowded) {
    // Above the back of the hand, facing the eyes: a card standing over the hand, clear of it, so
    // the pointing hand never has to come near.
    const p = wrist.transform.position;
    wristPos.set(p.x, p.y, p.z);
    const knuckle = xrFrame.getJointPose?.(left.get('middle-finger-phalanx-proximal'), refSpace);
    if (knuckle) {
      const k = knuckle.transform.position;
      wristPos.lerp(v3.set(k.x, k.y, k.z), 0.5); // the middle of the back of the hand
    }
    aim.position.copy(wristPos);
    aim.position.y += C.liftM;
    // A little beyond the hand, away from the wearer: the pointing hand is then on the near
    // side of the card even when it is held as far out as the left one.
    v3.subVectors(wristPos, v2).setY(0);
    if (v3.lengthSq() > 1e-6) aim.position.addScaledVector(v3.normalize(), C.awayM);
    aim.lookAt(v2);
  }
  followMenu(pCommands, steady.commands, backUp, engaged.commands || (crowded && steady.commands.shown), C.scale, now, frame.dt, { handSeen: seen, other: seen && mapUp });
}

/** Pointing and pinching, after the menus have been placed for this frame. */
function updatePointer(frame, now) {
  const res = pointer.update(frame, pointerTargets, now, frame.dt);
  for (const [id, st, flag] of [['layers', touch, 'layers'], ['commands', cmdTouch, 'commands']]) {
    const r = res.get(id);
    engaged[id] = r.engaged;
    if (r.hoverId !== st.hoverId) {
      st.hoverId = r.hoverId;
      dirty[flag] = true;
    }
  }
  const p = res.get('pick');
  engaged.pick = p.engaged;
  if (p.hoverId !== pickTouch.hoverId) {
    pickTouch.hoverId = p.hoverId;
    dirty.pick = true;
  }

  // A pointer that is on no menu may be on the map: a cursor on the terrain, and a pinch picks
  // the place under it. The same hands that press the left hand's menus (and controllers).
  mapPointed = false;
  if (mode.current === 'mars') {
    for (const ray of pointer.free()) {
      if (ray.hand && !HUD.pointer.hands.includes(ray.hand)) continue;
      const hit = pickOnMap(ray.origin, ray.dir, HUD.pointer.maxM);
      if (!hit) continue;
      ray.show(hit.point, UP);
      if (ray.hand === 'right') mapPointed = true;
      if (ray.pressed) selectPoint(hit.cell);
      break;
    }
  }
  // The card stands over the picked place and goes where the map goes; it hides with the map.
  const over = pick && mapCellInRoom(pick.cell);
  pPick.mesh.visible = !!over;
  if (over) {
    pPick.mesh.position.copy(over);
    pPick.mesh.position.y += HUD.pick.liftM * (ctx.xr.presenting ? 1 : 8);
    pPick.mesh.lookAt(ctx.camera.getWorldPosition(v1));
    pPick.mesh.scale.setScalar(HUD.pick.scale * (ctx.xr.presenting ? 1 : 6));
  }
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
  place(pBanner, (HUD.stage.wDeg - HUD.banner.wDeg) / 2 + HUD.centreShiftDeg, HUD.banner.topDeg, HUD.banner.wDeg, HUD.banner.hDeg);
  pLayers = makePanel(HUD.layers.wDeg, HUD.layers.hDeg);
  // Voice command menu: lives in the room (over the back of the left hand), hidden until then.
  pCommands = makePanel(HUD.commands.wDeg, HUD.commands.hDeg);
  pCommands.mesh.visible = false;
  ctx.scene.add(pCommands.mesh);
  // Alert card: bottom centre, clear of the line of sight (mockup). Its flashing light is a
  // second panel of the same size behind it, so the pulse is a change of opacity, not a redraw.
  const A = HUD.alert;
  const alertTop = HUD.stage.hDeg - A.bottomDeg + A.glowDeg - A.hDeg;
  pEdge = makePanel(A.wDeg, A.hDeg);
  place(pEdge, (HUD.stage.wDeg - A.wDeg) / 2 + HUD.centreShiftDeg, alertTop, A.wDeg, A.hDeg);
  pEdge.mesh.renderOrder = 999;
  pEdge.mesh.visible = false;
  pAlert = makePanel(A.wDeg, A.hDeg);
  place(pAlert, (HUD.stage.wDeg - A.wDeg) / 2 + HUD.centreShiftDeg, alertTop, A.wDeg, A.hDeg);
  cards.add(pStatus.mesh, pBanner.mesh, pEdge.mesh, pAlert.mesh);
  wash = makeWash();
  camera.add(wash);
  placeLayersFixed();

  suit = createSuit(ctx);
  rescue = createRescue(ctx, { showToast, changed: () => (dirty.commands = true), battery: suit.battery });
  pPick = makePanel(HUD.pick.wDeg, HUD.pick.hDeg);
  pPick.mesh.visible = false;
  ctx.scene.add(pPick.mesh);
  wire(ctx.bus);
  initInput();
  loadFont().then(() => {
    dirty.status = dirty.banner = dirty.layers = true;
  });

  // 테스트와 콘솔에서 상태를 볼 수 있게 열어 둔다.
  window.__hud = {
    commandsVM,
    runCommand,
    /** PC: put the command menu in the scene without a hand, to look at it and click it. */
    showCommands: (on, at = [0.95, 1.45, 0.4]) => {
      commandsPinned = on;
      pCommands.mesh.visible = on;
      pCommands.mesh.position.fromArray(at);
      pCommands.mesh.lookAt(ctx.camera.getWorldPosition(v1));
      pCommands.mesh.scale.setScalar(HUD.commands.scale * 3);
      dirty.commands = true;
    },
    pointer,
    suit,
    rescue,
    panels: () => ({ layers: pLayers, commands: pCommands, layerHits, commandHits }),
    state,
    statusVM,
    bannerVM,
    layersVM,
    tabScreenXY,
    frameLevel,
    statusOpacity: () => pStatus.mat.opacity,
    wash: () => ({ visible: wash.visible, opacity: wash.material.opacity, color: `#${wash.material.color.getHexString()}` }),
  };
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

  if (HUD.followRate > 0) {
    const k = 1 - Math.exp(-HUD.followRate * frame.dt);
    cards.position.lerp(ctx.camera.getWorldPosition(v1), k);
    cards.quaternion.slerp(ctx.camera.getWorldQuaternion(q1), k);
    cards.scale.set(s, s, 1);
  }

  updateHands(frame);
  updatePointer(frame, now);
  suit.tick(now, frame.dt);
  // The emergency button counts down while armed: the card is redrawn ten times a second then.
  if (rescue.tick(now) && now - lastSosDraw > 100) {
    lastSosDraw = now;
    dirty.commands = true;
  }
  if (touch.pressedId && now > touch.pressedUntil) {
    touch.pressedId = null;
    dirty.layers = true;
  }
  if (cmdTouch.pressedId && now > cmdTouch.pressedUntil) {
    cmdTouch.pressedId = null;
    dirty.commands = true;
  }

  if (state.toast && now > state.toast.until) {
    state.toast = null;
    dirty.banner = true;
  }

  // 테두리: critical은 빨강, warn은 같은 테두리를 주황으로. 느리게 밝아졌다 어두워진다.
  // "경보 확인" 뒤에는 흐리게 멈춘다. mode:change(emergency)는 critical일 때만 보낸다.
  const level = frameLevel();
  // The light around the alert card (mockup): orange for warn, red for critical.
  pEdge.mesh.visible = !!level;
  // Alarm: a beep at the start of every period, the flash 0.1 s after it (mockup). "Confirm"
  // stops both; a change of level starts over.
  const ringing = level && !state.acked ? level : null;
  if (ringing !== alarm.level) {
    alarm.level = ringing;
    alarm.t0 = now;
    alarm.beeps = 0;
  }
  let pulse = 0; // 1 at the flash, 0 between flashes and after "Confirm"
  if (level) {
    const E = HUD.edge;
    pEdge.mat.color.set(level === 'critical' ? T.dangerLine : T.point);
    if (!ringing) pEdge.mat.opacity = E.ackedOpacity;
    else {
      const periodMs = E.periodS * 1000;
      if (now - alarm.t0 >= alarm.beeps * periodMs) {
        alarm.beeps++;
        alarmBeep(ringing);
      }
      // Pulse: bright at the start, eased down to lowOpacity by 48% of the period, held, then
      // back up over the last 8%.
      const since = now - alarm.t0 - E.flashDelayS * 1000;
      const p = since < 0 ? 0.6 : (since % periodMs) / periodMs;
      const ease = (x) => x * x * (3 - 2 * x);
      pulse = p < 0.48 ? 1 - ease(p / 0.48) : p < 0.92 ? 0 : ease((p - 0.92) / 0.08);
      pEdge.mat.opacity = E.lowOpacity + (1 - E.lowOpacity) * pulse;
    }
  }
  // The same pulse as a soft light over the whole view: orange for warn, red for critical.
  // It goes dark between flashes and stays dark after "Confirm".
  const washOpacity = HUD.wash.enabled && ringing ? pulse * (ringing === 'critical' ? HUD.wash.criticalPeak : HUD.wash.warnPeak) : 0;
  wash.visible = washOpacity > 0.002;
  if (wash.visible) {
    wash.material.color.set(ringing === 'critical' ? T.dangerLine : T.point);
    wash.material.opacity = washOpacity;
  }

  // Status card: lighter while the map is in view so the terrain shows through, full when any
  // alert is active so a warning is never faint.
  const S_ = HUD.status;
  const wanted = level ? 1 : mapInView ? S_.mapOpacity : S_.opacity;
  pStatus.mat.opacity += (wanted - pStatus.mat.opacity) * (1 - Math.exp(-S_.fadeRate * frame.dt));

  if (dirty.status) {
    drawStatus(pStatus.g, HUD.pxPerDeg, statusVM(), HUD.suitGauge);
    pStatus.tex.needsUpdate = true;
    dirty.status = false;
  }
  if (dirty.banner) {
    const vm = bannerVM();
    drawBanner(pBanner.g, HUD.pxPerDeg, vm);
    pBanner.tex.needsUpdate = true;
    const card = drawAlert(pAlert.g, HUD.pxPerDeg, vm, HUD.alert.maxCardDeg, HUD.alert.glowDeg);
    pAlert.tex.needsUpdate = true;
    drawAlertGlow(pEdge.g, HUD.pxPerDeg, card);
    pEdge.tex.needsUpdate = true;
    pAlert.mesh.visible = !!vm.alert; // an empty panel in the centre would still cost a draw
    dirty.banner = false;
  }
  if (dirty.layers) {
    layerHits = drawLayers(pLayers.g, HUD.pxPerDeg, layersVM());
    pLayers.tex.needsUpdate = true;
    dirty.layers = false;
  }
  if (pickTouch.pressedId && now > pickTouch.pressedUntil) {
    pickTouch.pressedId = null;
    dirty.pick = true;
  }
  if (dirty.pick && pPick.mesh.visible) {
    pickHits = drawCommands(pPick.g, HUD.pxPerDeg, pickVM());
    pPick.tex.needsUpdate = true;
    dirty.pick = false;
  }
  if (dirty.commands && pCommands.mesh.visible) {
    commandHits = drawCommands(pCommands.g, HUD.pxPerDeg, commandsVM());
    pCommands.tex.needsUpdate = true;
    dirty.commands = false;
  }
}
