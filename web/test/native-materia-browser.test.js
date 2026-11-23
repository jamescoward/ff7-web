// Tier 1 (Chromium + WebKit): the native Materia screen (#250, Labs flag
// `native-materia`) with a fake semantic source that simulates the game's
// Materia screen as Tier 2 saw it (#244, #246, #248): the slot cursor moves
// with Left/Right (columns 0-1) and Down/Up (weapon/armor row); Circle opens
// the list with its cursor on row 0, offset 0; in the list Down moves the
// row to 9 and then scrolls, Up moves the row first; Circle on a filled
// list index moves that inventory slot's materia into the slot under the
// slot cursor and closes the list; Cross closes the list, or the screen.
// The backend is stubbed, so this runs without the Wasm core. Also checks
// the visible panel's layout (44 px targets, inside the picture, no page
// scroll) in portrait and landscape.
// Original project code, GPL-2.0-or-later.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { BROWSERS, launch, loadPlaywright, serveWeb, until } from './helpers.js';
import { materiaColumnPlan, materiaListPlan } from '../js/semantic/materia-screen.js';
import { PAD } from '../js/pad.js';

const pw = loadPlaywright();
let server;
before(async () => { server = await serveWeb(); });
after(() => server?.close());

const CROSS = PAD.cross;
const CIRCLE = PAD.circle;

/** The pad masks a tap on column `col` then inventory slot `slot` should send, from the screen's opening state. */
const expected = (col, slot) => [
  ...materiaColumnPlan(0, col).steps.map((s) => PAD[s.button]),
  CIRCLE,
  ...materiaListPlan({ row: 0, offset: 0 }, slot).steps.map((s) => PAD[s.button]),
  CIRCLE,
];

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
    // Materia (ID 49) in inventory slots 2, 7 and 13 (AP = slot), as save-boot-27a.
    const sim = {
      frame: 1000, prev: 0, open: open0, list: false, row: 0, column: 0, listRow: 0, listOffset: 0,
      failRead: false, party: party0, freezeList: false,
      weapon: [null, null], armor: [null, null],
      inv: new Map([[2, { id: 49, ap: 2 }], [7, { id: 49, ap: 7 }], [13, { id: 49, ap: 13 }]]),
    };
    window.sim = sim;
    const B = { cross: 1 << 0, circle: 1 << 8, up: 1 << 4, down: 1 << 5, left: 1 << 6, right: 1 << 7 };
    setInterval(() => {
      const cur = window.pads.length ? window.pads[window.pads.length - 1] : 0;
      const rising = cur & ~sim.prev;
      sim.prev = cur;
      if (sim.open && rising) {
        if (!sim.list) {
          if (rising & B.right) sim.column = Math.min(1, sim.column + 1);
          if (rising & B.left) sim.column = Math.max(0, sim.column - 1);
          if (rising & B.down) sim.row = 1;
          if (rising & B.up) sim.row = 0;
          if (rising & B.circle) { sim.list = true; sim.listRow = 0; sim.listOffset = 0; }
          if (rising & B.cross) sim.open = false;
        } else {
          if ((rising & B.down) && !sim.freezeList) { if (sim.listRow < 9) sim.listRow++; else sim.listOffset++; }
          if ((rising & B.up) && !sim.freezeList) { if (sim.listRow > 0) sim.listRow--; else if (sim.listOffset > 0) sim.listOffset--; }
          if (rising & B.circle) {
            const slot = sim.listOffset + sim.listRow;
            const m = sim.inv.get(slot);
            if (m) {
              const target = sim.row === 0 ? sim.weapon : sim.armor;
              const old = target[sim.column];
              target[sim.column] = m;
              sim.inv.delete(slot);
              if (old) sim.inv.set(slot, old);
              sim.list = false;
            }
          }
          if (rising & B.cross) sim.list = false;
        }
      }
      sim.frame++;
    }, 1000 / 60);
    const screen = window.ff7web.materiaScreen;
    const none = { row: null, column: null, listRow: null, listOffset: null };
    screen.setSource({
      get frame() { return sim.frame; },
      materiaCursors: async () => {
        if (sim.failRead) return { value: null, confirmed: false, reason: 'read failed' };
        if (!sim.open) return { value: none, confirmed: true, reason: 'not the Materia screen' };
        return { value: { row: sim.row, column: sim.column, listRow: sim.list ? sim.listRow : 0, listOffset: sim.list ? sim.listOffset : 0 }, confirmed: true };
      },
      materia: async () => ({ value: [...sim.inv].sort((a, b) => a[0] - b[0]).map(([slot, m]) => ({ slot, ...m })), confirmed: true }),
      equipment: async (s) => (sim.party[s] === null
        ? { value: null, confirmed: true, reason: 'empty slot' }
        : {
          value: { record: sim.party[s], weapon: 0, armor: 0, accessory: null, weaponMateria: s === 0 ? sim.weapon.slice() : [null, null], armorMateria: s === 0 ? sim.armor.slice() : [null, null] },
          confirmed: true,
        }),
    });
    screen.setGate({ active: true });
  }, { open0: open, party0: party });
  return { context, page, errors };
}
const pads = (page) => page.evaluate(() => window.pads.slice());
const visible = (page) => page.locator('#native-materia').isVisible();
const pressed = (list) => list.filter((m) => m !== 0);
const materiaBtn = (page, slot) => page.locator(`.nm-materia[data-slot="${slot}"]`);
const enabled = async (page, slot) => !(await materiaBtn(page, slot).isDisabled());
const msgText = (page) => page.locator('#native-materia .nm-msg').textContent();

