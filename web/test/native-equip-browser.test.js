// Tier 1 (Chromium + WebKit): the native Equip screen (#121 v1, #254 v2;
// Labs flag `native-equip`) with a fake semantic source that simulates the
// game's Equip screen as Tier 2 saw it: it opens on the slot page (#121);
// Up and Down move the slot cursor 0-2 (#216 18a); Circle opens that slot's
// list on row 0, offset 0; Down moves the list row, then scrolls past row 7
// (#216 18b); Circle on the list equips its entry and returns to the slot
// page. The simulated list holds the spares of that kind in inventory slot
// order (a model, not a claim about the game). Cross on the slot page
// closes the screen. The expected presses come from the semantic planners,
// not hand-written sequences. The backend is stubbed, so this runs without
// the Wasm core. Also checks the visible panel's layout (44 px targets,
// inside the picture, no page scroll) in portrait and landscape, with
// safe-layout on and off.
// Original project code, GPL-2.0-or-later.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { equipListPlan, equipSlotPlan } from '../../semantic/equip-screen.js';
import { BROWSERS, launch, loadPlaywright, serveWeb, until } from './helpers.js';

const pw = loadPlaywright();
let server;
before(async () => { server = await serveWeb(); });
after(() => server?.close());

const CROSS = 1 << 0;
const CIRCLE = 1 << 8;
const TRIANGLE = 1 << 9;
const masks = (plan) => plan.steps.map((s) => s.mask);

