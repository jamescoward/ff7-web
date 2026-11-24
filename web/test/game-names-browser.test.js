// Tier 1 (Chromium + WebKit): Labs flag `game-names` (#260 part 2). The
// backend is stubbed: its gameNames() returns author-made tables (no game
// data), as the worker would after the hash gate passed. The native Equip
// and Materia panels show those names with the flag on; with it off, or
// before the gate passes, the labels are the ID labels exactly as before.
// The names never reach localStorage or sessionStorage.
// Original project code, GPL-2.0-or-later.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { BROWSERS, launch, loadPlaywright, serveWeb, until } from './helpers.js';

const pw = loadPlaywright();
let server;
before(async () => { server = await serveWeb(); });
after(() => server?.close());

// Author-made names at the IDs the fake screens use.
const TABLES = {
  weapon: ['Test Stick'],
  armor: ['Test Coat'],
  accessory: [],
  materia: Object.assign(Array(50).fill(''), { 49: 'Test Orb' }),
};

async function openApp(browser, query) {
  const context = await browser.newContext({ ...(pw.devices['iPhone 14 Pro'] ?? {}) });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/js/backend.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `export async function createWorkerBackend() {
      window.pads = []; window.namesAsked = 0;
      return { loaded: false, onFrameEnd() {}, setPad(m) { window.pads.push(m); },
        async gameNames() { window.namesAsked += 1; return { tables: ${JSON.stringify(TABLES)} }; } };
    }`,
  }));
  await page.goto(server.url + query);
  await page.evaluate(() => window.ff7web.ready);
  await page.evaluate(() => {
    let frame = 1000;
    setInterval(() => { frame += 1; }, 1000 / 60);
    const gear = { record: 0, weapon: 0, armor: 0, accessory: null, weaponMateria: [{ id: 49, ap: 3 }, null], armorMateria: [null, null] };
    const equipment = async (s) => (s === 0 ? { value: gear, confirmed: true } : { value: null, confirmed: true, reason: 'empty slot' });
    const eq = window.ff7web.equipScreen;
    eq.setSource({
      get frame() { return frame; },
      equipScreen: async () => ({ value: { open: true }, confirmed: true }),
      equipCursors: async () => ({ value: { slot: 0, listRow: 0, listOffset: 0 }, confirmed: true }),
      equipment,
      inventory: async () => ({ value: [], confirmed: true }),
    });
    eq.setGate({ active: true });
    const mt = window.ff7web.materiaScreen;
    mt.setSource({
      get frame() { return frame; },
      materiaCursors: async () => ({ value: { row: 0, column: 1, listRow: 0, listOffset: 0 }, confirmed: true }),
      materia: async () => ({ value: [{ slot: 2, id: 49, ap: 7 }, { slot: 5, id: 12, ap: 1 }], confirmed: true }),
      equipment,
    });
    mt.setGate({ active: true });
  });
  return { context, page, errors };
}
const texts = (page, sel) => page.locator(sel).allTextContents();
const ID_EQUIP = ['Weapon: #0', 'Armor: #0', 'Accessory: none'];
const ID_MATERIA_SLOTS = ['Wpn 1: #49', 'Wpn 2: empty'];
const ID_MATERIA = ['3. materia #49  AP 7', '6. materia #12  AP 1'];

for (const name of BROWSERS) {
  describe(`game names: ${name}`, () => {
    let browser;
    let skip;
    before(async () => {
      const r = await launch(pw, name);
      browser = r.browser;
      skip = r.skip;
    });
    after(() => browser?.close());

    test('flag off: ID labels as before, and the disc is never asked for names', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=native-equip,native-materia');
      try {
        await page.evaluate(() => window.ff7web.gameNames.setGate({ active: true }));
        await until(async () => (await texts(page, '.nm-materia')).length === 2, { timeout: 3000, what: 'materia rows' });
        assert.deepEqual(await texts(page, '.ne-slot'), ID_EQUIP);
        assert.deepEqual(await texts(page, '.ne-member'), ['Slot 1  Wpn #0  Arm #0  Acc none', 'Slot 2: —', 'Slot 3: —']);
        assert.deepEqual(await texts(page, '.nm-slot'), ID_MATERIA_SLOTS);
        assert.deepEqual(await texts(page, '.nm-materia'), ID_MATERIA);
        assert.equal(await page.evaluate(() => window.namesAsked), 0);
        assert.equal(await page.evaluate(() => window.ff7web.gameNames.names()), null);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('flag on: names after the gate passes; empty entries keep the ID label; off again restores IDs', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=native-equip,native-materia,game-names');
      try {
        await until(async () => (await texts(page, '.nm-materia')).length === 2, { timeout: 3000, what: 'materia rows' });
        assert.deepEqual(await texts(page, '.nm-materia'), ID_MATERIA, 'before the gate: ID labels');
        assert.equal(await page.evaluate(() => window.namesAsked), 0, 'nothing read before the gate');
        await page.evaluate(() => window.ff7web.gameNames.setGate({ active: true }));
        await until(async () => (await texts(page, '.nm-materia'))[0] === '3. Test Orb  AP 7', { timeout: 3000, what: 'materia name shown' });
        assert.deepEqual(await texts(page, '.nm-materia'), ['3. Test Orb  AP 7', '6. materia #12  AP 1']);
        assert.deepEqual(await texts(page, '.nm-slot'), ['Wpn 1: Test Orb', 'Wpn 2: empty']);
        await until(async () => (await texts(page, '.ne-slot'))[0] === 'Weapon: Test Stick', { timeout: 3000, what: 'equip name shown' });
        assert.deepEqual(await texts(page, '.ne-slot'), ['Weapon: Test Stick', 'Armor: Test Coat', 'Accessory: none']);
        assert.equal(await page.evaluate(() => window.namesAsked), 1);
        // Names stay in memory: not in either storage.
        const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
        assert.ok(!stored.includes('Test'), 'no name in web storage');
        await page.evaluate(() => window.ff7web.labs.setFlag('game-names', false));
        await until(async () => (await texts(page, '.nm-materia'))[0] === ID_MATERIA[0], { timeout: 3000, what: 'ID labels back' });
        assert.deepEqual(await texts(page, '.ne-slot'), ID_EQUIP);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  });
}
