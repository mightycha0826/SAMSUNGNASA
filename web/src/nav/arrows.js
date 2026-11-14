import * as THREE from 'three';
import { NAV } from './config.js';

export function createArrows(scene) {
  const shape = new THREE.Shape();
  shape.moveTo(-0.035, -0.045); shape.lineTo(0.035, -0.045); shape.lineTo(0.035, 0.015);
  shape.lineTo(0.075, 0.015); shape.lineTo(0, 0.09); shape.lineTo(-0.075, 0.015); shape.lineTo(-0.035, 0.015); shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape); geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({ color: 0x8192ff, side: THREE.DoubleSide, depthWrite: false });
  const mesh = new THREE.InstancedMesh(geometry, material, 128);
  mesh.name = 'nav-arrows'; mesh.count = 0; mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(mesh);
  const dummy = new THREE.Object3D();
  return {
    mesh,
    update({ status, targetId, points = [] }) {
      mesh.count = 0;
      if (status !== 'ok') return;
      material.color.set(targetId === 'base' ? 0xf27a0a : 0x8192ff);
      let next = 0.12;
      for (let i = 1; i < points.length && mesh.count < 128; i++) {
        const a = points[i - 1], b = points[i], dx = b[0] - a[0], dz = b[2] - a[2];
        const length = Math.hypot(dx, dz);
        if (length < 1e-9) continue;
        while (next <= length && mesh.count < 128) {
          dummy.position.set(a[0] + dx * next / length, NAV.arrowHeightM, a[2] + dz * next / length);
          dummy.rotation.set(0, Math.atan2(-dx, -dz), 0); dummy.updateMatrix();
          mesh.setMatrixAt(mesh.count++, dummy.matrix); next += NAV.arrowSpacingM;
        }
        next -= length;
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() { scene.remove(mesh); geometry.dispose(); material.dispose(); },
  };
}
