// Point and pinch: how the floating menus are operated.
//
// Modelled on the Quest 3's own hand pointer. A ray leaves the hand, a cursor shows where it
// meets a menu, and closing thumb and index finger presses the button under the cursor. The
// pointing hand stays where it is comfortable, well away from the menu and from the other hand:
// nothing has to be touched, so the hands never cover each other from the headset's cameras.
//
// Where the ray comes from
//   - The input source's `targetRaySpace`. For a tracked hand the Quest Browser puts the system's
//     own pointer pose there: it is anchored further up the arm, not on the fingertips, so it
//     barely moves while the fingers close. Controllers give their pointing ray the same way.
//   - If a hand has no such pose (or with ?ray=own), the ray is built here the same way: from an
//     estimated shoulder through the base of the index finger.
//
// What counts as a pinch
//   - The session's `selectstart` / `selectend` (the system's pinch, or a controller trigger).
//   - Thumb tip and index tip closer than pinchOnM, from the hand joints.
//   Either one presses, once per pinch: the fingers must open again before the next press.
//
// What makes it forgiving
//   - The cursor is smoothed hard while the hand holds still and hardly at all while it sweeps.
//   - The button under the cursor keeps the hover until the cursor is clearly outside it, and the
//     gaps between buttons belong to the nearest button, so a press never falls between two.
//
// There is no cursor freezing and no touching: the old fingertip cursor, its lock while the
// fingers closed, and the poke are gone.

import * as THREE from 'three';

const o = new THREE.Vector3();
const p2 = new THREE.Vector3();
const inv = new THREE.Matrix4();
const head = new THREE.Vector3();
const side = new THREE.Vector3();
const a = new THREE.Vector3();
const b = new THREE.Vector3();
const q = new THREE.Quaternion();
const Y = new THREE.Vector3(0, 1, 0);

/** The hit rectangle to hover: the current one while the cursor is still about on it, else the
 *  one under the cursor, else the nearest one within reach. Lengths are in canvas pixels. */
export function pickHit(hits, x, y, currentId, K) {
  const gap = (h) => Math.hypot(Math.max(h.x - x, 0, x - (h.x + h.w)), Math.max(h.y - y, 0, y - (h.y + h.h)));
  const current = currentId == null ? null : hits.find((h) => h.id === currentId);
  if (current && gap(current) <= current.h * K.stick) return current.id;
  let best = null;
  let bestGap = Infinity;
  for (const h of hits) {
    const g = gap(h);
    if (g < bestGap && g <= h.h * K.snap) {
      best = h;
      bestGap = g;
    }
  }
  return best ? best.id : null;
}

/**
 * Where a ray meets a panel, in the panel's canvas pixels, or null.
 * panel: { mesh, wM, hM, canvas } (hud/index.js makePanel). The ray must come from the panel's
 * front and hit within `maxM`; the cursor may sit up to `margin` (a fraction of the panel) outside.
 */
export function rayOnPanel(panel, origin, dir, maxM, margin) {
  panel.mesh.updateWorldMatrix(true, false);
  inv.copy(panel.mesh.matrixWorld).invert();
  o.copy(origin).applyMatrix4(inv);
  p2.copy(origin).add(dir).applyMatrix4(inv).sub(o); // the direction, in the panel's own frame
  if (o.z <= 0 || p2.z >= -1e-6) return null; // behind the panel, or pointing away from it
  const t = -o.z / p2.z; // the map is affine, so t is still the distance along the unit ray in metres
  if (t > maxM) return null;
  const u = (o.x + p2.x * t) / panel.wM + 0.5;
  const v = 0.5 - (o.y + p2.y * t) / panel.hM;
  if (u < -margin || u > 1 + margin || v < -margin || v > 1 + margin) return null;
  return { t, x: u * panel.canvas.width, y: v * panel.canvas.height };
}

function makeVisuals(scene) {
  const flat = (geometry, color, opacity, order) => {
    const m = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
    );
    m.renderOrder = order;
    m.frustumCulled = false;
    return m;
  };
  const cursor = new THREE.Group();
  cursor.name = 'hud-pointer-cursor';
  const shade = flat(new THREE.RingGeometry(0.62, 1.22, 40), 0x000000, 0.35, 1002); // dark edge: visible on any button
  const ring = flat(new THREE.RingGeometry(0.72, 1, 40), 0xffffff, 0.95, 1003);
  const dot = flat(new THREE.CircleGeometry(0.3, 24), 0xffffff, 1, 1004);
  cursor.add(shade, ring, dot);
  // A thin beam from the hand to the cursor, a unit long along +y before it is scaled.
  const beam = flat(new THREE.CylinderGeometry(0.0016, 0.0006, 1, 6, 1, true).translate(0, 0.5, 0), 0xcfdcff, 0.4, 1001);
  beam.name = 'hud-pointer-beam';
  cursor.visible = beam.visible = false;
  scene.add(cursor, beam);
  return { cursor, ring, shade, dot, beam };
}

