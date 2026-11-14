// map — 손바닥 지도, 레이어 표시 (D, 안현상)
//
// 받는 이벤트: layers:ready, layer:toggle, nav:route, hazard:update(P1)
// 보내는 이벤트: 없음
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
// 이미지 레이어는 ctx.assetUrl(layer.file) 로 주소를 얻는다 (목 모드에서도 같은 코드로 돈다).
// 숫자 격자는 layers:ready 의 grids.topo, grids.slope (Float32Array, 인덱스 row * cols + col).

export function init(ctx) {}

export function update(frame) {}
