// Tier 1 (Chromium + WebKit): the battle status strip (#133) with a fake
// semantic source. The backend is stubbed, so this runs without the Wasm core.
// Layout: with the strip shown, on the iPhone 14 Pro profiles of #106, it sits
// below the picture inside the viewport and covers neither the picture nor any
// control, and every pad control stays on screen (with and without
// `safe-layout`). In landscape it stays hidden.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { BROWSERS, launch, loadPlaywright, serveWeb, until } from './helpers.js';

const pw = loadPlaywright();
let server;
before(async () => { server = await serveWeb(); });
after(() => server?.close());

// The iPhone 14 Pro safe-area insets #106 uses (Home Screen web app, viewport-fit=cover).
const INSETS = {
  portrait: { top: 59, right: 0, bottom: 34, left: 0 },
  landscape: { top: 0, right: 59, bottom: 21, left: 59 },
};
const ZERO = { top: 0, right: 0, bottom: 0, left: 0 };
const PROFILES = [
  { name: 'portrait standalone', device: 'iPhone 14 Pro', insets: INSETS.portrait, viewport: { width: 393, height: 852 } },
  { name: 'portrait browser', device: 'iPhone 14 Pro', insets: ZERO },
  { name: 'landscape standalone', device: 'iPhone 14 Pro landscape', insets: INSETS.landscape, viewport: { width: 852, height: 393 } },
  { name: 'landscape browser', device: 'iPhone 14 Pro landscape', insets: ZERO },
];
const TOL = 1;
const STATUS = [
  { hp: 271, maxHp: 314, mp: 41, maxMp: 54, limit: 100, atb: 0x8000 },
  { hp: 300, maxHp: 333, mp: 20, maxMp: 27, limit: 255, atb: 0xffff },
  { hp: 222, maxHp: 250, mp: 33, maxMp: 44, limit: 200, atb: 0 },
];

async function openApp(browser, query, { device, viewport, insets = ZERO } = {}) {
  const options = device ? { ...pw.devices[device], ...(viewport && { viewport }) } : { viewport: { width: 390, height: 844 }, hasTouch: true };
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/js/backend.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: 'export async function createWorkerBackend() { return { loaded: false, onFrameEnd() {}, setPad() {} }; }',
  }));
  await page.route('**/css/app.css', async (route) => {
    const res = await route.fetch();
    const css = (await res.text()).replace(/env\(safe-area-inset-(top|right|bottom|left)\)/g, (_, side) => `${insets[side]}px`);
    await route.fulfill({ response: res, body: css });
  });
  await page.goto(server.url + query);
  await page.evaluate(() => window.ff7web.ready);
  // The fake source: window.fake holds the mode and the three partyStatus results.
  await page.evaluate((status) => {
    window.fake = {
      mode: 'battle',
      modeConfirmed: true,
      slots: status.map((value) => ({ value, confirmed: true })),
    };
    window.ff7web.battleHud.setSource({
      mode: async () => ({ value: { mode: window.fake.mode, raw: 0, previous: null }, confirmed: window.fake.modeConfirmed }),
      partyStatus: async (slot) => structuredClone(window.fake.slots[slot]),
    });
  }, STATUS);
  return { context, page, errors };
}

const hudShown = (page) => page.evaluate(() => !document.getElementById('hud').hidden && getComputedStyle(document.getElementById('hud')).display !== 'none');
const rowsShown = (page) => page.evaluate(() => [...document.querySelectorAll('#hud .hud-row')].filter((r) => !r.hidden).map((r) => Number(r.dataset.slot)));
const cellText = (page, slot, key) => page.evaluate(([s, k]) => {
  const c = document.querySelector(`#hud .hud-row[data-slot="${s}"] .hud-cell[data-key="${k}"]`);
  return c && !c.hidden ? { num: c.querySelector('.hud-num').textContent, fill: c.querySelector('.hud-fill').style.width, full: c.hasAttribute('data-full') } : null;
}, [slot, key]);
const waitShown = (page, want, what) => until(async () => (await hudShown(page)) === want, { timeout: 3000, what });
const SETTLE = 800; // several 4 Hz polls

