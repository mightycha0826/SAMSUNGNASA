// 젯슨 연결. 브라우저에서 WebSocket을 여는 곳은 여기뿐이다 (INTERFACES 4장).
//
// 젯슨 → 헤드셋 메시지를 브라우저 이벤트로 바꾼다:
//   telemetry      → telemetry:update   (payload + ts)
//   alert.raise    → alert:raise        (payload + ts)
//   alert.clear    → alert:clear
//   voice.command  → voice:command, 그리고 6장 규칙에 따라
//                      nav.start / nav.home     → nav:request
//                      layer.show / layer.hide  → layer:toggle
//   tts.begin / binary / tts.end → played by voice.js
//
// 헤드셋 → 젯슨:
//   연결 직후 hello, 브라우저의 voice:say → voice.say,
//   mode:change·nav:route가 바뀌면 state,
//   microphone audio as mic.begin / binary / mic.end (voice.js)
//
// 연결이 끊기면 `alert:raise` { id: 'link-lost' }, 다시 붙으면 `alert:clear`.
// 목 모드(mock.link)에서는 WebSocket 대신 mock/jetson.js가 같은 메시지를 넣는다.

import { bus } from './bus.js';
import { config, mock } from './config.js';
import { handleVoiceMessage, initVoice, resetVoice } from './voice.js';

let ws = null;
let linkLost = false;
let lostTimer = null;
const state = { mode: 'normal', navStatus: null, targetId: null };

/** 젯슨이 보낸 봉투 메시지 하나를 처리한다. 진짜와 가짜가 같이 쓴다. */
export function handleMessage(msg) {
  const { type, payload = {} } = msg ?? {};
  const ts = msg?.ts ?? Date.now();
  switch (type) {
    case 'telemetry':
      bus.emit('telemetry:update', { suitTempC: payload.suitTempC, source: payload.source, ts });
      break;
    case 'alert.raise':
      bus.emit('alert:raise', { id: payload.id, level: payload.level, message: payload.message, ts });
      break;
    case 'alert.clear':
      bus.emit('alert:clear', { id: payload.id });
      break;
    case 'voice.command':
      handleVoiceCommand(payload);
      break;
    case 'tts.begin':
    case 'tts.end':
      handleVoiceMessage(msg);
      break;
    default:
      console.warn('[link] 모르는 메시지 type:', type);
  }
}

function handleVoiceCommand({ intent, slots = {}, text = '' }) {
  bus.emit('voice:command', { intent, slots, text });
  switch (intent) {
    case 'nav.start':
      bus.emit('nav:request', { targetId: slots.targetId ?? 'site1' });
      break;
    case 'nav.home':
      bus.emit('nav:request', { targetId: 'base' });
      break;
    case 'layer.show':
    case 'layer.hide':
      if (slots.id) bus.emit('layer:toggle', { id: slots.id, visible: intent === 'layer.show' });
      else console.warn('[link] layer 명령에 slots.id가 없습니다:', text);
      break;
    // nav.stop, alert.ack, mode.set, status.report는 voice:command를 받는 모듈이 직접 처리한다.
  }
}

/** 헤드셋 → 젯슨 글자 메시지. 연결이 없으면 버리고 false를 돌려준다. */
function send(type, payload) {
  if (ws?.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify({ type, ts: Date.now(), payload }));
  return true;
}

/** Headset -> Jetson binary frame (microphone PCM). */
function sendBinary(data) {
  if (ws?.readyState !== WebSocket.OPEN) return false;
  ws.send(data);
  return true;
}

function raiseLost() {
  if (linkLost) return;
  linkLost = true;
  bus.emit('alert:raise', {
    id: 'link-lost',
    level: config.linkLostLevel,
    message: '젯슨과 연결이 끊겼습니다',
    ts: Date.now(),
  });
}

function clearLost() {
  clearTimeout(lostTimer);
  lostTimer = null;
  if (!linkLost) return;
  linkLost = false;
  bus.emit('alert:clear', { id: 'link-lost' });
}

function connect() {
  // 처음 연결이든 끊긴 뒤든, 일정 시간 안에 붙지 않으면 경보를 낸다.
  if (!lostTimer && !linkLost) lostTimer = setTimeout(raiseLost, config.linkLostAfterMs);
  try {
    ws = new WebSocket(config.jetsonUrl);
  } catch (err) {
    console.error('[link] 젯슨 주소가 잘못됐습니다:', config.jetsonUrl, err);
    raiseLost();
    return;
  }
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => {
    console.info('[link] 젯슨 연결됨:', config.jetsonUrl);
    clearLost();
    send('hello', { client: 'quest', mock: false });
    send('state', state);
  };
  ws.onmessage = (ev) => {
    if (typeof ev.data !== 'string') {
      handleVoiceMessage(ev.data); // TTS audio (16-bit PCM)
      return;
    }
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      console.warn('[link] JSON이 아닌 메시지를 버립니다');
      return;
    }
    handleMessage(msg);
  };
  ws.onclose = () => {
    ws = null;
    resetVoice();
    if (!lostTimer && !linkLost) lostTimer = setTimeout(raiseLost, config.linkLostAfterMs);
    setTimeout(connect, config.linkRetryMs);
  };
  ws.onerror = () => {}; // 이어서 onclose가 온다
}

function sendState(patch) {
  const before = JSON.stringify(state);
  Object.assign(state, patch);
  if (JSON.stringify(state) !== before) send('state', state);
}

/** 연결을 시작한다. 모든 모듈의 init이 끝난 뒤에 부른다. */
export async function initLink() {
  bus.on('voice:say', ({ text, priority = 'normal' }) => send('voice.say', { text, priority }));
  bus.on('mode:change', ({ mode }) => sendState({ mode }));
  bus.on('nav:route', ({ status, targetId }) => sendState({ navStatus: status, targetId: targetId ?? null }));

  if (mock.link) {
    const { startMockJetson } = await import('../mock/jetson.js');
    startMockJetson(handleMessage, { speed: mock.speed });
    return;
  }
  initVoice({ sendJson: send, sendBinary });
  connect();
}
