// 기기 점검 페이지 (check.html). 헤드셋 브라우저에서 열어 WebXR 기능을 확인한다.
// 앱과 같은 세션 옵션(core/xr.js의 sessionInit)으로 세션을 열어 10초 동안 측정한다.
// AR 세션 안에서는 HTML이 보이지 않으므로, 세션 중에는 눈앞 패널에, 끝난 뒤에는 표에 결과를 적는다.

import * as THREE from 'three';
import { OPTIONAL_FEATURES, sessionInit, readEnabledFeatures } from './core/xr.js';

const MEASURE_MS = 10000;

// 상태: ok(됨) / no(안 됨) / unk(아직 모름)
const rows = [
  ['secure', '보안 연결 (HTTPS)'],
  ['xr', 'navigator.xr'],
  ['ar', 'immersive-ar 지원'],
  ['session', 'AR 세션 시작'],
  ...OPTIONAL_FEATURES.map((f) => [`f:${f}`, `허용: ${f}`]),
  ['hands', '손 입력 감지'],
  ['depth', '깊이 정보 수신'],
  ['meshes', '감지된 메쉬 수'],
  ['planes', '감지된 평면 수'],
  ['mic', '마이크 권한 (getUserMedia)'],
];
const result = Object.fromEntries(rows.map(([k]) => [k, { s: 'unk', v: '미확인', d: '' }]));
const set = (k, s, v, d = '') => {
  result[k] = { s, v, d };
  render();
};
const MARK = { ok: '✔', no: '✘', unk: '?' };

function render() {
  document.getElementById('rows').innerHTML = rows
    .map(([k, label]) => {
      const r = result[k];
      return `<tr><td>${label}</td><td class="v ${r.s}">${MARK[r.s]} ${r.v}</td><td class="d">${r.d}</td></tr>`;
    })
    .join('');
}

function asText() {
  const lines = rows.map(([k, label]) => `${MARK[result[k].s]} ${label}: ${result[k].v}${result[k].d ? ` (${result[k].d})` : ''}`);
  return [`[기기 점검] ${new Date().toLocaleString('ko-KR')}`, navigator.userAgent, ...lines].join('\n');
}

// ---- 세션 밖에서 알 수 있는 것 ----
set('secure', window.isSecureContext ? 'ok' : 'no', window.isSecureContext ? '예' : '아니오', location.origin);
const startBtn = document.getElementById('start');
if (!navigator.xr) {
  set('xr', 'no', '없음', window.isSecureContext ? '이 브라우저는 WebXR을 지원하지 않음' : 'HTTPS나 localhost로 열어야 함');
  set('ar', 'no', '확인 불가');
} else {
  set('xr', 'ok', '있음');
  navigator.xr.isSessionSupported('immersive-ar').then(
    (ok) => {
      set('ar', ok ? 'ok' : 'no', ok ? '지원' : '미지원');
      startBtn.disabled = !ok;
    },
    (err) => set('ar', 'no', '오류', err.message),
  );
}

// ---- 마이크 ----
document.getElementById('mic').addEventListener('click', async () => {
  if (!navigator.mediaDevices?.getUserMedia) return set('mic', 'no', 'getUserMedia 없음');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const st = stream.getAudioTracks()[0]?.getSettings?.() ?? {};
    set('mic', 'ok', '허용됨', `sampleRate ${st.sampleRate ?? '?'}, channelCount ${st.channelCount ?? '?'}`);
    stream.getTracks().forEach((t) => t.stop());
  } catch (err) {
    set('mic', 'no', '거부 또는 실패', `${err.name}: ${err.message}`);
  }
});

document.getElementById('copy').addEventListener('click', async () => {
  const text = asText();
  document.getElementById('raw').textContent = text;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* 복사가 막히면 아래에 보이는 글자를 직접 고른다 */
  }
});

// ---- AR 세션 ----
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.getElementById('app').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 50);

// 세션 중 눈앞 1.2m에 띄우는 결과 패널
const panelCanvas = document.createElement('canvas');
panelCanvas.width = 1024;
panelCanvas.height = 1024;
const panelTex = new THREE.CanvasTexture(panelCanvas);
panelTex.colorSpace = THREE.SRGBColorSpace;
const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({ map: panelTex, transparent: true }));
panel.position.set(0, 1.4, -1.2);
scene.add(panel);

function drawPanel(lines) {
  const g = panelCanvas.getContext('2d');
  g.clearRect(0, 0, 1024, 1024);
  g.fillStyle = 'rgba(11,13,16,0.85)';
  g.fillRect(0, 0, 1024, 1024);
  g.font = 'bold 46px system-ui, sans-serif';
  g.textBaseline = 'top';
  lines.forEach(([text, s], i) => {
    g.fillStyle = { ok: '#5bd57a', no: '#ff6b5e', unk: '#f6b26b' }[s] ?? '#e8eaed';
    g.fillText(text, 36, 30 + i * 62);
  });
  panelTex.needsUpdate = true;
}

