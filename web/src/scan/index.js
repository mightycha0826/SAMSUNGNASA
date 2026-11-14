// scan — 현장 장애물 스캔 (A, 이효제)
//
// 받는 이벤트: mode:change (P2, 야간투시)
// 보내는 이벤트: hazard:update (초당 2회 이하)
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
//
// 깊이·메쉬·평면이 실제로 들어오는지는 check.html 결과를 먼저 본다.
//   ctx.xr.has('depth-sensing'), ctx.xr.has('mesh-detection'), ctx.xr.has('plane-detection')
//   frame.xrFrame.detectedMeshes / detectedPlanes / getDepthInformation(view)

import { startMockHazard } from '../mock/hazard.js';

export function init(ctx) {
  // 목 모드의 가짜 장애물. 실제 스캔을 만들면 이 줄을 자기 구현으로 바꾼다.
  if (ctx.mock.hazard) startMockHazard(ctx.bus, { speed: ctx.mock.speed });
}

export function update(frame) {}
