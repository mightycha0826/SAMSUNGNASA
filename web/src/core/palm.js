// Where things that float over the left palm go. Shared by the map (D) and the layer menu (F)
// so the two stay arranged around the same point.
//
// The map does not sit on the hand: it floats a little above the palm and a little away from
// the wearer, like a hologram projected out of the palm. The numbers are tuned on the Quest 3.

import * as THREE from 'three';

export const PALM = {
  /** Height of the hologram above the palm (m) */
  liftM: 0.1,
  /** How far it sits in front of the palm, away from the wearer (m) */
  forwardM: 0.13,
  /** How far it sits toward the middle of the body: right of a left palm, left of a right one (m) */
  rightM: 0.1,
  /** The map leans this far toward the wearer, so its surface faces the eyes a little (degrees) */
  tiltDeg: 8,
  /** The palm counts as facing up when the back-of-hand direction (wrist +Y) points this far down */
  upDot: -0.35,
};

const quat = new THREE.Quaternion();
const a = new THREE.Vector3();
const b = new THREE.Vector3();

/** How far a finger's tip must be from the wrist, as a multiple of its knuckle's distance, to count as stretched out. */
export const OPEN = { stretched: 1.5, relaxed: 1.3, fingers: 3 };
const FINGERS = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];

/**
 * True when the hand is held open, flat: at least three of the four fingers stretched out.
 * The menus and holograms of a hand show only then, so a hand that points, pinches or makes a
 * fist never brings one up by the way it happens to be turned. `wasOpen` makes it sticky: an
 * open hand may relax a little before it counts as closed. A finger whose joints are not
 * tracked this frame counts as it did before.
 */
export function handOpen(hand, xrFrame, refSpace, wasOpen = false) {
  const wrist = xrFrame.getJointPose?.(hand.get('wrist'), refSpace);
  if (!wrist) return false;
  const w = wrist.transform.position;
  const need = wasOpen ? OPEN.relaxed : OPEN.stretched;
  let out = 0;
  let known = 0;
  for (const finger of FINGERS) {
    const knuckle = xrFrame.getJointPose(hand.get(`${finger}-phalanx-proximal`), refSpace);
    const tip = xrFrame.getJointPose(hand.get(`${finger}-tip`), refSpace);
    if (!knuckle || !tip) continue;
    known++;
    const k = knuckle.transform.position;
    const t = tip.transform.position;
    const toKnuckle = Math.hypot(k.x - w.x, k.y - w.y, k.z - w.z);
    const toTip = Math.hypot(t.x - w.x, t.y - w.y, t.z - w.z);
    if (toTip >= toKnuckle * need) out++;
  }
  if (known < OPEN.fingers) return wasOpen;
  return out >= OPEN.fingers;
}

/**
 * Palm pose of one hand for this frame, or null when that hand is not tracked.
 * Fills `out`: palm (palm centre), anchor (where the hologram floats), forward and right
 * (horizontal unit vectors as the wearer sees them), palmUp (boolean), open (the hand is held
 * open, see handOpen). The hologram floats above the palm, a little away from the wearer and a
 * little toward the middle of the body: to the right of a left hand, to the left of a right one.
 */
export function palmOf(frame, camera, out, handedness = 'left') {
  const { xrFrame, refSpace, session } = frame;
  if (!xrFrame || !refSpace || !session || !xrFrame.getJointPose) return null;
  let hand = null;
  for (const src of session.inputSources) if (src.hand && src.handedness === handedness) hand = src.hand;
  const wrist = hand && xrFrame.getJointPose(hand.get('wrist'), refSpace);
  if (!wrist) {
    out.open = false;
    return null;
  }

  const o = wrist.transform.orientation;
  out.palmUp = a.set(0, 1, 0).applyQuaternion(quat.set(o.x, o.y, o.z, o.w)).y < PALM.upDot;
  out.open = handOpen(hand, xrFrame, refSpace, out.open);

  // Palm centre: halfway from the wrist to the base of the middle finger.
  const p = wrist.transform.position;
  out.palm.set(p.x, p.y, p.z);
  const knuckle = xrFrame.getJointPose(hand.get('middle-finger-phalanx-proximal'), refSpace);
  if (knuckle) {
    const k = knuckle.transform.position;
    out.palm.lerp(b.set(k.x, k.y, k.z), 0.5);
  }

  // "Forward" is where the wearer is looking, flattened to the floor plane.
  camera.getWorldDirection(out.forward);
  out.forward.y = 0;
  if (out.forward.lengthSq() < 1e-6) out.forward.set(0, 0, -1);
  out.forward.normalize();
  out.right.set(-out.forward.z, 0, out.forward.x);

  const inward = handedness === 'right' ? -PALM.rightM : PALM.rightM;
  out.anchor.copy(out.palm).addScaledVector(out.forward, PALM.forwardM).addScaledVector(out.right, inward);
  out.anchor.y += PALM.liftM;
  return out;
}

/** The left palm (the map's hand). See palmOf. */
export const leftPalm = (frame, camera, out) => palmOf(frame, camera, out, 'left');

export function makePalmState() {
  return {
    palmUp: false,
    open: false,
    palm: new THREE.Vector3(),
    anchor: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
  };
}
