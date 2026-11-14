// 목 모드 연기 테스트: 페이지를 열어 콘솔 오류가 없고 주요 이벤트가 흐르는지 본다.
//   1) npm run dev   (다른 터미널)
//   2) npm run smoke [주소]      기본 주소: https://localhost:5173/
// Playwright가 설치돼 있어야 한다 (프로젝트 의존성에는 넣지 않았다).
const { chromium } = require('playwright');

const base = process.argv[2] || 'https://localhost:5173/';
const MUST = ['layers:ready', 'env:update', 'telemetry:update', 'alert:raise', 'alert:clear', 'hazard:update',
  'voice:command', 'nav:request', 'layer:toggle'];

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}?mock=1&mockSpeed=10`);
  await page.waitForTimeout(8000); // 10배속으로 80초 = 시간표 한 바퀴 이상
  const result = await page.evaluate(() => {
    const m = window.__marswalk;
    const brief = (v) => JSON.parse(JSON.stringify(v, (k, x) => (ArrayBuffer.isView(x) ? `${x.constructor.name}(${x.length})` : k === 'layerSet' || k === 'traverse' ? '{…}' : x)));
    return { counts: Object.fromEntries(m.counts), last: brief(m.last), button: document.getElementById('xr-button').textContent,
      canvas: !!document.querySelector('#app canvas') };
  });
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  await browser.close();
  console.log(JSON.stringify(result, null, 1));
  const missing = MUST.filter((n) => !result.counts[n]);
  if (errors.length) console.error('콘솔 오류:\n' + errors.join('\n'));
  if (missing.length) console.error('흐르지 않은 이벤트: ' + missing.join(', '));
  if (errors.length || missing.length || !result.canvas) process.exit(1);
  console.log('OK: 콘솔 오류 없음, 주요 이벤트 ' + MUST.length + '종 확인');
})();
