// 실행 설정. 주소 뒤 쿼리로 바꾼다.
//
//   ?mock=1                 전부 가짜 (헤드셋·젯슨·실데이터 없이 돈다)
//   ?mock=link,hazard       일부만 가짜. 부분: data, link, hazard
//                           예) C의 실데이터 + 가짜 젯슨: ?mock=link,hazard
//   ?mockSpeed=10           목 시간표를 10배 빠르게 (테스트용)
//   ?jetson=192.168.0.7:8443  젯슨 주소 (기본: 이 페이지와 같은 호스트의 8443)
//   ?debug=0                왼쪽 위 이벤트 창 숨김
//   ?near=20                a destination this many metres from the base (default 20, 0 = none)

const q = new URLSearchParams(location.search);

const MOCK_PARTS = ['data', 'link', 'hazard'];
const mockParam = q.get('mock');
const mockList = mockParam ? mockParam.split(',') : [];
const mockAll = mockParam === '1' || mockParam === 'true' || mockList.includes('all');

/** 어떤 부분이 가짜로 도는지. 예: mock.link === true 이면 젯슨 대신 mock/jetson.js */
export const mock = Object.fromEntries(MOCK_PARTS.map((p) => [p, mockAll || mockList.includes(p)]));
mock.any = MOCK_PARTS.some((p) => mock[p]);
mock.speed = Number(q.get('mockSpeed')) || 1;

function jetsonUrl() {
  const j = q.get('jetson');
  if (!j) return `wss://${location.hostname}:8443/ws`; // INTERFACES 4장 시작값
  if (j.startsWith('ws://') || j.startsWith('wss://')) return j;
  return `wss://${j}${j.includes('/') ? '' : '/ws'}`;
}

export const config = {
  jetsonUrl: jetsonUrl(),
  /** 연결이 끊긴 뒤 다시 시도하는 간격 */
  linkRetryMs: 2000,
  /** 이 시간 안에 연결되지 않으면 link-lost 경보 */
  linkLostAfterMs: 3000,
  /** link-lost 경보 등급. critical이면 D가 기지 복귀 경로로 바꾸므로 시작값은 warn */
  linkLostLevel: 'warn',
  /** env.json 표본 하나를 재생하는 간격 */
  envIntervalMs: 5000,
  debug: q.get('debug') !== '0',
  /** A destination this far from the base is added to the waypoints (m). ?near=0 leaves it out */
  nearbyM: q.has('near') ? Math.max(0, Number(q.get('near')) || 0) : 20,
};

/** public/data/ 아래 파일의 주소. */
export const DATA_BASE = `${import.meta.env.BASE_URL}data/`;
