// Local integration test: run the Vite server first; Playwright and Chrome required.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
let browser;
(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(`${process.env.TEST_URL || 'https://127.0.0.1:5173/'}?mock=data,link&mockSpeed=0.1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__marswalk?.counts.get('layers:ready'), null, { timeout: 20000 });
  assert.ok(await page.locator('#app canvas').count());
  await page.evaluate(() => {
    window.__routeTest = { originXZ: [-2, -2], cellSizeM: .1, cols: 40, rows: 40, cells: new Uint8Array(1600), ts: Date.now() };
    window.__marswalk.bus.emit('hazard:update', window.__routeTest);
  });
  const t0 = Date.now();
  await page.keyboard.press('n');
  await page.waitForFunction(() => window.__marswalk?.last['nav:route']?.status === 'ok', null, { timeout: 30000 });
  const firstMs = Date.now() - t0;
  const first = await page.evaluate(() => window.__marswalk.last['nav:route']);
  assert.ok(first.points.length >= 2); assert.ok(first.distanceM > 0); assert.equal(first.reason, '');
  // Convert vectors to grid units: emitted main segments must follow the 8-way grid.
  for (let i = 2; i < first.points.length; i++) {
    const a = first.points[i - 1], b = first.points[i], dx = Math.abs(b[0] - a[0]), dz = Math.abs(b[2] - a[2]);
    assert.ok(dx < 1e-8 || dz < 1e-8 || Math.abs(dx - dz) < 1e-8);
  }
  const addedAt = Date.now();
  const immediate = await page.evaluate(() => {
    const route = window.__marswalk.last['nav:route']; let remaining = route.distanceM * .45, p;
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1], b = route.points[i], d = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (d > 0 && remaining <= d) { p = [a[0] + (b[0] - a[0]) * remaining / d, a[2] + (b[2] - a[2]) * remaining / d]; break; }
      remaining -= d;
    }
    const h = window.__routeTest, id = Math.floor((p[1] + 2) / .1) * 40 + Math.floor((p[0] + 2) / .1);
    h.cells[id] = 1; h.ts = Date.now(); window.__marswalk.bus.emit('hazard:update', h);
    return window.__marswalk.last['nav:route'].status;
  });
  assert.equal(immediate, 'blocked');
  await page.waitForFunction(() => window.__marswalk.last['nav:route']?.status === 'ok', null, { timeout: 30000 });
  const repairMs = Date.now() - addedAt;
  const detour = await page.evaluate(() => window.__marswalk.last['nav:route']);
  assert.notDeepEqual(detour.points, first.points); assert.equal(detour.reason, '');
  const signature = JSON.stringify(detour.points);
  await page.evaluate(() => {
    // A change in the far opposite corner must not change this guidance.
    const h = window.__routeTest; h.cells[39] = 255; h.ts = Date.now(); window.__marswalk.bus.emit('hazard:update', h);
  });
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(() => JSON.stringify(window.__marswalk.last['nav:route'].points)), signature);
  await page.screenshot({ path: path.join(os.tmpdir(), 'marswalk-map-test.png') });
  await page.evaluate(() => {
    const h = window.__routeTest; h.cells.fill(0); h.ts = Date.now(); window.__marswalk.bus.emit('hazard:update', h);
  });
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(800); await page.keyboard.up('ArrowRight');
  await page.evaluate(() => window.__marswalk.bus.emit('alert:raise', { id: 'test-emergency', level: 'critical', message: 'test', ts: Date.now() }));
  await page.waitForFunction(() => {
    const route = window.__marswalk?.last['nav:route']; return route?.targetId === 'base' && (route.status === 'ok' || route.status === 'arrived');
  }, null, { timeout: 30000 });
  const emergency = await page.evaluate(() => window.__marswalk.last['nav:route']);
  assert.equal(emergency.targetId, 'base');
  await page.keyboard.press('s');
  await page.waitForFunction(() => window.__marswalk?.last['nav:route']?.status === 'cancelled', null, { timeout: 5000 });
  await browser.close();
  if (errors.length) throw Error(errors.join('\n'));
  console.log(JSON.stringify({ firstStatus: first.status, firstMs, repairMs, firstDistanceM: first.distanceM,
    detourDistanceM: detour.distanceM, offRouteChangePreserved: true, emergencyStatus: emergency.status,
    emergencyTarget: emergency.targetId, screenshot: path.join(os.tmpdir(), 'marswalk-map-test.png') }, null, 2));
})().catch(async err => { console.error(err); await browser?.close(); process.exitCode = 1; });
