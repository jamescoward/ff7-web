// Tier 1 (Chromium + WebKit): "Use default name" on the naming screen (#289
// part 2) with a fake semantic source that simulates the screen. The backend
// is stubbed, so this runs without the Wasm core. Checks the button's size
// and place in portrait and landscape, the pad masks a tap sends, and that
// nothing shows or polls with the flag off.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { BROWSERS, launch, loadPlaywright, serveWeb, until } from './helpers.js';

const pw = loadPlaywright();
let server;
before(async () => { server = await serveWeb(); });
after(() => server?.close());

const START = 1 << 3;
const CIRCLE = 1 << 8;
const MIN_TARGET = 44;

async function openApp(browser, query, device = 'iPhone 14 Pro', open = true) {
  const context = await browser.newContext({ ...(pw.devices[device] ?? {}) });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/js/backend.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: 'export async function createWorkerBackend() { window.pads = []; return { loaded: false, onFrameEnd() {}, setPad(m) { window.pads.push(m); } }; }',
  }));
  await page.goto(server.url + query);
  await page.evaluate(() => window.ff7web.ready);
  await page.evaluate((o) => {
    // A simulated naming screen at 60 frames a second: a fresh Circle after a
    // fresh Start closes it, as Start (cursor to the confirm item) then Circle does.
    const sim = { frame: 1000, open: o, prev: 0, sawStart: false, reads: 0 };
    window.sim = sim;
    setInterval(() => {
      const cur = window.pads.length ? window.pads[window.pads.length - 1] : 0;
      const rising = cur & ~sim.prev;
      sim.prev = cur;
      if (rising & (1 << 3)) sim.sawStart = true;
      if ((rising & (1 << 8)) && sim.sawStart) sim.open = false;
      sim.frame++;
    }, 1000 / 60);
    const nc = window.ff7web.namingConfirm;
    nc.setSource({
      get frame() { return sim.frame; },
      naming: async () => { sim.reads++; return { value: sim.open, confirmed: true }; },
    });
    nc.setGate({ active: true });
  }, open);
  return { context, page, errors };
}
const pads = (page) => page.evaluate(() => window.pads.slice());
const visible = (page) => page.locator('#naming-confirm').isVisible();

for (const name of BROWSERS) {
  describe(`naming confirm: ${name}`, () => {
    let browser;
    let skip;
    before(async () => {
      const r = await launch(pw, name);
      browser = r.browser;
      skip = r.skip;
    });
    after(() => browser?.close());

    for (const device of ['iPhone 14 Pro', 'iPhone 14 Pro landscape']) {
      test(`shown on the naming screen, ≥44 px, inside the picture: ${device}`, async (t) => {
        if (skip) return t.skip(skip);
        const { context, page, errors } = await openApp(browser, '?labs=naming-confirm', device, false);
        try {
          await page.waitForTimeout(400);
          assert.equal(await visible(page), false);
          await page.evaluate(() => { window.sim.open = true; });
          await until(() => visible(page), { timeout: 3000, what: 'button shown on the naming screen' });
          const btn = page.locator('.nc-btn');
          assert.equal(await btn.textContent(), 'Use default name');
          const b = await btn.boundingBox();
          assert.ok(b.width >= MIN_TARGET && b.height >= MIN_TARGET, `button ${JSON.stringify(b)}`);
          const s = await page.locator('.screen').boundingBox();
          assert.ok(b.x >= s.x && b.y >= s.y && b.x + b.width <= s.x + s.width + 0.5 && b.y + b.height <= s.y + s.height + 0.5,
            `button ${JSON.stringify(b)} inside the picture ${JSON.stringify(s)}`);
          const vp = page.viewportSize();
          assert.ok(b.x + b.width <= vp.width && b.y + b.height <= vp.height, 'button on screen');
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal scroll');
          assert.deepEqual(errors, []);
        } finally { await context.close(); }
      });
    }

    test('a tap presses Start, then Circle, and the button goes when the screen closes', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=naming-confirm');
      try {
        await until(() => visible(page), { timeout: 3000, what: 'button shown' });
        await page.locator('.nc-btn').tap();
        await until(async () => (await page.evaluate(() => window.ff7web.namingConfirm.last))?.ok === true, { timeout: 5000, what: 'run done' });
        const seq = (await pads(page)).filter((m, i, a) => m !== 0 && (i === 0 || m !== a[i - 1]));
        assert.deepEqual(seq, [START, CIRCLE]);
        assert.equal((await pads(page)).at(-1), 0, 'nothing held after');
        await until(async () => !(await visible(page)), { timeout: 3000, what: 'button hidden after the screen closes' });
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('flag off: no button and no polling', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '');
      try {
        await page.waitForTimeout(500);
        assert.equal(await visible(page), false);
        assert.equal(await page.evaluate(() => window.sim.reads), 0);
        assert.equal(await page.evaluate(() => window.ff7web.labs.isOn('naming-confirm')), false);
        assert.deepEqual((await pads(page)).filter((m) => m !== 0), []);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  });
}
