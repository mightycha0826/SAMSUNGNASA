// What stands on the palm maps: the wearer, the target, waypoints, a picked place.
//
// One set of shapes for the Mars map (map/) and the field map (field/), so a thing looks the
// same whichever map shows it:
//   you       a teal arrowhead pointing where the wearer faces
//   target    an orange diamond, the tallest and largest thing on the map: where the route leads
//   waypoint  a blue ball on a short stem with its name over it: a place that was marked
//   pin       a pale pin: the place the pointer picked, while its card is up
// Each floats over the map's surface on a thin stem, so it is never draped over the relief.
//
// Sizes are metres on the map (both maps are the same size). A marker's origin is its head;
// place() puts it `lift` above a point of the surface and stretches the stem down to it.

import * as THREE from 'three';

export const MARK = {
  you: 0x5bdbba,
  target: 0xf27a0a,
  waypoint: 0x4da3ff,
  pin: 0xb9c3ff,
  youLiftM: 0.014,
  targetLiftM: 0.03, // the target stands twice as high as a waypoint
  waypointLiftM: 0.013,
  tagHM: 0.0075, // height of a waypoint's name
};

const flat = (material) => Object.assign(material, { depthTest: false, transparent: true });

function stem(color, opacity) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.0004, 0.0004, 1, 6).translate(0, -0.5, 0), flat(new THREE.MeshBasicMaterial({ color, opacity })));
  mesh.name = 'stem';
  return mesh;
}

function finish(group, order) {
  group.traverse((o) => {
    o.renderOrder = order;
    o.frustumCulled = false;
  });
  group.visible = false;
  return group;
}

/** Put a marker `lift` above a point of the map's surface (the map's own frame), stem down to the surface. */
export function place(marker, x, y, z, lift) {
  marker.position.set(x, y + lift, z);
  const s = marker.getObjectByName('stem');
  if (s) s.scale.y = lift;
  marker.visible = true;
}

/** The wearer: an arrowhead with a dark rim. Turn it with rotation.y = -heading (0 = north, -z). */
export function makeYou() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.0085);
  shape.lineTo(0.006, -0.0065);
  shape.lineTo(0, -0.003);
  shape.lineTo(-0.006, -0.0065);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
  const group = new THREE.Group();
  const rim = new THREE.Mesh(geometry, flat(new THREE.MeshBasicMaterial({ color: 0x0b0d10, side: THREE.DoubleSide })));
  rim.scale.setScalar(1.3);
  rim.position.y = -0.0003;
  group.add(rim, new THREE.Mesh(geometry, flat(new THREE.MeshBasicMaterial({ color: MARK.you, side: THREE.DoubleSide }))), stem(MARK.you, 0.7));
  return finish(group, 24);
}

/** The target: a large diamond with white edges and a ring where its stem meets the map. Turn it with rotation.y. */
export function makeTarget() {
  const group = new THREE.Group();
  const shape = new THREE.OctahedronGeometry(0.0085).scale(0.75, 1.25, 0.75);
  group.add(
    new THREE.Mesh(shape, flat(new THREE.MeshBasicMaterial({ color: MARK.target }))),
    new THREE.LineSegments(new THREE.EdgesGeometry(shape), flat(new THREE.LineBasicMaterial({ color: 0xffffff }))),
    stem(MARK.target, 0.85),
  );
  return finish(group, 23);
}

/** A name on a small dark plate that always faces the eye. */
function makeTag(text, color) {
  const canvas = document.createElement('canvas');
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false, transparent: true }));
  sprite.material.map.colorSpace = THREE.SRGBColorSpace;
  sprite.userData = { canvas, text: null, color };
  sprite.name = 'tag';
  writeTag(sprite, text);
  return sprite;
}

function writeTag(sprite, text) {
  const u = sprite.userData;
  const shown = String(text ?? '').trim();
  if (u.text === shown) return;
  u.text = shown;
  const FONT = '600 40px "Atkinson Hyperlegible", system-ui, sans-serif';
  const H = 64;
  const g = u.canvas.getContext('2d');
  g.font = FONT;
  const short = shown.length > 28 ? `${shown.slice(0, 27)}…` : shown;
  const W = Math.max(H, Math.ceil(g.measureText(short).width) + 40);
  u.canvas.width = W; // resizing clears the canvas and its state
  u.canvas.height = H;
  g.font = FONT;
  g.fillStyle = 'rgba(12, 15, 22, 0.86)';
  g.beginPath();
  g.roundRect(0, 0, W, H, 18);
  g.fill();
  g.fillStyle = `#${new THREE.Color(u.color).getHexString()}`;
  g.fillRect(0, 0, 8, H);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(short, W / 2 + 4, H / 2 + 2);
  sprite.material.map.dispose();
  sprite.material.map = new THREE.CanvasTexture(u.canvas);
  sprite.material.map.colorSpace = THREE.SRGBColorSpace;
  sprite.scale.set((MARK.tagHM * W) / H, MARK.tagHM, 1);
  sprite.visible = !!short;
}

/** A waypoint: a blue ball on a stem with its name over it. setLabel(marker, text) changes the name. */
export function makeWaypoint(label = '', color = MARK.waypoint) {
  const group = new THREE.Group();
  const tag = makeTag(label, color);
  tag.position.y = 0.0032 + 0.0018 + MARK.tagHM / 2;
  group.add(
    new THREE.Mesh(new THREE.SphereGeometry(0.0032, 14, 10), flat(new THREE.MeshBasicMaterial({ color }))),
    new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.OctahedronGeometry(0.0044)), flat(new THREE.LineBasicMaterial({ color: 0xffffff, opacity: 0.8 }))),
    stem(color, 0.85),
    tag,
  );
  return finish(group, 22);
}

export function setLabel(marker, text) {
  const tag = marker.getObjectByName('tag');
  if (tag) writeTag(tag, text);
}

/** The picked place: a pale pin with a ring on the map under it. Its origin is its foot: put it on the surface. */
export function makePin() {
  const group = new THREE.Group();
  const material = flat(new THREE.MeshBasicMaterial({ color: MARK.pin }));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.004, 12, 8), material);
  head.position.y = 0.016;
  const point = new THREE.Mesh(new THREE.ConeGeometry(0.0026, 0.014, 8).rotateX(Math.PI), material);
  point.position.y = 0.007;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.006, 0.0075, 24).rotateX(-Math.PI / 2), flat(new THREE.MeshBasicMaterial({ color: MARK.pin, side: THREE.DoubleSide })));
  ring.position.y = 0.0006;
  group.add(head, point, ring);
  return finish(group, 25);
}
