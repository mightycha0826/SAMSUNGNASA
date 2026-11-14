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

// ---- a reading (one tile of the dashboard, dash.js) ----
// r: { label, value, unit, tag, word, state, viz: 'bar' | 'graph' | 'progress',
//      fill: 0..1, marks: [{ at: 0..1 }], history: [number | null], min, max, lines: [value] }
// state: '' | 'warn' | 'crit' | 'stale'
// Look: no card and no frame, bold haloed text straight on the view, bars with a dark edge.
// The tile fills its panel: the label on the first line; on the second the value, and beside it
// a bar with its limits marked (the pinned readings), a graph of the last minute, or how far
// along a route is.
export function drawReading(g, d, r) {
  const W = g.canvas.width;
  const H = g.canvas.height;
  g.clearRect(0, 0, W, H);
  const m = 0.3 * d; // room for the outline and the text glow
  // No frame: a line around every reading made the view busy. What is wrong shows in the
  // colour of the number and the bar, and in a mark before the label.
  const inL = m + 0.85 * d;
  const inR = W - m - 0.9 * d;
  const ink = r.state === 'stale' ? O.stale : STATE_COLOR[r.state]?.() ?? O.ink;
  const fillColour = r.state === 'crit' ? T.dangerLine : r.state === 'warn' ? T.point : O.fill;

  // First line: what it is (and where the number comes from). Second line: the number on the
  // left, and beside it the bar or graph, which takes whatever width the number leaves.
  const ly = m + 1.25 * d;
  let lx = inL;
  if (r.state === 'warn' || r.state === 'crit') {
    haloIcon(g, r.state === 'crit' ? 'error' : 'warning', lx + 0.6 * d, ly, 1.25 * d, ink);
    lx += 1.55 * d;
  }
  const lw = text(g, r.label, lx, ly, { weight: 700, size: 1.0 * d, color: O.label, halo: true });
  if (r.tag) tag(g, r.tag, lx + lw + 0.45 * d, ly, d, false, true);
  if (r.word) text(g, r.word, inR, ly, { weight: 700, size: 1.0 * d, color: ink, align: 'right', halo: true });
  const vy = m + 3.05 * d;
  let vx = inL + text(g, r.value, inL, vy, { weight: 700, size: 1.75 * d, color: ink, tight: true, halo: true });
  if (r.unit) vx += 0.3 * d + text(g, r.unit, vx + 0.3 * d, vy + 0.2 * d, { weight: 700, size: 0.95 * d, color: O.label, halo: true });

  const gx = Math.max(inL + 5.0 * d, vx + 0.7 * d);
  const gw = inR - gx;
  const gy = m + 2.05 * d;
  const gh = H - m - 0.7 * d - gy;
  const track = (by, bh) => {
    box(g, gx - 1, by - 1, gw + 2, bh + 2, bh / 2 + 1, O.outer);
    box(g, gx, by, gw, bh, bh / 2, 'rgba(120, 124, 130, 1)');
  };
  if (r.viz === 'bar' || r.viz === 'progress') {
    const bh = 0.5 * d;
    const by = gy + gh / 2 - bh / 2;
    track(by, bh);
    if (r.fill > 0) box(g, gx, by, Math.max(bh, gw * r.fill), bh, bh / 2, fillColour);
    for (const mark of r.marks ?? []) {
      const mx = gx + gw * mark.at;
      g.fillStyle = O.outer;
      g.fillRect(mx - 0.07 * d - 1, by - 0.2 * d - 1, 0.14 * d + 2, 0.9 * d + 2);
      g.fillStyle = O.ink;
      g.fillRect(mx - 0.07 * d, by - 0.2 * d, 0.14 * d, 0.9 * d);
    }
    if (r.viz === 'progress') {
      // A dot where the wearer is on the way from the start to the destination.
      const dotX = gx + gw * Math.max(0, Math.min(1, r.fill));
      for (const [radius, colour] of [[0.5 * d, O.outer], [0.36 * d, O.ink]]) {
        g.beginPath();
        g.arc(dotX, by + bh / 2, radius, 0, Math.PI * 2);
        g.fillStyle = colour;
        g.fill();
      }
    }
    return;
  }

  // A graph of the last minute, newest on the right.
  const span = r.max - r.min || 1;
  const yOf = (v) => gy + gh - ((Math.max(r.min, Math.min(r.max, v)) - r.min) / span) * gh;
  g.save();
  g.setLineDash([0.35 * d, 0.3 * d]);
  g.lineWidth = 0.08 * d;
  g.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  for (const limit of r.lines ?? []) {
    if (!(limit > r.min && limit < r.max)) continue; // the limits, as dashed lines across the graph
    g.beginPath();
    g.moveTo(gx, yOf(limit));
    g.lineTo(gx + gw, yOf(limit));
    g.stroke();
  }
  g.restore();
  const h = r.history ?? [];
  const xOf = (k) => gx + gw - ((h.length - 1 - k) / 59) * gw; // a minute across the graph
  const stroke = (width, style) => {
    g.beginPath();
    let pen = false; // a gap in the readings is a gap in the line
    h.forEach((v, k) => {
      if (!Number.isFinite(v)) {
        pen = false;
        return;
      }
      if (pen) g.lineTo(xOf(k), yOf(v));
      else g.moveTo(xOf(k), yOf(v));
      pen = true;
    });
    g.lineWidth = width;
    g.strokeStyle = style;
    g.lineJoin = g.lineCap = 'round';
    g.stroke();
  };
  stroke(0.34 * d, O.outer);
  stroke(0.18 * d, fillColour);
  const last = [...h].reverse().find(Number.isFinite);
  if (last !== undefined) {
    for (const [radius, colour] of [[0.32 * d, O.outer], [0.22 * d, O.ink]]) {
      g.beginPath();
      g.arc(gx + gw, yOf(last), radius, 0, Math.PI * 2);
      g.fillStyle = colour;
      g.fill();
    }
  }
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
    // Feedback for the pointer: an outline while it hovers, a filled flash when it presses.
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
  return hits;
}

