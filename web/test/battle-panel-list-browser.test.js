// Tier 1 (Chromium + WebKit): the battle panel's list view (#253 part 2), with
// a fake semantic source simulating battleList() (a Magic list of 3 columns,
// 3 rows a page, scrolling as save-boot-29a showed) and battleListEntries().
// The backend is stubbed, so this runs without the Wasm core. Checks that a
// tap sends the planner's presses and then Circle, that the list view keeps
// the other views' height (the pad does not move), 44 px targets, no
// overlap and no horizontal scroll, and that it is hidden in landscape.
// Original project code, GPL-2.0-or-later.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { BROWSERS, launch, loadPlaywright, serveWeb, until } from './helpers.js';

const pw = loadPlaywright();
let server;
before(async () => { server = await serveWeb(); });
after(() => server?.close());

const DOWN = 1 << 5;
const LEFT = 1 << 6;
const CIRCLE = 1 << 8;

async function openApp(browser, query, device = 'iPhone 14 Pro', start = { list: 'magic', actor: 0 }) {
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
  await page.evaluate((st) => {
    // A simulated battle Magic list at 60 frames a second: Down moves the row
    // to 2, then scrolls; Left/Right move the column; Circle opens target
    // selection (the list closes). Slot 0's cursor is a confirmed read.
    const sim = { frame: 1000, list: st.list, actor: st.actor, row: 1, offset: 0, column: 2, targeting: null, prev: 0 };
    window.sim = sim;
    setInterval(() => {
      const cur = window.pads.length ? window.pads[window.pads.length - 1] : 0;
      const rising = cur & ~sim.prev;
      sim.prev = cur;
      if (sim.list) {
        if (rising & (1 << 5)) { if (sim.row < 2) sim.row++; else sim.offset++; }
        if (rising & (1 << 4)) { if (sim.row > 0) sim.row--; else sim.offset--; }
        if (rising & (1 << 6)) sim.column--;
        if (rising & (1 << 7)) sim.column++;
        if (rising & (1 << 8)) { sim.list = null; sim.targeting = { index: 4 }; }
      }
      sim.frame++;
    }, 1000 / 60);
    const known = () => sim.actor === 0;
    const sem = {
      get frame() { return sim.frame; },
      battleInput: async () => ({ value: { actor: sim.list ? null : sim.actor, row: null, targeting: sim.targeting }, confirmed: true }),
      battleList: async () => (sim.list
        ? { value: { actor: sim.actor, list: sim.list, index: known() ? (sim.offset + sim.row) * 3 + sim.column : null, row: known() ? sim.row : null, offset: known() ? sim.offset : null, column: known() ? sim.column : null }, confirmed: true }
        : { value: { actor: null, list: null, index: null, row: null, offset: null, column: null }, confirmed: true }),
      battleListEntries: async () => ({ value: [0, 1, 2, 5, 9, 13].map((index) => ({ index, id: index })), confirmed: true }),
      mode: async () => ({ value: { mode: 'battle' }, confirmed: true }),
      partyStatus: async () => ({ value: { hp: 271, maxHp: 314, mp: 41, maxMp: 54, limit: 100, atb: 0x8000 }, confirmed: true }),
    };
    window.ff7web.battlePanel.setSource(sem);
    window.ff7web.battlePanel.setGate({ active: true });
    window.ff7web.battleHud.setSource(sem);
    window.ff7web.battleHud.setGate({ active: true });
  }, start);
  return { context, page, errors };
}
const pads = (page) => page.evaluate(() => window.pads.slice());
const visible = (page) => page.locator('#battle-panel').isVisible();
const view = (page) => page.locator('#battle-panel').getAttribute('data-view');

