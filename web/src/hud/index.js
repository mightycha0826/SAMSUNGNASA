// hud — 상태창, 비상 모드, 레이어 전환 UI (F, 길윤석)
//
// 받는 이벤트: layers:ready, env:update, telemetry:update, alert:raise, alert:clear, nav:route,
//              hazard:update(P2), voice:command (intent가 alert.ack, mode.set일 때)
// 보내는 이벤트: layer:toggle, nav:request, mode:change, voice:say
// 형식: docs/INTERFACES.md 3장. 디자인 참고: mockups/hud-mockup.html
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
// AR 세션 안에서는 HTML이 보이지 않는다. 상태창은 ctx.scene에 3D 물체로 넣고,
// 시야를 따라오게 하려면 update에서 ctx.camera 기준으로 위치를 잡는다.

export function init(ctx) {}

export function update(frame) {}
