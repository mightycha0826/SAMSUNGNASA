// XR 코어: 렌더러, AR 세션 시작 버튼, 렌더 루프.
//
// - 세션: immersive-ar, 기준 공간 local-floor (방 좌표, INTERFACES 1장).
// - 선택 기능(optionalFeatures)은 기기가 허용한 것만 켜진다.
//   실제로 허용된 기능은 ctx.xr.enabledFeatures / ctx.xr.has('hand-tracking') 로 확인한다.
// - AR을 못 쓰는 PC 브라우저에서는 같은 장면을 일반 3D 화면(마우스로 회전)으로 보여 준다.
// - 매 프레임 등록된 모듈의 update(frame)을 호출한다.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// 'depth-sensing' is left out unless ?depth=1: when it is granted, three.js hides virtual
// objects behind real surfaces, and nothing reads the depth data yet (the room scan uses
// mesh-detection and plane-detection).
const WANT_DEPTH = new URLSearchParams(location.search).get('depth') === '1';
export const OPTIONAL_FEATURES = [
  'hand-tracking',
  ...(WANT_DEPTH ? ['depth-sensing'] : []),
  'mesh-detection',
  'plane-detection',
  'anchors',
  'hit-test',
];

// depth-sensing을 요청하려면 선호 형식을 같이 줘야 한다. 기기가 고른 값은
// session.depthUsage / session.depthDataFormat 에 들어온다 (check.html에서 확인).
export const DEPTH_SENSING_INIT = {
  usagePreference: ['cpu-optimized', 'gpu-optimized'],
  dataFormatPreference: ['luminance-alpha', 'float32', 'unsigned-short'],
};

export function sessionInit() {
  return {
    requiredFeatures: ['local-floor'],
    optionalFeatures: OPTIONAL_FEATURES,
    ...(WANT_DEPTH ? { depthSensing: DEPTH_SENSING_INIT } : {}),
  };
}

/** 세션에서 실제로 허용된 기능 목록. 브라우저가 알려 주지 않으면 null. */
export function readEnabledFeatures(session) {
  return Array.isArray(session?.enabledFeatures) ? [...session.enabledFeatures] : null;
}

