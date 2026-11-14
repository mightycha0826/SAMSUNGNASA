// What guidance looks like in the room: the path on the real floor and the marker at its end.
// Used by field/index.js for both maps: the way to a target in the room (field map), and the
// Mars route laid out on the floor at walking scale (Mars map).
//
// The path: chevrons every arrowEveryM along it, over a faint band that ties them into one
// line. A light runs along the chevrons toward the destination, they fade in just ahead of the
// feet and fade out a few metres on, so the eye is led forward and the far end of a long route
// does not clutter the room.
//
// The destination: rings spreading on the floor, a column of light that thins out upward, a
// diamond turning slowly at chest height, and a label that always faces the wearer.
//
// Everything is drawn without depth test: the real floor and furniture are not in the depth
// buffer, and guidance must not disappear behind a virtual map.

import * as THREE from 'three';

export const GUIDE = {
  arrowEveryM: 0.42,
  maxArrows: 160,
  arrowWidthM: 0.3,
  bandWidthM: 0.11,
  fadeInM: [0.2, 0.75], // chevrons appear over this stretch ahead of the wearer
  fadeOutM: [5.5, 8.5], // and fade out over this one
  path: 0x8e9dff, // the route colour, as on the maps
  target: 0xf27a0a, // the destination colour, as on the maps
};

/**
 * A flat band along a line of points: two triangles per segment, `width` wide, lying in the
 * plane the points are in (their y is kept). Used for the band under the chevrons and for the
 * route on the palm map.
 */
export function makeRibbon(maxSegments, material) {
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(new Float32Array(maxSegments * 4 * 3), 3);
  const along = new THREE.BufferAttribute(new Float32Array(maxSegments * 4), 1);
  const side = new THREE.BufferAttribute(new Float32Array(maxSegments * 4), 1);
  position.setUsage(THREE.DynamicDrawUsage);
  along.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', position);
  geometry.setAttribute('aAlong', along);
  geometry.setAttribute('aSide', side);
  const index = [];
  for (let i = 0; i < maxSegments; i++) index.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2);
  geometry.setIndex(index);
  geometry.setDrawRange(0, 0);
  for (let i = 0; i < maxSegments * 4; i++) side.setX(i, i % 2 ? 1 : -1);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return {
    mesh,
    /** points: [[x, y, z], ...]; width in the points' own units. */
    set(points, width) {
      let n = 0;
      let run = 0;
      for (let i = 1; i < points.length && n < maxSegments; i++) {
        const [ax, ay, az] = points[i - 1];
        const [bx, by, bz] = points[i];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 1e-6) continue;
        const nx = (-(bz - az) / len) * (width / 2);
        const nz = ((bx - ax) / len) * (width / 2);
        position.setXYZ(n * 4, ax - nx, ay, az - nz);
        position.setXYZ(n * 4 + 1, ax + nx, ay, az + nz);
        position.setXYZ(n * 4 + 2, bx - nx, by, bz - nz);
        position.setXYZ(n * 4 + 3, bx + nx, by, bz + nz);
        along.setX(n * 4, run);
        along.setX(n * 4 + 1, run);
        run += len;
        along.setX(n * 4 + 2, run);
        along.setX(n * 4 + 3, run);
        n++;
      }
      position.needsUpdate = along.needsUpdate = true;
      geometry.setDrawRange(0, n * 6);
    },
  };
}

// ---- the path on the floor ----
const PATH_FADE = `
uniform float time;
uniform vec3 colour;
uniform vec2 fadeIn;
uniform vec2 fadeOut;
float reach(float along) {
  return smoothstep(fadeIn.x, fadeIn.y, along) * (1.0 - smoothstep(fadeOut.x, fadeOut.y, along));
}
float runningLight(float along) {
  return pow(0.5 + 0.5 * sin(6.2832 * (along * 0.5 - time * 0.85)), 3.0);
}`;

