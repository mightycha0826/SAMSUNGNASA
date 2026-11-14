// The emergency button: a red button on the command card over the back of the left hand.
//
// Pressing it once arms it for a few seconds ("SEND SOS"); pressing it again, or saying
// "Confirm", sends the rescue signal. Arming first keeps a stray pinch from calling for help.
// By voice: "Emergency" arms it, "Confirm" sends, "Cancel" disarms, "Cancel rescue" withdraws
// a signal that was sent.
//
// Sending emits `rescue:signal`; link.js passes it to the hub, which raises an alert on the
// other headsets, shows a banner on the monitor page and answers with `rescue:state`. The crew
// is virtual: the hub's acknowledgement is simulated and says so. Without a hub (mock mode) the
// crew's part is played here.
//
// Receives: voice:command, rescue:state, nav:position, telemetry:update
// Sends:    rescue:signal { active, position, suitTempC, batteryPct }

import { HUD } from './config.js';
import { mock } from '../core/config.js';

/**
 * @param ctx the module context (bus)
 * @param tools { showToast, changed: () => void (the card must be redrawn), battery: () => number | null }
 */
export function createRescue(ctx, { showToast, changed, battery }) {
  const K = HUD.sos;
  const s = { phase: 'idle', armedUntil: 0, sentAt: null, ack: null };
  let position = null;
  let suitTempC = null;

  ctx.bus.on('nav:position', ({ point }) => {
    position = point ? [Number(point[0].toFixed(1)), Number(point[2].toFixed(1))] : null;
  });
  ctx.bus.on('telemetry:update', (t) => {
    suitTempC = t.suitTempC ?? null;
  });

  function set(active, ack = null) {
    s.phase = active ? 'sent' : 'idle';
    if (active && !s.sentAt) s.sentAt = new Date();
    if (!active) s.sentAt = null;
    s.ack = active ? ack : null;
    changed();
  }

  function arm() {
    if (s.phase !== 'idle') return;
    s.phase = 'armed';
    s.armedUntil = performance.now() + K.armMs;
    showToast('Emergency armed: say "Confirm" or press again');
    changed();
  }

  function disarm() {
    if (s.phase !== 'armed') return;
    s.phase = 'idle';
    changed();
  }

  function send() {
    set(true);
    ctx.bus.emit('rescue:signal', { active: true, position, suitTempC, batteryPct: battery() });
    showToast('Rescue signal sent');
    // No hub to answer (mock mode): play the crew's part here, and say that it is played.
    if (mock.link) setTimeout(() => s.phase === 'sent' && set(true, 'Base crew (simulated) notified'), 4000);
  }

  function cancel() {
    if (s.phase !== 'sent') return;
    set(false);
    ctx.bus.emit('rescue:signal', { active: false, position });
    showToast('Rescue signal cancelled');
  }

  // The hub's word on our own signal (it tells the other headsets with an alert).
  ctx.bus.on('rescue:state', ({ active, acknowledged, by }) => set(!!active, acknowledged ? `${by ?? 'Crew'} notified` : null));

  // Every button can be spoken.
  ctx.bus.on('voice:command', ({ intent }) => {
    if (intent === 'sos.arm') arm();
    else if (intent === 'sos.cancel') cancel();
    else if (intent === 'alert.ack' && s.phase === 'armed') send();
    else if (intent === 'nav.stop' && s.phase === 'armed') disarm();
  });

  return {
    /** The button was pressed: arm, then send, then (once sent) withdraw. */
    press() {
      if (s.phase === 'idle') arm();
      else if (s.phase === 'armed') send();
      else cancel();
    },
    /** Every frame: an armed button that was not confirmed goes back to idle. True while it counts down (redraw). */
    tick(now) {
      if (s.phase === 'armed' && now > s.armedUntil) disarm();
      return s.phase === 'armed';
    },
    /** What the button shows: { state, label, sub, pulse }. */
    vm(now) {
      if (s.phase === 'armed') {
        return { state: 'armed', label: 'SEND SOS', sub: `Again, or say "Confirm" · ${Math.max(0, Math.ceil((s.armedUntil - now) / 1000))} s`, pulse: 0.5 + 0.5 * Math.sin(now / 160) };
      }
      if (s.phase === 'sent') {
        const at = s.sentAt.toLocaleTimeString('en-GB', { hour12: false });
        return { state: 'sent', label: 'CANCEL SOS', sub: `Sent ${at} · ${s.ack ?? 'waiting for the crew…'}`, pulse: 0 };
      }
      return { state: 'idle', label: 'SOS', sub: 'Rescue signal · press twice', pulse: 0 };
    },
    state: () => ({ phase: s.phase, ack: s.ack }),
  };
}
