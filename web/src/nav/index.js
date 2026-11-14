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

export function init(ctx) {}

export function update(frame) {}
