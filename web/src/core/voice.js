// Voice link to the Jetson hub (docs/INTERFACES.md section 4). Used only by link.js.
//
//   Headset -> Jetson   mic.begin { sampleRate: 16000 } -> binary 16-bit mono PCM -> mic.end
//   Jetson -> headset   tts.begin { sampleRate, priority } -> binary 16-bit mono PCM -> tts.end
//
// The microphone is hands-free: a simple energy detector decides when someone is speaking,
// sends that stretch of audio, and the hub drops anything that is not a known command.
// The microphone is ignored while the hub's speech is playing, so the visor does not hear itself.
//
// Browsers only start audio after a user gesture, so everything here starts on the first
// tap, click or key press (the "Start AR" button counts).
//
//   ?voice=0     turn the voice link off
//   ?voice=ptt   no detector: hold the V key to talk (PC testing)

const MIC_RATE = 16000;
const FRAME_MS = 30;
const START_FRAMES = 3; // loud frames in a row before an utterance starts (~90 ms)
const PREROLL_FRAMES = 10; // audio kept from before the start (~300 ms)
const END_SILENCE_MS = 700;
const MIN_MS = 350;
const MAX_MS = 8000;
const MIN_RMS = 0.012; // floor for the speech threshold, full scale = 1
const NOISE_FACTOR = 3.5; // speech must be this many times louder than the background
const AFTER_TTS_MS = 350;

const q = new URLSearchParams(location.search);
const MODE = q.get('voice') === '0' ? 'off' : q.get('voice') === 'ptt' ? 'ptt' : 'vad';

let io = null; // { sendJson, sendBinary }
let ctx = null;
let started = false;

// ---------- speech output ----------
let ttsRate = 22050;
let ttsPlayAt = 0; // AudioContext time where the next chunk goes
let ttsSources = [];
let ttsBusyUntil = 0; // performance.now() until which the microphone is ignored

function stopSpeech() {
  for (const s of ttsSources) {
    try {
      s.stop();
    } catch {
      /* already ended */
    }
  }
  ttsSources = [];
  ttsPlayAt = 0;
}

function onTtsBegin({ sampleRate = 22050, priority = 'normal' } = {}) {
  ttsRate = sampleRate;
  if (priority === 'urgent') stopSpeech(); // urgent speech cuts whatever is playing
}