// ---- command menu (above the back of the left hand) ----
// vm: { title, hint, cols, items: [{ id, label, hover, pressed }] }
// Returns the pressable cells in canvas pixels: [{ id, x, y, w, h }]
// The buttons are made as large as the panel allows: they are aimed at with a pointer from a
// distance, so size matters more than density. A last row with fewer buttons stretches to fill
// the width. The whole card is centred on the panel, so the panel's centre is the card's centre.
export function drawCommands(g, d, vm) {
  const W = g.canvas.width;
  const H = g.canvas.height;
  g.clearRect(0, 0, W, H);
  const hits = [];
  if (!vm.items.length) return hits;
  const pad = 0.6 * d;
  const headH = 3.2 * d;
  const gap = 0.5 * d;
  const cols = vm.cols ?? 3;
  const rows = Math.ceil(vm.items.length / cols);
  // The emergency button, when the card has one: a red bar across the bottom, under the commands.
  const sosH = vm.sos ? 4.4 * d : 0;
  const sosGap = vm.sos ? 0.8 * d : 0;
  const cellH = Math.min(4.6 * d, (H - pad * 2 - headH - gap * (rows - 1) - sosH - sosGap) / rows);
  const total = pad + headH + rows * cellH + (rows - 1) * gap + sosGap + sosH + pad;
  const top = (H - total) / 2;
  box(g, 0, top, W, total, 1.6 * d, T.surface);
  ring(g, 0, top, W, total, 1.6 * d);
  icon(g, 'navigation', pad + 1.3 * d, top + pad + headH / 2 - 0.25 * d, 1.6 * d, T.primaryIcon, T.row);
  // The title gets what the hint leaves: a long one (a waypoint's spoken name) is cut short, not written over the hint.
  const hintW = vm.hint ? measure(g, vm.hint, 400, 1.0 * d) + 1.0 * d : 0;
  text(g, fit(g, vm.title, W - pad * 2 - 2.7 * d - hintW, 700, 1.45 * d), pad + 2.7 * d, top + pad + headH / 2 - 0.25 * d, { weight: 700, size: 1.45 * d });
  text(g, vm.hint, W - pad - 0.4 * d, top + pad + headH / 2 - 0.25 * d, { size: 1.0 * d, color: T.muted, align: 'right' });
  vm.items.forEach((item, i) => {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, vm.items.length - row * cols);
    const cellW = (W - pad * 2 - gap * (inRow - 1)) / inRow;
    const x = pad + (i % cols) * (cellW + gap);
    const y = top + pad + headH + row * (cellH + gap);
    hits.push({ id: item.id, x, y, w: cellW, h: cellH });
    box(g, x, y, cellW, cellH, 1.0 * d, item.pressed ? T.primary : item.hover ? T.badge : T.row);
    if (item.hover || item.pressed) {
      g.beginPath();
      g.roundRect(x + 0.14 * d, y + 0.14 * d, cellW - 0.28 * d, cellH - 0.28 * d, 0.88 * d);
      g.strokeStyle = item.pressed ? T.ink : 'rgba(255, 255, 255, 0.9)';
      g.lineWidth = 0.28 * d;
      g.stroke();
    }
    const size = 1.45 * d;
    text(g, fit(g, item.label, cellW - 1.0 * d, 700, size), x + cellW / 2, y + cellH / 2, { weight: 700, size, align: 'center' });
  });
  if (vm.sos) {
    // vm.sos: { id, state: 'idle' | 'armed' | 'sent', label, sub, pulse: 0..1, hover, pressed }
    const z = vm.sos;
    const x = pad;
    const y = top + pad + headH + rows * cellH + (rows - 1) * gap + sosGap;
    const w = W - pad * 2;
    hits.push({ id: z.id, x, y, w, h: sosH });
    // Red whatever its state, so it is found at a glance: full red, pulsing while armed, an
    // outlined dark red once the signal is out.
    const fill = z.state === 'sent' ? 'rgba(120, 18, 18, 0.92)' : z.state === 'armed' ? `rgba(255, 56, 56, ${0.7 + 0.3 * z.pulse})` : '#d92626';
    box(g, x, y, w, sosH, 1.1 * d, fill);
    g.beginPath();
    g.roundRect(x + 0.16 * d, y + 0.16 * d, w - 0.32 * d, sosH - 0.32 * d, 0.95 * d);
    g.strokeStyle = z.hover || z.pressed ? '#ffffff' : z.state === 'sent' ? T.dangerLine : 'rgba(255, 255, 255, 0.5)';
    g.lineWidth = (z.hover || z.pressed ? 0.34 : 0.18) * d;
    g.stroke();
    text(g, z.label, x + 1.3 * d, y + sosH / 2, { weight: 800, size: 1.8 * d, color: '#ffffff', tight: true });
    const lw = measure(g, z.label, 800, 1.8 * d);
    text(g, fit(g, z.sub, w - lw - 3.4 * d, 600, 1.0 * d), x + w - 1.2 * d, y + sosH / 2, { weight: 600, size: 1.0 * d, color: 'rgba(255, 255, 255, 0.92)', align: 'right' });
  }
  return hits;
}

