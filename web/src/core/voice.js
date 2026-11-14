// Voice link to the Jetson hub (docs/INTERFACES.md section 4). Used only by link.js.
//
//   Headset -> Jetson   mic.begin { sampleRate: 16000, stream: true } -> binary 16-bit mono PCM,
//                       without end; the hub finds the utterances itself (neural voice activity
//                       detection) and ignores the microphone while it is speaking.
//                       voice.status { mic, audio, ... } whenever the state changes, so the hub
//                       log shows why a headset is silent.
//   Jetson -> headset   tts.begin { sampleRate, priority } -> binary 16-bit mono PCM -> tts.end
//
// Order matters on the headset:
//   - The microphone permission is asked as soon as the page loads, on the 2D page. Asking for it
//     in the same tap that starts the AR session loses the prompt behind the session.
//   - Audio itself only runs after a user gesture, so the AudioContext is resumed on the first
//     tap, click or key press (the "Start AR" button counts), and on every pinch in AR.
//   - The headset ends the microphone when the wearer takes it off or opens the system menu
//     (the track fires 'ended' a few seconds after the session is hidden) and never gives it
//     back by itself. So the microphone is opened again whenever it is found dead: when the
//     track ends, when the page or the AR session becomes visible again, and by a check every
//     few seconds that audio is still arriving. Seen on the hub: after one pause the headset
//     reported "mic ended" for the rest of the evening and no speech reached the recogniser.
//
//   ?voice=0     turn the voice link off
//   ?mockMic=a.wav,b.wav   use these audio files as the microphone (testing without a mic)

const MIC_RATE = 16000;
const CHUNK_MS = 100;

const q = new URLSearchParams(location.search);
const ENABLED = q.get('voice') !== '0';
const MOCK_MIC = q.get('mockMic'); // comma-separated audio file URLs to use as the microphone

let io = null; // { sendJson, sendBinary }
let ctx = null;
let streamOpen = false; // mic.begin sent on the current socket
const status = { mic: 'starting', audio: 'suspended', inputRate: null, level: 0, restarts: 0 };
const WATCH_MS = 3000; // the microphone is checked this often, and restarted after this long without audio

// ---------- speech output ----------
let ttsRate = 22050;
let ttsPlayAt = 0; // AudioContext time where the next chunk goes
let ttsSources = [];

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

/** Averages blocks of input samples down to 16 kHz, carrying the remainder between calls. */
function makeResampler(inRate) {
  const ratio = inRate / MIC_RATE;
  let acc = 0;
  let n = 0;
  let pos = 0;
  return (input, out) => {
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
  };
}

function report(patch) {
  // The same state again (the microphone still cannot be opened): nothing new to say.
  if (Object.entries(patch).every(([k, v]) => status[k] === v)) return;
  Object.assign(status, patch);
  const line = `mic ${status.mic} · audio ${status.audio}`;
  const el = document.getElementById('voice-status');
  if (el) {
    el.textContent = `Voice: ${line}`;
    el.dataset.ok = String(status.mic === 'on' && status.audio === 'running');
  }
  console.info('[voice]', line);
  io?.sendJson('voice.status', { ...status });
}

function sendChunk(samples) {
  let peak = 0;
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = v * 32767;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  status.level = Math.max(status.level * 0.9, peak);
  if (!streamOpen) streamOpen = io.sendJson('mic.begin', { sampleRate: MIC_RATE, stream: true });
  if (streamOpen) io.sendBinary(pcm.buffer);
}

/** Mock microphone: plays audio files into the stream, 3 s apart, over faint noise. */
async function mockMicStream(urls) {
  const dest = ctx.createMediaStreamDestination();
  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.002;
  const bed = ctx.createBufferSource();
  bed.buffer = noise;
  bed.loop = true;
  bed.connect(dest);
  bed.start();
  const buffers = [];
  for (const url of urls) buffers.push(await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer()));
  let at = null;
  const schedule = () => {
    at = Math.max(at ?? 0, ctx.currentTime) + 2;
    for (const b of buffers) {
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(dest);
      s.start(at);
      at += b.duration + 3;
    }
  };
  if (ctx.state === 'running') schedule();
  else ctx.addEventListener('statechange', () => ctx.state === 'running' && at === null && schedule());
  return dest.stream;
}

let mic = null; // { stream, source } of the microphone in use
let capture = null; // the AudioWorkletNode every microphone stream is connected to
let opening = false;
let lastAudioAt = 0; // performance.now() of the last block of samples from the microphone
let everOn = false;

function closeMic() {
  try {
    mic?.source.disconnect();
  } catch {
    /* already gone */
  }
  mic?.stream.getTracks().forEach((t) => t.stop());
  mic = null;
}

