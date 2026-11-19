// Tier 1 (Chromium + WebKit): the native Item screen (#135, Labs flag
// `native-item`) with a fake semantic source that simulates the game's Item
// screen: a list page with a cursor over ten rows, a target page with a
// party cursor, Circle to choose and use, Cross to go back. The backend is
// stubbed, so this runs without the Wasm core. Also checks the visible
// panel's layout (44 px targets, inside the picture, no page scroll) in
// portrait and landscape, with safe-layout on and off.
// Original project code, GPL-2.0-or-later.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { BROWSERS, launch, loadPlaywright, serveWeb, until } from './helpers.js';

const pw = loadPlaywright();
let server;
before(async () => { server = await serveWeb(); });
after(() => server?.close());

const DOWN = 1 << 5;
const UP = 1 << 4;
const CROSS = 1 << 0;
const CIRCLE = 1 << 8;

async function openApp(browser, query, device = 'iPhone 14 Pro', page0 = 'list') {
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
  await page.evaluate((p0) => {
    // A simulated Item screen at 60 frames a second. Items: slot 0 index 1
    // x2, slot 1 index 3 x2, slot 2 index 0 x5 (a Potion: +100 HP).
    const sim = {
      frame: 1000, prev: 0, page: p0, listRow: 0, targetSlot: 0, failRead: false,
      inv: new Map([[0, { index: 1, quantity: 2 }], [1, { index: 3, quantity: 2 }], [2, { index: 0, quantity: 5 }]]),
      hp: [500, 300, 400], maxHp: [500, 333, 450], chosen: null,
    };
    window.sim = sim;
    setInterval(() => {
      const cur = window.pads.length ? window.pads[window.pads.length - 1] : 0;
      const rising = cur & ~sim.prev;
      sim.prev = cur;
      if (sim.page === 'list') {
        if (rising & (1 << 5)) sim.listRow = Math.min(9, sim.listRow + 1);
        if (rising & (1 << 4)) sim.listRow = Math.max(0, sim.listRow - 1);
        if (rising & (1 << 8) && sim.inv.has(sim.listRow)) { sim.chosen = sim.listRow; sim.page = 'target'; sim.targetSlot = 0; }
        else if (rising & (1 << 0)) sim.page = null;
      } else if (sim.page === 'target') {
        if (rising & (1 << 5)) sim.targetSlot = (sim.targetSlot + 1) % 3;
        if (rising & (1 << 4)) sim.targetSlot = (sim.targetSlot + 2) % 3;
        if (rising & (1 << 8)) {
          const it = sim.inv.get(sim.chosen);
          const s = sim.targetSlot;
          if (it && it.index === 0 && sim.hp[s] < sim.maxHp[s]) {
            sim.hp[s] = Math.min(sim.maxHp[s], sim.hp[s] + 100);
            it.quantity -= 1;
            if (it.quantity === 0) { sim.inv.delete(sim.chosen); sim.page = 'list'; }
          }
        } else if (rising & (1 << 0)) sim.page = 'list';
      }
      sim.frame++;
    }, 1000 / 60);
    const screen = window.ff7web.itemScreen;
    screen.setSource({
      get frame() { return sim.frame; },
      itemScreen: async () => {
        if (sim.failRead) return { value: null, confirmed: false, reason: 'read failed' };
        if (!sim.page) return { value: { page: null, listRow: null, listOffset: null, targetSlot: null }, confirmed: true };
        return {
          value: { page: sim.page, listOffset: 0, listRow: sim.page === 'list' ? sim.listRow : null, targetSlot: sim.page === 'target' ? sim.targetSlot : null },
          confirmed: true,
        };
      },
      inventory: async () => ({
        value: [...sim.inv].sort((a, b) => a[0] - b[0]).map(([slot, it]) => ({ slot, index: it.index, quantity: it.quantity, kind: 'item', number: it.index })),
        confirmed: true,
      }),
      partyStatus: async (s) => ({ value: { hp: sim.hp[s], maxHp: sim.maxHp[s], mp: 10, maxMp: 20, limit: null, atb: null }, confirmed: true }),
    });
    screen.setGate({ active: true });
  }, page0);
  return { context, page, errors };
}
const pads = (page) => page.evaluate(() => window.pads.slice());
const visible = (page) => page.locator('#native-item').isVisible();
const pressed = (list) => list.filter((m) => m !== 0);

