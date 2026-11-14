// Obstacle highlight on the real floor (field mode): each obstacle's footprint is filled with a
// soft translucent red, the way a phone shades what it has picked out of a photo before
// erasing it, with a light that travels across it and a few sparks. It is shown in full within
// 2 m of the wearer and fades out exponentially beyond. There is no outline and no halo: on the headset a bright line around every obstacle was more than the room needed.
// Nothing blocky: the edge of the fill is drawn from a distance field, so it follows the shape
// and not the 10 cm cells, and fades out over a few centimetres.
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
uniform vec2 eye; // where the wearer is, on the floor
uniform vec2 reach; // shown in full within reach.x metres of the wearer, then fading by 1/e every reach.y metres
varying vec2 vUv;
varying vec2 vFloor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  float f = texture2D(field, vUv).r; // 0.5 on the edge of an obstacle, more inside, less outside
  float inside = smoothstep(0.42, 0.58, f); // the fill, fading out across the edge
  // Only what is near is shown in full: an obstacle across the room is not in the way yet,
  // and red patches all over the floor are more than the eye needs.
  float away = distance(vFloor, eye);
  float near = away <= reach.x ? 1.0 : exp(-(away - reach.x) / reach.y);
  if (inside * near < 0.01) discard;
  // A band of light that crosses the floor every few seconds.
  float sweep = pow(0.5 + 0.5 * sin(dot(vFloor, vec2(0.8, 0.6)) * 2.4 - time * 1.7), 6.0);
  // Sparks inside the shape: 2.5 cm squares, a few of them lit, each twinkling at its own pace.
  float seed = hash(floor(vFloor / 0.025));
  float spark = step(0.94, seed) * (0.5 + 0.5 * sin(time * 3.2 + seed * 50.0));
  float breathe = 0.9 + 0.1 * sin(time * 2.1);

  float alpha = inside * near * (0.34 * breathe + 0.14 * sweep + 0.36 * spark);
  vec3 rgb = mix(colour, glint, clamp(sweep * 0.35 + spark * 0.6, 0.0, 1.0));
  gl_FragColor = vec4(rgb, clamp(alpha, 0.0, 0.9));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** @param cfg { glowRGB, glintRGB } each [r, g, b] 0-255, glowFullM, glowFadeM (SCAN in index.js) */
export function initOverlay(ctx, { glowRGB, glintRGB, glowFullM = 2, glowFadeM = 0.7 }) {
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
          uniforms: { field: { value: null }, time: { value: 0 }, colour: { value: rgb(glowRGB) }, glint: { value: rgb(glintRGB) }, eye: { value: new THREE.Vector2() }, reach: { value: new THREE.Vector2(glowFullM, glowFadeM) } },
          vertexShader: VERTEX,
          fragmentShader: FRAGMENT,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      floor.name = 'scan-obstacles';
      floor.visible = mode.current === 'field';
      floor.onBeforeRender = (_renderer, _scene, camera) => {
        floor.material.uniforms.time.value = (performance.now() / 1000) % 3600;
        // The camera that is drawing: in the headset one eye, close enough to where the wearer stands.
        const e = camera.matrixWorld.elements;
        floor.material.uniforms.eye.value.set(e[12], e[14]);
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
