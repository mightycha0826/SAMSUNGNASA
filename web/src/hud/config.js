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
  // Layout follows mockups/hud-mockup.html, which the UI owner keeps refining: change the mockup
  // first, then these numbers. The status card is 20.5 deg wide at (3.5, 4.5); the panel is 0.3 deg
  // larger on every side for its outline and text glow.
  status: {
    leftDeg: 3.2, topDeg: 4.2, wDeg: 21.1, hDeg: 31.6,
    /** Opacity of the whole status card (0 to 1). Both values are 1, as in the mockup: the card's
     *  face is already transparent there and its outlines and text are at full strength.
     *  `mapOpacity` applies while the map is in view (palm up in the headset; always on a PC
     *  screen); lower it (for example 0.55) to fade the card while looking at the map. Any active
     *  alert brings the card back to full opacity. `fadeRate` is how fast it changes (1/s). */
    opacity: 1, mapOpacity: 1, fadeRate: 6,
  },
  /** Toast strip, top centre */
  banner: { topDeg: 4.5, wDeg: 38, hDeg: 4 },
  /** Alert card, centred in the view (updated mockup: alerts sit in the line of sight) */
  alert: { wDeg: 36, hDeg: 8 },
  /** Alert frame (critical red, warn orange). The mockup runs it around the whole viewport, so
   *  here it sits near the edge of the headset's field of view instead of around the stage:
   *  half-sizes in stage degrees from the centre of view (66 and 52 are about 49 and 42 real
   *  degrees on the 1 m plane; Quest 3 shows roughly 55 and 48). Its glow reaches about 7 real
   *  degrees inward. If the frame is cut off or invisible, lower these; periodS is the pulse. */
  edge: { halfWDeg: 66, halfHDeg: 52, periodS: 1.6, minOpacity: 0.28, ackedOpacity: 0.5 },
  /** 레이어 탭 + 범례 */
  layers: {
    wDeg: 16,
    hDeg: 21,
    /** 손 추적이 없을 때(PC 포함) 화면에 고정하는 자리 */
    fixedLeftDeg: 26,
    fixedBottomDeg: 3.5,
    /** Beside the palm map: distance of the menu centre to the right of the map centre and
     *  above it (m), and the size factor. The map is 0.25 m wide and the menu about 0.17 m,
     *  so 0.27 leaves a gap of about 6 cm between them. */
    palmOffsetRightM: 0.27,
    palmOffsetUpM: 0.02,
    palmScale: 0.6,
    /** Opacity of the menu and legend backgrounds (0 to 1). 0.9 is the mockup's `--h-surface`.
     *  Lower it to see more of the map behind them; the text and colour ramp stay opaque. */
    faceOpacity: 0.9,
    /** The fingertip cursor appears within this distance in front of the menu (m) */
    hoverDistM: 0.09,
    /** How long a pressed tab stays lit (ms) */
    pressFlashMs: 220,
    /** 손등 방향(손목 관절의 +Y)의 위쪽 성분이 이 값보다 작으면 손바닥이 위를 본다고 본다. 헤드셋에서 미확인 */
    palmUpDot: -0.35,
    /** 검지 끝이 이 거리 안으로 들어오면 누른 것으로 본다 (m) */
    pokeDistM: 0.02,
  },
  /** 슈트 온도 막대의 범위와 눈금 (°C). 기준은 INTERFACES 4장의 시작값 */
  suitGauge: { min: 20, max: 40, warn: 30, crit: 35 },
  toastMs: 4000,
};