for (const name of BROWSERS) {
  describe(`native Item screen: ${name}`, () => {
    let browser;
    let skip;
    before(async () => {
      const r = await launch(pw, name);
      browser = r.browser;
      skip = r.skip;
    });
    after(() => browser?.close());

    test('shown only while the Item screen is open: ten rows from the inventory, three party rows', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=native-item', 'iPhone 14 Pro', null);
      try {
        await page.waitForTimeout(400);
        assert.equal(await visible(page), false);
        await page.evaluate(() => { window.sim.page = 'list'; });
        await until(() => visible(page), { timeout: 3000, what: 'panel shown on the list page' });
        const items = await page.locator('.ni-item').allTextContents();
        assert.equal(items.length, 10);
        assert.deepEqual(items.slice(0, 4), ['item #1 ×2', 'item #3 ×2', 'item #0 ×5', '—']);
        assert.equal(await page.locator('.ni-item[data-row="3"]').isDisabled(), true);
        assert.equal(await page.locator('.ni-item[data-row="0"]').getAttribute('data-cursor'), '');
        assert.deepEqual(await page.locator('.ni-member').allTextContents(), ['Slot 1  HP 500/500  MP 10/20', 'Slot 2  HP 300/333  MP 10/20', 'Slot 3  HP 400/450  MP 10/20']);
        assert.equal(await page.locator('.ni-member[data-slot="0"]').isDisabled(), true, 'party rows wait for the target page');
        // A failed read changes nothing; leaving the Item screen hides it.
        await page.evaluate(() => { window.sim.failRead = true; });
        await page.waitForTimeout(600);
        assert.equal(await visible(page), true);
        await page.evaluate(() => { window.sim.failRead = false; window.sim.page = null; });
        await until(async () => !(await visible(page)), { timeout: 3000, what: 'panel hidden when Item closes' });
        assert.deepEqual(await pads(page), []);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('flag off: no panel, no polling, no input', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '');
      try {
        await page.waitForTimeout(400);
        assert.equal(await visible(page), false);
        assert.equal(await page.evaluate(() => window.ff7web.itemScreen.running), false);
        assert.deepEqual(await pads(page), []);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('tap an item, then a party member: planned moves, Circle each time, and the use is confirmed', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=native-item');
      try {
        await until(() => visible(page), { timeout: 3000, what: 'panel shown' });
        await page.locator('.ni-item[data-row="2"]').tap();
        await until(() => page.evaluate(() => window.sim.page === 'target'), { timeout: 5000, what: 'target page' });
        await page.waitForTimeout(200);
        assert.deepEqual(pressed(await pads(page)), [DOWN, DOWN, CIRCLE]);
        await until(async () => !(await page.locator('.ni-member[data-slot="1"]').isDisabled()), { timeout: 3000, what: 'party rows enabled' });
        assert.equal(await page.locator('.ni-item[data-row="2"]').getAttribute('data-chosen'), '');
        await page.evaluate(() => { window.pads.length = 0; });
        await page.locator('.ni-member[data-slot="1"]').tap();
        await until(() => page.evaluate(() => window.sim.hp[1] === 333), { timeout: 5000, what: 'item used' });
        await until(async () => (await page.locator('.ni-msg').textContent()).startsWith('Used'), { timeout: 4000, what: 'use confirmed' });
        assert.equal(await page.locator('.ni-msg').textContent(), 'Used: ×5 → ×4, HP 300 → 333');
        await until(async () => (await pads(page)).at(-1) === 0, { timeout: 2000, what: 'Circle released' });
        assert.deepEqual(pressed(await pads(page)), [DOWN, CIRCLE]);
        const last = await page.evaluate(() => window.ff7web.itemScreen.last);
        assert.equal(last.used, true);
        assert.equal(last.hpRose, true);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('a use the game refuses is reported as no change', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=native-item');
      try {
        await until(() => visible(page), { timeout: 3000, what: 'panel shown' });
        await page.locator('.ni-item[data-row="2"]').tap();
        await until(() => page.evaluate(() => window.sim.page === 'target'), { timeout: 5000, what: 'target page' });
        await until(async () => !(await page.locator('.ni-member[data-slot="0"]').isDisabled()), { timeout: 3000, what: 'party rows enabled' });
        await page.locator('.ni-member[data-slot="0"]').tap(); // slot 0 is at full HP
        await until(async () => (await page.locator('.ni-msg').textContent()) === 'No change seen', { timeout: 6000, what: 'no change reported' });
        assert.equal(await page.evaluate(() => window.sim.inv.get(2).quantity), 5);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('Back presses Cross; Hide uncovers the picture until Item closes; the classic pad still works', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=native-item', 'iPhone 14 Pro', 'target');
      try {
        await until(() => visible(page), { timeout: 3000, what: 'panel shown' });
        await page.locator('.ni-back').tap();
        await until(() => page.evaluate(() => window.sim.page === 'list'), { timeout: 3000, what: 'back to the list' });
        assert.deepEqual(pressed(await pads(page)), [CROSS]);
        await page.waitForTimeout(200);
        await page.locator('.ni-hide').tap();
        assert.equal(await visible(page), false);
        await page.waitForTimeout(600);
        assert.equal(await visible(page), false, 'stays hidden while Item is open');
        await page.evaluate(() => { window.sim.page = null; });
        await page.waitForTimeout(600);
        await page.evaluate(() => { window.sim.page = 'list'; });
        await until(() => visible(page), { timeout: 3000, what: 'shown again when Item reopens' });
        // The classic pad: Up on the d-pad still reaches setPad.
        await page.evaluate(() => { window.pads.length = 0; });
        const up = page.locator('#pad [data-btn="up"]').first();
        if (await up.count()) {
          await up.dispatchEvent('pointerdown', { pointerId: 1, isPrimary: true });
          await until(async () => (await pads(page)).some((m) => m & UP), { timeout: 2000, what: 'pad Up' });
          await up.dispatchEvent('pointerup', { pointerId: 1, isPrimary: true });
        }
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    for (const [device, flags] of [
      ['iPhone 14 Pro', 'native-item'],
      ['iPhone 14 Pro', 'native-item,safe-layout'],
      ['iPhone 14 Pro landscape', 'native-item'],
      ['iPhone 14 Pro landscape', 'native-item,safe-layout'],
    ]) {
      test(`layout (${device}, ${flags}): inside the picture, 44 px targets, no page scroll`, async (t) => {
        if (skip) return t.skip(skip);
        const { context, page, errors } = await openApp(browser, `?labs=${flags}`, device);
        try {
          await until(() => visible(page), { timeout: 3000, what: 'panel shown' });
          const box = await page.locator('#native-item').boundingBox();
          const pic = await page.locator('#screen').boundingBox();
          assert.ok(Math.abs(box.x - pic.x) < 1 && Math.abs(box.width - pic.width) < 1, 'covers the picture width');
          assert.ok(Math.abs(box.y - pic.y) < 1 && Math.abs(box.height - pic.height) < 1, 'covers the picture height');
          for (const b of await page.locator('#native-item .btn').all()) {
            const r = await b.boundingBox();
            assert.ok(r.height >= 44 && r.width >= 44, `target ${JSON.stringify(r)} is at least 44 px`);
          }
          const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
          assert.equal(overflowX, false, 'no horizontal scroll');
          assert.deepEqual(errors, []);
        } finally { await context.close(); }
      });
    }
  });
}