// ---- a vital sign (one chip beside the figure over the right palm, suit.js) ----
// chip: { label, value, unit, tag, state: '' | 'warn' | 'crit' }                         one reading, or
//       { label, unit, rows: [{ label, value, tag, state }], state }                     a short table
// A dark card with its outline in the state's colour: label and where the number comes from on
// the first line, the number large under it. The chip fills its canvas.
export function drawVitalChip(g, d, chip) {
  const W = g.canvas.width;
  const H = g.canvas.height;
  g.clearRect(0, 0, W, H);
  const tone = (state) => (state === 'crit' ? T.dangerLine : state === 'warn' ? T.point : null);
  // A dark backing so the numbers read against a bright room, and no frame: a reading out of
  // range is told by the colour of its name and number.
  box(g, 0, 0, W, H, 1.0 * d, T.surface);
  text(g, chip.rows && chip.unit ? `${chip.label} · ${chip.unit}` : chip.label, 0.8 * d, 1.3 * d, { weight: 600, size: 1.0 * d, color: tone(chip.state) ?? T.muted });
  if (chip.tag) tag(g, chip.tag, W - 0.6 * d, 1.3 * d, d, true);
  if (chip.rows) {
    chip.rows.forEach((row, k) => {
      const ry = 2.5 * d + (k + 0.5) * 1.75 * d;
      const lw = text(g, row.label, 0.8 * d, ry, { weight: 600, size: 1.05 * d, color: tone(row.state) ?? T.muted });
      if (row.tag) text(g, row.tag, 0.8 * d + lw + 0.4 * d, ry + 0.08 * d, { weight: 600, size: 0.75 * d, color: T.muted });
      text(g, row.value, W - 0.8 * d, ry, { weight: 700, size: 1.3 * d, color: tone(row.state) ?? T.ink, align: 'right', tight: true });
    });
    return;
  }
  const size = 2.1 * d;
  const vw = text(g, chip.value, 0.8 * d, 3.55 * d, { weight: 700, size, color: tone(chip.state) ?? T.ink, tight: true });
  if (chip.unit) text(g, chip.unit, 0.8 * d + vw + 0.35 * d, 3.85 * d, { weight: 600, size: 1.05 * d, color: T.muted });
}
