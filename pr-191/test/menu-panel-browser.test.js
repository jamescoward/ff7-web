// Tier 1 (Chromium + WebKit): tap-to-select main menu panel (#115) with a fake
// semantic source that simulates the menu cursor. The backend is stubbed, so
// this runs without the Wasm core. Also checks the visible panel's layout
// (target size, overlap, scroll) in portrait, with safe-layout on and off, and
// that it is hidden in landscape.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { BROWSERS, launch, loadPlaywright, serveWeb, until } from './helpers.js';

const pw = loadPlaywright();
let server;
before(async () => { server = await serveWeb(); });
after(() => server?.close());

const DOWN = 1 << 5;
const UP = 1 << 4;
const CIRCLE = 1 << 8;
const TRIANGLE = 1 << 9;
const LABELS = ['Item', 'Magic', 'Materia', 'Equip', 'Status', 'Order', 'Limit', 'Config', 'PHS', 'Save'];

async function openApp(browser, query, device = 'iPhone 14 Pro', mode = 'menu') {
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
  await page.evaluate((m) => {
    // A simulated game: 60 frames a second; a fresh Up/Down press moves the
    // cursor (10 rows, wraps), as the menu does.
    const sim = { frame: 1000, cursor: 0, mode: m, prev: 0 };
    window.sim = sim;
    setInterval(() => {
      const cur = window.pads.length ? window.pads[window.pads.length - 1] : 0;
      const rising = cur & ~sim.prev;
      sim.prev = cur;
      if (rising & (1 << 5)) sim.cursor = (sim.cursor + 1) % 10;
      if (rising & (1 << 4)) sim.cursor = (sim.cursor + 9) % 10;
      sim.frame++;
    }, 1000 / 60);
    const panel = window.ff7web.menuPanel;
    panel.setSource({
      get frame() { return sim.frame; },
      mode: async () => ({ value: { mode: sim.mode }, confirmed: true }),
      menuCursor: async () => ({ value: sim.cursor, confirmed: true }),
    });
    panel.setGate({ active: true });
  }, mode);
  return { context, page, errors };
}
const pads = (page) => page.evaluate(() => window.pads.slice());
const visible = (page) => page.locator('#menu-panel').isVisible();

