// One map-local metric frame: +x east, +z south, origin at the map centre.
// Geometry display size, demo metadata and device poses never define this frame.
export function createGridFrame(layerSet) {
  const { cols, rows, cellSizeM } = layerSet.grid ?? {};
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2 ||
      !Number.isFinite(cellSizeM) || cellSizeM <= 0) throw new Error('invalid-grid');
  const frameId = layerSet.grid.frameId ?? `map:${layerSet.site?.lon ?? ''}:${layerSet.site?.lat ?? ''}:${cols}:${rows}:${cellSizeM}`;
  return Object.freeze({ cols, rows, cellSizeM, width: cols * cellSizeM, depth: rows * cellSizeM,
    sx: cellSizeM, sz: cellSizeM, frameId });
}

export function cellToWorld(t, cell, y = 0) {
  return [(cell[0] + 0.5) * t.sx - t.width / 2, y,
    t.depth / 2 - (cell[1] + 0.5) * t.sz];
}

export function worldToCell(t, point) {
  return [(point[0] + t.width / 2) / t.sx - 0.5,
    (t.depth / 2 - point[2]) / t.sz - 0.5];
}

export function containsCell(t, p) {
  return p?.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) &&
    p[0] >= -0.5 && p[0] < t.cols - 0.5 && p[1] >= -0.5 && p[1] < t.rows - 0.5;
}

export function sampleGrid(grid, t, cell) {
  if (!grid || !containsCell(t, cell)) return NaN;
  const c = Math.max(0, Math.min(t.cols - 1, Math.round(cell[0])));
  const r = Math.max(0, Math.min(t.rows - 1, Math.round(cell[1])));
  return grid[r * t.cols + c];
}

export function remainingPath(points, position) {
  if (!points.length) return { points: [], distanceM: 0, deviationM: Infinity };
  let best = Infinity, bestIndex = 0, bestPoint = points[0];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b[0] - a[0], dz = b[2] - a[2];
    const s = Math.max(0, Math.min(1, ((position[0] - a[0]) * dx + (position[2] - a[2]) * dz) / (dx * dx + dz * dz || 1)));
    const p = [a[0] + s * dx, 0, a[2] + s * dz];
    const d = Math.hypot(position[0] - p[0], position[2] - p[2]);
    if (d <= best) { best = d; bestIndex = i; bestPoint = p; }
  }
  if (points.length === 1) best = Math.hypot(position[0] - points[0][0], position[2] - points[0][2]);
  const rest = [position.slice(), bestPoint.slice(), ...points.slice(bestIndex + 1)];
  let distanceM = 0;
  for (let i = 1; i < rest.length; i++) distanceM += Math.hypot(rest[i][0] - rest[i - 1][0], rest[i][2] - rest[i - 1][2]);
  return { points: rest, distanceM, deviationM: best };
}
