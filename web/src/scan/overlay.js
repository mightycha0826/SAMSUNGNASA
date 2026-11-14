// Obstacle highlight on the real floor (field mode): each obstacle's footprint glows red, the
// way a phone shows what it has picked out of a photo before erasing it. A soft translucent
// fill, a bright smooth outline with a light that travels along it, a faint halo outside and a
// few sparks inside. Nothing blocky: the outline is drawn from a distance field, so it follows
// the shape and not the 10 cm cells.
//
// It draws whatever arrives on the bus, so the mock grid (?mock=hazard) shows the same way.

import * as THREE from 'three';
import { mode } from '../core/mode.js';

export const OVERLAY = {
  reachCells: 2.5, // the field runs from 0 to 1 over this many cells either side of an outline
};

/**
 * How far each cell is from the outline of the obstacles, as bytes: 128 on the outline, rising
 * to 255 `reach` cells inside an obstacle and falling to 0 `reach` cells outside. Sampled with
 * smoothing on the GPU, the 128 line is a smooth outline. Floor and unknown cells are both
 * "outside". Distances are along rows, columns and diagonals (a chamfer), close enough for a glow.
 */
export function outlineField(cells, cols, rows, reach = OVERLAY.reachCells) {
  const n = cols * rows;
  const FAR = 1e3;
  // Distance to the nearest cell of the other kind, in cells, for both kinds at once.
  const out = new Float32Array(n); // for cells outside: distance to the nearest obstacle
  const inn = new Float32Array(n); // for cells inside: distance to the nearest free cell
  for (let i = 0; i < n; i++) {
    const obstacle = cells[i] === 1;
    out[i] = obstacle ? 0 : FAR;
    inn[i] = obstacle ? FAR : 0;
  }
  const relax = (d) => {
    const pass = (from, to, step) => {
      for (let r = from; r !== to; r += step) {
        for (let c = from === 0 ? 0 : cols - 1; c >= 0 && c < cols; c += step) {
          const i = r * cols + c;
          let best = d[i];
          const rr = r - step;
          const cc = c - step;
          if (cc >= 0 && cc < cols) best = Math.min(best, d[i - step] + 1);
          if (rr >= 0 && rr < rows) {
            best = Math.min(best, d[rr * cols + c] + 1);
            if (cc >= 0 && cc < cols) best = Math.min(best, d[rr * cols + cc] + Math.SQRT2);
            const co = c + step;
            if (co >= 0 && co < cols) best = Math.min(best, d[rr * cols + co] + Math.SQRT2);
          }
          d[i] = best;
        }
      }
    };
    pass(0, rows, 1);
    pass(rows - 1, -1, -1);
  };
  relax(out);
  relax(inn);
  const field = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    // A cell centre is half a cell from its own edge: the outline runs between the two kinds.
    const signed = cells[i] === 1 ? inn[i] - 0.5 : -(out[i] - 0.5);
    field[i] = Math.round(255 * Math.min(1, Math.max(0, 0.5 + signed / (2 * reach))));
  }
  return field;
}

const VERTEX = `
varying vec2 vUv;
varying vec2 vFloor;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vFloor = world.xz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const FRAGMENT = `
uniform sampler2D field;
uniform float time;
uniform vec3 colour;
uniform vec3 glint;
varying vec2 vUv;
varying vec2 vFloor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  float f = texture2D(field, vUv).r; // 0.5 on the outline, more inside, less outside
  if (f < 0.03) discard;
  float inside = smoothstep(0.44, 0.56, f);
  float rim = 1.0 - smoothstep(0.0, 0.11, abs(f - 0.5));
  float halo = smoothstep(0.03, 0.5, f) * (1.0 - inside);
  // A band of light that crosses the floor every few seconds and lights the outline as it passes.
  float sweep = pow(0.5 + 0.5 * sin(dot(vFloor, vec2(0.8, 0.6)) * 2.4 - time * 1.7), 6.0);
  // Sparks inside the shape: 2.5 cm squares, a few of them lit, each twinkling at its own pace.
  float seed = hash(floor(vFloor / 0.025));
  float spark = step(0.94, seed) * (0.5 + 0.5 * sin(time * 3.2 + seed * 50.0));
  float breathe = 0.86 + 0.14 * sin(time * 2.1);

  float alpha = inside * (0.20 + 0.10 * sweep + 0.40 * spark) + rim * (0.72 + 0.28 * sweep) * breathe + halo * 0.26;
  vec3 rgb = mix(colour, glint, clamp(rim * sweep * 0.85 + inside * spark * 0.6, 0.0, 1.0));
  gl_FragColor = vec4(rgb, clamp(alpha, 0.0, 0.95));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** @param colours { glowRGB, glintRGB } each [r, g, b] 0-255 (SCAN in index.js) */
export function initOverlay(ctx, { glowRGB, glintRGB }) {
  let floor = null;
  const rgb = (v) => new THREE.Color().setRGB(v[0] / 255, v[1] / 255, v[2] / 255, THREE.SRGBColorSpace);

  ctx.bus.on('app:mode', () => {
    if (floor) floor.visible = mode.current === 'field';
  });

  ctx.bus.on('hazard:update', ({ originXZ, cellSizeM, cols, rows, cells }) => {
    if (!floor) {
      // Laid down this way the texture runs along +x and +z, so cell [0, 0] sits at originXZ.
      floor = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2),
        new THREE.ShaderMaterial({
          uniforms: { field: { value: null }, time: { value: 0 }, colour: { value: rgb(glowRGB) }, glint: { value: rgb(glintRGB) } },
          vertexShader: VERTEX,
          fragmentShader: FRAGMENT,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      floor.name = 'scan-obstacles';
      floor.visible = mode.current === 'field';
      floor.onBeforeRender = () => {
        floor.material.uniforms.time.value = (performance.now() / 1000) % 3600;
      };
      ctx.scene.add(floor);
    }
    const uniforms = floor.material.uniforms;
    // A new picture when the grid size is not the one before (the first event, or a test that feeds several sizes).
    if (uniforms.field.value?.image.width !== cols || uniforms.field.value.image.height !== rows) {
      uniforms.field.value?.dispose();
      const texture = new THREE.DataTexture(new Uint8Array(cols * rows), cols, rows, THREE.RedFormat);
      texture.magFilter = texture.minFilter = THREE.LinearFilter; // the smoothing that turns cells into an outline
      uniforms.field.value = texture;
    }
    const width = cols * cellSizeM;
    const depth = rows * cellSizeM;
    floor.scale.set(width, 1, depth);
    floor.position.set(originXZ[0] + width / 2, 0.01, originXZ[1] + depth / 2);
    uniforms.field.value.image.data.set(outlineField(cells, cols, rows));
    uniforms.field.value.needsUpdate = true;
  });
}
