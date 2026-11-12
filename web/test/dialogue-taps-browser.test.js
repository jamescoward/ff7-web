// Tier 1 (Chromium + WebKit): tap to advance dialogue (#114) with a fake
// semantic source. The backend is stubbed, so this runs without the Wasm core.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { BROWSERS, launch, loadPlaywright, serveWeb, until } from './helpers.js';

const pw = loadPlaywright();
let server;
before(async () => { server = await serveWeb(); });
after(() => server?.close());

const CIRCLE = 1 << 8;

async function openApp(browser, query) {
  const context = await browser.newContext({ ...(pw.devices['iPhone 14 Pro'] ?? {}) });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/js/backend.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: 'export async function createWorkerBackend() { window.pads = []; return { loaded: false, onFrameEnd() {}, setPad(m) { window.pads.push(m); } }; }',
  }));
  await page.goto(server.url + query);
  await page.evaluate(() => window.ff7web.ready);
  await page.evaluate(() => {
    window.fake = { sample: { value: { open: true, waiting: true, choice: null }, confirmed: true } };
    window.ff7web.dialogueTaps.setSource({ dialogue: async () => structuredClone(window.fake.sample) });
    window.ff7web.dialogueTaps.setGate({ active: true });
  });
  return { context, page, errors };
}

const tapPicture = async (page) => {
  const box = await page.locator('#screen').boundingBox();
  // Tap a point on the canvas that no overlay covers (centre, upper half).
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 4);
};
const pads = (page) => page.evaluate(() => window.pads.slice());

for (const name of BROWSERS) {
  describe(`dialogue taps: ${name}`, () => {
    let browser;
    let skip;
    before(async () => {
      const r = await launch(pw, name);
      browser = r.browser;
      skip = r.skip;
    });
    after(() => browser?.close());

    test('waiting: a tap presses Circle once, then releases', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=dialogue-taps');
      try {
        await tapPicture(page);
        await until(async () => (await pads(page)).length >= 2, { timeout: 3000, what: 'press and release' });
        assert.deepEqual(await pads(page), [CIRCLE, 0]);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('typing and closed: a tap sends nothing', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=dialogue-taps');
      try {
        for (const [open, waiting] of [[true, false], [false, false]]) {
          await page.evaluate(([o, w]) => { window.fake.sample = { value: { open: o, waiting: w, choice: null }, confirmed: true }; }, [open, waiting]);
          await tapPicture(page);
          await page.waitForTimeout(400);
          assert.deepEqual(await pads(page), []);
        }
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('flag off: a tap sends nothing', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '');
      try {
        await tapPicture(page);
        await page.waitForTimeout(400);
        assert.deepEqual(await pads(page), []);
        assert.equal(await page.evaluate(() => window.ff7web.dialogueTaps.running), false);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  });
}
