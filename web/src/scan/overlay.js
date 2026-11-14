// Obstacle outline on the real floor (field mode). One texel per grid cell, laid on the floor
// where hazard:update says the cells are: the rim of each obstacle solid, its inside faint, so
// a wall or a piece of furniture reads as a red outline around its footprint.
// It draws whatever arrives on the bus, so the mock grid (?mock=hazard) shows the same way.

import * as THREE from 'three';
import { mode } from '../core/mode.js';

// [r, g, b, a] as the one 32-bit number those four bytes make in a little-endian Uint32Array.
const pack = ([r, g, b, a]) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;

/** @param colours { edgeRGBA, fillRGBA } each [r, g, b, a] 0-255 (SCAN in index.js) */
export function initOverlay(ctx, { edgeRGBA, fillRGBA }) {
  const edge = pack(edgeRGBA);
  const fill = pack(fillRGBA);
  let floor = null;

  ctx.bus.on('app:mode', () => {
    if (floor) floor.visible = mode.current === 'field';
  });

  ctx.bus.on('hazard:update', ({ originXZ, cellSizeM, cols, rows, cells }) => {
    if (!floor) {
      // Laid down this way the texture runs along +x and +z, so cell [0, 0] sits at originXZ.
      floor = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2),
        new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }),
      );
      floor.name = 'scan-obstacles';
      floor.visible = mode.current === 'field';
      ctx.scene.add(floor);
    }
    const material = floor.material;
    // A new picture when the grid size is not the one before (the first event, or a test that feeds several sizes).
    if (material.map?.image.width !== cols || material.map.image.height !== rows) {
      material.map?.dispose();
      material.map = new THREE.DataTexture(new Uint8Array(cols * rows * 4), cols, rows);
      material.map.colorSpace = THREE.SRGBColorSpace;
      material.needsUpdate = true;
    }
    const width = cols * cellSizeM;
    const depth = rows * cellSizeM;
    floor.scale.set(width, 1, depth);
    floor.position.set(originXZ[0] + width / 2, 0.01, originXZ[1] + depth / 2);

    const texels = new Uint32Array(material.map.image.data.buffer); // one store per cell: this runs on every event
    for (let i = 0; i < cols * rows; i++) {
      let rgba = 0;
      if (cells[i] === 1) {
        const col = i % cols;
        const inside =
          col > 0 && col < cols - 1 && cells[i - 1] === 1 && cells[i + 1] === 1 && cells[i - cols] === 1 && cells[i + cols] === 1;
        rgba = inside ? fill : edge;
      }
      texels[i] = rgba;
    }
    material.map.needsUpdate = true;
  });
}
