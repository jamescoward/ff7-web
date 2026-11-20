// Tier 1 (Chromium + WebKit): the native Equip screen (#121, Labs flag
// `native-equip`) with a three-member party (#215). A fake semantic source
// simulates the game's Equip screen opened for one member, with the
// main-menu party pick (partyPick) naming that slot, as Tier 2 saw it
// (save-boot-16a to 16d). The panel marks the picked member's row; the
// weapon tap stays off, because the game's list holds only that member's
// weapons, which is not read. Without partyPick in the source, no row is
// marked. The backend is stubbed, so this runs without the Wasm core.
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

    test('the party pick marks the chosen member; the tap stays off', async (t) => {
      if (skip) return t.skip(skip);
      for (const pick of [0, 1, 2]) {
        const { context, page, errors } = await openApp(browser, { pick });
        try {
          await until(() => visible(page), { timeout: 3000, what: 'panel shown' });
          await until(async () => (await chosen(page)).length === 1, { timeout: 3000, what: 'a member marked' });
          assert.deepEqual(await chosen(page), [pick]);
          await page.waitForTimeout(2500);
          assert.equal(await page.locator('.ne-weapon[data-row="0"]').isDisabled(), true, 'no tap for a larger party');
          assert.match(await page.locator('#native-equip .ne-msg').textContent(), /party pick/);
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
        await page.waitForTimeout(800);
        assert.deepEqual(await chosen(page), []);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  });
}