for (const name of BROWSERS) {
  describe(`battle panel list view: ${name}`, () => {
    let browser;
    let skip;
    before(async () => {
      const r = await launch(pw, name);
      browser = r.browser;
      skip = r.skip;
    });
    after(() => browser?.close());

    test('an open Magic list shows its entries; a tap plans there, presses Circle, then targeting shows', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=battle-panel');
      try {
        await until(async () => (await view(page)) === 'list', { timeout: 3000, what: 'list view' });
        assert.deepEqual(await page.locator('.bp-list button').allTextContents(), ['Spell #0', 'Spell #1', 'Spell #2', 'Spell #5', 'Spell #9', 'Spell #13']);
        assert.equal(await page.locator('.bp-commands').isVisible(), false);
        assert.equal(await page.locator('.bp-targets').isVisible(), false);
        // From index 5 (row 1, column 2) to index 13 (list row 4, column 1):
        // Down (row 2), Down (offset 1), Down (offset 2), Left.
        await page.locator('.bp-btn[data-index="13"]').scrollIntoViewIfNeeded();
        await page.locator('.bp-btn[data-index="13"]').tap();
        await until(async () => (await pads(page)).includes(CIRCLE), { timeout: 5000, what: 'Circle pressed' });
        assert.deepEqual((await pads(page)).filter((m) => m !== 0), [DOWN, DOWN, DOWN, LEFT, CIRCLE]);
        await until(async () => (await view(page)) === 'targeting', { timeout: 3000, what: 'targeting view' });
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('another slot\'s list (cursor not confirmed): entries greyed and send nothing', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=battle-panel', 'iPhone 14 Pro', { list: 'magic', actor: 1 });
      try {
        await until(async () => (await view(page)) === 'list', { timeout: 3000, what: 'list view' });
        await until(() => page.locator('.bp-btn[data-index="0"]').isDisabled(), { timeout: 3000, what: 'entries disabled' });
        assert.equal(await page.locator('.bp-note').isVisible(), true);
        await page.locator('.bp-btn[data-index="0"]').tap({ force: true });
        await page.waitForTimeout(300);
        assert.deepEqual(await pads(page), []);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    for (const extra of ['', ',battle-hud', ',safe-layout', ',battle-hud,safe-layout']) {
      test(`portrait layout with the list up${extra}: same height as the command view, 44 px, no horizontal scroll`, async (t) => {
        if (skip) return t.skip(skip);
        const heights = {};
        for (const start of [{ list: 'magic', actor: 0 }, { list: null, actor: 0 }]) {
          const { context, page, errors } = await openApp(browser, `?labs=battle-panel${extra}`, 'iPhone 14 Pro', start);
          try {
            await until(() => visible(page), { timeout: 3000, what: 'panel shown' });
            await until(async () => (await view(page)) === (start.list ? 'list' : 'command'), { timeout: 3000, what: 'view' });
            const m = await page.evaluate(() => {
              const rect = (el) => el.getBoundingClientRect().toJSON();
              const panel = document.getElementById('battle-panel');
              const box = rect(panel);
              const btns = [...panel.querySelectorAll('button')].filter((el) => el.getClientRects().length > 0).map(rect)
                .filter((r) => r.y + r.height > box.y && r.y < box.y + box.height); // inside the list's scroll box
              return { panel: box, btns, screen: rect(document.getElementById('screen')), scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth };
            });
            heights[start.list ? 'list' : 'command'] = m.panel.height;
            assert.ok(m.btns.length >= 4);
            for (const r of m.btns) {
              assert.ok(r.width >= 44 && r.height >= 44, `button ${r.width}x${r.height} is under 44 px`);
              assert.ok(r.x >= -0.5 && r.x + r.width <= m.innerW + 0.5, 'button inside the viewport width');
            }
            assert.ok(m.panel.y >= m.screen.y + m.screen.height - 1, 'panel is below the picture');
            assert.ok(m.scrollW <= m.innerW, 'no horizontal scroll');
            assert.deepEqual(errors, []);
          } finally { await context.close(); }
        }
        assert.ok(Math.abs(heights.list - heights.command) <= 1, `list view ${heights.list} px vs command view ${heights.command} px`);
      });
    }

    test('landscape: the list view is hidden too', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=battle-panel', 'iPhone 14 Pro landscape');
      try {
        await page.waitForTimeout(500);
        assert.equal(await visible(page), false);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  });
}
