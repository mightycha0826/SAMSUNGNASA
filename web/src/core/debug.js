// 왼쪽 위 이벤트 창 (PC 화면 전용, AR 세션 안에서는 보이지 않는다).
// 버스에 흐르는 이벤트의 횟수와 마지막 payload를 보여 준다. ?debug=0 으로 숨긴다.

import { bus } from './bus.js';

function brief(payload) {
  try {
    return JSON.stringify(payload, (k, v) => {
      if (ArrayBuffer.isView(v)) return `${v.constructor.name}(${v.length})`;
      if (k === 'layerSet' || k === 'traverse') return '{…}';
      return v;
    });
  } catch {
    return String(payload);
  }
}

export function initDebug({ el, mock, keys }) {
  const counts = new Map();
  let dirty = true;
  // 테스트(scripts/smoke.cjs)와 콘솔에서 볼 수 있게 열어 둔다.
  window.__marswalk = { bus, counts, last: {} };
  bus.on('*', (name, payload) => {
    counts.set(name, (counts.get(name) ?? 0) + 1);
    window.__marswalk.last[name] = payload;
    dirty = true;
  });
  if (!el) return;
  const mockOn = ['data', 'link', 'hazard'].filter((p) => mock[p]);
  setInterval(() => {
    if (!dirty) return;
    dirty = false;
    const rows = [...counts.keys()].sort().map((name) => {
      const p = brief(window.__marswalk.last[name]);
      return `<tr><td>${name}</td><td class="n">${counts.get(name)}</td><td class="p" title='${p.replaceAll("'", '&#39;')}'>${p}</td></tr>`;
    });
    el.innerHTML =
      `<h1>Marswalk Visor <span class="tag">${mockOn.length ? `mock: ${mockOn.join(', ')}` : '실연결'}</span></h1>` +
      `<table>${rows.join('')}</table>` +
      (keys ? `<div style="margin-top:6px;color:#9aa0a6">${keys}</div>` : '') +
      `<div style="margin-top:6px"><a href="./check.html">기기 점검 페이지</a></div>`;
  }, 250);
}
