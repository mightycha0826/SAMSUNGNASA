// Distances are physical map metres. Slope limits are a planning assumption.
export const NAV = Object.freeze({
  unknownMultiplier: 3,
  slopeReferenceDeg: 15,
  maxSlopeDeg: 20,
  clearanceM: 0.2,
  replanIntervalMs: 500,
  offRouteM: 8,
  arrivalM: 2,
  publishIntervalMs: 200,
});
