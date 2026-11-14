import { MAP } from './config.js';

export function range(grid) {
  let min = Infinity, max = -Infinity;
  for (const v of grid ?? []) if (Number.isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v); }
  return { min, max };
}
export function sampleHeight(topo, grid, c, r) {
  if (c < 0 || r < 0 || c > grid.cols - 1 || r > grid.rows - 1) return NaN;
  const c0 = Math.floor(c), r0 = Math.floor(r), c1 = Math.min(grid.cols - 1, c0 + 1), r1 = Math.min(grid.rows - 1, r0 + 1);
  const tx = c - c0, ty = r - r0;
  const values = [[topo[r0 * grid.cols + c0], (1 - tx) * (1 - ty)],
    [topo[r0 * grid.cols + c1], tx * (1 - ty)], [topo[r1 * grid.cols + c0], (1 - tx) * ty], [topo[r1 * grid.cols + c1], tx * ty]];
  let h = 0;
  for (const [v, w] of values) { if (!w) continue; if (!Number.isFinite(v)) return NaN; h += v * w; }
  return h;
}
export function mapPoint(topo, grid, cell, min, width = MAP.widthM, lift = 0) {
  const h = sampleHeight(topo, grid, cell[0], cell[1]);
  if (!Number.isFinite(h)) return null;
  const scale = width / (grid.cols * grid.cellSizeM);
  return [((cell[0] + 0.5) / grid.cols - 0.5) * width, (h - min) * scale + lift,
    (0.5 - (cell[1] + 0.5) / grid.rows) * width * grid.rows / grid.cols];
}
export function terrainArrays(topo, grid, maxSide = MAP.maxVerticesPerSide) {
  if (!topo || topo.length !== grid.cols * grid.rows) throw new Error('missing-topo');
  const { min, max } = range(topo);
  if (!Number.isFinite(min)) throw new Error('empty-topo');
  const cols = Math.min(grid.cols, maxSide), rows = Math.min(grid.rows, maxSide);
  const positions = new Float32Array(cols * rows * 3), uv = new Float32Array(cols * rows * 2), cells = [];
  // Prefix sum keeps holes even when vertices are downsampled.
  const stride = grid.cols + 1, missing = new Uint32Array((grid.rows + 1) * stride);
  for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) {
    const i = (r + 1) * stride + c + 1;
    missing[i] = Number(!Number.isFinite(topo[r * grid.cols + c])) + missing[i - 1] + missing[i - stride] - missing[i - stride - 1];
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cell = [c / (cols - 1) * (grid.cols - 1), r / (rows - 1) * (grid.rows - 1)]; cells.push(cell);
    const p = mapPoint(topo, grid, cell, min) ?? [0, 0, 0]; const i = r * cols + c;
    positions.set(p, i * 3); uv.set([(cell[0] + 0.5) / grid.cols, (cell[1] + 0.5) / grid.rows], i * 2);
  }
  const indices = [];
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
    const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
    const c0 = Math.floor(cells[a][0]), r0 = Math.floor(cells[a][1]);
    const c1 = Math.ceil(cells[e][0]) + 1, r1 = Math.ceil(cells[e][1]) + 1;
    const absent = missing[r1 * stride + c1] - missing[r0 * stride + c1] - missing[r1 * stride + c0] + missing[r0 * stride + c0];
    if (!absent) indices.push(a, b, d, b, e, d);
  }
  return { positions, uv, indices, min, max };
}
