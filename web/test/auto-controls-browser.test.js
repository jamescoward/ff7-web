// Tier 1 (Chromium + WebKit): automatic controls (#113) with a fake semantic
// source. The backend is stubbed, so this runs without the Wasm core.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { BROWSERS, launch, loadPlaywright, serveWeb, until } from './helpers.js';

const pw = loadPlaywright();
let server;
before(async () => { server = await serveWeb(); });
after(() => server?.close());

async function openApp(browser, query) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/js/backend.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: 'export async function createWorkerBackend() { return { loaded: false, onFrameEnd() {}, setPad() {} }; }',
  }));
  await page.goto(server.url + query);
  await page.evaluate(() => window.ff7web.ready);
  // The fake source: window.fakeMode names the mode it reports.
  await page.evaluate(() => {
    window.fakeMode = 'field';
    window.ff7web.autoControls.setSource(async () => ({ value: { mode: window.fakeMode, raw: 0, previous: null }, confirmed: true }));
  });
  return { context, page, errors };
}
const shown = (page) => page.evaluate(() => ({
  field: !document.getElementById('field').hidden,
  pad: !document.getElementById('pad').hidden,
}));
const setMode = (page, m) => page.evaluate((x) => { window.fakeMode = x; }, m);
const expectShown = (page, which, why) => until(async () => (await shown(page))[which], { timeout: 3000, what: `${which} shown` }).then(async () => {
  const s = await shown(page);
  assert.deepEqual(s, { field: which === 'field', pad: which === 'pad' }, why);
});
const SETTLE = 800; // several 4 Hz polls

for (const name of BROWSERS) {
  describe(`auto controls: ${name}`, () => {
    let browser;
    let skip;
    before(async () => {
      const r = await launch(pw, name);
      browser = r.browser;
      skip = r.skip;
    });
    after(() => browser?.close());

    test('flag on: field shows drag-to-walk, battle and menu show the pad', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=auto-controls');
      try {
        await page.evaluate(() => window.ff7web.autoControls.setGate({ active: true }));
        await expectShown(page, 'field', 'field');
        await setMode(page, 'battle');
        await expectShown(page, 'pad', 'battle');
        await setMode(page, 'field');
        await expectShown(page, 'field', 'field again');
        await setMode(page, 'menu');
        await expectShown(page, 'pad', 'menu');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('the Controls button overrides until the next mode change, and is not saved by auto', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=auto-controls');
      try {
        await page.evaluate(() => { window.fakeMode = 'battle'; window.ff7web.autoControls.setGate({ active: true }); });
        await expectShown(page, 'pad', 'battle');
        assert.equal(await page.evaluate(() => localStorage.getItem('ff7-web-control-mode')), null, 'auto does not save');
        await page.tap('#controls-btn');
        await expectShown(page, 'field', 'override');
        await page.waitForTimeout(SETTLE); // battle keeps being reported
        await expectShown(page, 'field', 'override holds');
        await setMode(page, 'menu');
        await expectShown(page, 'pad', 'next change wins');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('flag off: no automatic switching', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '');
      try {
        await page.evaluate(() => window.ff7web.autoControls.setGate({ active: true }));
        await page.waitForTimeout(SETTLE);
        await expectShown(page, 'pad', 'still the pad');
        assert.equal(await page.evaluate(() => window.ff7web.autoControls.running), false);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('gate closed: no automatic switching', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=auto-controls');
      try {
        await page.evaluate(() => window.ff7web.autoControls.setGate({ active: false, reason: 'not the USA disc' }));
        await page.waitForTimeout(SETTLE);
        await expectShown(page, 'pad', 'still the pad');
        assert.equal(await page.evaluate(() => window.ff7web.autoControls.running), false);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  });
}
