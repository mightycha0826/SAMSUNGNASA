// HUD 색과 글꼴. 포인트 디자인 시스템(design-system/point)의 다크 테마를 그대로 쓴다.
// 배경이 실제 방이라 테마는 다크로 고정한다 (mockups/hud-mockup.html).

import tokens from '../../../design-system/point/tokens.json';
import fontUrl from '../../../design-system/point/fonts/WantedSansVariable.woff2?url';

const dark = Object.fromEntries(tokens.color.tokens.map((t) => [t.name, t.value.dark]));

function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export const T = {
  surface: alpha(dark.surface, 0.88),
  row: dark.row,
  track: dark.track,
  badge: dark['badge-bg'],
  toast: alpha(dark['toast-bg'], 0.94),
  ink: dark.ink,
  muted: dark['ink-muted'],
  primary: dark.primary,
  primaryIcon: dark['primary-text'],
  point: dark.point,
  danger: dark.danger,
  dangerLine: dark['danger-line'],
  hairline: 'rgba(255, 255, 255, 0.08)',
};

export const FONT_FAMILY = '"Wanted Sans", "Apple SD Gothic Neo", system-ui, sans-serif';

/** 원티드 산스를 불러온다. 실패해도 시스템 글꼴로 그린다. */
export async function loadFont() {
  try {
    const face = new FontFace('Wanted Sans', `url(${fontUrl})`, { weight: '400 1000' });
    document.fonts.add(await face.load());
    return true;
  } catch (err) {
    console.warn('[hud] 글꼴을 불러오지 못해 시스템 글꼴을 씁니다:', err.message);
    return false;
  }
}

// 레이어별 범례 색띠 (목업과 같은 값). 모르는 레이어는 회색조.
export const RAMPS = {
  topo: [[18, 42, 74], [32, 120, 128], [196, 170, 110], [250, 246, 232]],
  slope: [[236, 236, 244], [150, 130, 200], [60, 20, 110]],
  optical: [[30, 30, 30], [240, 240, 240]],
  thermal: [[10, 6, 40], [110, 30, 120], [230, 110, 40], [252, 240, 150]],
  default: [[30, 30, 30], [240, 240, 240]],
};