async function openApp(browser, query, { device = 'iPhone 14 Pro', open = true, party = [0, null, null], pick } = {}) {
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
  await page.evaluate(({ open0, party0, pick0 }) => {
    // A simulated Equip screen at 60 frames a second. Spares: slot 0 weapon
    // 1, slot 3 weapon 2, slot 4 armor 5, slot 5 armor 6, slot 6 accessory 3;
    // slot 1 holds an item.
    const KINDS = ['weapon', 'armor', 'accessory'];
    const sim = {
      frame: 1000, prev: 0, open: open0, page: 'slot', failRead: false, circles: [],
      party: party0, pick: pick0, slot: 0, row: 0, offset: 0, stuckList: false, alsoChange: false,
      gear: [{ weapon: 0, armor: 0, accessory: null }, { weapon: 5, armor: 1, accessory: null }, { weapon: 7, armor: 2, accessory: null }],
      inv: new Map([[0, { kind: 'weapon', number: 1, quantity: 1 }], [1, { kind: 'item', number: 0, quantity: 3 }], [3, { kind: 'weapon', number: 2, quantity: 1 }],
        [4, { kind: 'armor', number: 5, quantity: 1 }], [5, { kind: 'armor', number: 6, quantity: 1 }], [6, { kind: 'accessory', number: 3, quantity: 1 }]]),
    };
    window.sim = sim;
    const member = () => (Number.isInteger(sim.pick) ? sim.pick : sim.party.findIndex((r) => r !== null));
    const list = () => [...sim.inv].sort((a, b) => a[0] - b[0]).filter(([, it]) => it.kind === KINDS[sim.slot]);
    setInterval(() => {
      const cur = window.pads.length ? window.pads[window.pads.length - 1] : 0;
      const rising = cur & ~sim.prev;
      sim.prev = cur;
      if (sim.open) {
        if (rising & (1 << 8)) sim.circles.push(sim.frame);
        if (sim.page === 'slot') {
          if (rising & (1 << 8)) { sim.page = 'list'; sim.row = 0; sim.offset = 0; }
          else if (rising & (1 << 0)) sim.open = false;
          else if (rising & (1 << 5)) sim.slot = Math.min(2, sim.slot + 1);
          else if (rising & (1 << 4)) sim.slot = Math.max(0, sim.slot - 1);
        } else if (sim.page === 'list') {
          if (rising & (1 << 5) && !sim.stuckList) {
            if (sim.row < 7) sim.row++; else sim.offset++;
          } else if (rising & (1 << 8)) {
            const e = list()[sim.row + sim.offset];
            const m = member();
            const kind = KINDS[sim.slot];
            if (e) {
              const [slot, it] = e;
              const old = sim.gear[m][kind];
              sim.gear[m][kind] = it.number;
              sim.inv.delete(slot);
              if (old !== null) sim.inv.set(20 + slot, { kind, number: old, quantity: 1 });
              if (sim.alsoChange) sim.gear[(m + 1) % 3].weapon += 1;
            }
            sim.page = 'slot';
          } else if (rising & (1 << 0)) sim.page = 'slot';
        }
      }
      sim.frame++;
    }, 1000 / 60);
    const screen = window.ff7web.equipScreen;
    const source = {
      get frame() { return sim.frame; },
      equipScreen: async () => (sim.failRead ? { value: null, confirmed: false, reason: 'read failed' } : { value: { open: sim.open }, confirmed: true }),
      equipCursors: async () => ({ value: sim.open ? { slot: sim.slot, listRow: sim.page === 'list' ? sim.row : 0, listOffset: sim.page === 'list' ? sim.offset : 0 } : { slot: null, listRow: null, listOffset: null }, confirmed: true }),
      equipment: async (s) => (sim.party[s] === null
        ? { value: null, confirmed: true, reason: 'empty slot' }
        : { value: { record: sim.party[s], ...sim.gear[s], weaponMateria: [], armorMateria: [] }, confirmed: true }),
      inventory: async () => ({
        value: [...sim.inv].sort((a, b) => a[0] - b[0]).map(([slot, it]) => ({ slot, index: 128 + it.number, quantity: it.quantity, kind: it.kind, number: it.number })),
        confirmed: true,
      }),
    };
    if (pick0 !== undefined) source.partyPick = async () => ({ value: sim.pick, confirmed: true });
    screen.setSource(source);
    screen.setGate({ active: true });
  }, { open0: open, party0: party, pick0: pick });
  return { context, page, errors };
}
const pads = (page) => page.evaluate(() => window.pads.slice());
const visible = (page) => page.locator('#native-equip').isVisible();
const pressed = (list) => list.filter((m) => m !== 0);
const row = (page, index) => page.locator(`.ne-row[data-index="${index}"]`);
const enabled = async (page, index) => (await row(page, index).count()) > 0 && !(await row(page, index).isDisabled());
const msgText = (page) => page.locator('#native-equip .ne-msg').textContent();
// A "not offered" check: the row must be drawn (exactly one), and disabled.
// `enabled() === false` alone would also pass if the panel drew no rows (#267).
async function disabledRow(page, index) {
  assert.equal(await row(page, index).count(), 1, `list row ${index + 1} is drawn`);
  return row(page, index).isDisabled();
}

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

    test('shown only while the Equip screen is open: member rows, slots and list rows', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=native-equip', { open: false });
      try {
        await page.waitForTimeout(400);
        assert.equal(await visible(page), false);
        await page.evaluate(() => { window.sim.open = true; });
        await until(() => visible(page), { timeout: 3000, what: 'panel shown on the Equip screen' });
        assert.deepEqual(await page.locator('.ne-member').allTextContents(), ['Slot 1  Wpn #0  Arm #0  Acc none', 'Slot 2: —', 'Slot 3: —']);
        assert.equal(await page.locator('.ne-member[data-slot="0"]').getAttribute('data-chosen'), '');
        assert.deepEqual(await page.locator('.ne-slot').allTextContents(), ['Weapon: #0', 'Armor: #0', 'Accessory: none']);
        assert.equal(await page.locator('.ne-slot[data-equip-slot="0"]').getAttribute('data-chosen'), '', 'the game\'s slot is chosen first');
        assert.deepEqual(await page.locator('.ne-row').allTextContents(), ['List row 1', 'List row 2'], 'one row per spare weapon');
        await page.locator('.ne-slot[data-equip-slot="2"]').tap();
        assert.deepEqual(await page.locator('.ne-row').allTextContents(), ['List row 1'], 'one spare accessory');
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

    test('v1\'s tap: Weapon, list row 1 is Circle, 60 frames, Circle, and the change is confirmed', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=native-equip');
      try {
        await until(() => visible(page), { timeout: 3000, what: 'panel shown' });
        await until(() => enabled(page, 0), { timeout: 5000, what: 'list row 1 enabled once settled' });
        await row(page, 0).tap();
        await until(() => page.evaluate(() => window.sim.gear[0].weapon === 1), { timeout: 5000, what: 'weapon equipped' });
        await until(async () => (await msgText(page)).startsWith('Equipped'), { timeout: 4000, what: 'change confirmed' });
        assert.equal(await msgText(page), 'Equipped: weapon #0 → #1');
        assert.deepEqual(pressed(await pads(page)), [CIRCLE, CIRCLE]);
        const gap = await page.evaluate(() => window.sim.circles[1] - window.sim.circles[0]);
        assert.ok(gap >= 60 && gap <= 70, `Circles ${gap} frames apart`);
        const last = await page.evaluate(() => window.ff7web.equipScreen.last);
        assert.equal(last.outcome, 'equipped');
        // Back on the slot page after the panel's own tap: offered again.
        assert.equal(await page.evaluate(() => window.ff7web.equipScreen.slotPage), true);
        await until(() => enabled(page, 0), { timeout: 3000, what: 'offered again' });
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('Armor, list row 2: exactly the planners\' presses, then the savemap read', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=native-equip');
      try {
        await until(() => enabled(page, 0), { timeout: 5000, what: 'panel ready' });
        await page.locator('.ne-slot[data-equip-slot="1"]').tap();
        await until(() => enabled(page, 1), { timeout: 3000, what: 'armor row 2 enabled' });
        await row(page, 1).tap();
        await until(async () => (await msgText(page)).startsWith('Equipped'), { timeout: 8000, what: 'armor equipped' });
        assert.equal(await msgText(page), 'Equipped: armor #0 → #6');
        const expected = [...masks(equipSlotPlan(0, 1)), CIRCLE, ...masks(equipListPlan({ row: 0, offset: 0 }, 1)), CIRCLE];
        assert.deepEqual(pressed(await pads(page)), expected);
        assert.deepEqual(await page.evaluate(() => window.sim.gear[0]), { weapon: 0, armor: 6, accessory: null });
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('a list past page 1: the plan scrolls (row 7, then the offset)', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=native-equip');
      try {
        await page.evaluate(() => { for (let i = 0; i < 10; i++) window.sim.inv.set(30 + i, { kind: 'armor', number: 10 + i, quantity: 1 }); });
        await until(() => visible(page), { timeout: 3000, what: 'panel shown' });
        await page.locator('.ne-slot[data-equip-slot="1"]').tap();
        await until(() => enabled(page, 9), { timeout: 5000, what: 'armor row 10 enabled' });
        await row(page, 9).tap();
        await until(async () => (await msgText(page)).startsWith('Equipped'), { timeout: 10000, what: 'armor equipped' });
        // Inventory order: armor 5, 6, then 10.. (slots 30+); index 9 is armor 17.
        assert.equal(await msgText(page), 'Equipped: armor #0 → #17');
        const expected = [...masks(equipSlotPlan(0, 1)), CIRCLE, ...masks(equipListPlan({ row: 0, offset: 0 }, 9)), CIRCLE];
        assert.deepEqual(pressed(await pads(page)), expected);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('a cursor that does not move stops input: no Circle on the list', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=native-equip');
      try {
        await until(() => enabled(page, 1), { timeout: 5000, what: 'weapon row 2 enabled' });
        await page.evaluate(() => { window.sim.stuckList = true; });
        await row(page, 1).tap();
        await until(async () => (await msgText(page)).startsWith('Stopped'), { timeout: 6000, what: 'stopped' });
        await page.waitForTimeout(500);
        const down = masks(equipListPlan({ row: 0, offset: 0 }, 1))[0];
        assert.deepEqual(pressed(await pads(page)), [CIRCLE, down], 'the list Circle is never sent');
        assert.equal(await page.evaluate(() => window.sim.gear[0].weapon), 0);
        const last = await page.evaluate(() => window.ff7web.equipScreen.last);
        assert.equal(last.ok, false);
        assert.equal(last.error.phase, 'list');
        assert.equal(await disabledRow(page, 0), true, 'the page is not known after a stop');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('another change seen is reported as such', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=native-equip', { party: [0, 1, 2], pick: 0 });
      try {
        await until(() => enabled(page, 0), { timeout: 5000, what: 'row 1 enabled' });
        await page.evaluate(() => { window.sim.alsoChange = true; });
        await row(page, 0).tap();
        await until(async () => (await msgText(page)).startsWith('Something else'), { timeout: 6000, what: 'other change reported' });
        assert.equal((await page.evaluate(() => window.ff7web.equipScreen.last)).outcome, 'other');
        assert.equal(await disabledRow(page, 0), true, 'the page is not known after an unexpected change');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    // v1's reopen path (#267): after a stop or an unexpected change the page
    // is not known; closing Equip resets the panel, and reopening it is the
    // opening state again (slotPage = canWatch), so the rows are offered.
    // A stop needs a Down on the list, so it taps weapon row 2.
    for (const [what, setup, outcome, index] of [
      ['a stop', () => { window.sim.stuckList = true; }, 'Stopped', 1],
      ['an unexpected change', () => { window.sim.alsoChange = true; }, 'Something else', 0],
    ]) {
      test(`after ${what}, closing and reopening Equip offers the rows again`, async (t) => {
        if (skip) return t.skip(skip);
        const { context, page, errors } = await openApp(browser, '?labs=native-equip', { party: [0, 1, 2], pick: 0 });
        try {
          await until(() => enabled(page, index), { timeout: 5000, what: 'row enabled' });
          await page.evaluate(setup);
          await row(page, index).tap();
          await until(async () => (await msgText(page)).startsWith(outcome), { timeout: 6000, what: outcome });
          assert.equal(await disabledRow(page, index), true, `not offered after ${what}`);
          // The player leaves the Equip screen and opens it again.
          await page.evaluate(() => { Object.assign(window.sim, { open: false, stuckList: false, alsoChange: false }); });
          await until(async () => !(await visible(page)), { timeout: 3000, what: 'panel hidden when Equip closes' });
          assert.equal(await page.evaluate(() => window.ff7web.equipScreen.last), null, 'the stop is cleared on close');
          await page.evaluate(() => { Object.assign(window.sim, { open: true, page: 'slot', slot: 0, row: 0, offset: 0 }); });
          await until(() => visible(page), { timeout: 3000, what: 'panel shown when Equip reopens' });
          await until(() => enabled(page, index), { timeout: 5000, what: 'row offered again on reopen' });
          assert.equal(await page.evaluate(() => window.ff7web.equipScreen.slotPage), true);
          // And the offered tap works: weapon row 1 is equipped.
          const before = await page.evaluate(() => window.sim.gear[0].weapon);
          await row(page, index).tap();
          await until(async () => (await msgText(page)).startsWith('Equipped'), { timeout: 6000, what: 'equipped after reopen' });
          assert.notEqual(await page.evaluate(() => window.sim.gear[0].weapon), before);
          assert.deepEqual(errors, []);
        } finally { await context.close(); }
      });
    }

    test('nothing offered without a known member, or after other input', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=native-equip', { party: [0, 1, null] });
      try {
        await until(() => visible(page), { timeout: 3000, what: 'panel shown' });
        await page.waitForTimeout(2500);
        assert.equal(await disabledRow(page, 0), true, 'party pick not read');
        assert.match(await msgText(page), /not read/);
        // One-member party, but the player presses a classic-pad button on the
        // Equip screen. Triangle does nothing in the simulator, so the screen
        // stays open and only the mixer listener can end the known page.
        await page.evaluate(() => { window.sim.party = [0, null, null]; });
        await until(() => enabled(page, 0), { timeout: 3000, what: 'offered for a party of one' });
        assert.equal(await page.evaluate(() => window.ff7web.equipScreen.pristine), true, 'still the opening state before the press');
        await page.evaluate(() => { window.pads.length = 0; });
        const tri = await page.locator('[data-btn="triangle"]').boundingBox();
        await page.touchscreen.tap(tri.x + tri.width / 2, tri.y + tri.height / 2);
        await until(async () => (await pads(page)).includes(TRIANGLE), { timeout: 2000, what: 'classic pad Triangle' });
        await page.waitForTimeout(2500);
        assert.equal(await page.evaluate(() => window.sim.open), true, 'the Equip screen is still open');
        assert.equal(await visible(page), true);
        assert.equal(await page.evaluate(() => window.ff7web.equipScreen.pristine), false);
        assert.equal(await disabledRow(page, 0), true, 'not the opening state');
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