function onTtsChunk(buffer) {
  if (!ctx || ctx.state !== 'running') return; // no user gesture yet: nothing can play
  const pcm = new Int16Array(buffer, 0, buffer.byteLength >> 1);
  if (!pcm.length) return;
  const buf = ctx.createBuffer(1, pcm.length, ttsRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  const at = Math.max(ttsPlayAt, ctx.currentTime + 0.05);
  src.start(at);
  ttsPlayAt = at + buf.duration;
  ttsSources.push(src);
  src.onended = () => {
    ttsSources = ttsSources.filter((s) => s !== src);
  };
  ttsBusyUntil = performance.now() + (ttsPlayAt - ctx.currentTime) * 1000 + AFTER_TTS_MS;
}

/** Text and binary messages from the hub that belong to speech. Returns true if handled. */
export function handleVoiceMessage(msg) {
  if (msg instanceof ArrayBuffer) {
    onTtsChunk(msg);
    return true;
  }
  if (msg?.type === 'tts.begin') {
    onTtsBegin(msg.payload);
    return true;
  }
  return msg?.type === 'tts.end';
}

// ---------- microphone ----------
const WORKLET = `
class Capture extends AudioWorkletProcessor {
  process(inputs) {
    const x = inputs[0] && inputs[0][0];
    if (x) this.port.postMessage(x.slice(0));
    return true;
  }
}
registerProcessor('marswalk-capture', Capture);`;

const state = {
  talking: false,
  loud: 0,
  quietMs: 0,
  lengthMs: 0,
  noise: 0.004,
  preroll: [],
  pttHeld: false,
};

/** Averages blocks of input samples down to 16 kHz, carrying the remainder between calls. */
function makeResampler(inRate) {
  const ratio = inRate / MIC_RATE;
  let acc = 0;
  let n = 0;
  let pos = 0;
  return (input) => {
    const out = [];
    for (let i = 0; i < input.length; i++) {
      acc += input[i];
      n++;
      pos++;
      if (pos >= ratio) {
        out.push(acc / n);
        acc = 0;
        n = 0;
        pos -= ratio;
      }
    }
    return out;
  };
}

function toPcm(frame) {
  const pcm = new Int16Array(frame.length);
  for (let i = 0; i < frame.length; i++) pcm[i] = Math.max(-1, Math.min(1, frame[i])) * 32767;
  return pcm.buffer;
}

function beginUtterance() {
  state.talking = true;
  state.quietMs = 0;
  state.lengthMs = 0;
  io.sendJson('mic.begin', { sampleRate: MIC_RATE });
  for (const f of state.preroll) io.sendBinary(toPcm(f));
  state.lengthMs = state.preroll.length * FRAME_MS;
  state.preroll = [];
}

function endUtterance() {
  state.talking = false;
  state.loud = 0;
  // Too short to be a command: the hub drops anything under 0.3 s, so just close it.
  io.sendJson('mic.end', {});
  if (state.lengthMs < MIN_MS) console.debug('[voice] short sound ignored');
}

function onFrame(frame) {
  if (performance.now() < ttsBusyUntil) {
    if (state.talking) endUtterance();
    state.preroll = [];
    state.loud = 0;
    return;
  }
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  const rms = Math.sqrt(sum / frame.length);
  const threshold = Math.max(MIN_RMS, state.noise * NOISE_FACTOR);
  const loud = MODE === 'ptt' ? state.pttHeld : rms > threshold;

  if (!state.talking) {
    if (MODE !== 'ptt' && !loud) state.noise += (rms - state.noise) * 0.05; // track the background
    state.preroll.push(frame);
    if (state.preroll.length > PREROLL_FRAMES) state.preroll.shift();
    state.loud = loud ? state.loud + 1 : 0;
    if (state.loud >= (MODE === 'ptt' ? 1 : START_FRAMES)) beginUtterance();
    return;
  }
  io.sendBinary(toPcm(frame));
  state.lengthMs += FRAME_MS;
  state.quietMs = loud ? 0 : state.quietMs + FRAME_MS;
  const endAfter = MODE === 'ptt' ? FRAME_MS : END_SILENCE_MS;
  if (state.quietMs >= endAfter || state.lengthMs >= MAX_MS) endUtterance();
}

async function startMic() {
  if (!navigator.mediaDevices?.getUserMedia) {
    console.warn('[voice] no microphone API (the page must be HTTPS or localhost)');
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    console.warn('[voice] microphone not available:', err.name);
    return;
  }
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  const node = new AudioWorkletNode(ctx, 'marswalk-capture', { numberOfInputs: 1, numberOfOutputs: 0 });
  const resample = makeResampler(ctx.sampleRate);
  const frameLen = (MIC_RATE * FRAME_MS) / 1000;
  let pending = [];
  node.port.onmessage = (ev) => {
    pending.push(...resample(ev.data));
    while (pending.length >= frameLen) {
      onFrame(Float32Array.from(pending.slice(0, frameLen)));
      pending = pending.slice(frameLen);
    }
  };
  ctx.createMediaStreamSource(stream).connect(node);
  console.info(`[voice] microphone on (${ctx.sampleRate} Hz -> ${MIC_RATE} Hz, mode ${MODE})`);
}

async function start() {
  if (started) return;
  started = true;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  await ctx.resume();
  await startMic();
}

/** Called when the socket closes, so a half-sent utterance is not continued on the next one. */
export function resetVoice() {
  state.talking = false;
  state.loud = 0;
  state.preroll = [];
}

/**
 * @param {{ sendJson: (type: string, payload: object) => boolean,
 *           sendBinary: (data: ArrayBuffer) => boolean }} link
 */
export function initVoice(link) {
  if (MODE === 'off') return;
  io = link;
  const kick = () => start().catch((err) => console.error('[voice] could not start audio', err));
  for (const ev of ['pointerdown', 'keydown', 'touchend']) {
    window.addEventListener(ev, kick, { once: true, capture: true });
  }
  if (MODE === 'ptt') {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyV') state.pttHeld = true;
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'KeyV') state.pttHeld = false;
    });
  }
}
