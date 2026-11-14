// nav — 경로 탐색, 바닥 화살표, 지도 격자 ↔ 방 좌표 변환 (D, 안현상)
//
// 받는 이벤트: layers:ready, nav:request, hazard:update(P1), alert:raise(critical이면 base로),
//              voice:command (intent가 nav.stop일 때. nav.start·nav.home은 core가 nav:request로 바꿔 준다)
// 보내는 이벤트: nav:route, alert:raise / alert:clear (id: route-blocked)
// 형식: docs/INTERFACES.md 3장
//
// ctx (init에서 받는 것):
//   ctx.bus        이벤트 버스 (core/bus.js). 다른 모듈과는 이것으로만 대화한다
//   ctx.scene      THREE.Scene. 방 좌표(local-floor, 미터, y가 위)가 곧 장면 좌표다
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

import * as THREE from 'three';
import { NAV } from './config.js';
import { Navigation } from './controller.js';
import { createArrows } from './arrows.js';
import { cellToRoom, containsCell, roomToCell } from './coordinates.js';

let ctx, navigation, arrows, actor, off = [], keys = new Set(), wasXR = false;

export function init(context) {
  dispose(); ctx = context;
  arrows = createArrows(ctx.scene);
  actor = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), new THREE.MeshBasicMaterial({ color: 0x5bdbba }));
  actor.name = 'nav-desktop-explorer'; ctx.scene.add(actor);
  const worker = new Worker(new URL('./planner.worker.js', import.meta.url), { type: 'module' });
  navigation = new Navigation({ bus: ctx.bus, worker, onRoute: route => arrows.update(route),
    onPosition: p => { if (p) actor.position.set(p[0], 0.065, p[2]); } });
  off.push(ctx.bus.on('layers:ready', () => {
    if (!ctx.xr.presenting && navigation.transform) {
      const base = navigation.data.layerSet.waypoints?.find(w => w.id === 'base');
      if (base && containsCell(navigation.transform, base.cell)) navigation.setPosition(cellToRoom(navigation.transform, base.cell));
    }
  }));
  const keyDown = e => {
    if (ctx.xr.presenting || !e.key.startsWith('Arrow') || /INPUT|TEXTAREA|SELECT/.test(e.target?.tagName)) return;
    e.preventDefault(); e.stopImmediatePropagation(); keys.add(e.key);
  };
  const keyUp = e => keys.delete(e.key);
  const blur = () => keys.clear();
  window.addEventListener('keydown', keyDown, true); window.addEventListener('keyup', keyUp); window.addEventListener('blur', blur);
  off.push(() => window.removeEventListener('keydown', keyDown, true), () => window.removeEventListener('keyup', keyUp), () => window.removeEventListener('blur', blur));
  const end = () => { keys.clear(); navigation.setPosition(null); arrows.update({ status: 'blocked' }); };
  off.push(ctx.xr.onSessionStart(end), ctx.xr.onSessionEnd(end));
}

export function update(frame) {
  if (!navigation) return;
  const xr = !!frame.session;
  actor.visible = !xr;
  if (xr) {
    const pose = frame.xrFrame && frame.refSpace && frame.xrFrame.getViewerPose(frame.refSpace);
    const p = pose?.transform.position;
    if (p) navigation.setPosition([p.x, 0, p.z]);
    else if (navigation.position) navigation.setPosition(null);
  } else {
    if (wasXR && navigation.transform) {
      const base = navigation.data.layerSet.waypoints?.find(w => w.id === 'base');
      if (base) navigation.setPosition(cellToRoom(navigation.transform, base.cell));
    }
    if (navigation.position && keys.size && navigation.transform) {
      const dx = Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'));
      const dz = Number(keys.has('ArrowDown')) - Number(keys.has('ArrowUp'));
      const norm = Math.hypot(dx, dz) || 1, step = NAV.desktopSpeedMps * frame.dt / norm;
      const p = [navigation.position[0] + dx * step, 0, navigation.position[2] + dz * step];
      if (containsCell(navigation.transform, roomToCell(navigation.transform, p)) && navigation.routeClear([navigation.position, p])) navigation.setPosition(p);
    }
  }
  wasXR = xr; navigation.tick();
}

export function dispose() {
  off.forEach(fn => fn()); off = []; keys.clear(); wasXR = false;
  navigation?.dispose(); navigation = null; arrows?.dispose(); arrows = null;
  if (actor) { actor.removeFromParent(); actor.geometry.dispose(); actor.material.dispose(); actor = null; }
}
