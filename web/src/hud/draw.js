// HUD 캔버스 그리기. AR 세션 안에서는 HTML이 보이지 않으므로 2D 캔버스에 그려 텍스처로 쓴다.
// 모든 길이는 d(1도에 해당하는 픽셀 수)의 배수이고, 값은 mockups/hud-mockup.html의 CSS에서 가져왔다.
// 여기 함수들은 상태를 갖지 않는다. index.js가 만든 표시용 값(vm)을 받아 그리기만 한다.

import { T, O, FONT_FAMILY, RAMPS } from './tokens.js';

const font = (weight, px) => `${weight} ${px}px ${FONT_FAMILY}`;

function text(g, str, x, y, { weight = 500, size, color = T.ink, align = 'left', tight = false, halo = false }) {
  g.font = font(weight, size);
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.letterSpacing = tight ? '-0.02em' : '-0.01em';
  if (halo) {
    // Text with no card behind it: a dark edge and a soft dark glow keep it readable over
    // whatever the room looks like (the mockup's text-shadow).
    g.save();
    g.lineJoin = 'round';
    g.shadowColor = O.halo;
    g.shadowBlur = size * 0.45;
    g.strokeStyle = O.halo;
    g.lineWidth = Math.max(2, size * 0.16);
    g.strokeText(str, x, y);
    g.restore();
  }
  g.fillStyle = color;
  g.fillText(str, x, y);
  return g.measureText(str).width;
}

function measure(g, str, weight, size) {
  g.font = font(weight, size);
  g.letterSpacing = '-0.01em';
  return g.measureText(str).width;
}

/** 폭에 안 맞으면 끝을 …로 줄인다. */
function fit(g, str, maxW, weight, size) {
  if (measure(g, str, weight, size) <= maxW) return str;
  let s = str;
  while (s.length > 1 && measure(g, s + '…', weight, size) > maxW) s = s.slice(0, -1);
  return s.trimEnd() + '…';
}

function box(g, x, y, w, h, r, fill) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fillStyle = fill;
  g.fill();
}

function ring(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, r);
  g.strokeStyle = T.hairline;
  g.lineWidth = 1;
  g.stroke();
}

/** Pill tag. (x, y) is its left centre. Returns the width. `outlined` is the status-card look. */
function tag(g, str, x, y, d, alignRight = false, outlined = false) {
  const size = 0.95 * d;
  const weight = outlined ? 700 : 600;
  const w = measure(g, str, weight, size) + 1.0 * d;
  const h = 1.4 * d;
  const left = alignRight ? x - w : x;
  box(g, left, y - h / 2, w, h, h / 2, outlined ? O.tagBg : T.badge);
  if (outlined) {
    g.beginPath();
    g.roundRect(left + 0.5, y - h / 2 + 0.5, w - 1, h - 1, h / 2);
    g.strokeStyle = 'rgba(255, 255, 255, 0.88)';
    g.lineWidth = 1;
    g.stroke();
  }
  text(g, str, left + w / 2, y + 0.02 * d, { weight, size, color: outlined ? O.ink : T.muted, align: 'center' });
  return w;
}

/** Transparent frame: a light line with a thin dark line on each side of it. */
function frame(g, x, y, w, h, r, lineW, color, outerW, innerW) {
  const stroke = (inset, width, style) => {
    g.beginPath();
    g.roundRect(x + inset, y + inset, w - inset * 2, h - inset * 2, Math.max(0, r - inset));
    g.strokeStyle = style;
    g.lineWidth = width;
    g.stroke();
  };
  stroke(outerW / 2, outerW, O.outer);
  stroke(outerW + lineW + innerW / 2, innerW, O.inner);
  stroke(outerW + lineW / 2, lineW, color);
}