/**
 * @param ctx the module context (scene, camera, xr)
 * @param K   HUD.pointer (hud/config.js)
 */
export function createPointer(ctx, K) {
  const states = new Map(); // key -> pointer state
  const systemDown = new WeakMap(); // XRInputSource -> true while its select is held
  let sim = null; // a pointer driven from the console or a test: { origin, dir, down }

  ctx.xr.onSessionStart((session) => {
    session.addEventListener('selectstart', (ev) => systemDown.set(ev.inputSource, true));
    session.addEventListener('selectend', (ev) => systemDown.set(ev.inputSource, false));
  });

  function stateFor(key) {
    let st = states.get(key);
    if (!st) {
      st = {
        key,
        origin: new THREE.Vector3(),
        dir: new THREE.Vector3(0, 0, -1),
        down: false,
        jointDown: false,
        strength: 0, // 0 open hand, 1 pinched
        lastPressAt: -Infinity,
        target: null, // the panel descriptor under the ray
        x: 0,
        y: 0,
        hoverId: null,
        seen: false,
        ...makeVisuals(ctx.scene),
      };
      states.set(key, st);
    }
    return st;
  }

  const jointPos = (frame, hand, name, out) => {
    const pose = frame.xrFrame.getJointPose?.(hand.get(name), frame.refSpace);
    if (!pose) return null;
    const p = pose.transform.position;
    return out.set(p.x, p.y, p.z);
  };

  /** The hand's ray built here: from an estimated shoulder through the base of the index finger. */
  function ownRay(st, src, frame) {
    const knuckle = jointPos(frame, src.hand, 'index-finger-phalanx-proximal', a) ?? jointPos(frame, src.hand, 'wrist', a);
    if (!knuckle) return false;
    ctx.camera.getWorldPosition(head);
    side.set(1, 0, 0).applyQuaternion(ctx.camera.getWorldQuaternion(q));
    side.y = 0;
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const shoulder = b.copy(head).addScaledVector(side, src.handedness === 'left' ? -K.shoulderSideM : K.shoulderSideM);
    shoulder.y -= K.shoulderDownM;
    st.origin.copy(knuckle);
    st.dir.copy(knuckle).sub(shoulder).normalize();
    return true;
  }

  function readRay(st, src, frame) {
    if (!(K.ownRay && src.hand)) {
      const pose = src.targetRaySpace && frame.xrFrame.getPose(src.targetRaySpace, frame.refSpace);
      if (pose) {
        const { position: p, orientation: r } = pose.transform;
        st.origin.set(p.x, p.y, p.z);
        st.dir.set(0, 0, -1).applyQuaternion(q.set(r.x, r.y, r.z, r.w)).normalize();
        return true;
      }
    }
    return src.hand ? ownRay(st, src, frame) : false;
  }

  /** Thumb-to-index pinch from the joints, with hysteresis. Fills st.jointDown and st.strength. */
  function readPinch(st, src, frame) {
    const tip = jointPos(frame, src.hand, 'index-finger-tip', a);
    const thumb = tip && jointPos(frame, src.hand, 'thumb-tip', b);
    if (!thumb) {
      st.jointDown = false;
      st.strength = 0;
      return;
    }
    const d = tip.distanceTo(thumb);
    if (d < K.pinchOnM) st.jointDown = true;
    else if (d > K.pinchOffM) st.jointDown = false;
    st.strength = THREE.MathUtils.clamp((K.pinchFarM - d) / (K.pinchFarM - K.pinchOnM), 0, 1);
  }

  function hide(st) {
    st.cursor.visible = st.beam.visible = false;
    st.target = null;
    st.hoverId = null;
  }

  function show(st, panel, hit) {
    // Cursor: on the panel's face, a hair in front of it.
    panel.mesh.getWorldQuaternion(q);
    st.cursor.quaternion.copy(q);
    st.cursor.position.copy(st.origin).addScaledVector(st.dir, hit.t).addScaledVector(a.set(0, 0, 1).applyQuaternion(q), 0.002);
    // Like the system cursor: the ring closes as the fingers do, and fills when they meet.
    const s = st.down ? 1 : st.strength;
    st.cursor.scale.setScalar(K.cursorM);
    st.ring.scale.setScalar(1 - 0.5 * s);
    st.shade.scale.setScalar(1 - 0.5 * s);
    st.dot.scale.setScalar(st.down ? 1.9 : 1);
    st.cursor.visible = true;
    // Beam: from a little way out of the hand to the cursor.
    const length = hit.t - K.beamStartM;
    st.beam.visible = length > 0.02;
    if (st.beam.visible) {
      st.beam.position.copy(st.origin).addScaledVector(st.dir, K.beamStartM);
      st.beam.quaternion.setFromUnitVectors(Y, st.dir);
      st.beam.scale.set(1, length, 1);
    }
  }

  /**
   * One frame of pointing.
   * targets: [{ id, panel, hits: () => [{ id, x, y, w, h }], press: (hitId) => void, enabled: () => boolean }]
   * Returns Map(target id -> { hoverId, engaged }) for every target.
   */
  function update(frame, targets, now, dt) {
    const live = [];
    const { xrFrame, refSpace, session } = frame;
    if (xrFrame && refSpace && session) {
      for (const src of session.inputSources) {
        if (src.targetRayMode !== 'tracked-pointer') continue; // not gaze, not a tap on a phone screen
        if (src.hand && !K.hands.includes(src.handedness)) continue; // the other hand holds the map
        const st = stateFor(`${src.handedness}:${src.hand ? 'hand' : 'controller'}`);
        if (!readRay(st, src, frame)) continue;
        if (src.hand) {
          readPinch(st, src, frame);
          // A select whose end was never delivered would block every later press. The joints
          // say when the hand is plainly open again: the held select is dropped then.
          if (st.strength === 0) systemDown.set(src, false);
        } else {
          st.jointDown = false;
          st.strength = 0;
        }
        st.wantDown = st.jointDown || systemDown.get(src) === true;
        live.push(st);
      }
    }
    if (sim) {
      const st = stateFor('sim');
      st.origin.fromArray(sim.origin);
      st.dir.fromArray(sim.dir).normalize();
      st.wantDown = !!sim.down;
      st.strength = sim.down ? 1 : 0;
      live.push(st);
    }

    const out = new Map(targets.map((t) => [t.id, { hoverId: null, engaged: false }]));
    for (const st of states.values()) st.seen = false;
    for (const st of live) {
      st.seen = true;
      const pressed = st.wantDown && !st.down && now - st.lastPressAt >= K.repeatMs;
      st.down = st.wantDown;

      // The nearest menu the ray meets.
      let best = null;
      let bestHit = null;
      for (const t of targets) {
        if (!t.panel.mesh.visible || t.enabled?.() === false) continue;
        const hit = rayOnPanel(t.panel, st.origin, st.dir, K.maxM, K.margin);
        if (hit && (!bestHit || hit.t < bestHit.t)) {
          best = t;
          bestHit = hit;
        }
      }
      if (!best) {
        hide(st);
        continue;
      }
      // Smooth the cursor on the menu: firmly while it rests, barely while it travels.
      if (st.target !== best) {
        st.target = best;
        st.x = bestHit.x;
        st.y = bestHit.y;
        st.hoverId = null;
      } else {
        const travel = Math.hypot(bestHit.x - st.x, bestHit.y - st.y) / best.panel.canvas.width;
        const rate = K.smoothMin + (K.smoothMax - K.smoothMin) * Math.min(1, travel / K.smoothTravel);
        const k = 1 - Math.exp(-rate * dt);
        st.x += (bestHit.x - st.x) * k;
        st.y += (bestHit.y - st.y) * k;
      }
      st.hoverId = pickHit(best.hits(), st.x, st.y, st.hoverId, K);
      if (pressed && st.hoverId != null) {
        st.lastPressAt = now;
        best.press(st.hoverId);
      }
      // Draw the cursor where the smoothed point is, not where the raw ray is.
      const u = st.x / best.panel.canvas.width - 0.5;
      const v = 0.5 - st.y / best.panel.canvas.height;
      best.panel.mesh.updateWorldMatrix(true, false);
      const world = p2.set(u * best.panel.wM, v * best.panel.hM, 0).applyMatrix4(best.panel.mesh.matrixWorld);
      const t = world.distanceTo(st.origin);
      b.copy(world).sub(st.origin).normalize();
      const rawDir = o.copy(st.dir);
      st.dir.copy(b);
      show(st, best.panel, { t });
      st.dir.copy(rawDir);

      const r = out.get(best.id);
      r.engaged = true;
      r.hoverId ??= st.hoverId;
    }
    for (const st of states.values()) {
      if (!st.seen) {
        hide(st);
        st.down = false;
      }
    }
    return out;
  }

  return {
    update,
    /** Drive a pointer by hand (console, tests): simulate({ origin: [x,y,z], dir: [x,y,z], down }) or simulate(null). */
    simulate(next) {
      sim = next;
    },
    /** What each pointer is doing, for tests and the console. */
    debug: () => [...states.values()].map((s) => ({ key: s.key, target: s.target?.id ?? null, hoverId: s.hoverId, down: s.down, x: Math.round(s.x), y: Math.round(s.y), cursor: s.cursor.visible })),
  };
}
