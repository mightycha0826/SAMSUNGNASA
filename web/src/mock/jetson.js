// 가짜 젯슨 (?mock=1 또는 ?mock=link).
// 실제 젯슨이 보내는 것과 같은 봉투 메시지({ type, ts, payload }, INTERFACES 4장)를
// 시간표대로 만들어 link.js에 넘긴다. link.js는 진짜와 가짜를 같은 코드로 처리한다.
//
// 60 s timetable (then it starts over):
//    4 s  "Thermal"     layer.show
//    8 s  "Navigate"    nav.start
//   20 s  "Optical"     layer.show
//   30-42 s the suit temperature climbs from 24.5 to 36.5 C (warn at 30, critical at 35)
//   42-55 s it cools (back to warn below 34 C, alert.clear below 29 C)
//   57 s  "Stop"        nav.stop
//
// PC keyboard: N navigate, H base, S stop, L thermal / optical, T temperature spike

const CYCLE_S = 60;

const SCRIPT = [
  { at: 4, intent: 'layer.show', slots: { id: 'thermal' }, text: 'Thermal' },
  { at: 8, intent: 'nav.start', slots: { targetId: 'site1' }, text: 'Navigate' },
  { at: 20, intent: 'layer.show', slots: { id: 'optical' }, text: 'Optical' },
  { at: 57, intent: 'nav.stop', slots: {}, text: 'Stop' },
];

export const MOCK_KEYS_HELP = 'Keys: N navigate · H base · S stop · L thermal/optical · T temperature spike';

function scriptedTemp(t) {
  if (t < 30) return 24.5;
  if (t < 42) return 24.5 + ((t - 30) / 12) * 12; // 36.5까지
  if (t < 55) return 36.5 - ((t - 42) / 13) * 12.5; // 24.0까지
  return 24.5;
}

/**
 * @param {(msg: {type: string, ts: number, payload: object}) => void} deliver 젯슨 → 헤드셋 메시지를 받을 함수
 * @param {{ speed?: number }} opts
 * @returns {() => void} 멈추는 함수
 */
export function startMockJetson(deliver, { speed = 1 } = {}) {
  const send = (type, payload) => deliver({ type, ts: Date.now(), payload });
  const say = (intent, slots, text) => send('voice.command', { intent, slots, text });

  const t0 = performance.now();
  let lastT = 0;
  let level = null; // 지금 걸려 있는 suit-temp 경보 등급
  let spikeUntil = -1; // T 키로 올린 온도가 유지되는 시각(초)
  let thermalOn = false;

  function tick() {
    const elapsed = ((performance.now() - t0) / 1000) * speed;
    const t = elapsed % CYCLE_S;

    // 온도: 1초에 한 번 (INTERFACES 3장)
    let temp = scriptedTemp(t) + (Math.random() - 0.5) * 0.2;
    if (elapsed < spikeUntil) temp = Math.max(temp, 36.5);
    temp = Math.round(temp * 10) / 10;
    send('telemetry', { suitTempC: temp, source: 'mock' });

    // Alert: the same rule as the hub (jetson/marswalk/alerts.py, INTERFACES section 4). The
    // level follows the temperature both ways, with a 1 degree margin on the way down.
    let next = null;
    if (temp >= 35) next = 'critical';
    else if (temp >= 30) next = level === 'critical' && temp >= 34 ? 'critical' : 'warn';
    else if (temp >= 29) next = level ? 'warn' : null;
    if (next !== level) {
      const easing = level === 'critical';
      level = next;
      if (!level) send('alert.clear', { id: 'suit-temp' });
      else {
        const message = easing ? 'Suit temperature is high' : level === 'critical' ? 'Suit temperature is critical' : 'Suit temperature is rising';
        send('alert.raise', { id: 'suit-temp', level, message });
      }
    }

    // 음성 명령: 지난 틱과 이번 틱 사이에 걸린 것을 보낸다
    for (const s of SCRIPT) {
      const crossed = lastT <= t ? s.at > lastT && s.at <= t : s.at > lastT || s.at <= t;
      if (crossed) say(s.intent, s.slots, s.text);
    }
    lastT = t;
  }

  const timer = setInterval(tick, 1000 / speed);

  function onKey(e) {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key.toLowerCase()) {
      case 'n': say('nav.start', { targetId: 'site1' }, 'Navigate'); break;
      case 'h': say('nav.home', {}, 'Base'); break;
      case 's': say('nav.stop', {}, 'Stop'); break;
      case 'l':
        thermalOn = !thermalOn;
        say('layer.show', { id: thermalOn ? 'thermal' : 'optical' }, thermalOn ? 'Thermal' : 'Optical');
        break;
      case 't': spikeUntil = ((performance.now() - t0) / 1000) * speed + 8; break;
    }
  }
  window.addEventListener('keydown', onKey);

  return () => {
    clearInterval(timer);
    window.removeEventListener('keydown', onKey);
  };
}