function makeChevrons() {
  // One chevron lying on the floor, pointing along -z: two arms meeting at the tip.
  const w = GUIDE.arrowWidthM / 2;
  const s = new THREE.Shape();
  s.moveTo(0, 0.12);
  s.lineTo(w, -0.04);
  s.lineTo(w, -0.12);
  s.lineTo(0, 0.035);
  s.lineTo(-w, -0.12);
  s.lineTo(-w, -0.04);
  s.closePath();
  const geometry = new THREE.ShapeGeometry(s);
  geometry.rotateX(-Math.PI / 2); // shape +y -> floor -z
  const along = new THREE.InstancedBufferAttribute(new Float32Array(GUIDE.maxArrows), 1);
  along.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aAlong', along);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      colour: { value: new THREE.Color(GUIDE.path) },
      fadeIn: { value: new THREE.Vector2(...GUIDE.fadeInM) },
      fadeOut: { value: new THREE.Vector2(...GUIDE.fadeOutM) },
    },
    vertexShader: `
      attribute float aAlong;
      varying float vAlong;
      varying float vTip;
      void main() {
        vAlong = aAlong;
        vTip = clamp(0.5 - position.z / 0.24, 0.0, 1.0); // 0 at the tail, 1 at the tip
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `${PATH_FADE}
      varying float vAlong;
      varying float vTip;
      void main() {
        float light = runningLight(vAlong);
        float alpha = (0.42 + 0.58 * light) * (0.5 + 0.5 * vTip) * reach(vAlong);
        vec3 rgb = mix(colour, vec3(1.0), 0.55 * light * vTip);
        gl_FragColor = vec4(rgb, alpha);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, GUIDE.maxArrows);
  mesh.name = 'guide-arrows';
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 20;
  return { mesh, along, material };
}

function makeBand() {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      colour: { value: new THREE.Color(GUIDE.path) },
      fadeIn: { value: new THREE.Vector2(...GUIDE.fadeInM) },
      fadeOut: { value: new THREE.Vector2(...GUIDE.fadeOutM) },
    },
    vertexShader: `
      attribute float aAlong;
      attribute float aSide;
      varying float vAlong;
      varying float vSide;
      void main() {
        vAlong = aAlong;
        vSide = aSide;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `${PATH_FADE}
      varying float vAlong;
      varying float vSide;
      void main() {
        float soft = 1.0 - smoothstep(0.35, 1.0, abs(vSide)); // soft edges
        float alpha = (0.13 + 0.12 * runningLight(vAlong)) * soft * reach(vAlong);
        gl_FragColor = vec4(colour, alpha);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const band = makeRibbon(96, material);
  band.mesh.name = 'guide-band';
  band.mesh.renderOrder = 19;
  return { ...band, material };
}

// ---- the destination ----
function makeBeacon() {
  const g = new THREE.Group();
  g.name = 'guide-target';
  const colour = new THREE.Color(GUIDE.target);

  // Rings spreading on the floor around a solid ring and a dot.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(1.3, 1.3).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, colour: { value: colour } },
      vertexShader: 'varying vec2 vAt; void main() { vAt = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform float time;
        uniform vec3 colour;
        varying vec2 vAt;
        float ring(float r, float at, float w) { return 1.0 - smoothstep(0.0, w, abs(r - at)); }
        void main() {
          float r = length(vAt);
          float dot_ = 1.0 - smoothstep(0.045, 0.06, r);
          float solid = ring(r, 0.26, 0.022);
          // Two ripples leave the ring one after the other and fade on the way out.
          float ripples = 0.0;
          for (int i = 0; i < 2; i++) {
            float t = fract(time * 0.45 + float(i) * 0.5);
            ripples += ring(r, 0.26 + 0.34 * t, 0.03) * (1.0 - t);
          }
          float glow = (1.0 - smoothstep(0.0, 0.26, r)) * 0.16;
          float alpha = clamp(dot_ + solid * 0.95 + ripples * 0.6 + glow, 0.0, 0.95);
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(colour, alpha);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  floor.position.y = 0.012;

  // A column of light: full at the floor, gone at the top.
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.07, 1.9, 20, 1, true).translate(0, 0.95, 0),
    new THREE.ShaderMaterial({
      uniforms: { colour: { value: colour } },
      vertexShader: 'varying float vUp; void main() { vUp = position.y / 1.9; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 colour; varying float vUp; void main() { gl_FragColor = vec4(colour, 0.5 * pow(1.0 - vUp, 1.6)); \n#include <colorspace_fragment>\n }',
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );

  // A diamond at chest height, turning: seen over furniture and from across the room.
  const gem = new THREE.Group();
  const shape = new THREE.OctahedronGeometry(0.075).scale(0.7, 1.15, 0.7);
  gem.add(
    new THREE.Mesh(shape, new THREE.MeshBasicMaterial({ color: GUIDE.target, transparent: true, opacity: 0.85, depthTest: false })),
    new THREE.LineSegments(new THREE.EdgesGeometry(shape), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false })),
  );
  gem.position.y = 1.22;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 176;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  label.scale.set(0.46, 0.158, 1);
  label.position.y = 1.52;
  label.userData = { canvas, texture, text: '' };

  for (const [object, order] of [[floor, 21], [column, 21], [label, 23]]) {
    object.renderOrder = order;
    object.frustumCulled = false;
    g.add(object);
  }
  for (const child of gem.children) child.renderOrder = 22;
  g.add(gem);
  g.visible = false;
  return { group: g, floor, gem, label };
}