function readDepth(frame, refSpace, session) {
  const pose = frame.getViewerPose(refSpace);
  if (!pose) return null;
  for (const view of pose.views) {
    let info = null;
    // cpu-optimized는 XRFrame에서, gpu-optimized는 XRWebGLBinding에서 받는다.
    if (session.depthUsage !== 'gpu-optimized' && frame.getDepthInformation) {
      info = frame.getDepthInformation(view);
    } else {
      info = renderer.xr.getBinding?.()?.getDepthInformation?.(view) ?? null;
    }
    if (info) return info;
  }
  return null;
}

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  let session;
  try {
    session = await navigator.xr.requestSession('immersive-ar', sessionInit());
    await renderer.xr.setSession(session);
  } catch (err) {
    set('session', 'no', '실패', `${err.name}: ${err.message}`);
    startBtn.disabled = false;
    return;
  }
  set('session', 'ok', '시작됨');

  const enabled = readEnabledFeatures(session);
  for (const f of OPTIONAL_FEATURES) {
    if (!enabled) set(`f:${f}`, 'unk', '알 수 없음', 'session.enabledFeatures 없음');
    else set(`f:${f}`, enabled.includes(f) ? 'ok' : 'no', enabled.includes(f) ? '허용' : '거부');
  }

  const m = { hands: 0, handJoints: 0, depthFrames: 0, depthSize: '', depthErr: '', meshes: 0, planes: 0, meshApi: false, planeApi: false, frames: 0 };
  const t0 = performance.now();
  let lastPanel = 0;

  renderer.setAnimationLoop((time, frame) => {
    if (!frame) return;
    m.frames++;
    const refSpace = renderer.xr.getReferenceSpace();

    let hands = 0;
    for (const src of session.inputSources) {
      if (!src.hand) continue;
      hands++;
      const wrist = src.hand.get?.('wrist');
      if (wrist && frame.getJointPose?.(wrist, refSpace)) m.handJoints++;
    }
    m.hands = Math.max(m.hands, hands);

    try {
      const info = readDepth(frame, refSpace, session);
      if (info) {
        m.depthFrames++;
        m.depthSize = `${info.width ?? info.texture?.width ?? '?'}×${info.height ?? info.texture?.height ?? '?'}`;
      }
    } catch (err) {
      m.depthErr = `${err.name}: ${err.message}`;
    }

    if (frame.detectedMeshes) {
      m.meshApi = true;
      m.meshes = Math.max(m.meshes, frame.detectedMeshes.size);
    }
    if (frame.detectedPlanes) {
      m.planeApi = true;
      m.planes = Math.max(m.planes, frame.detectedPlanes.size);
    }

    const left = Math.max(0, MEASURE_MS - (performance.now() - t0));
    if (time - lastPanel > 300) {
      lastPanel = time;
      drawPanel([
        [`기기 점검 중… ${Math.ceil(left / 1000)}초`, null],
        ['방을 둘러보고 두 손을 드세요', null],
        [`손: ${m.hands}개 (관절 ${m.handJoints ? '수신' : '없음'})`, m.handJoints ? 'ok' : 'unk'],
        [`깊이: ${m.depthFrames}프레임 ${m.depthSize}`, m.depthFrames ? 'ok' : 'unk'],
        [`메쉬: ${m.meshApi ? m.meshes : 'API 없음'}`, m.meshes ? 'ok' : 'unk'],
        [`평면: ${m.planeApi ? m.planes : 'API 없음'}`, m.planes ? 'ok' : 'unk'],
        [`허용: ${enabled ? enabled.filter((f) => OPTIONAL_FEATURES.includes(f)).join(', ') || '없음' : '알 수 없음'}`.slice(0, 44), null],
      ]);
    }
    renderer.render(scene, camera);
    if (left <= 0) session.end();
  });

  session.addEventListener('end', () => {
    renderer.setAnimationLoop(null);
    startBtn.disabled = false;
    if (m.handJoints) set('hands', 'ok', `${m.hands}개, 관절 수신`);
    else if (m.hands) set('hands', 'unk', `${m.hands}개, 관절 위치 없음`, '손은 잡혔지만 관절 자세를 받지 못함');
    else set('hands', 'no', '감지 안 됨', '손을 들었는데도 0이면 손 추적이 꺼져 있거나 컨트롤러를 쥐고 있음');

    const usage = `usage ${session.depthUsage ?? '?'}, format ${session.depthDataFormat ?? '?'}`;
    if (m.depthFrames) set('depth', 'ok', `${m.depthFrames}프레임, ${m.depthSize}`, usage);
    else set('depth', 'no', '수신 안 됨', m.depthErr || usage);

    set('meshes', m.meshes ? 'ok' : 'no', m.meshApi ? `${m.meshes}개` : 'API 없음', m.meshApi && !m.meshes ? '방 설정(공간 스캔)이 안 돼 있으면 0' : '');
    set('planes', m.planes ? 'ok' : 'no', m.planeApi ? `${m.planes}개` : 'API 없음', m.planeApi && !m.planes ? '방 설정(공간 스캔)이 안 돼 있으면 0' : '');
    document.getElementById('raw').textContent = asText();
  });
});

render();
window.__check = { result, asText };
