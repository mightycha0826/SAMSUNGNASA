// What the two palm maps share, so that the Mars map (map/) and the field map (field/) look and
// behave as one thing: the caption that goes around the map on an imaginary cylinder, the cone of
// light from the palm, and how the map follows the hand.
//
// "The cylinder": the map is the top face of an imaginary upright cylinder. Everything written
// about the map (what it shows, its extent, its sources) is on one card that stands on the side
// of that cylinder, just under the rim, on the side nearest the wearer. The card slides around
// the cylinder as the wearer moves, so it always faces them, and it leans outward so that it can
// be read when looking down at the map. Nothing is written on the map surface itself.

import * as THREE from 'three';
import { PALM, leftPalm } from './palm.js';

export const CAPTION = {
  wM: 0.28,
  hM: 0.07,
  /** The cylinder is this much wider than the map (m) */
  gapM: 0.012,
  /** The card's top edge sits this far under the rim (m) */
  dropM: 0.006,
  /** The card tips outward by this much: its top edge stays under the rim (degrees) */
  leanDeg: 35,
  pxW: 1024,
  pxH: 256,
};

/** Where the six lines of a caption sit on its canvas, and how each is written by default. */
const ROWS = [
  { y: 40, font: '600 32px system-ui', color: '#f2f2f2' }, // title
  { y: 78, font: '26px system-ui', color: '#c3c9da' },
  { y: 116, font: '26px system-ui', color: '#c3c9da' },
  { y: 154, font: '26px system-ui', color: '#f4b575' }, // the one line to notice
  { y: 192, font: '22px system-ui', color: '#c3c9da' },
  { y: 230, font: '20px system-ui', color: '#c3c9da' }, // credit
];

/** A caption card, added to the map's root group. */
export function makeCaption(root, name = 'map-caption') {
  const canvas = document.createElement('canvas');
  canvas.width = CAPTION.pxW;
  canvas.height = CAPTION.pxH;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const card = new THREE.Mesh(
    new THREE.PlaneGeometry(CAPTION.wM, CAPTION.hM),
    new THREE.MeshBasicMaterial({ map: texture, depthTest: false, transparent: true, side: THREE.DoubleSide, toneMapped: false }),
  );
  card.name = name;
  card.renderOrder = 8;
  card.userData = { canvas, texture, text: '' };
  root.add(card);
  return card;
}

/** Write up to six lines on a caption card. Empty lines are skipped; nothing is redrawn if the text is the same. */
export function writeCaption(card, lines) {
  const u = card.userData;
  const text = lines.join('\n');
  if (u.text === text) return;
  u.text = text;
  const g = u.canvas.getContext('2d');
  g.clearRect(0, 0, CAPTION.pxW, CAPTION.pxH);
  g.fillStyle = 'rgba(20,24,32,.93)';
  g.fillRect(0, 0, CAPTION.pxW, CAPTION.pxH);
  lines.slice(0, ROWS.length).forEach((line, i) => {
    if (!line) return;
    g.font = ROWS[i].font;
    g.fillStyle = ROWS[i].color;
    g.fillText(line, 24, ROWS[i].y, CAPTION.pxW - 48);
  });
  u.texture.needsUpdate = true;
}

const radial = new THREE.Vector3();
const cardX = new THREE.Vector3();
const cardUp = new THREE.Vector3();
const cardNormal = new THREE.Vector3();
const basis = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

/** Put the card on the cylinder around a map `mapWidthM` wide, on the side nearest the camera. */
export function placeCaption(card, root, camera, mapWidthM) {
  if (!card || !root.visible) return;
  // Direction from the map centre to the viewer, in the map's own frame, flattened onto the map.
  root.updateWorldMatrix(true, false);
  camera.getWorldPosition(radial);
  root.worldToLocal(radial);
  radial.y = 0;
  if (radial.lengthSq() < 1e-8) radial.set(0, 0, 1);
  radial.normalize();
  cardX.crossVectors(UP, radial).normalize(); // card right = up x radial
  // Lean: the card's face turns up toward the eyes, hinged at its top edge.
  const lean = THREE.MathUtils.degToRad(CAPTION.leanDeg);
  cardNormal.copy(radial).multiplyScalar(Math.cos(lean)).addScaledVector(UP, Math.sin(lean));
  cardUp.copy(UP).multiplyScalar(Math.cos(lean)).addScaledVector(radial, -Math.sin(lean));
  card.quaternion.setFromRotationMatrix(basis.makeBasis(cardX, cardUp, cardNormal));
  // top edge on the cylinder just under the rim; the centre is half a card down from it
  card.position.copy(radial).multiplyScalar(mapWidthM / 2 + CAPTION.gapM);
  card.position.y = -CAPTION.dropM;
  card.position.addScaledVector(cardUp, -CAPTION.hM / 2);
}

const BEAM_SEGMENTS = 24;

/** A faint cone of light from the palm up to the map, so the map reads as projected from the hand. */
export function makeBeam(name = 'palm-beam') {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((BEAM_SEGMENTS + 2) * 3), 3));
  const index = [];
  for (let i = 1; i <= BEAM_SEGMENTS; i++) index.push(0, i, i + 1);
  geometry.setIndex(index);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: 0x8ab4ff, transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }),
  );
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

/** Apex at the palm (given in the map's own frame), rim under the edge of a map `mapWidthM` wide. */
export function updateBeam(beam, apex, mapWidthM) {
  const p = beam.geometry.attributes.position;
  const r = mapWidthM * 0.42;
  p.setXYZ(0, apex.x, apex.y, apex.z);
  for (let i = 0; i <= BEAM_SEGMENTS; i++) {
    const t = (i / BEAM_SEGMENTS) * Math.PI * 2;
    p.setXYZ(i + 1, Math.cos(t) * r, -0.004, Math.sin(t) * r);
  }
  p.needsUpdate = true;
}

const tiltAxis = new THREE.Vector3();
const tiltQuat = new THREE.Quaternion();
const apex = new THREE.Vector3();

/**
 * Float a map over the left palm for this frame: shown once the palm has been up for `holdMs`,
 * gliding after the hand, leaning toward the wearer, with the beam from the palm.
 * `st` keeps the state between frames: { shownSince: null }. Returns true when the map is shown.
 */
export function floatOverPalm(root, beam, frame, camera, palmState, st, { holdMs, followRate, widthM }) {
  if (!leftPalm(frame, camera, palmState) || !palmState.palmUp) {
    st.shownSince = null;
    root.visible = false;
    return false;
  }
  st.shownSince ??= frame.time;
  if (frame.time - st.shownSince < holdMs) {
    root.visible = false;
    return false;
  }
  if (!root.visible) root.position.copy(palmState.anchor);
  else root.position.lerp(palmState.anchor, 1 - Math.exp(-followRate * frame.dt));
  root.visible = true;
  // Lean the map toward the wearer: its up direction tips back along the line of sight.
  const tilt = THREE.MathUtils.degToRad(PALM.tiltDeg);
  tiltAxis.copy(UP).multiplyScalar(Math.cos(tilt)).addScaledVector(palmState.forward, -Math.sin(tilt));
  root.quaternion.copy(tiltQuat.setFromUnitVectors(UP, tiltAxis));
  if (beam) {
    beam.visible = true;
    // palm position in the map's own (tilted) frame
    updateBeam(beam, apex.copy(palmState.palm).sub(root.position).applyQuaternion(tiltQuat.invert()), widthM);
  }
  return true;
}
