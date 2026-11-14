export const MAP = Object.freeze({ widthM: 0.25, desktopScale: 8, maxVerticesPerSide: 129,
  desktopTiltRad: 0.55, holdMs: 200, followRate: 18, textureMaxSize: 2048 });
// Published HUD legend colours; no import of another module's runtime.
export const RAMPS = {
  topo: [[18, 42, 74], [32, 120, 128], [196, 170, 110], [250, 246, 232]],
  slope: [[236, 236, 244], [150, 130, 200], [60, 20, 110]],
  thermal: [[10, 6, 40], [110, 30, 120], [230, 110, 40], [252, 240, 150]],
};
export function rampColor(id, value) {
  const ramp = RAMPS[id] ?? [[30, 30, 30], [240, 240, 240]];
  const t = (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(t)), f = t - i;
  return ramp[i].map((v, k) => Math.round(v + (ramp[i + 1][k] - v) * f));
}
