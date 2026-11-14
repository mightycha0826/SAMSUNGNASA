// 가짜 현장 장애물 (?mock=1 또는 ?mock=hazard).
// `hazard:update`(INTERFACES 3장)를 1초에 한 번 보낸다. 방 좌표 기준 4m × 4m, 칸 0.1m.
// 20초 주기로 방 한쪽(x≈0.5, z≈-0.6)에 의자 크기(0.5m) 장애물이 12초 동안 놓였다 사라진다.
// 격자 가장자리 두 줄은 "아직 모름"(255)이다.
//
// scan/index.js가 mock.hazard(?mock=1 또는 ?mock=hazard)일 때 실제 스캔 대신 이 함수를 부른다.

const COLS = 40;
const ROWS = 40;
const CELL_M = 0.1;
const ORIGIN = [-2.0, -2.0];

/**
 * @param {{ emit: Function }} bus
 * @param {{ speed?: number }} opts
 * @returns {() => void} 멈추는 함수
 */
export function startMockHazard(bus, { speed = 1 } = {}) {
  const t0 = performance.now();
  function tick() {
    const t = (((performance.now() - t0) / 1000) * speed) % 20;
    const chair = t >= 6 && t < 18;
    const cells = new Uint8Array(COLS * ROWS);
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const i = row * COLS + col;
        if (row < 2 || col < 2 || row >= ROWS - 2 || col >= COLS - 2) {
          cells[i] = 255;
          continue;
        }
        const x = ORIGIN[0] + (col + 0.5) * CELL_M;
        const z = ORIGIN[1] + (row + 0.5) * CELL_M;
        if (chair && Math.abs(x - 0.5) < 0.25 && Math.abs(z + 0.6) < 0.25) cells[i] = 1;
      }
    }
    bus.emit('hazard:update', { originXZ: [...ORIGIN], cellSizeM: CELL_M, cols: COLS, rows: ROWS, cells, ts: Date.now() });
  }
  tick();
  const timer = setInterval(tick, Math.max(500, 1000 / speed)); // 초당 2회 이하
  return () => clearInterval(timer);
}