/** The label over the destination: a small name over a large distance. */
function writeLabel(label, name, distance) {
  const u = label.userData;
  const text = `${name}\n${distance}`;
  if (u.text === text) return;
  u.text = text;
  const g = u.canvas.getContext('2d');
  const { width: W, height: H } = u.canvas;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(18, 21, 28, 0.9)';
  g.beginPath();
  g.roundRect(6, 6, W - 12, H - 12, 34);
  g.fill();
  g.fillStyle = '#f27a0a'; // the accent on the left, the colour of the marker
  g.beginPath();
  g.roundRect(6, 6, 16, H - 12, [34, 0, 0, 34]);
  g.fill();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#c9cfdb';
  g.font = '600 34px "Atkinson Hyperlegible", system-ui, sans-serif';
  g.fillText(name.toUpperCase(), W / 2 + 8, 52, W - 70);
  g.fillStyle = '#ffffff';
  g.font = '700 70px "Atkinson Hyperlegible", system-ui, sans-serif';
  g.fillText(distance, W / 2 + 8, 116, W - 70);
  u.texture.needsUpdate = true;
}

const dummy = new THREE.Object3D();

export function createGuide() {
  const group = new THREE.Group();
  group.name = 'guide';
  const chevrons = makeChevrons();
  const band = makeBand();
  const beacon = makeBeacon();
  group.add(band.mesh, chevrons.mesh, beacon.group);

  return {
    group,
    /** How many chevrons lie on the floor (tests). */
    get arrows() {
      return chevrons.mesh.count;
    },
    get targetShown() {
      return beacon.group.visible;
    },

    /** Lay the path along room points [[x, z], ...], the first one where the wearer is. Fewer than two points: no path. */
    lay(points) {
      let n = 0;
      let run = 0;
      if (points.length > 1) {
        let carried = GUIDE.arrowEveryM * 0.75; // the first chevron a step ahead of the feet
        for (let i = 1; i < points.length && n < GUIDE.maxArrows; i++) {
          const [ax, az] = points[i - 1];
          const [bx, bz] = points[i];
          const len = Math.hypot(bx - ax, bz - az);
          if (len < 1e-4) continue;
          const yaw = Math.atan2(-(bx - ax), -(bz - az)); // rotation about +y that turns -z toward the step
          let d = carried;
          while (d < len && n < GUIDE.maxArrows) {
            const t = d / len;
            dummy.position.set(ax + (bx - ax) * t, 0.016, az + (bz - az) * t);
            dummy.rotation.set(0, yaw, 0);
            dummy.updateMatrix();
            chevrons.along.setX(n, run + d);
            chevrons.mesh.setMatrixAt(n++, dummy.matrix);
            d += GUIDE.arrowEveryM;
          }
          carried = d - len;
          run += len;
        }
        band.set(points.map(([x, z]) => [x, 0.012, z]), GUIDE.bandWidthM);
      } else band.set([], GUIDE.bandWidthM);
      chevrons.mesh.count = n;
      chevrons.mesh.instanceMatrix.needsUpdate = true;
      chevrons.along.needsUpdate = true;
    },

    /** Take the path away (the destination marker stays as it is). */
    clear() {
      chevrons.mesh.count = 0;
      band.set([], GUIDE.bandWidthM);
    },

    /** Put the destination marker at room position (x, z), or take it away (null). */
    target(at) {
      beacon.group.visible = !!at;
      if (at) beacon.group.position.set(at.x, 0, at.z);
    },

    /** What the label says: a name ("Target") and a distance ("3.2 m"). `near` hides it: at arm's length it is in the way. */
    label(name, distance, near = false) {
      writeLabel(beacon.label, name, distance);
      beacon.label.visible = !near;
    },

    /** Every frame: the running light, the ripples, the turning diamond. */
    tick(now) {
      const t = (now / 1000) % 1000;
      chevrons.material.uniforms.time.value = t;
      band.material.uniforms.time.value = t;
      beacon.floor.material.uniforms.time.value = t;
      beacon.gem.rotation.y = t * 0.9;
      beacon.gem.position.y = 1.22 + 0.025 * Math.sin(t * 1.7);
    },
  };
}
