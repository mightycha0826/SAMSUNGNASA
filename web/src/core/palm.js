// Where things that float over the left palm go. Shared by the map (D) and the layer menu (F)
// so the two stay arranged around the same point.
//
// The map does not sit on the hand: it floats a little above the palm and a little away from
// the wearer, like a hologram projected out of the palm. The numbers are tuned on the Quest 3.

import * as THREE from 'three';

export const PALM = {
  /** Height of the hologram above the palm (m) */
  liftM: 0.14,
  /** How far it sits in front of the palm, away from the wearer (m) */
  forwardM: 0.18,
  /** How far it sits to the wearer's right of the palm (m) */
  rightM: 0.06,
  /** The palm counts as facing up when the back-of-hand direction (wrist +Y) points this far down */
  upDot: -0.35,
};

const quat = new THREE.Quaternion();
const a = new THREE.Vector3();

/**
 * Left-palm pose for this frame, or null when the left hand is not tracked.
 * Fills `out`: palm (palm centre), anchor (where the hologram floats), forward and right
 * (horizontal unit vectors as the wearer sees them), palmUp (boolean).
 */
export function leftPalm(frame, camera, out) {
  const { xrFrame, refSpace, session } = frame;
  if (!xrFrame || !refSpace || !session || !xrFrame.getJointPose) return null;
  let hand = null;
  for (const src of session.inputSources) if (src.hand && src.handedness === 'left') hand = src.hand;
  const wrist = hand && xrFrame.getJointPose(hand.get('wrist'), refSpace);
  if (!wrist) return null;

  const o = wrist.transform.orientation;
  out.palmUp = a.set(0, 1, 0).applyQuaternion(quat.set(o.x, o.y, o.z, o.w)).y < PALM.upDot;

  // Palm centre: halfway from the wrist to the base of the middle finger.
  const p = wrist.transform.position;
  out.palm.set(p.x, p.y, p.z);
  const knuckle = xrFrame.getJointPose(hand.get('middle-finger-phalanx-proximal'), refSpace);
  if (knuckle) {
    const k = knuckle.transform.position;
    out.palm.lerp(a.set(k.x, k.y, k.z), 0.5);
  }

  // "Forward" is where the wearer is looking, flattened to the floor plane.
  camera.getWorldDirection(out.forward);
  out.forward.y = 0;
  if (out.forward.lengthSq() < 1e-6) out.forward.set(0, 0, -1);
  out.forward.normalize();
  out.right.set(-out.forward.z, 0, out.forward.x);

  out.anchor.copy(out.palm).addScaledVector(out.forward, PALM.forwardM).addScaledVector(out.right, PALM.rightM);
  out.anchor.y += PALM.liftM;
  return out;
}

export function makePalmState() {
  return {
    palmUp: false,
    palm: new THREE.Vector3(),
    anchor: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
  };
}
