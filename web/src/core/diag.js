// Remote diagnostics: what goes wrong inside the headset is invisible from outside, so errors
// and session events are sent to the hub, which writes them to its log (client.log).
//
//   - uncaught errors, unhandled promise rejections, console.error
//   - AR session start / end, visibility changes, reference space resets
//   - a heartbeat every 5 s while in AR: head position, tracked hands, session visibility

import * as THREE from 'three';
import { bus } from './bus.js';

const headPos = new THREE.Vector3();

let send = null;
const queue = [];

function log(kind, data) {
  const entry = { kind, ...data };
  if (send && send('client.log', entry)) return;
  queue.push(entry);
  if (queue.length > 40) queue.shift();
}

function brief(value) {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** @param {(type: string, payload: object) => boolean} sendJson */
export function initDiag(sendJson, xr) {
  send = sendJson;
  window.addEventListener('error', (e) => log('error', { message: e.message, at: `${e.filename?.split('/').pop()}:${e.lineno}` }));
  window.addEventListener('unhandledrejection', (e) => log('rejection', { message: brief(e.reason) }));
  const original = console.error.bind(console);
  console.error = (...args) => {
    original(...args);
    log('console.error', { message: args.map(brief).join(' ').slice(0, 400) });
  };

  xr.onSessionStart((session) => {
    log('xr', { event: 'start', features: xr.enabledFeatures, visibility: session.visibilityState });
    setTimeout(() => xr.session === session && log('xr', { event: 'space', space: xr.space }), 1500);
    session.addEventListener('visibilitychange', () => log('xr', { event: 'visibility', visibility: session.visibilityState }));
    const space = xr.refSpace;
    space?.addEventListener?.('reset', () => log('xr', { event: 'reference-space-reset' }));
  });
  xr.onSessionEnd(() => log('xr', { event: 'end' }));
  bus.on('app:mode', ({ mode }) => log('mode', { mode }));
}

/** Called by link.js when the socket opens: send what was collected while offline. */
export function flushDiag() {
  while (queue.length && send?.('client.log', queue[0])) queue.shift();
}

let lastBeat = 0;
/** Called every frame by the render loop. */
export function diagFrame(frame, camera) {
  if (!frame.session || frame.time - lastBeat < 5000) return;
  lastBeat = frame.time;
  let hands = 0;
  for (const src of frame.session.inputSources) if (src.hand) hands++;
  const p = camera.getWorldPosition(headPos);
  log('beat', { head: [p.x, p.y, p.z].map((v) => Number(v.toFixed(2))), hands, visibility: frame.session.visibilityState });
}
