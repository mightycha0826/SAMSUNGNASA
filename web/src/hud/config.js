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
  status: {
    // Layout follows mockups/hud-mockup.html, which the UI owner keeps refining: change the
    // mockup first, then these numbers. The status card is 19.5 deg wide, bottom right, 5.5 deg
    // from the right edge and 7 deg from the bottom, pulled inward for the Quest 3's narrower
    // field of view. The panel is 0.3 deg larger on every side for its outline and text glow,
    // and the card is drawn against the panel's bottom edge.
    leftDeg: 54.96, topDeg: 11.86, wDeg: 20.1, hDeg: 31.6,
    /** Opacity of the whole status card (0 to 1). Both values are 1, as in the mockup: the card's
     *  face is already clear and only its outlines and text are drawn.
     *  `mapOpacity` applies while the map is in view (palm up in the headset; always on a PC
     *  screen), in case the card should fade further over the map. A warning or critical
     *  alert brings the card back to full opacity. `fadeRate` is how fast it changes (1/s). */
    opacity: 1, mapOpacity: 1, fadeRate: 6,
  },
  /** Toast strip, top centre */
  banner: { topDeg: 6, wDeg: 38, hDeg: 4 },
  /** Alert card: bottom centre, its bottom edge bottomDeg above the bottom of the stage, at
   *  most 26 deg wide. The panel is glowDeg larger on every side for the light around it. */
  alert: { wDeg: 31, hDeg: 12, bottomDeg: 7, glowDeg: 2.5, maxCardDeg: 26 },
  /** The light around the alert card (critical red, warn orange). Pulse: full brightness at the
   *  start of every period, fading to lowOpacity by 48% of it, 0.1 s after the alarm beep.
   *  "Confirm" stops the pulse and the beep (ackedOpacity). */
  edge: { periodS: 1.6, lowOpacity: 0.16, ackedOpacity: 0.36, flashDelayS: 0.1 },
  /** Alarm beep before each flash: one soft 880 Hz tone for warn, two sharp 2350 Hz pulses for
   *  critical (mockup). `?sound=0` turns it off. */
  alarm: { enabled: q.get('sound') !== '0', warnHz: 880, criticalHz: 2350, gain: 0.2 },
  /** 레이어 탭 + 범례 */
  layers: {
    wDeg: 14.5,
    hDeg: 21,
    /** 손 추적이 없을 때(PC 포함) 화면에 고정하는 자리 */
    // Left of the bottom-centre alert card, so the two never overlap (PC screen, controllers).
    fixedLeftDeg: 11.5,
    fixedBottomDeg: 6.5,
    /** Beside the palm map: distance of the menu centre to the right of the map centre and
     *  above it (m), and the size factor. The map is 0.25 m wide and the menu about 0.17 m,
     *  so 0.27 leaves a gap of about 6 cm between them. */
    palmOffsetRightM: 0.27,
    palmOffsetUpM: 0.02,
    palmScale: 0.6,
    /** Opacity of the menu and legend backgrounds (0 to 1). 0.92 is the mockup's `--h-surface`.
     *  Lower it to see more of the map behind them; the text and colour ramp stay opaque. */
    faceOpacity: 0.92,
    /** (see `touch` below for how the menus are pressed) */
    /** How long a pressed tab stays lit (ms) */
    pressFlashMs: 220,
    /** 손등 방향(손목 관절의 +Y)의 위쪽 성분이 이 값보다 작으면 손바닥이 위를 본다고 본다. 헤드셋에서 미확인 */
    palmUpDot: -0.35,
    /** 검지 끝이 이 거리 안으로 들어오면 누른 것으로 본다 (m) */
    pokeDistM: 0.02, // kept for reference; the live value is touch.pokeDistM
  },
  /** 슈트 온도 막대의 범위와 눈금 (°C). 기준은 INTERFACES 4장의 시작값 */
  suitGauge: { min: 20, max: 40, warn: 30, crit: 35 },
  /** Pressing the floating menus with the right hand.
   *  The cursor is where the index fingertip points at the menu, shown from hoverDistM away.
   *  A pinch (thumb tip to index tip) clicks at the cursor. Pinching moves the fingertip, so
   *  the cursor freezes once the fingers come within lockDistM of each other and the click
   *  lands where the cursor was, not where the fingertip ends up. Touching the menu with an
   *  open hand also presses it (pokeDistM); a pinching hand never pokes. */
  touch: {
    hoverDistM: 0.3,
    lockDistM: 0.05,
    pinchOnM: 0.02,
    pinchOffM: 0.04,
    pokeDistM: 0.015,
    /** The frozen cursor is the one from this long before the fingers started closing (ms) */
    settleMs: 140,
  },
  /** Voice command menu: floats over the back of the left hand when it faces up. */
  commands: {
    wDeg: 22,
    hDeg: 30,
    /** Back of the hand counts as up when its direction (wrist +Y) points this far up */
    backUpDot: 0.5,
    /** Above the wrist and toward the fingers (m), size factor */
    liftM: 0.13,
    scale: 0.6,
  },
  toastMs: 4000,
};
