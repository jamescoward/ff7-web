// Tier 1 (Chromium + WebKit): the native Equip screen (#121, Labs flag
// `native-equip`) with a three-member party (#215). A fake semantic source
// simulates the game's Equip screen opened for one member, with the
// main-menu party pick (partyPick) naming that slot, as Tier 2 saw it
// (save-boot-16a to 16d). The panel marks the picked member's row, and v2
// (#254) offers list rows for that member: the game's list holds only that
// member's weapons, which is not read, so rows are offered by index and the
// savemap read says what was equipped. Without partyPick in the source, no
// row is marked and nothing is offered. The backend is stubbed, so this
// runs without the Wasm core.
// Original project code, GPL-2.0-or-later.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { BROWSERS, launch, loadPlaywright, serveWeb, until } from './helpers.js';

const pw = loadPlaywright();
let server;
before(async () => { server = await serveWeb(); });
after(() => server?.close());

async function openApp(browser, { pick, withPick = true }) {
  const context = await browser.newContext({ ...(pw.devices['iPhone 14 Pro'] ?? {}) });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/js/backend.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: 'export async function createWorkerBackend() { window.pads = []; return { loaded: false, onFrameEnd() {}, setPad(m) { window.pads.push(m); } }; }',
  }));
  await page.goto(`${server.url}?labs=native-equip`);
  await page.evaluate(() => window.ff7web.ready);
  await page.evaluate(({ pick0, withPick0 }) => {
    const sim = { frame: 1000, pick: pick0, weapon: [0, 32, 16] };
    window.sim = sim;
    setInterval(() => { sim.frame++; }, 1000 / 60);
    const source = {
      get frame() { return sim.frame; },
      equipScreen: async () => ({ value: { open: true }, confirmed: true }),
      equipCursors: async () => ({ value: { slot: 0, listRow: 0, listOffset: 0 }, confirmed: true }),
      equipment: async (s) => ({ value: { record: s, weapon: sim.weapon[s], armor: 0, accessory: null, weaponMateria: [], armorMateria: [] }, confirmed: true }),
      inventory: async () => ({ value: [{ slot: 0, index: 129, quantity: 1, kind: 'weapon', number: 1 }], confirmed: true }),
    };
    if (withPick0) source.partyPick = async () => ({ value: sim.pick, confirmed: true });
    window.ff7web.equipScreen.setSource(source);
    window.ff7web.equipScreen.setGate({ active: true });
  }, { pick0: pick, withPick0: withPick });
  return { context, page, errors };
}
const visible = (page) => page.locator('#native-equip').isVisible();
const chosen = (page) => page.$$eval('.ne-member', (rows) => rows.filter((r) => r.hasAttribute('data-chosen')).map((r) => Number(r.dataset.slot)));

for (const name of BROWSERS) {
  describe(`native Equip screen, three-member party: ${name}`, () => {
    let browser;
    let skip;
    before(async () => {
      const r = await launch(pw, name);
      browser = r.browser;
      skip = r.skip;
    });
    after(() => browser?.close());

    test('the party pick marks the chosen member, whose rows are offered; nothing is pressed until a tap', async (t) => {
      if (skip) return t.skip(skip);
      for (const pick of [0, 1, 2]) {
        const { context, page, errors } = await openApp(browser, { pick });
        try {
          await until(() => visible(page), { timeout: 3000, what: 'panel shown' });
          await until(async () => (await chosen(page)).length === 1, { timeout: 3000, what: 'a member marked' });
          assert.deepEqual(await chosen(page), [pick]);
          await until(async () => !(await page.locator('.ne-row[data-index="0"]').isDisabled()), { timeout: 5000, what: 'list row 1 offered for the picked member' });
          assert.equal(await page.locator('.ne-slot[data-equip-slot="0"]').textContent(), `Weapon: #${[0, 32, 16][pick]}`, 'the picked member\'s slots');
          assert.deepEqual(await page.evaluate(() => window.pads.filter((m) => m !== 0)), []);
          assert.deepEqual(errors, []);
        } finally { await context.close(); }
      }
    });

    test('without a party-pick reader, no member is marked', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, { pick: 1, withPick: false });
      try {
        await until(() => visible(page), { timeout: 3000, what: 'panel shown' });
        await page.waitForTimeout(2500);
        assert.deepEqual(await chosen(page), []);
        assert.equal(await page.locator('.ne-row[data-index="0"]').isDisabled(), true, 'no member known: nothing offered');
        assert.match(await page.locator('#native-equip .ne-msg').textContent(), /not read/);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  });
}