for (const name of BROWSERS) {
  describe(`native Materia screen: ${name}`, () => {
    let browser;
    let skip;
    before(async () => {
      const r = await launch(pw, name);
      browser = r.browser;
      skip = r.skip;
    });
    after(() => browser?.close());

    test('shown only while the Materia screen is open: weapon slots and the inventory materia', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=native-materia', { open: false });
      try {
        await page.waitForTimeout(400);
        assert.equal(await visible(page), false);
        await page.evaluate(() => { window.sim.open = true; });
        await until(() => visible(page), { timeout: 3000, what: 'panel shown on the Materia screen' });
        assert.deepEqual(await page.locator('.nm-slot').allTextContents(), ['Wpn 1: empty', 'Wpn 2: empty']);
        assert.deepEqual(await page.locator('.nm-materia').allTextContents(), ['3. materia #49  AP 2', '8. materia #49  AP 7', '14. materia #49  AP 13']);
        assert.equal(await page.locator('.nm-slot[data-column="0"]').getAttribute('data-chosen'), '', 'the first empty slot is chosen');
        // A failed read changes nothing; leaving the Materia screen hides it.
        await page.evaluate(() => { window.sim.failRead = true; });
        await page.waitForTimeout(600);
        assert.equal(await visible(page), true);
        await page.evaluate(() => { window.sim.failRead = false; window.sim.open = false; });
        await until(async () => !(await visible(page)), { timeout: 3000, what: 'panel hidden when Materia closes' });
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
        assert.equal(await page.evaluate(() => window.ff7web.materiaScreen.running), false);
        assert.deepEqual(await pads(page), []);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('weapon slot 2, then the materia in slot 13: the planner\'s own presses, and the move is confirmed', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=native-materia');
      try {
        await until(() => visible(page), { timeout: 3000, what: 'panel shown' });
        await page.locator('.nm-slot[data-column="1"]').tap();
        await until(() => enabled(page, 13), { timeout: 5000, what: 'materia enabled once settled' });
        await materiaBtn(page, 13).tap();
        await until(async () => (await msgText(page)).startsWith('Equipped'), { timeout: 15000, what: 'move confirmed' });
        assert.equal(await msgText(page), 'Equipped: materia #49 → weapon slot 2');
        assert.deepEqual(await page.evaluate(() => [window.sim.weapon[1], window.sim.inv.has(13)]), [{ id: 49, ap: 13 }, false]);
        assert.deepEqual(pressed(await pads(page)), expected(1, 13));
        const last = await page.evaluate(() => window.ff7web.materiaScreen.last);
        assert.equal(last.outcome, 'equipped');
        // The filled slot is no longer offered; the other one is chosen.
        await until(async () => (await page.locator('.nm-slot[data-column="1"]').textContent()) === 'Wpn 2: #49', { timeout: 3000, what: 'slot label' });
        assert.equal(await page.locator('.nm-slot[data-column="1"]').isDisabled(), true);
        assert.equal(await page.evaluate(() => window.ff7web.materiaScreen.column), 0);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('a list cursor that does not move stops the tap before the second Circle', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=native-materia');
      try {
        await until(() => enabled(page, 7), { timeout: 5000, what: 'materia enabled' });
        await page.evaluate(() => { window.sim.freezeList = true; });
        await materiaBtn(page, 7).tap();
        await until(async () => (await msgText(page)).startsWith('Stopped'), { timeout: 8000, what: 'stopped' });
        const last = await page.evaluate(() => window.ff7web.materiaScreen.last);
        assert.equal(last.ok, false);
        assert.equal(last.error.phase, 'list');
        const circles = pressed(await pads(page)).filter((m) => m === CIRCLE).length;
        assert.equal(circles, 1, 'only the Circle that opens the list');
        assert.deepEqual(await page.evaluate(() => [window.sim.weapon[0], window.sim.inv.has(7)]), [null, true]);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('nothing offered with a larger party, or off the weapon row', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=native-materia', { party: [0, 1, null] });
      try {
        await until(() => visible(page), { timeout: 3000, what: 'panel shown' });
        await page.waitForTimeout(2500);
        assert.equal(await enabled(page, 2), false, 'party pick not read');
        assert.match(await msgText(page), /more than one member/);
        await page.evaluate(() => { window.sim.party = [0, null, null]; window.sim.row = 1; });
        await page.waitForTimeout(800);
        assert.equal(await enabled(page, 2), false, 'cursor on the armor row');
        assert.match(await msgText(page), /weapon row/);
        await page.evaluate(() => { window.sim.row = 0; });
        await until(() => enabled(page, 2), { timeout: 3000, what: 'offered on the weapon row' });
        assert.deepEqual(await pads(page), []);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('Back presses Cross; Hide uncovers the picture until Materia closes', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=native-materia');
      try {
        await until(() => visible(page), { timeout: 3000, what: 'panel shown' });
        await page.locator('.nm-hide').tap();
        assert.equal(await visible(page), false);
        await page.waitForTimeout(600);
        assert.equal(await visible(page), false, 'stays hidden while Materia is open');
        await page.evaluate(() => { window.sim.open = false; });
        await page.waitForTimeout(600);
        await page.evaluate(() => { window.sim.open = true; });
        await until(() => visible(page), { timeout: 3000, what: 'shown again when Materia reopens' });
        await page.evaluate(() => { window.pads.length = 0; });
        await page.locator('.nm-back').tap();
        await until(() => page.evaluate(() => !window.sim.open), { timeout: 3000, what: 'Cross closed Materia' });
        assert.deepEqual(pressed(await pads(page)), [CROSS]);
        await until(async () => !(await visible(page)), { timeout: 3000, what: 'hidden' });
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    for (const [device, flags] of [
      ['iPhone 14 Pro', 'native-materia'],
      ['iPhone 14 Pro', 'native-materia,safe-layout'],
      ['iPhone 14 Pro landscape', 'native-materia'],
      ['iPhone 14 Pro landscape', 'native-materia,safe-layout'],
    ]) {
      test(`layout (${device}, ${flags}): inside the picture, 44 px targets, no page scroll`, async (t) => {
        if (skip) return t.skip(skip);
        const { context, page, errors } = await openApp(browser, `?labs=${flags}`, { device });
        try {
          await until(() => visible(page), { timeout: 3000, what: 'panel shown' });
          await until(async () => (await page.locator('.nm-materia').count()) === 3, { timeout: 3000, what: 'materia rows' });
          const box = await page.locator('#native-materia').boundingBox();
          const pic = await page.locator('#screen').boundingBox();
          assert.ok(Math.abs(box.x - pic.x) < 1 && Math.abs(box.width - pic.width) < 1, 'covers the picture width');
          assert.ok(Math.abs(box.y - pic.y) < 1 && Math.abs(box.height - pic.height) < 1, 'covers the picture height');
          for (const b of await page.locator('#native-materia .btn').all()) {
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
