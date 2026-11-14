// Mirror: what the app draws, sent to the Jetson hub so it can be watched on a monitor
// (http://<jetson>:8080/monitor, or https://<jetson>:8443/monitor).
//
// The headset's own casting needs a Meta account, and adb needs developer mode. This needs
// neither: a few times a second the scene is drawn once more, from the wearer's head, into a
// small picture that goes to the hub as a JPEG over its own WebSocket (/mirror). The hub keeps
// the newest picture and streams it to whoever has the monitor page open.
//
// The page only draws the picture and reads it back from the GPU without waiting for it: the
// pixels go into a buffer on the GPU and are fetched a frame or two later, when the GPU says
// they are there (checked from the frame loop, the one clock that is sure to tick in AR).
// Encoding and sending happen in a worker (mirror.worker.js):
// on the page's own thread an AR session leaves no idle time, and the first version, which
// encoded there, delivered one picture every few seconds.
//
// What it shows: everything the app draws (HUD, map, menus, pointer, arrows, the obstacle
// outline), plus two things only the mirror sees: a floor grid of 1 m squares and a dot on
// every tracked hand joint, so there is something to see the virtual things against.
// What it does not show by itself: the room. WebXR gives a page no picture of what the wearer
// sees, so the background is plain where the wearer sees the real world.
//
// The room behind it: on a headset the page asks the browser for a camera (getUserMedia) and
// draws its picture as the background. Our Quest 3 offers "camera 0, facing front" (a virtual
// camera that shows the wearer's avatar) and two cameras "facing back" (the passthrough
// cameras): a back one is taken; ?mirrorCam=camera 1 picks by name.
//
// Lining the two up: the virtual things are drawn over the camera picture with a lens of the
// mirror's own, so they only sit where the wearer sees them if that lens is the camera's. With
// a lens wider than the camera's everything virtual is drawn too small about the middle of the
// picture, and the floor grid then looks like a plane tipped against the real floor (it did:
// the mirror drew with 80 degrees, the camera sees about 58). The browser does not tell a page
// the camera's lens or where it points, so the values are our estimate for the Quest 3
// (CAMERA below) and can be corrected while watching: the monitor page has buttons for the
// field of view and the tilt, the hub keeps what was set and hands it to the app (a "tune"
// message). ?mirrorFov= and ?mirrorTilt= set them from the address instead.
// What the browser offered and gave is shown on the monitor page and in the hub's log.
// ?mirror=nocam leaves the camera out.
//
// It costs nothing while nobody watches: the hub says how many viewers there are, and pictures
// are only made while there is at least one. ?mirror=0 turns it off, ?mirror=1 also mirrors the
// PC view (outside AR, without a camera), ?mirrorFps= changes the rate.
//
// This is the one WebSocket besides link.js (INTERFACES section 4): pictures must not queue up
// in front of the microphone stream and the alerts.

import * as THREE from 'three';
import { config, mock } from './config.js';
import { mode } from './mode.js';

const q = new URLSearchParams(location.search);

export const MIRROR = {
  enabled: q.get('mirror') !== '0' && !mock.link,
  outsideAR: q.get('mirror') === '1',
  camera: !['0', '1', 'nocam'].includes(q.get('mirror')), // the headset's camera picture behind the mirror; ?mirror=nocam leaves it out
  cameraName: q.get('mirrorCam'), // ?mirrorCam=camera 1 picks a camera by (part of) its name, when the default choice is the wrong one
  width: 640, // 4:3 like the camera picture. 480 x 360 ran well on the headset, so the picture is a step larger and less compressed
  height: 480,
  fps: Math.min(20, Math.max(1, Number(q.get('mirrorFps')) || 10)),
  quality: 0.72, // JPEG quality: about 40-60 kB a picture
  fovDeg: 80, // vertical, without a camera picture; 4:3 makes that about 96 degrees across, close to what the wearer sees
  // With the camera picture behind: the lens the picture was taken with. Estimates for the
  // Quest 3's passthrough camera at 4:3 (not published for the browser); the monitor page tunes them.
  lens: {
    fovDeg: Number(q.get('mirrorFov')) || 58, // vertical
    tiltDeg: Number(q.get('mirrorTilt')) || 0, // how far the camera looks below the wearer's line of sight
    fovRange: [35, 110],
    tiltRange: [-25, 25],
  },
  backdrop: 0x0b0d12, // where the wearer sees the room
  layer: 31, // things only the mirror's camera sees
};