for (const name of BROWSERS) {
  describe(`menu panel: ${name}`, () => {
    let browser;
    let skip;
    before(async () => {
      const r = await launch(pw, name);
      browser = r.browser;
      skip = r.skip;
    });
    after(() => browser?.close());

    test('shown only in menu mode, with ten labelled rows plus Back and Close', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=menu-panel', 'iPhone 14 Pro', 'field');
      try {
        await page.waitForTimeout(400);
        assert.equal(await visible(page), false);
        await page.evaluate(() => { window.sim.mode = 'menu'; });
        await until(() => visible(page), { timeout: 3000, what: 'panel shown in menu mode' });
        assert.deepEqual(await page.locator('.mp-row[data-row]').allTextContents(), LABELS);
        assert.deepEqual(await page.locator('.mp-nav').allTextContents(), ['Back', 'Close']);
        await page.evaluate(() => { window.sim.mode = 'battle'; });
        await until(async () => !(await visible(page)), { timeout: 3000, what: 'panel hidden outside menu mode' });
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('flag off: no panel and no polling', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '');
      try {
        await page.waitForTimeout(400);
        assert.equal(await visible(page), false);
        assert.equal(await page.evaluate(() => window.ff7web.menuPanel.running), false);
        assert.deepEqual(await pads(page), []);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('tapping a row moves the cursor there, then presses Circle once', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=menu-panel');
      try {
        await until(() => visible(page), { timeout: 3000, what: 'panel shown' });
        await page.locator('.mp-row[data-row="2"]').tap();
        await until(async () => (await pads(page)).includes(CIRCLE), { timeout: 5000, what: 'Circle pressed' });
        await page.waitForTimeout(300);
        const seen = (await pads(page)).filter((m) => m !== 0);
        assert.deepEqual(seen, [DOWN, DOWN, CIRCLE]);
        assert.equal((await pads(page)).at(-1), 0);
        assert.equal(await page.evaluate(() => window.sim.cursor), 2);
        // Wrapping: from row 2 to row 9 is three Ups (shorter than seven Downs).
        await page.evaluate(() => { window.pads.length = 0; });
        await page.locator('.mp-row[data-row="9"]').tap();
        await until(async () => (await pads(page)).includes(CIRCLE), { timeout: 5000, what: 'Circle pressed' });
        assert.deepEqual((await pads(page)).filter((m) => m !== 0), [UP, UP, UP, CIRCLE]);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('Back and Close press Triangle; the classic pad still works', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=menu-panel');
      try {
        await until(() => visible(page), { timeout: 3000, what: 'panel shown' });
        await page.locator('.mp-nav[data-action="back"]').tap();
        await until(async () => (await pads(page)).length >= 2, { timeout: 3000, what: 'press and release' });
        assert.deepEqual(await pads(page), [TRIANGLE, 0]);
        await page.waitForTimeout(150);
        await page.locator('.mp-nav[data-action="close"]').tap();
        await until(async () => (await pads(page)).length >= 4, { timeout: 3000, what: 'second press' });
        assert.deepEqual(await pads(page), [TRIANGLE, 0, TRIANGLE, 0]);
        await page.evaluate(() => { window.pads.length = 0; });
        const cross = await page.locator('[data-btn="cross"]').boundingBox();
        await page.touchscreen.tap(cross.x + cross.width / 2, cross.y + cross.height / 2);
        await until(async () => (await pads(page)).length >= 2, { timeout: 3000, what: 'cross press' });
        assert.deepEqual(await pads(page), [1, 0]);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    for (const layout of ['', '&labs=safe-layout']) {
      test(`portrait layout with the panel up${layout ? ' and safe-layout' : ''}: 44 px targets, no overlap, no horizontal scroll`, async (t) => {
        if (skip) return t.skip(skip);
        const { context, page, errors } = await openApp(browser, `?labs=menu-panel${layout}`);
        try {
          await until(() => visible(page), { timeout: 3000, what: 'panel shown' });
          const m = await page.evaluate(() => {
            const rect = (el) => el.getBoundingClientRect().toJSON();
            const panel = rect(document.getElementById('menu-panel'));
            const rows = [...document.querySelectorAll('#menu-panel button')].map(rect);
            const others = [...document.querySelectorAll('.vp-btn, .vp-dpad, #labs-btn, #controls-btn, summary, #status')]
              .filter((el) => el.getClientRects().length).map(rect);
            return {
              panel, rows, others,
              screen: rect(document.getElementById('screen')),
              scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
            };
          });
          assert.equal(m.rows.length, 12);
          for (const r of m.rows) {
            assert.ok(r.width >= 44 && r.height >= 44, `row ${r.width}x${r.height} is under 44 px`);
            assert.ok(r.x >= -0.5 && r.x + r.width <= m.innerW + 0.5, 'row inside the viewport width');
          }
          for (let i = 0; i < m.rows.length; i++) {
            for (let j = i + 1; j < m.rows.length; j++) {
              const a = m.rows[i];
              const b = m.rows[j];
              assert.ok(!(a.x < b.x + b.width - 0.01 && b.x < a.x + a.width - 0.01 && a.y < b.y + b.height - 0.01 && b.y < a.y + a.height - 0.01), `rows ${i} and ${j} overlap`);
            }
          }
          for (const o of m.others) {
            if (!o.width) continue;
            const hit = m.panel.x < o.x + o.width && o.x < m.panel.x + m.panel.width && m.panel.y < o.y + o.height && o.y < m.panel.y + m.panel.height;
            assert.ok(!hit, `panel overlaps another control at ${Math.round(o.x)},${Math.round(o.y)}`);
          }
          // Below the picture, never on it.
          assert.ok(m.panel.y >= m.screen.y + m.screen.height - 1, 'panel is below the picture');
          assert.ok(m.scrollW <= m.innerW, 'no horizontal scroll');
          assert.deepEqual(errors, []);
        } finally { await context.close(); }
      });
    }

    test('landscape: the panel is hidden (no free space beside the picture)', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=menu-panel', 'iPhone 14 Pro landscape');
      try {
        await page.waitForTimeout(500);
        assert.equal(await visible(page), false);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  });
}
