import { sampleHeight } from '../map/terrain.js';

// Metrics of the supplied raster path, in map metres. No display or demo scale.
export function analyzeRoute({ layerSet, grids }, points, weightedCost = null) {
  const grid = layerSet.grid, samples = [];
  for (let i = 0; i < points.length; i++) {
    const b = points[i], a = points[Math.max(0, i - 1)];
    const steps = i ? Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])))) : 1;
    for (let k = i ? 1 : 0; k <= (i ? steps : 0); k++)
      samples.push([a[0] + (b[0] - a[0]) * k / steps, a[1] + (b[1] - a[1]) * k / steps]);
  }
  let distanceM = 0, ascentM = 0, descentM = 0, maxSlopeDeg = 0, slopeIntegral = 0, previous = null;
  for (const cell of samples) {
    if (cell[0] < -0.5 || cell[1] < -0.5 || cell[0] >= grid.cols - 0.5 || cell[1] >= grid.rows - 0.5) return null;
    const height = sampleHeight(grids.topo, grid, Math.max(0, Math.min(grid.cols - 1, cell[0])), Math.max(0, Math.min(grid.rows - 1, cell[1])));
    const c = Math.max(0, Math.min(grid.cols - 1, Math.round(cell[0]))), r = Math.max(0, Math.min(grid.rows - 1, Math.round(cell[1])));
    const slope = grids.slope[r * grid.cols + c];
    if (!Number.isFinite(height) || !Number.isFinite(slope)) return null;
    maxSlopeDeg = Math.max(maxSlopeDeg, slope);
    if (previous) {
      const distance = Math.hypot(cell[0] - previous.cell[0], cell[1] - previous.cell[1]) * grid.cellSizeM;
      distanceM += distance; slopeIntegral += distance * (slope + previous.slope) / 2;
      ascentM += Math.max(0, height - previous.height); descentM += Math.max(0, previous.height - height);
    }
    previous = { cell, slope, height };
  }
  return { distanceM, ascentM, descentM, maxSlopeDeg, meanSlopeDeg: distanceM ? slopeIntegral / distanceM : maxSlopeDeg,
    weightedCost, sampleCount: samples.length };
}
