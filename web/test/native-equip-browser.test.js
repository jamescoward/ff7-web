// Tier 1 (Chromium + WebKit): the native Equip screen (#121, Labs flag
// `native-equip`) with a fake semantic source that simulates the game's
// Equip screen as Tier 2 saw it (save-boot-15c): it opens on the Weapon
// slot; Circle opens the weapon list; Circle on the list equips its first
// entry, the first spare weapon in slot order, which leaves the inventory.
// Cross on the slot row closes the screen. The backend is stubbed, so this
// runs without the Wasm core. Also checks the visible panel's layout (44 px
// targets, inside the picture, no page scroll) in portrait and landscape,
// with safe-layout on and off.
// Original project code, GPL-2.0-or-later.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { BROWSERS, launch, loadPlaywright, serveWeb, until } from './helpers.js';

const pw = loadPlaywright();
let server;
before(async () => { server = await serveWeb(); });
after(() => server?.close());

const CROSS = 1 << 0;
const CIRCLE = 1 << 8;
const TRIANGLE = 1 << 9;

async function openApp(browser, query, { device = 'iPhone 14 Pro', open = true, party = [0, null, null] } = {}) {
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
  await page.evaluate(({ open0, party0 }) => {
    // A simulated Equip screen at 60 frames a second. Spare weapons: slot 0
    // weapon 1 x1, slot 3 weapon 2 x1; slot 1 holds an item.
    const sim = {
      frame: 1000, prev: 0, open: open0, page: 'slot', failRead: false, circles: [],
      party: party0, weapon: [0, 5, 7],
      inv: new Map([[0, { kind: 'weapon', number: 1, quantity: 1 }], [1, { kind: 'item', number: 0, quantity: 3 }], [3, { kind: 'weapon', number: 2, quantity: 1 }]]),
    };
    window.sim = sim;
    setInterval(() => {
      const cur = window.pads.length ? window.pads[window.pads.length - 1] : 0;
      const rising = cur & ~sim.prev;
      sim.prev = cur;
      if (sim.open) {
        if (rising & (1 << 8)) sim.circles.push(sim.frame);
        if (sim.page === 'slot') {
          if (rising & (1 << 8)) sim.page = 'list';
          else if (rising & (1 << 0)) sim.open = false;
        } else if (sim.page === 'list') {
          if (rising & (1 << 8)) {
            const first = [...sim.inv].sort((a, b) => a[0] - b[0]).find(([, it]) => it.kind === 'weapon');
            if (sim.listFirst !== undefined) sim.weapon[0] = sim.listFirst;
            else if (first) {
              const [slot, it] = first;
              const old = sim.weapon[0];
              sim.weapon[0] = it.number;
              sim.inv.delete(slot);
              sim.inv.set(9, { kind: 'weapon', number: old, quantity: 1 });
            }
            sim.page = 'slot';
          } else if (rising & (1 << 0)) sim.page = 'slot';
        }
      }
      sim.frame++;
    }, 1000 / 60);
    const screen = window.ff7web.equipScreen;
    screen.setSource({
      get frame() { return sim.frame; },
      equipScreen: async () => (sim.failRead ? { value: null, confirmed: false, reason: 'read failed' } : { value: { open: sim.open }, confirmed: true }),
      equipment: async (s) => (sim.party[s] === null
        ? { value: null, confirmed: true, reason: 'empty slot' }
        : { value: { record: sim.party[s], weapon: sim.weapon[s], armor: s, accessory: null, weaponMateria: [], armorMateria: [] }, confirmed: true }),
      inventory: async () => ({
        value: [...sim.inv].sort((a, b) => a[0] - b[0]).map(([slot, it]) => ({ slot, index: 128 + it.number, quantity: it.quantity, kind: it.kind, number: it.number })),
        confirmed: true,
      }),
    });
    screen.setGate({ active: true });
  }, { open0: open, party0: party });
  return { context, page, errors };
}
const pads = (page) => page.evaluate(() => window.pads.slice());
const visible = (page) => page.locator('#native-equip').isVisible();
const pressed = (list) => list.filter((m) => m !== 0);
const enabled = async (page, row) => !(await page.locator(`.ne-weapon[data-row="${row}"]`).isDisabled());

