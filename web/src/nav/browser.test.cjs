// Real C-data integration test. Run the local Vite server first.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
let browser;
(async () => {
  const { createGridFrame } = await import('./coordinates.js');
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), errors = [], loaded = new Set();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(message.text()); });
  page.on('response', response => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) errors.push(`${response.status()} ${response.url()}`);
    if (response.status() === 200 && response.url().includes('/data/')) loaded.add(new URL(response.url()).pathname);
  });
  await page.goto(`${process.env.TEST_URL || 'https://127.0.0.1:5173/'}?mock=link&mockSpeed=0.01`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__marswalk?.counts.get('layers:ready'), null, { timeout: 20000 });
  const layerSet = await page.evaluate(() => window.__marswalk.last['layers:ready'].layerSet);
  assert.equal(!!layerSet.mock, false); assert.equal(layerSet.grid.cellSizeM, 4);
  assert.deepEqual(layerSet.waypoints.find(w => w.id === 'site1').cell, [275, 272]);
  await page.locator('#route-plan').click();
  await page.waitForFunction(() => window.__marswalk.last['nav:route']?.status === 'ok', null, { timeout: 30000 });
  const first = await page.evaluate(() => window.__marswalk.last['nav:route']);
  assert.ok(first.distanceM > 380 && first.distanceM < 405, String(first.distanceM)); assert.equal(first.reason, '');
  assert.match(await page.locator('#route-analysis').textContent(), /389\.7 m/);
  for (let i = 2; i < first.points.length; i++) {
    const a = first.points[i - 1], b = first.points[i], dx = Math.abs(b[0] - a[0]), dz = Math.abs(b[2] - a[2]);
    assert.ok(dx < 1e-8 || dz < 1e-8 || Math.abs(dx - dz) < 1e-8);
  }
  // Local/unregistered input must not be interpreted as a hazard on Mars.
  await page.evaluate(() => window.__marswalk.bus.emit('hazard:update', {
    originXZ: [-2, -2], cols: 40, rows: 40, cellSizeM: .1, cells: new Uint8Array(1600).fill(1), ts: Date.now(),
  }));
  await page.waitForTimeout(650);
  assert.equal(await page.evaluate(() => window.__marswalk.last['nav:route'].distanceM), first.distanceM);
  const frameId = createGridFrame(layerSet).frameId, began = Date.now();
  const immediate = await page.evaluate(frameId => {
    const h = { frameId, originXZ: [-1024, -1024], cols: 512, rows: 512, cellSizeM: 4, cells: new Uint8Array(512 * 512), ts: Date.now() };
    // One map-aligned obstacle along the real baseline route (a synthetic input).
    h.cells[(511 - 315) * 512 + 264] = 1; window.__routeTest = h;
    window.__marswalk.bus.emit('hazard:update', h); return window.__marswalk.last['nav:route'].status;
  }, frameId);
  assert.equal(immediate, 'blocked');
  await page.waitForFunction(() => window.__marswalk.last['nav:route']?.status === 'ok', null, { timeout: 30000 });
  const replanMs = Date.now() - began, detour = await page.evaluate(() => window.__marswalk.last['nav:route']);
  assert.notDeepEqual(detour.points, first.points); assert.equal(detour.reason, '');
  const signature = JSON.stringify(detour.points);
  await page.evaluate(() => {
    const h = window.__routeTest; h.cells[0] = 255; h.ts = Date.now(); window.__marswalk.bus.emit('hazard:update', h);
  });
  await page.waitForTimeout(650);
  assert.equal(await page.evaluate(() => JSON.stringify(window.__marswalk.last['nav:route'].points)), signature);
  await page.evaluate(() => window.__marswalk.bus.emit('layer:toggle', { id: 'thermal', visible: true }));
  await page.waitForFunction(() => performance.getEntriesByType('resource').some(r => r.name.endsWith('/data/thermal.png')));
  await page.evaluate(() => window.__marswalk.bus.emit('layer:toggle', { id: 'slope', visible: true }));
  await page.waitForTimeout(250);
  await page.evaluate(() => window.__marswalk.bus.emit('layer:toggle', { id: 'optical', visible: true }));
  await page.screenshot({ path: path.join(os.tmpdir(), 'marswalk-c-map-test.png') });
  await page.evaluate(() => { const h = window.__routeTest; h.cells.fill(0); h.ts = Date.now(); window.__marswalk.bus.emit('hazard:update', h); });
  await page.selectOption('#route-start', 'site1'); await page.selectOption('#route-target', 'base');
  await page.locator('#route-plan').click();
  await page.waitForFunction(() => { const r = window.__marswalk.last['nav:route']; return r?.targetId === 'base' && r.status === 'ok'; }, null, { timeout: 30000 });
  await page.evaluate(() => {
    window.__marswalk.bus.emit('alert:raise', { id: 'test-emergency', level: 'critical', message: 'test', ts: Date.now() });
    window.__marswalk.bus.emit('nav:request', { targetId: 'site1' });
  });
  await page.waitForFunction(() => { const r = window.__marswalk.last['nav:route']; return r?.targetId === 'base' && r.status === 'ok'; }, null, { timeout: 30000 });
  await page.locator('#route-stop').click();
  await page.waitForFunction(() => window.__marswalk.last['nav:route']?.status === 'cancelled');
  assert.ok(loaded.has('/data/topo.bin')); assert.ok(loaded.has('/data/slope.bin')); assert.ok(loaded.has('/data/optical.png')); assert.ok(loaded.has('/data/thermal.png'));
  await browser.close(); if (errors.length) throw Error(errors.join('\n'));
  console.log(JSON.stringify({ data: 'C real terrain', firstDistanceM: first.distanceM, detourDistanceM: detour.distanceM,
    replanMs, unregisteredInputIgnored: true, offRouteChangePreserved: true, emergencyReturn: true,
    screenshot: path.join(os.tmpdir(), 'marswalk-c-map-test.png') }, null, 2));
})().catch(async err => { console.error(err); await browser?.close(); process.exitCode = 1; });
