// D 모듈 설정. 배수·거리·각도는 데모용이며 실제 보행 안전 기준이 아니다.
export const NAV = Object.freeze({
  unknownMultiplier: 3,
  slopeReferenceDeg: 15,
  clearanceM: 0.2,
  replanIntervalMs: 500,
  offRouteM: 0.2,
  arrivalM: 0.2,
  publishIntervalMs: 200,
  arrowSpacingM: 0.25,
  arrowHeightM: 0.02,
  desktopSpeedMps: 0.65,
  fullMap: true,
});