/** Open the microphone and feed it to the hub. Safe to call again: the old stream is let go. */
async function startMic() {
  if (opening) return;
  if (!MOCK_MIC && !navigator.mediaDevices?.getUserMedia) {
    report({ mic: 'unavailable (page must be HTTPS or localhost)' });
    return;
  }
  opening = true;
  try {
    let stream;
    try {
      stream = MOCK_MIC
        ? await mockMicStream(MOCK_MIC.split(','))
        : await navigator.mediaDevices.getUserMedia({
            audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
    } catch (err) {
      // After a first success this is the headset still asleep: the next check tries again.
      report({ mic: everOn ? `lost (${err.name})` : `blocked (${err.name})` });
      return;
    }
    try {
      if (!capture) {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
        await ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        capture = new AudioWorkletNode(ctx, 'marswalk-capture', { numberOfInputs: 1, numberOfOutputs: 0 });
        const resample = makeResampler(ctx.sampleRate);
        const chunkLen = (MIC_RATE * CHUNK_MS) / 1000;
        const pending = [];
        capture.port.onmessage = (ev) => {
          lastAudioAt = performance.now();
          resample(ev.data, pending);
          while (pending.length >= chunkLen) sendChunk(pending.splice(0, chunkLen));
        };
      }
      closeMic();
      const source = ctx.createMediaStreamSource(stream);
      source.connect(capture);
      mic = { stream, source };
      lastAudioAt = performance.now();
      stream.getAudioTracks()[0]?.addEventListener('ended', () => {
        if (mic?.stream !== stream) return; // an old stream that was let go on purpose
        report({ mic: 'ended' });
        setTimeout(() => checkMic('track ended'), 500);
      });
      if (everOn) status.restarts++;
      everOn = true;
      report({ mic: 'on', inputRate: ctx.sampleRate });
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      report({ mic: `failed (${err.name}: ${err.message})` });
    }
  } finally {
    opening = false;
  }
}

/**
 * Open the microphone again if it is dead: its track has ended, or no audio has arrived for
 * WATCH_MS although audio is running. A microphone the wearer never allowed is left alone
 * (asking again would only fail again), except when the page comes back into view.
 */
function checkMic(why, force = false) {
  if (!ENABLED || MOCK_MIC || !ctx || opening) return;
  if (ctx.state !== 'running') {
    ctx.resume().catch(() => {}); // suspended while the headset was off; works without a gesture once one was given
    return;
  }
  const track = mic?.stream.getAudioTracks()[0];
  const alive = track?.readyState === 'live' && performance.now() - lastAudioAt < WATCH_MS;
  if (alive || (!everOn && !force)) return;
  console.info('[voice] microphone is not delivering audio, opening it again:', why);
  startMic();
}

/** Called when the socket opens: the hub needs a fresh mic.begin and the current state. */
export function voiceLinkOpened() {
  streamOpen = false;
  if (io) io.sendJson('voice.status', { ...status });
}

/** Called when the socket closes. */
export function resetVoice() {
  streamOpen = false;
}

/**
 * @param {{ sendJson: (type: string, payload: object) => boolean,
 *           sendBinary: (data: ArrayBuffer) => boolean }} link
 * @param {{ onSessionStart: (fn: (session: XRSession) => void) => void }} [xr] core/xr.js
 */
export function initVoice(link, xr) {
  if (!ENABLED) return;
  io = link;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  ctx.addEventListener('statechange', () => report({ audio: ctx.state }));
  report({ audio: ctx.state });
  startMic(); // asks for the permission now, on the 2D page

  const resume = () => {
    if (ctx.state !== 'running') ctx.resume().catch((err) => console.warn('[voice] resume failed', err));
  };
  for (const ev of ['pointerdown', 'keydown', 'touchend', 'click']) {
    window.addEventListener(ev, resume, { capture: true });
  }
  // Back in view (headset put on again, system menu closed): audio and the microphone may be gone.
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && checkMic('page visible', true));
  xr?.onSessionStart((session) => {
    checkMic('AR session started', true);
    session.addEventListener('visibilitychange', () => session.visibilityState === 'visible' && checkMic('AR session visible', true));
    session.addEventListener('select', resume); // a pinch counts as a gesture: audio may run again
  });
  setInterval(() => checkMic('no audio'), WATCH_MS);
  // Every 10 s tell the hub the microphone level, so a silent microphone shows up in its log.
  setInterval(() => io?.sendJson('voice.status', { ...status, level: Number(status.level.toFixed(3)) }), 10000);
}
