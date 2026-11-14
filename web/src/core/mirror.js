// Mirror: what the app draws, sent to the Jetson hub so it can be watched on a monitor
// (http://<jetson>:8080/monitor, or https://<jetson>:8443/monitor).
//
// The headset's own casting needs a Meta account, and adb needs developer mode. This needs
// neither: a few times a second the scene is drawn once more, from the wearer's head, into a
// small picture that goes to the hub as a JPEG over its own WebSocket (/mirror). The hub keeps
// the newest picture and streams it to whoever has the monitor page open.
//
// What it shows: everything the app draws (HUD, map, menus, pointer, arrows, the obstacle
// outline), plus two things only the mirror sees: a floor grid of 1 m squares and a dot on
// every tracked hand joint, so there is something to see the virtual things against.
// What it does not show by itself: the room. WebXR gives a page no picture of what the wearer
// sees, so the background is plain where the wearer sees the real world.
//
// ?mirror=cam tries to put the room behind it: it asks the browser for a camera
// (getUserMedia) and, if one is given, draws its picture as the background. Whether the Quest
// Browser hands out the headset's passthrough camera this way depends on its version and on
// the "headset cameras" permission; reports differ, and it is not checked on our headset. The
// camera sits beside the eye and its lens is not the one the mirror draws with, so the virtual
// things sit roughly, not exactly, where the wearer sees them (?mirrorFov= adjusts). What the
// browser offered and gave is shown on the monitor page and in the hub's log.
//
// It costs nothing while nobody watches: the hub says how many viewers there are, and pictures
// are only made while there is at least one. ?mirror=0 turns it off, ?mirror=1 also mirrors the
// PC view (outside AR), ?mirrorFps= changes the rate.
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
  camera: q.get('mirror') === 'cam', // try to put the headset's camera picture behind the mirror
  width: 480,
  height: 360,
  fps: Math.min(15, Math.max(1, Number(q.get('mirrorFps')) || 5)),
  quality: 0.6, // JPEG quality: about 15-25 kB a picture
  fovDeg: Number(q.get('mirrorFov')) || 80, // vertical; 4:3 makes that about 96 degrees across, close to what the wearer sees
  retryMs: 5000,
  maxQueuedBytes: 200000, // pictures are dropped, not queued, when the link is slower than the camera
  backdrop: 0x0b0d12, // where the wearer sees the room
  layer: 31, // things only the mirror's camera sees
};

const JOINTS = 25;

/** Linear light 0-255 -> sRGB 0-255: a render target holds linear values, a JPEG wants sRGB. */
const TO_SRGB = Uint8ClampedArray.from({ length: 256 }, (_, i) => {
  const x = i / 255;
  return 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
});

/** The picture as read from the GPU (rows bottom to top, linear) -> ImageData rows (top to bottom, sRGB). */
export function toImageRows(bytes, out, width, height) {
  for (let y = 0; y < height; y++) {
    let s = (height - 1 - y) * width * 4;
    let d = y * width * 4;
    for (let x = 0; x < width; x++, s += 4, d += 4) {
      out[d] = TO_SRGB[bytes[s]];
      out[d + 1] = TO_SRGB[bytes[s + 1]];
      out[d + 2] = TO_SRGB[bytes[s + 2]];
      out[d + 3] = 255;
    }
  }
}

/** ws(s)://host/ws -> ws(s)://host/mirror */
export const mirrorUrl = (jetsonUrl) => jetsonUrl.replace(/\/ws(\?.*)?$/, '/mirror');

export function initMirror({ renderer, scene, camera, xr }) {
  if (!MIRROR.enabled) return { update() {} };
  const { width, height } = MIRROR;
  const cam = new THREE.PerspectiveCamera(MIRROR.fovDeg, width / height, 0.05, 200);
  cam.layers.enable(MIRROR.layer);
  const target = new THREE.WebGLRenderTarget(width, height);
  const bytes = new Uint8Array(width * height * 4);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  const image = g.createImageData(width, height);
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
      let stream = await media.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
      // The Quest Browser also has a virtual camera that shows the wearer's avatar: not the room.
      const notTheRoom = /virtual|avatar/i;
      const cameras = (await media.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      const names = cameras.map((d) => d.label || '(unnamed)');
      if (notTheRoom.test(stream.getVideoTracks()[0]?.label ?? '')) {
        const other = cameras.find((d) => d.label && !notTheRoom.test(d.label));
        stream.getTracks().forEach((t) => t.stop());
        if (!other) throw new Error(`only a virtual camera is offered: ${names.join(', ')}`);
        stream = await media.getUserMedia({ video: { deviceId: { exact: other.deviceId } }, audio: false });
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
  if (MIRROR.camera) openCamera();

  let ws = null;
  let viewers = 0;
  let busy = false;
  let last = 0;
  let sentInfo = '';

  function connect() {
    try {
      ws = new WebSocket(mirrorUrl(config.jetsonUrl));
    } catch {
      return; // a bad ?jetson= address: link.js has already said so
    }
    ws.onmessage = (ev) => {
      try {
        viewers = Number(JSON.parse(ev.data).viewers) || 0;
      } catch {
        /* not for us */
      }
    };
    ws.onclose = () => {
      ws = null;
      viewers = 0;
      sentInfo = '';
      setTimeout(connect, MIRROR.retryMs);
    };
    ws.onerror = () => {}; // onclose follows
  }
  connect();

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
      if (room) scene.background = room;
      else if (inAR) scene.background = backdrop;
      renderer.setRenderTarget(target);
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(target, 0, 0, width, height, bytes); // while target is still current (scan/depth.js)
    } finally {
      scene.background = background;
      renderer.setRenderTarget(before);
      renderer.xr.enabled = xrOn;
    }
    toImageRows(bytes, image.data, width, height);
    g.putImageData(image, 0, 0);
    busy = true;
    canvas.toBlob(
      (blob) => {
        busy = false;
        if (!blob || ws?.readyState !== WebSocket.OPEN || ws.bufferedAmount > MIRROR.maxQueuedBytes) return;
        const info = JSON.stringify({ info: { width, height, fps: MIRROR.fps, ar: inAR, mode: mode.current, space: xr.space ?? null, camera: cameraNote } });
        if (info !== sentInfo) ws.send((sentInfo = info));
        ws.send(blob);
      },
      'image/jpeg',
      MIRROR.quality,
    );
  }

  return {
    update(frame) {
      if (busy || !viewers || ws?.readyState !== WebSocket.OPEN) return;
      if (!frame.session && !MIRROR.outsideAR) return;
      if (frame.time - last < 1000 / MIRROR.fps) return;
      last = frame.time;
      capture(frame);
    },
  };
}
