// 가짜 젯슨 (?mock=1 또는 ?mock=link).
// 실제 젯슨이 보내는 것과 같은 봉투 메시지({ type, ts, payload }, INTERFACES 4장)를
// 시간표대로 만들어 link.js에 넘긴다. link.js는 진짜와 가짜를 같은 코드로 처리한다.
//
// 60초 시간표 (끝나면 처음부터 반복):
//    4초  "열 지도 보여 줘"            layer.show
//    8초  "조사 지점으로 안내해 줘"     nav.start
//   20초  "열 지도 꺼 줘"              layer.hide
//   30~42초 슈트 온도가 24.5 → 36.5°C로 오른다 (30°C warn, 35°C critical)
//   42~55초 식는다 (28°C 아래에서 alert.clear)
//   57초  "안내 그만"                  nav.stop
//
// PC 키보드: N 안내 시작, H 기지 복귀, S 안내 그만, L 열 지도 켜고 끄기, T 온도 급상승

const CYCLE_S = 60;

const SCRIPT = [
  { at: 4, intent: 'layer.show', slots: { id: 'thermal' }, text: '열 지도 보여 줘' },
  { at: 8, intent: 'nav.start', slots: { targetId: 'site1' }, text: '조사 지점으로 안내해 줘' },
  { at: 20, intent: 'layer.hide', slots: { id: 'thermal' }, text: '열 지도 꺼 줘' },
  { at: 57, intent: 'nav.stop', slots: {}, text: '안내 그만' },
];

export const MOCK_KEYS_HELP = '키: N 안내 · H 기지 · S 그만 · L 열 지도 · T 온도 급상승';

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

    // 경보: INTERFACES 4장의 슈트 온도 기준(시작값)
    if (temp >= 35 && level !== 'critical') {
      level = 'critical';
      send('alert.raise', { id: 'suit-temp', level, message: '슈트 온도가 위험 수준입니다' });
    } else if (temp >= 30 && level === null) {
      level = 'warn';
      send('alert.raise', { id: 'suit-temp', level, message: '슈트 온도가 오르고 있습니다' });
    } else if (temp < 28 && level !== null) {
      level = null;
      send('alert.clear', { id: 'suit-temp' });
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
      case 'n': say('nav.start', { targetId: 'site1' }, '조사 지점으로 안내해 줘'); break;
      case 'h': say('nav.home', {}, '기지로 돌아가자'); break;
      case 's': say('nav.stop', {}, '안내 그만'); break;
      case 'l':
        thermalOn = !thermalOn;
        say(thermalOn ? 'layer.show' : 'layer.hide', { id: 'thermal' }, thermalOn ? '열 지도 보여 줘' : '열 지도 꺼 줘');
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