// ---- 아이콘 ----
// Material Symbols Rounded의 모양을 단순하게 직접 그린다 (아이콘 글꼴을 네트워크에서 받지 않기 위해).
// (cx, cy) 가운데, s 크기, color 채움색, cut 은 아이콘 안쪽 기호의 색(바탕색).
function icon(g, name, cx, cy, s, color, cut = T.row) {
  g.save();
  g.translate(cx, cy);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.fillStyle = color;
  g.strokeStyle = color;
  const bang = (dy = 0) => {
    g.strokeStyle = cut;
    g.fillStyle = cut;
    g.lineWidth = 0.1 * s;
    g.beginPath();
    g.moveTo(0, -0.2 * s + dy);
    g.lineTo(0, 0.05 * s + dy);
    g.stroke();
    g.beginPath();
    g.arc(0, 0.21 * s + dy, 0.06 * s, 0, Math.PI * 2);
    g.fill();
  };
  switch (name) {
    case 'check_circle':
      g.beginPath();
      g.arc(0, 0, 0.44 * s, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = cut;
      g.lineWidth = 0.1 * s;
      g.beginPath();
      g.moveTo(-0.2 * s, 0.02 * s);
      g.lineTo(-0.05 * s, 0.17 * s);
      g.lineTo(0.22 * s, -0.14 * s);
      g.stroke();
      break;
    case 'error':
      g.beginPath();
      g.arc(0, 0, 0.44 * s, 0, Math.PI * 2);
      g.fill();
      bang();
      break;
    case 'warning':
      g.lineWidth = 0.14 * s;
      g.beginPath();
      g.moveTo(0, -0.34 * s);
      g.lineTo(0.38 * s, 0.32 * s);
      g.lineTo(-0.38 * s, 0.32 * s);
      g.closePath();
      g.fill();
      g.stroke();
      bang(0.06 * s);
      break;
    case 'navigation':
      g.lineWidth = 0.08 * s;
      g.beginPath();
      g.moveTo(0, -0.38 * s);
      g.lineTo(0.3 * s, 0.34 * s);
      g.lineTo(0, 0.2 * s);
      g.lineTo(-0.3 * s, 0.34 * s);
      g.closePath();
      g.fill();
      g.stroke();
      break;
    case 'layers':
      g.lineWidth = 0.08 * s;
      g.beginPath();
      g.moveTo(0, -0.36 * s);
      g.lineTo(0.4 * s, -0.08 * s);
      g.lineTo(0, 0.2 * s);
      g.lineTo(-0.4 * s, -0.08 * s);
      g.closePath();
      g.fill();
      g.stroke();
      g.beginPath();
      g.moveTo(-0.4 * s, 0.14 * s);
      g.lineTo(0, 0.42 * s);
      g.lineTo(0.4 * s, 0.14 * s);
      g.stroke();
      break;
    case 'link_off':
      g.lineWidth = 0.1 * s;
      g.beginPath();
      g.roundRect(-0.42 * s, -0.17 * s, 0.84 * s, 0.34 * s, 0.17 * s);
      g.stroke();
      g.strokeStyle = cut;
      g.lineWidth = 0.26 * s;
      g.beginPath();
      g.moveTo(-0.3 * s, -0.4 * s);
      g.lineTo(0.3 * s, 0.4 * s);
      g.stroke();
      g.strokeStyle = color;
      g.lineWidth = 0.1 * s;
      g.beginPath();
      g.moveTo(-0.3 * s, -0.4 * s);
      g.lineTo(0.3 * s, 0.4 * s);
      g.stroke();
      break;
  }
  g.restore();
}

const STATE_COLOR = { warn: () => O.warn, crit: () => O.crit };

/** An icon with no card behind it gets the same dark glow as the text. */
function haloIcon(g, name, cx, cy, s, color) {
  g.save();
  g.shadowColor = O.halo;
  g.shadowBlur = s * 0.22;
  icon(g, name, cx, cy, s, color, O.cut);
  g.restore();
}

// ---- status card ----
// vm: { suit: { value, word, state, tag, fill }, dist: { label, value, unit, word, state },
//       env: [{ k, v, unit, tag, state }], foot: { layer, sol, tag } }
// state: '' | 'warn' | 'crit' | 'stale'
// Look (updated mockup): transparent face, white-and-black double outlines, bold haloed text.
export function drawStatus(g, d, vm, gauge) {
  const W = g.canvas.width;
  g.clearRect(0, 0, W, g.canvas.height);
  const m = 0.3 * d; // room for the outer outline and the text glow
  const pad = 0.75 * d;
  const gap = 0.55 * d;
  const suitH = 7.45 * d;
  const distH = 5.35 * d;
  const envLine = 1.76 * d;
  const envH = 1.1 * d + vm.env.length * envLine + Math.max(0, vm.env.length - 1) * 0.25 * d;
  const footH = 1.5 * d;
  const total = pad + suitH + gap + distH + gap + (vm.env.length ? envH + gap : 0) + footH + 0.4 * d;

  // The card sits against the bottom of its panel (it is anchored bottom right in the mockup),
  // so it grows upward when the optional pressure and air temperature rows appear.
  const top = Math.max(m, g.canvas.height - m - total);
  frame(g, m, top, W - 2 * m, total, 1.6 * d, 0.18 * d, O.ink, 0.12 * d, 0.1 * d);

  const x0 = m + pad;
  const w = W - 2 * m - pad * 2;
  let y = top + pad;
  const rowFrame = (h, state) => {
    const color = state === 'crit' ? T.dangerLine : state === 'warn' ? T.point : O.line;
    frame(g, x0, y, w, h, 1.25 * d, 0.13 * d, color, 0.09 * d, 0.08 * d);
  };

  // Big row: icon + label (+tag) + value + state word
  const mainRow = (h, ico, r, okWord = false) => {
    rowFrame(h, r.state);
    const accent = STATE_COLOR[r.state]?.() ?? O.ink;
    haloIcon(g, ico, x0 + 0.85 * d + 0.95 * d, y + h / 2, 1.9 * d, accent);
    const tx = x0 + 0.85 * d + 1.9 * d + 0.65 * d;
    let ly = y + 0.65 * d + 0.7 * d;
    const lw = text(g, r.label, tx, ly, { weight: 700, size: 1.05 * d, color: O.label, halo: true });
    if (r.tag) tag(g, r.tag, tx + lw + 0.5 * d, ly, d, false, true);
    ly += 0.7 * d + 1.33 * d;
    let vx = tx;
    vx += text(g, r.value, vx, ly, { weight: 700, size: 2.3 * d, color: r.state === 'stale' ? O.stale : O.ink, tight: true, halo: true });
    if (r.unit) vx += 0.35 * d + text(g, r.unit, vx + 0.35 * d, ly + 0.35 * d, { weight: 700, size: 1.25 * d, color: O.label, halo: true });
    if (r.word) {
      const wordColor = STATE_COLOR[r.state]?.() ?? (okWord ? O.ok : O.ink);
      text(g, r.word, vx + 0.85 * d, ly + 0.4 * d, { weight: 700, size: 1.15 * d, color: wordColor, halo: true });
    }
    return { tx, bottom: ly + 1.33 * d };
  };

  // Suit temperature
  const suitIcon = { crit: 'error', warn: 'warning', stale: 'link_off' }[vm.suit.state] ?? 'check_circle';
  const s = mainRow(suitH, suitIcon, { ...vm.suit, unit: '°C' }, true);
  const gx = s.tx;
  const gw = x0 + w - 0.9 * d - gx;
  const gy = s.bottom + 0.4 * d;
  const gh = 0.46 * d;
  box(g, gx - 1, gy - 1, gw + 2, gh + 2, gh / 2 + 1, O.outer);
  box(g, gx, gy, gw, gh, gh / 2, 'rgba(120, 124, 130, 1)');
  if (vm.suit.fill > 0) {
    const fillColor = vm.suit.state === 'crit' ? T.dangerLine : vm.suit.state === 'warn' ? T.point : O.fill;
    box(g, gx, gy, Math.max(gh, gw * vm.suit.fill), gh, gh / 2, fillColor);
  }
  for (const mark of [gauge.warn, gauge.crit]) {
    const mx = gx + (gw * (mark - gauge.min)) / (gauge.max - gauge.min);
    g.fillStyle = O.outer;
    g.fillRect(mx - 0.08 * d - 1, gy - 0.25 * d - 1, 0.16 * d + 2, 0.98 * d + 2);
    g.fillStyle = O.ink;
    g.fillRect(mx - 0.08 * d, gy - 0.25 * d, 0.16 * d, 0.98 * d);
    text(g, String(mark), mx, gy + 1.28 * d, { weight: 700, size: 0.9 * d, color: O.ink, align: 'center', halo: true });
  }
  y += suitH + gap;

  // Remaining distance
  mainRow(distH, vm.dist.state === 'warn' ? 'warning' : 'navigation', vm.dist);
  y += distH + gap;

  // Environment values
  if (vm.env.length) {
    rowFrame(envH, '');
    let ey = y + 0.55 * d + envLine / 2;
    for (const row of vm.env) {
      text(g, row.k, x0 + 0.85 * d, ey, { weight: 700, size: 1.15 * d, color: O.label, halo: true });
      let rx = x0 + w - 0.9 * d;
      if (row.tag) rx -= tag(g, row.tag, rx, ey, d, true, true) + 0.6 * d;
      if (row.unit) rx -= text(g, row.unit, rx, ey + 0.1 * d, { weight: 700, size: 1.0 * d, color: O.label, align: 'right', halo: true }) + 0.35 * d;
      rx -= text(g, row.v, rx, ey, { weight: 700, size: 1.35 * d, color: O.ink, align: 'right', halo: true });
      if (row.state === 'warn' || row.state === 'crit') {
        haloIcon(g, row.state === 'crit' ? 'error' : 'warning', rx - 1.1 * d, ey, 1.4 * d, STATE_COLOR[row.state]());
      }
      ey += envLine + 0.25 * d;
    }
    y += envH + gap;
  }

  // Foot: layer name, sol and local time
  const fy = y + footH / 2 - 0.1 * d;
  const lw = text(g, vm.foot.layerLabel + ' ', x0 + 0.9 * d, fy, { weight: 700, size: 1.0 * d, color: O.label, halo: true });
  text(g, vm.foot.layer, x0 + 0.9 * d + lw, fy, { weight: 700, size: 1.0 * d, color: O.ink, halo: true });
  text(g, vm.foot.sol, x0 + w - 0.9 * d, fy, { weight: 700, size: 1.0 * d, color: O.label, align: 'right', halo: true });
  return total;
}

// ---- alert card (bottom centre) ----
// vm: { alert: { level, title, sub, more } | null }
// Warn and critical alerts sit at the bottom centre so the line of sight stays clear (mockup).
// Returns the card's rectangle in canvas pixels, for the light drawn around it, or null.
export function drawAlert(g, d, vm, maxCardDeg = 26, glowDeg = 2.5) {
  const W = g.canvas.width;
  const H = g.canvas.height;
  g.clearRect(0, 0, W, H);
  if (!vm.alert) return null;
  const crit = vm.alert.level === 'critical';
  const icoS = (crit ? 3.1 : 2.5) * d;
  const titleS = (crit ? 1.8 : 1.55) * d;
  const subS = 1.15 * d;
  const padX = 1.4 * d;
  const padY = 0.95 * d;
  const maxW = Math.min(W - 2 * glowDeg * d, maxCardDeg * d);
  const moreW = vm.alert.more ? measure(g, vm.alert.more, 600, 0.95 * d) + 1.0 * d + 1.2 * d : 0;
  const room = maxW - padX * 2 - icoS - 0.85 * d - moreW;
  const title = fit(g, vm.alert.title, room, 700, titleS);
  const sub = vm.alert.sub ? fit(g, vm.alert.sub, room, 500, subS) : '';
  const tw = Math.max(measure(g, title, 700, titleS), sub ? measure(g, sub, 500, subS) : 0);
  const w = Math.min(maxW, padX * 2 + icoS + 0.85 * d + tw + moreW);
  const textH = titleS * 1.3 + (sub ? subS * 1.3 : 0);
  const h = padY * 2 + Math.max(icoS, textH);
  const x = (W - w) / 2;
  const y = H - glowDeg * d - h; // against the bottom, leaving room for the light
  g.save();
  g.shadowColor = 'rgba(0, 0, 0, 0.72)';
  g.shadowBlur = 1.6 * d;
  g.shadowOffsetY = 0.6 * d;
  box(g, x, y, w, h, 1.6 * d, T.surface);
  g.restore();
  icon(g, crit ? 'error' : 'warning', x + padX + icoS / 2, y + h / 2, icoS, crit ? T.danger : T.point, '#262626');
  const tx = x + padX + icoS + 0.85 * d;
  const ty = y + (h - textH) / 2;
  text(g, title, tx, ty + (titleS * 1.3) / 2, { weight: 700, size: titleS, tight: crit });
  if (sub) text(g, sub, tx, ty + titleS * 1.3 + (subS * 1.3) / 2, { size: subS, color: T.muted });
  if (vm.alert.more) tag(g, vm.alert.more, x + w - padX, y + h / 2, d, true);
  return { x, y, w, h, r: 1.6 * d };
}

// The flashing light of the alert card: a bright border with a glow outside it and a faint one
// inside. Drawn white; the material tints it orange or red and pulses its opacity.
export function drawAlertGlow(g, d, card) {
  g.clearRect(0, 0, g.canvas.width, g.canvas.height);
  if (!card) return;
  const { x, y, w, h, r } = card;
  g.save();
  g.strokeStyle = '#ffffff';
  g.shadowColor = '#ffffff';
  for (const [blur, width, alpha] of [[1.8 * d, 0.5 * d, 0.55], [0.9 * d, 0.34 * d, 0.8], [0, 0.24 * d, 1]]) {
    g.globalAlpha = alpha;
    g.shadowBlur = blur;
    g.lineWidth = width;
    g.beginPath();
    g.roundRect(x, y, w, h, r);
    g.stroke();
  }
  g.restore();
}

// ---- route / voice toast (top centre) ----
// vm: { toast: string | null }
export function drawBanner(g, d, vm) {
  const W = g.canvas.width;
  g.clearRect(0, 0, W, g.canvas.height);
  if (!vm.toast) return;
  const size = 1.3 * d;
  const tw = measure(g, vm.toast, 700, size);
  const w = Math.min(W, 2.4 * d + 1.6 * d + 0.5 * d + tw);
  const h = 2.8 * d;
  const x = (W - w) / 2;
  box(g, x, 0, w, h, 1.25 * d, T.toast);
  ring(g, x, 0, w, h, 1.25 * d);
  icon(g, 'navigation', x + 1.2 * d + 0.8 * d, h / 2, 1.6 * d, T.primaryIcon);
  text(g, vm.toast, x + 1.2 * d + 1.6 * d + 0.5 * d, h / 2, { weight: 700, size });
}

// ---- 레이어 탭 + 범례 ----
// vm: { tabs: [{ id, label, active }], legend: { rampId, min, max, note, src: [줄, ...], keys } | null }
// 누를 수 있는 칸의 위치(캔버스 픽셀)를 돌려준다: [{ id, x, y, w, h }]
export function drawLayers(g, d, vm) {
  const W = g.canvas.width;
  g.clearRect(0, 0, W, g.canvas.height);
  const hits = [];
  if (!vm.tabs.length) return hits; // layers:ready 전에는 아무것도 그리지 않는다
  const pad = 0.3 * d;
  const tabH = 3.0 * d;
  const rows = Math.ceil(vm.tabs.length / 2);
  const segH = pad * 2 + rows * tabH + Math.max(0, rows - 1) * pad;
  box(g, 0, 0, W, segH, 1.1 * d, T.menu);
  const tabW = (W - pad * 3) / 2;
  vm.tabs.forEach((tab, i) => {
    const x = pad + (i % 2) * (tabW + pad);
    const y = pad + Math.floor(i / 2) * (tabH + pad);
    hits.push({ id: tab.id, x, y, w: tabW, h: tabH });
    const size = 1.2 * d;
    // Feedback for a fingertip: an outline while it hovers, a filled flash when it presses.
    if (tab.pressed) {
      box(g, x, y, tabW, tabH, 0.8 * d, T.primary);
    } else if (tab.hover && !tab.active) {
      box(g, x, y, tabW, tabH, 0.8 * d, T.row);
    }
    if (tab.hover || tab.pressed) {
      g.beginPath();
      g.roundRect(x + 0.1 * d, y + 0.1 * d, tabW - 0.2 * d, tabH - 0.2 * d, 0.7 * d);
      g.strokeStyle = tab.pressed ? T.ink : 'rgba(255, 255, 255, 0.85)';
      g.lineWidth = 0.2 * d;
      g.stroke();
    }
    if (tab.pressed) {
      const tw = measure(g, tab.label, 600, size);
      text(g, tab.label, x + (tabW - tw) / 2, y + tabH / 2, { weight: 600, size });
    } else if (tab.active) {
      if (!tab.hover) box(g, x, y, tabW, tabH, 0.8 * d, T.badge);
      else { box(g, x + 0.2 * d, y + 0.2 * d, tabW - 0.4 * d, tabH - 0.4 * d, 0.6 * d, T.badge); }
      const tw = measure(g, tab.label, 600, size);
      const total = 1.4 * d + 0.4 * d + tw;
      const sx = x + (tabW - total) / 2;
      icon(g, 'layers', sx + 0.7 * d, y + tabH / 2, 1.4 * d, T.primaryIcon, T.badge);
      text(g, tab.label, sx + 1.8 * d, y + tabH / 2, { weight: 600, size });
    } else {
      text(g, tab.label, x + tabW / 2, y + tabH / 2, { size, color: T.muted, align: 'center' });
    }
  });

  if (vm.legend) {
    const lg = vm.legend;
    const y0 = segH + 0.6 * d;
    const lp = 0.9 * d;
    const line = 1.37 * d;
    const size = 1.0 * d;
    const inner = W - lp * 2;
    const h = 1.4 * d + 0.8 * d + (2 + lg.src.length) * line + (2 + lg.src.length) * 0.3 * d;
    box(g, 0, y0, W, h, 1.1 * d, T.menu);
    let y = y0 + 0.7 * d;
    const stops = RAMPS[lg.rampId] ?? RAMPS.default;
    const grad = g.createLinearGradient(lp, 0, W - lp, 0);
    stops.forEach((c, i) => grad.addColorStop(i / (stops.length - 1), `rgb(${c.join(',')})`));
    box(g, lp, y, inner, 0.8 * d, 0.4 * d, grad);
    y += 0.8 * d + 0.3 * d + line / 2;
    text(g, lg.min, lp, y, { size });
    text(g, lg.max, W - lp, y, { size, align: 'right' });
    if (lg.note) text(g, lg.note, W / 2, y, { size: 0.95 * d, color: T.muted, align: 'center' });
    for (const src of lg.src) {
      y += line + 0.3 * d;
      text(g, fit(g, src, inner, 500, size), lp, y, { size, color: T.muted });
    }
    y += line + 0.3 * d;
    let kx = lp;
    for (const k of lg.keys) kx += text(g, k, kx, y, { size, color: T.muted }) + 0.55 * d;
  }
  drawCursor(g, d, vm.cursor);
  return hits;
}

/** Fingertip cursor on a menu: a ring that tightens as the finger nears, solid once it is locked
 *  for a pinch. */
function drawCursor(g, d, cursor) {
  if (!cursor) return;
  const { x, y, near, locked } = cursor;
  g.beginPath();
  g.arc(x, y, (locked ? 0.75 : 1.6 - 0.9 * near) * d, 0, Math.PI * 2);
  g.strokeStyle = locked ? T.ink : T.primary;
  g.globalAlpha = locked ? 1 : 0.4 + 0.6 * near;
  g.lineWidth = (locked ? 0.3 : 0.22) * d;
  g.stroke();
  g.beginPath();
  g.arc(x, y, 0.22 * d, 0, Math.PI * 2);
  g.fillStyle = T.ink;
  g.fill();
  g.globalAlpha = 1;
}

// ---- voice command menu (back of the left hand) ----
// vm: { title, hint, items: [{ id, label, hover, pressed }], cursor }
// Returns the pressable cells in canvas pixels: [{ id, x, y, w, h }]
export function drawCommands(g, d, vm) {
  const W = g.canvas.width;
  g.clearRect(0, 0, W, g.canvas.height);
  const hits = [];
  if (!vm.items.length) return hits;
  const pad = 0.5 * d;
  const headH = 3.4 * d;
  const cellH = 3.3 * d;
  const gap = 0.35 * d;
  const rows = Math.ceil(vm.items.length / 2);
  const total = pad + headH + rows * cellH + Math.max(0, rows - 1) * gap + pad;
  box(g, 0, 0, W, total, 1.4 * d, T.surface);
  ring(g, 0, 0, W, total, 1.4 * d);
  icon(g, 'navigation', pad + 1.2 * d, pad + headH / 2 - 0.2 * d, 1.5 * d, T.primaryIcon, T.row);
  text(g, vm.title, pad + 2.5 * d, pad + headH / 2 - 0.55 * d, { weight: 700, size: 1.25 * d });
  text(g, vm.hint, pad + 2.5 * d, pad + headH / 2 + 0.75 * d, { size: 0.9 * d, color: T.muted });
  const cellW = (W - pad * 2 - gap) / 2;
  vm.items.forEach((item, i) => {
    const x = pad + (i % 2) * (cellW + gap);
    const y = pad + headH + Math.floor(i / 2) * (cellH + gap);
    hits.push({ id: item.id, x, y, w: cellW, h: cellH });
    box(g, x, y, cellW, cellH, 0.8 * d, item.pressed ? T.primary : item.hover ? T.badge : T.row);
    if (item.hover || item.pressed) {
      g.beginPath();
      g.roundRect(x + 0.1 * d, y + 0.1 * d, cellW - 0.2 * d, cellH - 0.2 * d, 0.7 * d);
      g.strokeStyle = item.pressed ? T.ink : 'rgba(255, 255, 255, 0.85)';
      g.lineWidth = 0.2 * d;
      g.stroke();
    }
    const size = 1.15 * d;
    text(g, fit(g, item.label, cellW - 1.2 * d, 600, size), x + cellW / 2, y + cellH / 2, { weight: 600, size, align: 'center' });
  });
  drawCursor(g, d, vm.cursor);
  return hits;
}