export function createXR({ container, button }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 100);
  camera.position.set(2.6, 2.4, 3.2); // PC 화면용 시작 위치. AR에서는 헤드셋 위치로 바뀐다.

  scene.add(new THREE.HemisphereLight(0xffffff, 0x554433, 2.0));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(2, 4, 1);
  scene.add(sun);

  // PC 화면에서만 보이는 것: 어두운 배경, 4m × 4m 바닥 격자(1칸 0.5m), 축.
  // 축 색: 빨강 +x, 초록 +y(위), 파랑 +z. 방 좌표 원점은 바닥 한가운데.
  const desktopOnly = new THREE.Group();
  desktopOnly.name = 'desktop-only';
  const grid = new THREE.GridHelper(4, 8, 0x6b7280, 0x2f343c);
  desktopOnly.add(grid, new THREE.AxesHelper(0.5));
  scene.add(desktopOnly);
  const desktopBackground = new THREE.Color(0x0b0d10);
  scene.background = desktopBackground;

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.6, 0);
  controls.enableDamping = true;

  window.addEventListener('resize', () => {
    if (renderer.xr.isPresenting) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const startCbs = new Set();
  const endCbs = new Set();

  /** 다른 모듈이 보는 XR 상태 (ctx.xr). */
  const xr = {
    /** 이 브라우저가 immersive-ar를 지원하는가. 확인 전에는 null */
    supported: null,
    /** 현재 XRSession. 세션 밖에서는 null */
    session: null,
    /** 허용된 기능 이름 배열. 세션 밖이거나 브라우저가 알려 주지 않으면 null */
    enabledFeatures: null,
    /** AR 세션 안인가 */
    get presenting() {
      return renderer.xr.isPresenting;
    },
    /** local-floor 기준 공간. 세션 밖에서는 null */
    get refSpace() {
      return renderer.xr.isPresenting ? renderer.xr.getReferenceSpace() : null;
    },
    /** 기능이 허용됐는가. 알 수 없으면 null (그때는 직접 써 보고 판단한다) */
    has(feature) {
      if (!xr.session) return false;
      if (!xr.enabledFeatures) return null;
      return xr.enabledFeatures.includes(feature);
    },
    /** 세션이 시작될 때 부른다. 이미 세션 안이면 바로 부른다. 해제 함수를 돌려준다 */
    onSessionStart(fn) {
      startCbs.add(fn);
      if (xr.session) fn(xr.session);
      return () => startCbs.delete(fn);
    },
    onSessionEnd(fn) {
      endCbs.add(fn);
      return () => endCbs.delete(fn);
    },
    start: startSession,
    end: () => xr.session?.end(),
  };

  function callAll(cbs, arg) {
    for (const fn of [...cbs]) {
      try {
        fn(arg);
      } catch (err) {
        console.error('[xr] 세션 콜백 오류', err);
      }
    }
  }

  async function startSession() {
    if (xr.session) return xr.session;
    const session = await navigator.xr.requestSession('immersive-ar', sessionInit());
    await renderer.xr.setSession(session);
    xr.session = session;
    xr.enabledFeatures = readEnabledFeatures(session);
    console.info('[xr] 세션 시작. 허용된 기능:', xr.enabledFeatures ?? '(브라우저가 알려 주지 않음)');
    scene.background = null; // 패스스루가 보이게
    desktopOnly.visible = false;
    controls.enabled = false;
    session.addEventListener('end', () => {
      xr.session = null;
      xr.enabledFeatures = null;
      scene.background = desktopBackground;
      desktopOnly.visible = true;
      controls.enabled = true;
      updateButton();
      callAll(endCbs);
    });
    updateButton();
    callAll(startCbs, session);
    return session;
  }

  function updateButton() {
    if (!button) return;
    if (xr.session) {
      button.textContent = 'Exit AR';
      button.disabled = false;
    } else if (xr.supported) {
      button.textContent = 'Mars map';
      button.disabled = false;
    } else if (xr.supported === false) {
      button.textContent = 'No AR here · PC 3D view';
      button.disabled = true;
    }
  }

  button?.addEventListener('click', () => {
    if (xr.session) xr.end();
    else startSession().catch((err) => {
      console.error('[xr] 세션 시작 실패', err);
      button.textContent = `Start failed: ${err.name}`;
    });
  });

  (async () => {
    try {
      xr.supported = !!navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar'));
    } catch {
      xr.supported = false;
    }
    updateButton();
  })();

  // ---- 렌더 루프 ----
  const modules = [];
  const failed = new WeakSet();
  let last = 0;

  /** 매 프레임 update(frame)을 받을 모듈을 등록한다. */
  function addModule(name, mod) {
    modules.push({ name, mod });
  }

  function run() {
    renderer.setAnimationLoop((time, xrFrame) => {
      const dt = last ? Math.min((time - last) / 1000, 0.1) : 0;
      last = time;
      // 모듈의 update(frame)에 넘기는 값
      const frame = {
        /** 시작 후 지난 시간 (ms) */
        time,
        /** 앞 프레임과의 간격 (초, 최대 0.1) */
        dt,
        /** XRFrame. AR 세션 밖(PC 화면)에서는 null */
        xrFrame: xrFrame ?? null,
        /** local-floor 기준 공간. 세션 밖에서는 null */
        refSpace: xr.refSpace,
        session: xr.session,
      };
      for (const m of modules) {
        if (!m.mod.update) continue;
        try {
          m.mod.update(frame);
        } catch (err) {
          // 같은 오류가 매 프레임 쏟아지지 않게 모듈당 한 번만 찍는다.
          if (!failed.has(m.mod)) {
            failed.add(m.mod);
            console.error(`[xr] ${m.name}.update 오류 (이후 같은 모듈의 오류는 생략)`, err);
          }
        }
      }
      if (controls.enabled) controls.update();
      renderer.render(scene, camera);
    });
  }

  return { renderer, scene, camera, xr, addModule, run };
}