const JOINTS = 25;

/** ws(s)://host/ws -> ws(s)://host/mirror */
export const mirrorUrl = (jetsonUrl) => jetsonUrl.replace(/\/ws(\?.*)?$/, '/mirror');

export function initMirror({ renderer, scene, camera, xr }) {
  if (!MIRROR.enabled) return { update() {} };
  const { width, height } = MIRROR;
  const cam = new THREE.PerspectiveCamera(MIRROR.fovDeg, width / height, 0.05, 200);
  const lens = { fovDeg: MIRROR.lens.fovDeg, tiltDeg: MIRROR.lens.tiltDeg }; // of the camera picture; the hub may correct it
  const tilt = new THREE.Quaternion();
  const RIGHT = new THREE.Vector3(1, 0, 0);
  const within = (v, [lo, hi], fallback) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
  cam.layers.enable(MIRROR.layer);
  const target = new THREE.WebGLRenderTarget(width, height);
  let pixels = new Uint8Array(width * height * 4); // handed to the worker with each picture and handed back
  const backdrop = new THREE.Color(MIRROR.backdrop);

  // Only for the mirror: the floor, and the hands.
  const floor = new THREE.GridHelper(16, 16, 0x39404f, 0x232833);
  floor.layers.set(MIRROR.layer);
  floor.visible = false; // on the PC view the scene has its own ground
  const hands = new THREE.InstancedMesh(new THREE.SphereGeometry(0.007, 8, 6), new THREE.MeshBasicMaterial({ color: 0xe8edf5 }), JOINTS * 2);
  hands.layers.set(MIRROR.layer);
  hands.frustumCulled = false;
  hands.count = 0;
  scene.add(floor, hands);
  const poses = new Float32Array(JOINTS * 16);

  // ?mirror=cam: a camera picture as the background, if the browser gives one.
  let video = null;
  let videoTexture = null;
  let cameraNote = MIRROR.camera ? 'asking' : 'off'; // goes to the hub with the info
  async function openCamera() {
    try {
      const media = navigator.mediaDevices;
      if (!media?.getUserMedia) throw new Error('no getUserMedia here');
      const size = { width: { ideal: 1280 }, height: { ideal: 960 } };
      // The first request is what makes the browser name its cameras (labels are empty before a permission).
      let stream = await media.getUserMedia({ video: { facingMode: { ideal: 'environment' }, ...size }, audio: false });
      const cameras = (await media.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      const names = cameras.map((d) => d.label || '(unnamed)');
      // The room is seen by a camera "facing back". "Facing front" on a headset is the virtual
      // camera with the wearer's avatar, which the Quest hands out first whatever is asked for.
      const wanted = MIRROR.cameraName ? new RegExp(MIRROR.cameraName, 'i') : /back|environment|passthrough|world/i;
      const notTheRoom = /front|user|virtual|avatar/i;
      const have = stream.getVideoTracks()[0]?.label ?? '';
      if (!wanted.test(have)) {
        const other = cameras.find((d) => wanted.test(d.label)) ?? (MIRROR.cameraName ? null : cameras.find((d) => d.label && !notTheRoom.test(d.label)));
        stream.getTracks().forEach((t) => t.stop());
        if (!other) throw new Error(`no camera that sees the room is offered: ${names.join(', ')}`);
        stream = await media.getUserMedia({ video: { deviceId: { exact: other.deviceId }, ...size }, audio: false });
      }
      video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      videoTexture = new THREE.VideoTexture(video);
      videoTexture.colorSpace = THREE.SRGBColorSpace;
      const s = stream.getVideoTracks()[0].getSettings();
      cameraNote = `"${stream.getVideoTracks()[0].label}" ${s.width}x${s.height} (offered: ${names.join(', ')})`;
    } catch (err) {
      video = videoTexture = null;
      cameraNote = `none: ${err.name}: ${err.message}`;
    }
    console.info('[mirror] camera:', cameraNote);
  }
  // Asked for when the page loads, like the microphone (a prompt that comes up while an AR
  // session starts is lost behind it), and only on a device that has AR: a desk computer
  // should not be asked for its webcam.
  if (MIRROR.camera) {
    navigator.xr
      ?.isSessionSupported('immersive-ar')
      .then((ar) => {
        if (ar) openCamera();
        else cameraNote = 'off (no AR here)';
      })
      .catch(() => {});
  }

  let viewers = 0;
  let busy = false; // a picture is with the GPU or the worker
  let last = 0;
  const worker = new Worker(new URL('./mirror.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'viewers') viewers = data.n;
    else if (data.type === 'tune') {
      // Set on the monitor page while watching the grid against the real floor.
      lens.fovDeg = within(Number(data.tune?.fovDeg), MIRROR.lens.fovRange, lens.fovDeg);
      lens.tiltDeg = within(Number(data.tune?.tiltDeg), MIRROR.lens.tiltRange, lens.tiltDeg);
    }
    else if (data.type === 'done') {
      pixels = new Uint8Array(data.pixels);
      busy = false;
    }
  };
  worker.postMessage({ type: 'open', url: mirrorUrl(config.jetsonUrl), quality: MIRROR.quality });

  function placeHands(frame) {
    let n = 0;
    if (frame.xrFrame?.fillPoses && frame.session && frame.refSpace) {
      for (const src of frame.session.inputSources) {
        if (!src.hand || n + JOINTS > JOINTS * 2) continue;
        if (!frame.xrFrame.fillPoses(src.hand.values(), frame.refSpace, poses)) continue;
        hands.instanceMatrix.array.set(poses, n * 16);
        n += JOINTS;
      }
    }
    hands.count = n;
    hands.instanceMatrix.needsUpdate = true;
  }

  // Reading back without waiting: the picture is copied into a GPU buffer (a PBO) behind a
  // fence, and collected once the fence has been passed.
  const gl = renderer.getContext();
  const pbo = gl.createBuffer();
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
  gl.bufferData(gl.PIXEL_PACK_BUFFER, width * height * 4, gl.STREAM_READ);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  let pending = null; // { sync, info, since } while a picture is on its way out of the GPU

  function capture(frame) {
    const inAR = !!frame.session;
    camera.matrixWorld.decompose(cam.position, cam.quaternion, cam.scale);
    placeHands(frame);
    floor.visible = inAR;
    const before = renderer.getRenderTarget();
    const xrOn = renderer.xr.enabled;
    const background = scene.background;
    try {
      renderer.xr.enabled = false; // draw into the picture, not into the headset's eyes
      const room = videoTexture && video.readyState >= 2 && !video.paused ? videoTexture : null;
      // Over the camera picture the mirror draws with the camera's lens, pointed where it points.
      const fov = room ? lens.fovDeg : MIRROR.fovDeg;
      if (cam.fov !== fov) {
        cam.fov = fov;
        cam.updateProjectionMatrix();
      }
      if (room && lens.tiltDeg) cam.quaternion.multiply(tilt.setFromAxisAngle(RIGHT, THREE.MathUtils.degToRad(-lens.tiltDeg)));
      if (room) scene.background = room;
      else if (inAR) scene.background = backdrop;
      renderer.setRenderTarget(target);
      renderer.render(scene, cam);
      // While target is still the current one (scan/depth.js): start the copy, do not wait for it.
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      pending = {
        sync: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0),
        info: { width, height, fps: MIRROR.fps, ar: inAR, mode: mode.current, space: xr.space ?? null, camera: cameraNote, lens: room ? { ...lens } : null },
        since: frame.time,
      };
      gl.flush();
      busy = true;
    } finally {
      scene.background = background;
      renderer.setRenderTarget(before);
      renderer.xr.enabled = xrOn;
    }
  }

  /** Fetch the picture if the GPU has finished it, and hand it to the worker. */
  function collect(frame) {
    const state = gl.clientWaitSync(pending.sync, 0, 0);
    if (state === gl.TIMEOUT_EXPIRED && frame.time - pending.since < 1000) return; // not yet: next frame
    const { sync, info } = pending;
    pending = null;
    gl.deleteSync(sync);
    if (state === gl.WAIT_FAILED || state === gl.TIMEOUT_EXPIRED) {
      busy = false; // the GPU never delivered: drop this picture
      return;
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, pixels);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    worker.postMessage({ type: 'frame', width, height, pixels: pixels.buffer, info }, [pixels.buffer]);
  }

  return {
    update(frame) {
      if (pending) collect(frame);
      if (busy || !viewers) return;
      if (!frame.session && !MIRROR.outsideAR) return;
      if (frame.time - last < 1000 / MIRROR.fps) return;
      last = frame.time;
      capture(frame);
    },
  };
}