const rect = (page, sel) => page.evaluate((s) => document.querySelector(s).getBoundingClientRect().toJSON(), sel);
const intersects = (a, b) => a.x < b.x + b.width - TOL && b.x < a.x + a.width - TOL && a.y < b.y + b.height - TOL && b.y < a.y + a.height - TOL;
const fmt = (r) => `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`;

for (const name of BROWSERS) {
  describe(`battle hud: ${name}`, () => {
    let browser;
    let skip;
    before(async () => {
      const r = await launch(pw, name);
      browser = r.browser;
      skip = r.skip;
    });
    after(() => browser?.close());

    test('flag on: the strip shows only in a confirmed battle', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=battle-hud');
      try {
        assert.equal(await hudShown(page), false, 'hidden before the gate opens');
        await page.evaluate(() => window.ff7web.battleHud.setGate({ active: true }));
        await waitShown(page, true, 'strip in battle');
        assert.deepEqual(await rowsShown(page), [0, 1, 2]);
        assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-hud-on')), true);
        for (const mode of ['field', 'menu', 'world', 'movie', 'unknown']) {
          await page.evaluate((m) => { window.fake.mode = m; }, mode);
          await waitShown(page, false, `hidden in ${mode}`);
          await page.evaluate(() => { window.fake.mode = 'battle'; });
          await waitShown(page, true, 'back in battle');
        }
        await page.evaluate(() => { window.fake.modeConfirmed = false; });
        await waitShown(page, false, 'hidden in an unconfirmed battle');
        assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-hud-on')), false);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('values and bars follow the source', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=battle-hud');
      try {
        await page.evaluate(() => window.ff7web.battleHud.setGate({ active: true }));
        await waitShown(page, true, 'strip');
        assert.deepEqual(await cellText(page, 0, 'hp'), { num: '271/314', fill: '86%', full: false });
        assert.deepEqual(await cellText(page, 0, 'mp'), { num: '41/54', fill: '76%', full: false });
        assert.deepEqual(await cellText(page, 0, 'atb'), { num: '50%', fill: '50%', full: false });
        assert.deepEqual(await cellText(page, 0, 'limit'), { num: '39%', fill: '39%', full: false });
        assert.deepEqual(await cellText(page, 1, 'atb'), { num: '100%', fill: '100%', full: true });
        assert.deepEqual(await cellText(page, 1, 'limit'), { num: '100%', fill: '100%', full: true });
        assert.deepEqual(await cellText(page, 2, 'atb'), { num: '0%', fill: '0%', full: false });
        await page.evaluate(() => { window.fake.slots[0].value.hp = 157; window.fake.slots[0].value.atb = 0xffff; });
        await until(async () => (await cellText(page, 0, 'hp'))?.num === '157/314', { timeout: 3000, what: 'hp follows' });
        assert.deepEqual(await cellText(page, 0, 'hp'), { num: '157/314', fill: '50%', full: false });
        assert.deepEqual(await cellText(page, 0, 'atb'), { num: '100%', fill: '100%', full: true });
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('an unconfirmed field, an empty slot and an unconfirmed slot are left out', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=battle-hud');
      try {
        await page.evaluate(() => {
          window.fake.slots[0].value.mp = null; // partyStatus gives null for an unconfirmed entry
          window.fake.slots[0].value.atb = null;
          window.fake.slots[1] = { value: null, confirmed: true, reason: 'empty slot' };
          window.fake.slots[2].confirmed = false;
          window.ff7web.battleHud.setGate({ active: true });
        });
        await waitShown(page, true, 'strip');
        assert.deepEqual(await rowsShown(page), [0]);
        assert.equal(await cellText(page, 0, 'mp'), null, 'mp hidden');
        assert.equal(await cellText(page, 0, 'atb'), null, 'atb hidden');
        assert.equal((await cellText(page, 0, 'hp')).num, '271/314');
        assert.equal((await cellText(page, 0, 'limit')).num, '39%');
        // Nothing confirmed in any slot: no strip at all.
        await page.evaluate(() => { window.fake.slots[0] = { value: null, confirmed: false, reason: 'read failed' }; });
        await waitShown(page, false, 'no rows, no strip');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('flag off: no strip, no polling', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '');
      try {
        await page.evaluate(() => window.ff7web.battleHud.setGate({ active: true }));
        await page.waitForTimeout(SETTLE);
        assert.equal(await hudShown(page), false);
        assert.equal(await page.evaluate(() => window.ff7web.battleHud.running), false);
        // Switching it on in the Labs panel starts it; off again hides it.
        await page.click('#labs-btn');
        await page.check('input[data-flag="battle-hud"]');
        await waitShown(page, true, 'on from the panel');
        await page.uncheck('input[data-flag="battle-hud"]');
        await waitShown(page, false, 'off from the panel');
        assert.equal(await page.evaluate(() => window.ff7web.battleHud.running), false);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    for (const profile of PROFILES) {
      for (const flags of ['battle-hud', 'battle-hud,safe-layout', 'battle-hud,auto-controls,safe-layout']) {
        test(`layout with the strip in battle: ${profile.name}, flags ${flags}`, async (t) => {
          if (skip) return t.skip(skip);
          const { context, page, errors } = await openApp(browser, `?labs=${flags}`, profile);
          try {
            await page.evaluate(() => window.ff7web.battleHud.setGate({ active: true }));
            const vp = page.viewportSize();
            if (vp.width > vp.height) {
              await page.waitForTimeout(SETTLE);
              assert.equal(await hudShown(page), false, 'portrait only');
            } else {
              await waitShown(page, true, 'strip');
              const hud = await rect(page, '#hud');
              const canvas = await rect(page, '#screen');
              assert.ok(hud.y >= canvas.y + canvas.height - TOL, `strip ${fmt(hud)} is below the picture ${fmt(canvas)}`);
              assert.ok(hud.x >= -TOL && hud.x + hud.width <= vp.width + TOL && hud.y + hud.height <= vp.height - profile.insets.bottom + TOL,
                `strip ${fmt(hud)} inside the viewport ${vp.width}x${vp.height}`);
              assert.ok(Math.abs(canvas.width / canvas.height - 4 / 3) * canvas.height <= TOL + 0.5, `picture ${fmt(canvas)} keeps 4:3`);
              // The strip's text does not overflow its rows.
              const overflow = await page.evaluate(() => [...document.querySelectorAll('#hud .hud-top')].some((e) => e.scrollWidth > e.clientWidth + 1));
              assert.equal(overflow, false, 'numbers fit their cells');
              const controls = await page.evaluate(() => [...document.querySelectorAll('.bar > .btn, .bar summary, #pad .vp-btn, #pad .vp-dpad, #field button')]
                .filter((e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed')
                .map((e) => ({ id: e.id || e.className, r: e.getBoundingClientRect().toJSON() }))
                .filter((c) => c.r.width > 0 && c.r.height > 0));
              assert.ok(controls.length >= 8, `found controls (${controls.length})`);
              for (const c of controls) {
                assert.ok(!intersects(hud, c.r), `strip ${fmt(hud)} overlaps ${c.id} ${fmt(c.r)}`);
              }
              if (flags.includes('safe-layout')) {
                // safe-layout's promise: the whole pad fits on screen, strip or not.
                for (const c of controls) {
                  assert.ok(c.r.y + c.r.height <= vp.height - profile.insets.bottom + TOL, `${c.id} ${fmt(c.r)} below the fold (${vp.height})`);
                }
                assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1), true, 'no vertical scroll');
              }
            }
            assert.deepEqual(errors, []);
          } finally { await context.close(); }
        });
      }
    }
  });
}