for (const name of BROWSERS) {
  describe(`native Equip screen: ${name}`, () => {
    let browser;
    let skip;
    before(async () => {
      const r = await launch(pw, name);
      browser = r.browser;
      skip = r.skip;
    });
    after(() => browser?.close());

    test('shown only while the Equip screen is open: member rows and the spare weapons', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=native-equip', { open: false });
      try {
        await page.waitForTimeout(400);
        assert.equal(await visible(page), false);
        await page.evaluate(() => { window.sim.open = true; });
        await until(() => visible(page), { timeout: 3000, what: 'panel shown on the Equip screen' });
        assert.deepEqual(await page.locator('.ne-member').allTextContents(), ['Slot 1  Wpn #0  Arm #0  Acc none', 'Slot 2: —', 'Slot 3: —']);
        assert.equal(await page.locator('.ne-member[data-slot="0"]').getAttribute('data-chosen'), '');
        const rows = await page.locator('.ne-weapon').allTextContents();
        assert.deepEqual(rows.slice(0, 3), ['weapon #1 ×1', 'weapon #2 ×1', '—']);
        assert.equal(await enabled(page, 1), false, 'only the first spare weapon is offered');
        // A failed read changes nothing; leaving the Equip screen hides it.
        await page.evaluate(() => { window.sim.failRead = true; });
        await page.waitForTimeout(600);
        assert.equal(await visible(page), true);
        await page.evaluate(() => { window.sim.failRead = false; window.sim.open = false; });
        await until(async () => !(await visible(page)), { timeout: 3000, what: 'panel hidden when Equip closes' });
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
        assert.equal(await page.evaluate(() => window.ff7web.equipScreen.running), false);
        assert.deepEqual(await pads(page), []);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('tap the first spare weapon: Circle, 60 frames, Circle, and the change is confirmed; then taps stay off', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=native-equip');
      try {
        await until(() => visible(page), { timeout: 3000, what: 'panel shown' });
        await until(() => enabled(page, 0), { timeout: 5000, what: 'first weapon enabled once settled' });
        await page.locator('.ne-weapon[data-row="0"]').tap();
        await until(() => page.evaluate(() => window.sim.weapon[0] === 1), { timeout: 5000, what: 'weapon equipped' });
        await until(async () => (await page.locator('#native-equip .ne-msg').textContent()).startsWith('Equipped'), { timeout: 4000, what: 'change confirmed' });
        assert.equal(await page.locator('#native-equip .ne-msg').textContent(), 'Equipped: weapon #0 → #1');
        assert.deepEqual(pressed(await pads(page)), [CIRCLE, CIRCLE]);
        const gap = await page.evaluate(() => window.sim.circles[1] - window.sim.circles[0]);
        assert.ok(gap >= 60 && gap <= 70, `Circles ${gap} frames apart`);
        const last = await page.evaluate(() => window.ff7web.equipScreen.last);
        assert.equal(last.outcome, 'equipped');
        await page.waitForTimeout(600);
        assert.equal(await enabled(page, 0), false, 'the opening state is gone');
        // Close and reopen: offered again.
        await page.evaluate(() => { window.sim.open = false; });
        await until(async () => !(await visible(page)), { timeout: 3000, what: 'hidden' });
        await page.evaluate(() => { window.sim.open = true; window.sim.page = 'slot'; });
        await until(() => enabled(page, 0), { timeout: 5000, what: 'offered again after reopening' });
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('a different weapon equipped is reported as such', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=native-equip');
      try {
        await until(() => enabled(page, 0), { timeout: 5000, what: 'first weapon enabled' });
        // The game lists another weapon first (its list order is not read).
        await page.evaluate(() => { window.sim.listFirst = 3; });
        await page.locator('.ne-weapon[data-row="0"]').tap();
        await until(async () => (await page.locator('#native-equip .ne-msg').textContent()).startsWith('Changed'), { timeout: 6000, what: 'other weapon reported' });
        assert.equal(await page.locator('#native-equip .ne-msg').textContent(), 'Changed to weapon #3, not #1');
        assert.equal((await page.evaluate(() => window.ff7web.equipScreen.last)).outcome, 'other');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('nothing offered with a larger party, or after other input', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=native-equip', { party: [0, 1, null] });
      try {
        await until(() => visible(page), { timeout: 3000, what: 'panel shown' });
        await page.waitForTimeout(2500);
        assert.equal(await enabled(page, 0), false, 'party pick not read');
        assert.match(await page.locator('#native-equip .ne-msg').textContent(), /party pick/);
        // One-member party, but the player presses a classic-pad button on the
        // Equip screen. Triangle does nothing in the simulator, so the screen
        // stays open and only the mixer listener can end the opening state.
        await page.evaluate(() => { window.sim.party = [0, null, null]; });
        await page.waitForTimeout(600);
        assert.equal(await page.evaluate(() => window.ff7web.equipScreen.pristine), true, 'still the opening state before the press');
        await page.evaluate(() => { window.pads.length = 0; });
        const tri = await page.locator('[data-btn="triangle"]').boundingBox();
        await page.touchscreen.tap(tri.x + tri.width / 2, tri.y + tri.height / 2);
        await until(async () => (await pads(page)).includes(TRIANGLE), { timeout: 2000, what: 'classic pad Triangle' });
        await page.waitForTimeout(2500);
        assert.equal(await page.evaluate(() => window.sim.open), true, 'the Equip screen is still open');
        assert.equal(await visible(page), true);
        assert.equal(await page.evaluate(() => window.ff7web.equipScreen.pristine), false);
        assert.equal(await enabled(page, 0), false, 'not the opening state');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('Back presses Cross; Hide uncovers the picture until Equip closes', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=native-equip');
      try {
        await until(() => visible(page), { timeout: 3000, what: 'panel shown' });
        await page.locator('.ne-hide').tap();
        assert.equal(await visible(page), false);
        await page.waitForTimeout(600);
        assert.equal(await visible(page), false, 'stays hidden while Equip is open');
        await page.evaluate(() => { window.sim.open = false; });
        await page.waitForTimeout(600);
        await page.evaluate(() => { window.sim.open = true; });
        await until(() => visible(page), { timeout: 3000, what: 'shown again when Equip reopens' });
        await page.evaluate(() => { window.pads.length = 0; });
        await page.locator('.ne-back').tap();
        await until(() => page.evaluate(() => !window.sim.open), { timeout: 3000, what: 'Cross closed Equip' });
        assert.deepEqual(pressed(await pads(page)), [CROSS]);
        await until(async () => !(await visible(page)), { timeout: 3000, what: 'hidden' });
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    for (const [device, flags] of [
      ['iPhone 14 Pro', 'native-equip'],
      ['iPhone 14 Pro', 'native-equip,safe-layout'],
      ['iPhone 14 Pro landscape', 'native-equip'],
      ['iPhone 14 Pro landscape', 'native-equip,safe-layout'],
    ]) {
      test(`layout (${device}, ${flags}): inside the picture, 44 px targets, no page scroll`, async (t) => {
        if (skip) return t.skip(skip);
        const { context, page, errors } = await openApp(browser, `?labs=${flags}`, { device, party: [0, 1, 2] });
        try {
          await until(() => visible(page), { timeout: 3000, what: 'panel shown' });
          const box = await page.locator('#native-equip').boundingBox();
          const pic = await page.locator('#screen').boundingBox();
          assert.ok(Math.abs(box.x - pic.x) < 1 && Math.abs(box.width - pic.width) < 1, 'covers the picture width');
          assert.ok(Math.abs(box.y - pic.y) < 1 && Math.abs(box.height - pic.height) < 1, 'covers the picture height');
          for (const b of await page.locator('#native-equip .btn').all()) {
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
