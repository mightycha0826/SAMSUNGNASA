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
  /** Soft light over the whole view, flashing with the alert card: orange for warn, red for
   *  critical. `warnPeak` / `criticalPeak` are its opacity at the brightest moment of each
   *  pulse, kept low so the room and the map stay readable through it; `centre` is how much of
   *  that reaches the middle of the view (the edges get all of it). It is dark between flashes
   *  and after "Confirm". `?wash=0` turns it off. */
  wash: { enabled: q.get('wash') !== '0', warnPeak: 0.13, criticalPeak: 0.18, centre: 0.6 },
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
     *  above it (m), and the size factor. The map is 0.25 m wide and the menu about 0.19 m
     *  (0.75 of its HUD size, so its tabs are easy targets for the pointer), so 0.29 leaves a
     *  gap of about 7 cm between them. */
    palmOffsetRightM: 0.29,
    palmOffsetUpM: 0.02,
    palmScale: 0.75,
    /** Opacity of the menu and legend backgrounds (0 to 1). 0.92 is the mockup's `--h-surface`.
     *  Lower it to see more of the map behind them; the text and colour ramp stay opaque. */
    faceOpacity: 0.92,
    /** (see `pointer` below for how the menus are pressed) */
    /** How long a pressed tab stays lit (ms) */
    pressFlashMs: 220,
    /** 손등 방향(손목 관절의 +Y)의 위쪽 성분이 이 값보다 작으면 손바닥이 위를 본다고 본다 */
    palmUpDot: -0.35,
  },
  /** 슈트 온도 막대의 범위와 눈금 (°C). 기준은 INTERFACES 4장의 시작값 */
  suitGauge: { min: 20, max: 40, warn: 30, crit: 35 },
  /** Point and pinch (pointer.js). A ray leaves the pointing hand, a cursor shows where it
   *  meets a menu, and closing thumb and index finger presses the button under the cursor, as
   *  with the Quest 3's own hand pointer. The hand stays away from the menu: nothing is touched. */
  pointer: {
    /** Which tracked hands may point. The left hand brings the menus up, so it does not. */
    hands: ['right'],
    /** ?ray=own builds the hand's ray here (shoulder through the index knuckle) instead of
     *  using the pointer pose the headset supplies. Try it if the supplied ray feels off. */
    ownRay: q.get('ray') === 'own',
    shoulderDownM: 0.2,
    shoulderSideM: 0.16,
    /** A menu farther along the ray than this is not hit (m) */
    maxM: 3,
    /** The cursor may leave the panel by this fraction of its size before it disappears */
    margin: 0.06,
    /** Thumb tip to index tip: pinched below pinchOnM, open again above pinchOffM; the cursor
     *  ring starts closing at pinchFarM (m) */
    pinchOnM: 0.018,
    pinchOffM: 0.035,
    pinchFarM: 0.075,
    /** Shortest time between two presses by one hand (ms) */
    repeatMs: 300,
    /** Cursor smoothing (1/s): smoothMin while it rests, smoothMax once it travels smoothTravel
     *  (a fraction of the panel width) in one frame */
    smoothMin: 9,
    smoothMax: 60,
    smoothTravel: 0.04,
    /** A hovered button keeps the hover until the cursor is this far outside it, and a cursor
     *  between buttons takes the nearest one within `snap` (fractions of the button height) */
    stick: 0.3,
    snap: 0.7,
    /** Cursor radius (m), and how far from the hand the beam starts (m) */
    cursorM: 0.0075,
    beamStartM: 0.06,
  },
  /** How a menu that a hand gesture brought up behaves afterwards (index.js followMenu). */
  follow: {
    /** It holds its place until the hand is this far from where the menu wants to be */
    deadZoneM: 0.05,
    deadZoneDeg: 16,
    /** then glides after it at this rate (1/s) until it is within settleM */
    rate: 9,
    settleM: 0.006,
    /** After the gesture or the left hand is lost, the menu stays this long (ms) */
    lingerMs: 900,
    /** How far the hand may tip away from the gesture before an open menu closes */
    gestureSlack: 0.35,
    /** Wrists closer than this: the left hand's pose is not trusted and the menus hold still (m) */
    crowdM: 0.16,
  },
  /** Command menu: a card that stands above the back of the left hand, facing the wearer. Turn
   *  the back of the left hand up, as when looking at a watch, and it appears. */
  commands: {
    wDeg: 26,
    hDeg: 14.4, // two rows of buttons; a third row makes them lower, not smaller in width
    cols: 3,
    /** Back of the hand counts as up when its direction (wrist +Y) points this far up */
    backUpDot: 0.5,
    /** Size factor: at 0.5 the card is about 23 cm wide and 12.5 cm tall */
    scale: 0.5,
    /** Height of the card's centre above the back of the hand (m): its lower edge is then
     *  about 8 cm above the hand */
    liftM: 0.145,
    /** How far beyond the hand, away from the wearer, the card stands (m) */
    awayM: 0.08,
  },
  toastMs: 4000,
};
