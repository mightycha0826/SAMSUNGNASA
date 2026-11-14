// HUD 설정값. 크기·위치·주기를 고칠 때는 여기 숫자만 바꾼다.
// 길이 단위 "도"는 목업(mockups/hud-mockup.html)의 d와 같다: 눈앞 distanceM 거리의 평면에서
// distanceM × tan(1°) ≈ 17.5mm. 시야 가운데에서는 시야각 1도이고, 가장자리로 갈수록 조금 작아진다.

import { PALM } from '../core/palm.js';

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
  /** What looks centred when it is laid out sits a little high in the Quest 3: the whole HUD
   *  (tiles, toast, alert card) is lowered by this much (deg). */
  viewDropDeg: 1.5,
  /** The readings: tiles in two columns beside what the wearer looks at (dash.js, layout.js).
   *  The mockup has one status card bottom right; on the headset that was too far out and too
   *  full, so the readings are tiles that come, go and move with their importance. */
  dash: {
    tileWDeg: 14.6,
    /** Height of a tile by what it shows: a bar, a route's progress, a graph (deg). All the
     *  same, so the two columns line up row by row */
    hDeg: { bar: 4.6, progress: 4.6, graph: 4.6 },
    /** The inner edge of each column, this far left and right of the middle of the view (deg):
     *  the 23 deg in the middle stay clear. A tile of size 1 ends 26 deg out */
    innerDeg: 11.7,
    /** A tile's size follows its importance (layout.js sizeOf): a pinned reading is 1 and
     *  `warn` when out of range; another goes from `min` at importance `fromScore` (it is only
     *  just shown) to `max` at `toScore` (a warning) */
    size: { min: 0.84, max: 1.16, fromScore: 30, toScore: 90, warn: 1.12 },
    /** Top of the columns, from the top of the stage, and the gap between tiles (deg) */
    topDeg: 16.6,
    gapDeg: 0.55,
    /** Where a critical reading goes: the middle, under the line of sight and over the alert
     *  card, larger than the rest. yDeg is its top edge from the top of the stage */
    focus: { yDeg: 31.4, scale: 1.3 },
    /** The spring the tiles move on: about a quarter of a second, with a 5 % overshoot */
    spring: { stiffness: 260, damping: 22 },
    /** A moving tile stretches along its way by up to this much, at this speed (deg/s) */
    stretch: 0.06,
    stretchFullDegS: 70,
    /** A tile fades in and out at this rate (1/s), growing from and shrinking to this size */
    fadeRate: 16,
    appearScale: 0.86,
  },
  /** The alert card and the toast are centred this far from the middle of the view (deg,
   *  negative = left). 0 since the readings stand in columns on both sides. */
  centreShiftDeg: 0,
  /** Toast strip ("what was heard", a layer change): just below the line of sight, where it is
   *  seen without looking up. It used to sit 19 deg above it and was easy to miss. */
  banner: { topDeg: 27, wDeg: 24, hDeg: 4 },
  /** Alert card: bottom centre, its bottom edge bottomDeg above the bottom of the stage, at
   *  most 26 deg wide. The panel is glowDeg larger on every side for the light around it. */
  alert: { wDeg: 33, hDeg: 12, bottomDeg: 4.6, glowDeg: 2.5, maxCardDeg: 28 },
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
    // Bottom left, under the left column of readings and left of the alert card (PC screen, controllers).
    fixedLeftDeg: 4,
    fixedBottomDeg: 1,
    /** Beside the palm map: distance of the menu centre to the right of the map centre and
     *  above it (m), and the size factor. The map is 0.25 m wide and the menu about 0.165 m
     *  (0.65 of its HUD size: a tab is still 9 cm wide, an easy target for the pointer), so
     *  0.28 leaves a gap of about 7 cm between them. */
    palmOffsetRightM: 0.28,
    palmOffsetUpM: 0.02,
    palmScale: 0.65,
    /** Opacity of the menu and legend backgrounds (0 to 1). 0.92 is the mockup's `--h-surface`.
     *  Lower it to see more of the map behind them; the text and colour ramp stay opaque. */
    faceOpacity: 0.92,
    /** (see `pointer` below for how the menus are pressed) */
    /** How long a pressed tab stays lit (ms) */
    pressFlashMs: 220,
    /** 손등 방향(손목 관절의 +Y)의 위쪽 성분이 이 값보다 작으면 손바닥이 위를 본다고 본다.
     *  메뉴는 지도 옆에 뜨므로 지도와 같은 값이어야 한다: core/palm.js 의 PALM.upDot 을 그대로 쓴다 */
    palmUpDot: PALM.upDot,
  },
  /** The readings the status card can show besides the pinned ones, and how much each matters
   *  when nothing is wrong (importance.js: `base`). `span` is the range a graph of it covers
   *  and `bad` the side where it goes out of range (+1 high, -1 low, 0 both, null: it has no limit). A reading out of
   *  range, or heading there fast, comes up whatever its base. `historyS` is how far back the
   *  graphs go. */
  readings: {
    historyS: 60,
    route: { base: 70 },
    heart: { base: 35, span: [40, 160], bad: 0 },
    body: { base: 33, span: [35, 40], bad: 0 },
    radiation: { base: 32, bad: 1 },
    pressure: { base: 30, span: [24, 33], bad: 0 },
    airTemp: { base: 12, bad: null }, // no limit to head for: its movement does not raise it
    airPressure: { base: 10, bad: null },
  },
  /** The bar of the ambient temperature (the sensor on the suit): its range and marks (deg C).
   *  The limits are the hub's (INTERFACES section 4). */
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
    /** When pointing at the palm map, which lies flat, the ray is tipped down by this much (deg):
     *  it then meets the map steeply and the cursor is easier to steer. The layer tabs beside
     *  the map and the card over a picked place are met by the same tipped ray */
    mapPitchDeg: 30,
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
    /** After the left hand is lost from view, the menu stays this long (ms) */
    lingerMs: 900,
    /** When the hand is in view and has turned out of the gesture, the menu goes after this
     *  long (ms): long enough to ride out one bad tracking frame, short enough to look instant.
     *  Turning the hand into the other gesture (map <-> commands) closes it at once. */
    turnedMs: 120,
    /** How far the hand may tip away from the gesture before an open menu closes */
    gestureSlack: 0.35,
    /** Wrists closer than this: the left hand's pose is not trusted and the menus hold still (m) */
    crowdM: 0.16,
  },
  /** Command menu: a card that stands above the back of the left hand, facing the wearer. Turn
   *  the back of the left hand up, as when looking at a watch, and it appears. */
  commands: {
    wDeg: 26,
    hDeg: 19.8, // two rows of buttons and the red emergency bar under them; a third row makes the buttons lower, not narrower
    cols: 3,
    /** Back of the hand counts as up when its direction (wrist +Y) points this far up */
    backUpDot: 0.5,
    /** Size factor: at 0.5 the card is about 23 cm wide and 17 cm tall */
    scale: 0.5,
    /** Height of the card's centre above the back of the hand (m): its lower edge is then
     *  about 8 cm above the hand */
    liftM: 0.17,
    /** How far beyond the hand, away from the wearer, the card stands (m) */
    awayM: 0.08,
  },
  /** Vitals over the right palm: a slowly turning figure of the wearer, floating like the map
   *  does over the left palm, with its readings on the caption card around its cylinder; a part
   *  turns orange or red when a reading that belongs to it is out of range (hud/suit.js). */
  suit: {
    /** Height of the figure (m) and width of the plate it stands on */
    figureM: 0.15,
    plateM: 0.16,
    /** The readings stand on an imaginary cylinder around the figure, wide enough to clear its
     *  arms: each is a chip of its own, to the wearer's left and right of the cylinder, standing
     *  out from its side like a wing and facing the wearer. As the wearer moves around the hand
     *  the chips go around the cylinder, so they are always seen square on.
     *  ringM: the cylinder's radius; chipWM: a chip's width; gapM: between a chip and the
     *  cylinder, and between chips; pxPerM: the chips' resolution */
    ringM: 0.075,
    chipWM: 0.088,
    gapM: 0.006,
    pxPerM: 3200,
    /** Seconds for one turn of the figure */
    turnS: 14,
    /** The open palm must be up this long before the hologram appears (ms), and how fast it follows the hand (1/s) */
    holdMs: 200,
    followRate: 18,
    /** Out-of-range limits. Oxygen is the tank level in percent, pressure the suit pressure in
     *  kPa (an EMU runs at 29.6), battery the headset's own charge in percent. */
    o2: { warn: 30, crit: 15 },
    pressureKpa: { nominal: 29.6, warnLow: 27, critLow: 25, warnHigh: 32 },
    battery: { warn: 30, crit: 15 },
    /** Heart rate (bpm) */
    heart: { critLow: 40, warnLow: 50, warnHigh: 120, critHigh: 150 },
    /** Body temperature (deg C), simulated: there is no sensor on the body. The torso is at
     *  `core`, the other parts this far from it; and the body warms by `perAmbientC` for every
     *  degree the ambient temperature (the real sensor) is above `fromAmbientC`, so heating
     *  the sensor shows on the figure too. */
    body: { core: 36.8, head: 0.1, arms: -0.6, legs: -0.8, fromAmbientC: 30, perAmbientC: 0.12 },
    bodyTemp: { critLow: 35, warnLow: 35.5, warnHigh: 37.8, critHigh: 39 },
  },
  /** Emergency button: the red bar on the command card (hud/rescue.js). Pressed once it is
   *  armed for armMs; pressed again, or "Confirm" said, it sends. */
  sos: { armMs: 8000 },
  /** The card over a place picked on the palm map: "Navigate" and "Cancel". */
  pick: { wDeg: 20, hDeg: 9.4, scale: 0.42, liftM: 0.07 },
  toastMs: 4000,
};
