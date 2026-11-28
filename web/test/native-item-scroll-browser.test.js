// Tier 1 (Chromium + WebKit), #256 part 2: the native Item screen (Labs flag
// `native-item`) offers every non-empty inventory slot, ten per page with
// Prev/Next, and a tap past the game's first page scrolls the game's list
// with itemSlotPlan, checking the row and the offset at every step. A fake
// semantic source simulates the game's list: Down moves the row to 9, then
// scrolls (offset + 1), as Tier 2 showed (save-boot-31a/31b). The backend is
// stubbed, so this runs without the Wasm core.
// Original project code, GPL-2.0-or-later.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { BROWSERS, launch, loadPlaywright, serveWeb, until } from './helpers.js';

const pw = loadPlaywright();
let server;
before(async () => { server = await serveWeb(); });
after(() => server?.close());

const DOWN = 1 << 5;
const CIRCLE = 1 << 8;
// Twelve items with gaps: page 1 holds slots 0..16, page 2 slots 18 and 25.
const SLOTS = [0, 1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 25];

async function openApp(browser, { row = 0, offset = 0, scrollAt = 9 } = {}) {
  const context = await browser.newContext({ ...(pw.devices['iPhone 14 Pro'] ?? {}) });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/js/backend.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: 'export async function createWorkerBackend() { window.pads = []; return { loaded: false, onFrameEnd() {}, setPad(m) { window.pads.push(m); } }; }',
  }));
  await page.goto(server.url + '?labs=native-item');
  await page.evaluate(() => window.ff7web.ready);
  await page.evaluate(({ slots, row, offset, scrollAt }) => {
    // `scrollAt`: the row from which Down scrolls instead (9 in the game; a
    // lower value simulates a game that disagrees with the plan).
    const sim = {
      frame: 1000, prev: 0, page: 'list', listRow: row, listOffset: offset, targetSlot: 0, chosen: null,
      inv: new Map(slots.map((s, i) => [s, { index: i, quantity: i + 1 }])),
    };
    window.sim = sim;
    setInterval(() => {
      const cur = window.pads.length ? window.pads[window.pads.length - 1] : 0;
      const rising = cur & ~sim.prev;
      sim.prev = cur;
      if (sim.page === 'list') {
        if (rising & (1 << 5) && sim.listOffset + sim.listRow < 319) {
          if (sim.listRow < scrollAt) sim.listRow += 1; else sim.listOffset += 1;
        }
        if (rising & (1 << 4)) { if (sim.listRow > 0) sim.listRow -= 1; else if (sim.listOffset > 0) sim.listOffset -= 1; }
        const slot = sim.listOffset + sim.listRow;
        if (rising & (1 << 8) && sim.inv.has(slot)) { sim.chosen = slot; sim.page = 'target'; }
      }
      sim.frame++;
    }, 1000 / 60);
    const screen = window.ff7web.itemScreen;
    screen.setSource({
      get frame() { return sim.frame; },
      itemScreen: async () => ({
        value: { page: sim.page, listOffset: sim.listOffset, listRow: sim.page === 'list' ? sim.listRow : null, targetSlot: sim.page === 'target' ? sim.targetSlot : null },
        confirmed: true,
      }),
      inventory: async () => ({
        value: [...sim.inv].sort((a, b) => a[0] - b[0]).map(([slot, it]) => ({ slot, index: it.index, quantity: it.quantity, kind: 'item', number: it.index })),
        confirmed: true,
      }),
      partyStatus: async () => ({ value: { hp: 100, maxHp: 200, mp: 10, maxMp: 20, limit: null, atb: null }, confirmed: true }),
    });
    screen.setGate({ active: true });
  }, { slots: SLOTS, row, offset, scrollAt });
  return { context, page, errors };
}
const pads = (page) => page.evaluate(() => window.pads.slice());
const visible = (page) => page.locator('#native-item').isVisible();
const pressed = (list) => list.filter((m) => m !== 0);
const texts = (page) => page.locator('.ni-item').allTextContents();

