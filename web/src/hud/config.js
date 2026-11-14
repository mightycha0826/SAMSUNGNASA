// HUD 설정값. 크기·위치·주기를 고칠 때는 여기 숫자만 바꾼다.
// 길이 단위 "도"는 목업(mockups/hud-mockup.html)의 d와 같다: 눈앞 distanceM 거리의 평면에서
// distanceM × tan(1°) ≈ 17.5mm. 시야 가운데에서는 시야각 1도이고, 가장자리로 갈수록 조금 작아진다.

const q = new URLSearchParams(location.search);

export const HUD = {
  /** 글자 언어: en(목업 기준) 또는 ko. 주소에 ?lang=ko */
  lang: q.get('lang') === 'ko' ? 'ko' : 'en',
  /** HUD 평면까지의 거리 (m) */
  distanceM: 1.0,
  /** 캔버스 해상도 (픽셀/도). Quest 3는 약 25 */
  pxPerDeg: 28,
  /** 0이면 머리에 고정. 0보다 크면 그 속도(1/초)로 천천히 따라온다. 비상 테두리는 항상 고정 */
  followRate: 0,
  /** 목업의 화면 크기 (도). 아래 위치는 이 화면의 왼쪽 위 기준 */
  stage: { wDeg: 80.26, hDeg: 50.16 },
  // Tuned on the Quest 3: cards near the stage corners were hard to see, so the status panel is
  // centred on the horizontal midline and everything sits a little closer to the middle of the
  // view. The drawn status card is about 23.3 deg tall without the optional pressure / air
  // temperature rows, so top = (50.16 - 23.3) / 2.
  status: { leftDeg: 8, topDeg: 13.4, wDeg: 20, hDeg: 31 },
  banner: { topDeg: 8, wDeg: 38, hDeg: 11 },
  /** 경보 테두리 (critical 빨강, warn 주황): 가운데에서 좌우·상하 절반 크기 (도, 기본은 목업 화면 전체 = 실제 시야각 약 ±35° × ±23.5°), 밝아지는 주기 (초) */
  edge: { halfWDeg: 40.13, halfHDeg: 25.08, periodS: 1.6, minOpacity: 0.28, ackedOpacity: 0.5 },
  /** 레이어 탭 + 범례 */
  layers: {
    wDeg: 16,
    hDeg: 21,
    /** 손 추적이 없을 때(PC 포함) 화면에 고정하는 자리 */
    // right side, centred on the horizontal midline (mirrors the status panel)
    fixedLeftDeg: 56.26,
    fixedBottomDeg: 17.33,
    /** 손바닥 옆에 띄울 때: 손목에서 오른쪽·위로 (m), 크기 배율 */
    palmOffsetRightM: 0.17,
    palmOffsetUpM: 0.06,
    palmScale: 0.45,
    /** 손등 방향(손목 관절의 +Y)의 위쪽 성분이 이 값보다 작으면 손바닥이 위를 본다고 본다. 헤드셋에서 미확인 */
    palmUpDot: -0.35,
    /** 검지 끝이 이 거리 안으로 들어오면 누른 것으로 본다 (m) */
    pokeDistM: 0.025,
  },
  /** 슈트 온도 막대의 범위와 눈금 (°C). 기준은 INTERFACES 4장의 시작값 */
  suitGauge: { min: 20, max: 40, warn: 30, crit: 35 },
  toastMs: 4000,
};
