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
  // Waypoints on the way (via.js): a route goes through a marked waypoint when that makes it
  // hardly more costly: by at most viaExtraShare of the direct route's cost, or viaExtraCost
  // (weighted metres: two cells of level ground) if that is more. Several may be taken, as long
  // as all of them together stay within that.
  viaExtraShare: 0.1,
  viaExtraCost: 8,
  viaMinM: 6, // a waypoint this near the start or the destination is not a stop on the way
  viaMax: 6,
});