for (const name of BROWSERS) {
  describe(`native Item screen past page 1: ${name}`, () => {
    let browser;
    let skip;
    before(async () => {
      const r = await launch(pw, name);
      browser = r.browser;
      skip = r.skip;
    });
    after(() => browser?.close());

    test('Prev/Next page through every non-empty slot; a page-2 tap scrolls the game list to it', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser);
      try {
        await until(() => visible(page), { timeout: 3000, what: 'panel shown' });
        assert.equal(await page.locator('.ni-page').textContent(), '1/2');
        assert.equal(await page.locator('.ni-prev').isDisabled(), true);
        assert.equal((await texts(page)).length, 10);
        assert.equal((await texts(page))[9], 'item #9 ×10', 'row 10 is slot 16, the tenth item');
        await page.locator('.ni-next').tap();
        assert.equal(await page.locator('.ni-page').textContent(), '2/2');
        assert.equal(await page.locator('.ni-next').isDisabled(), true);
        assert.deepEqual((await texts(page)).slice(0, 3), ['item #10 ×11', 'item #11 ×12', '—']);
        assert.equal(await page.locator('.ni-item[data-row="2"]').isDisabled(), true);
        // Slot 25 from row 0 offset 0: 25 Downs (9 moves, then 16 scrolls), then Circle.
        await page.locator('.ni-item[data-row="1"]').tap();
        await until(() => page.evaluate(() => window.sim.page === 'target'), { timeout: 20000, what: 'target page' });
        await until(async () => (await pads(page)).at(-1) === 0, { timeout: 2000, what: 'Circle released' });
        assert.deepEqual(pressed(await pads(page)), [...Array(25).fill(DOWN), CIRCLE]);
        assert.deepEqual(await page.evaluate(() => [window.sim.listRow, window.sim.listOffset, window.sim.chosen]), [9, 16, 25]);
        assert.deepEqual(await page.evaluate(() => window.ff7web.itemScreen.last), { ok: true, kind: 'list', to: 25 });
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('opens on the page with the game cursor and outlines its row', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, { row: 9, offset: 9 }); // slot 18
      try {
        await until(() => visible(page), { timeout: 3000, what: 'panel shown' });
        await until(async () => (await page.locator('.ni-page').textContent()) === '2/2', { timeout: 3000, what: 'page 2' });
        assert.equal(await page.locator('.ni-item[data-row="0"]').getAttribute('data-cursor'), '');
        await page.locator('.ni-prev').tap();
        assert.equal(await page.locator('.ni-page').textContent(), '1/2');
        assert.equal(await page.locator('.ni-item[data-cursor]').count(), 0, 'the cursor is not on page 1');
        assert.deepEqual(await pads(page), [], 'paging presses nothing');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('a game that scrolls before row 9 stops the plan: no Circle, the list page stays', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, { scrollAt: 8 });
      try {
        await until(() => visible(page), { timeout: 3000, what: 'panel shown' });
        await page.locator('.ni-next').tap();
        await page.locator('.ni-item[data-row="0"]').tap(); // slot 18
        await until(async () => (await page.locator('.ni-msg').textContent()).startsWith('Stopped'), { timeout: 20000, what: 'plan stopped' });
        const last = await page.evaluate(() => window.ff7web.itemScreen.last);
        assert.equal(last.ok, false);
        assert.equal(last.to, 18);
        // Index 9 read as row 8 offset 1 (the plan wants row 9 offset 0): the ninth Down is the last.
        assert.equal(last.error.step, 8);
        await page.waitForTimeout(300);
        const sent = pressed(await pads(page));
        assert.equal(sent.includes(CIRCLE), false, 'no Circle after a stop');
        assert.equal(sent.length, 9);
        assert.equal((await pads(page)).at(-1), 0, 'released');
        assert.equal(await page.evaluate(() => window.sim.page), 'list');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  });
}
