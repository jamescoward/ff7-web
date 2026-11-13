// Tier 1 (Chromium + WebKit): battle command panel (#116) with a fake semantic
// source simulating battleInput() (command cursor of 4 rows, target selection).
// The backend is stubbed, so this runs without the Wasm core. Also checks the
// visible panel's layout (44 px, overlap, scroll) in portrait, with the battle
// status strip and safe-layout on and off, and that it is hidden in landscape.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { BROWSERS, launch, loadPlaywright, serveWeb, until } from './helpers.js';

const pw = loadPlaywright();
let server;
before(async () => { server = await serveWeb(); });
after(() => server?.close());

const UP = 1 << 4;
const DOWN = 1 << 5;
const LEFT = 1 << 6;
const RIGHT = 1 << 7;
const CIRCLE = 1 << 8;
const CROSS = 1 << 0;

async function openApp(browser, query, device = 'iPhone 14 Pro', start = { actor: 0, targeting: null }) {
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
    // A simulated battle menu: 60 frames a second; a fresh Up/Down press moves
    // the command cursor (4 rows), Circle enters target selection, and there
    // Left/Right move the target, Circle takes it and Cross goes back.
    const sim = { frame: 1000, row: 0, actor: st.actor, targeting: st.targeting, prev: 0 };
    window.sim = sim;
    setInterval(() => {
      const cur = window.pads.length ? window.pads[window.pads.length - 1] : 0;
      const rising = cur & ~sim.prev;
      sim.prev = cur;
      if (sim.actor !== null && !sim.targeting) {
        if (rising & (1 << 5)) sim.row = (sim.row + 1) % 4;
        if (rising & (1 << 4)) sim.row = (sim.row + 3) % 4;
        if (rising & (1 << 8)) sim.targeting = { index: 4 };
      } else if (sim.targeting) {
        if (rising & (1 << 6)) sim.targeting = { index: sim.targeting.index - 1 };
        if (rising & (1 << 7)) sim.targeting = { index: sim.targeting.index + 1 };
        if (rising & (1 << 8)) { sim.targeting = null; sim.actor = null; }
        if (rising & (1 << 0)) sim.targeting = null;
      }
      sim.frame++;
    }, 1000 / 60);
    const sem = {
      get frame() { return sim.frame; },
      battleInput: async () => ({ value: { actor: sim.actor, row: sim.actor === 0 ? sim.row : null, targeting: sim.targeting }, confirmed: true }),
      mode: async () => ({ value: { mode: 'battle' }, confirmed: true }),
      partyStatus: async () => ({ value: { hp: 271, maxHp: 314, mp: 41, maxMp: 54, limit: 100, atb: 0x8000 }, confirmed: true }),
    };
    window.ff7web.battlePanel.setSource(sem);
    window.ff7web.battlePanel.setGate({ active: true });
    window.ff7web.battleHud.setSource(sem); // shown only when its flag is on
    window.ff7web.battleHud.setGate({ active: true });
  }, start);
  return { context, page, errors };
}
const pads = (page) => page.evaluate(() => window.pads.slice());
const visible = (page) => page.locator('#battle-panel').isVisible();
const view = (page) => page.locator('#battle-panel').getAttribute('data-view');

for (const name of BROWSERS) {
  describe(`battle panel: ${name}`, () => {
    let browser;
    let skip;
    before(async () => {
      const r = await launch(pw, name);
      browser = r.browser;
      skip = r.skip;
    });
    after(() => browser?.close());

    test('shown with a command menu open: four generic rows; hidden when it closes', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=battle-panel', 'iPhone 14 Pro', { actor: null, targeting: null });
      try {
        await page.waitForTimeout(400);
        assert.equal(await visible(page), false);
        await page.evaluate(() => { window.sim.actor = 0; });
        await until(() => visible(page), { timeout: 3000, what: 'panel shown' });
        assert.equal(await view(page), 'command');
        assert.deepEqual(await page.locator('.bp-commands button:visible').allTextContents(), ['Command 1', 'Command 2', 'Command 3', 'Command 4']);
        assert.equal(await page.locator('.bp-targets button:visible').count(), 0);
        await page.evaluate(() => { window.sim.actor = null; });
        await until(async () => !(await visible(page)), { timeout: 3000, what: 'panel hidden' });
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('flag off: no panel and no polling', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '');
      try {
        await page.waitForTimeout(400);
        assert.equal(await visible(page), false);
        assert.equal(await page.evaluate(() => window.ff7web.battlePanel.running), false);
        assert.deepEqual(await pads(page), []);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('a row tap plans there and presses Circle; targeting buttons then press Right, Cross', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=battle-panel');
      try {
        await until(() => visible(page), { timeout: 3000, what: 'panel shown' });
        await page.locator('.bp-btn[data-row="2"]').tap();
        await until(async () => (await pads(page)).includes(CIRCLE), { timeout: 5000, what: 'Circle pressed' });
        await page.waitForTimeout(300);
        assert.deepEqual((await pads(page)).filter((m) => m !== 0), [DOWN, DOWN, CIRCLE]);
        assert.equal((await pads(page)).at(-1), 0);
        assert.equal(await page.evaluate(() => window.sim.row), 2);
        await until(async () => (await view(page)) === 'targeting', { timeout: 3000, what: 'targeting view' });
        assert.deepEqual(await page.locator('.bp-targets button:visible').allTextContents(), ['◀ Prev', 'Next ▶', 'Confirm ○', 'Back ✕']);
        await page.evaluate(() => { window.pads.length = 0; });
        await page.locator('.bp-btn[data-action="next"]').tap();
        await until(async () => (await pads(page)).length >= 2, { timeout: 3000, what: 'Right press' });
        assert.deepEqual(await pads(page), [RIGHT, 0]);
        await page.waitForTimeout(150);
        await page.locator('.bp-btn[data-action="prev"]').tap();
        await until(async () => (await pads(page)).length >= 4, { timeout: 3000, what: 'Left press' });
        assert.deepEqual(await pads(page), [RIGHT, 0, LEFT, 0]);
        await page.waitForTimeout(150);
        await page.locator('.bp-btn[data-action="back"]').tap();
        await until(async () => (await view(page)) === 'command', { timeout: 3000, what: 'back to commands' });
        assert.deepEqual((await pads(page)).slice(4, 6), [CROSS, 0]);
        // Row 2 to row 0 without wrapping: two Ups.
        await page.evaluate(() => { window.pads.length = 0; });
        await page.locator('.bp-btn[data-row="0"]').tap();
        await until(async () => (await pads(page)).includes(CIRCLE), { timeout: 5000, what: 'Circle pressed' });
        assert.deepEqual((await pads(page)).filter((m) => m !== 0), [UP, UP, CIRCLE]);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('another slot acting (row not confirmed): rows greyed and send nothing', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=battle-panel', 'iPhone 14 Pro', { actor: 1, targeting: null });
      try {
        await until(() => visible(page), { timeout: 3000, what: 'panel shown' });
        await until(() => page.locator('.bp-btn[data-row="1"]').isDisabled(), { timeout: 3000, what: 'rows disabled' });
        await page.locator('.bp-btn[data-row="1"]').tap({ force: true });
        await page.waitForTimeout(300);
        assert.deepEqual(await pads(page), []);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    for (const extra of ['', '&labs=battle-panel,battle-hud', '&labs=battle-panel,safe-layout', '&labs=battle-panel,battle-hud,safe-layout']) {
      test(`portrait layout with the panel up${extra}: 44 px targets, no overlap, no horizontal scroll`, async (t) => {
        if (skip) return t.skip(skip);
        const query = extra ? `?${extra.slice(1)}` : '?labs=battle-panel';
        for (const start of [{ actor: 0, targeting: null }, { actor: 0, targeting: { index: 4 } }]) {
          const { context, page, errors } = await openApp(browser, query, 'iPhone 14 Pro', start);
          try {
            await until(() => visible(page), { timeout: 3000, what: 'panel shown' });
            await until(async () => (await view(page)) === (start.targeting ? 'targeting' : 'command'), { timeout: 3000, what: 'view' });
            if (query.includes('battle-hud')) await until(() => page.locator('#hud').isVisible(), { timeout: 3000, what: 'battle strip shown' });
            const m = await page.evaluate(() => {
              const rect = (el) => el.getBoundingClientRect().toJSON();
              const shown = (el) => el.getClientRects().length > 0;
              const panel = rect(document.getElementById('battle-panel'));
              const btns = [...document.querySelectorAll('#battle-panel button')].filter(shown).map(rect);
              const others = [...document.querySelectorAll('.vp-btn, .vp-dpad, #labs-btn, #controls-btn, summary, #status, #hud')]
                .filter(shown).map(rect);
              return { panel, btns, others, screen: rect(document.getElementById('screen')), scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth };
            });
            if (query.includes('battle-hud')) assert.ok(m.others.some((o) => o.height > 0 && o.y >= m.screen.y + m.screen.height - 1 && o.y < m.panel.y), 'the battle strip shows above the panel');
            assert.equal(m.btns.length, 4);
            for (const r of m.btns) {
              assert.ok(r.width >= 44 && r.height >= 44, `button ${r.width}x${r.height} is under 44 px`);
              assert.ok(r.x >= -0.5 && r.x + r.width <= m.innerW + 0.5, 'button inside the viewport width');
            }
            for (let i = 0; i < m.btns.length; i++) {
              for (let j = i + 1; j < m.btns.length; j++) {
                const a = m.btns[i];
                const b = m.btns[j];
                assert.ok(!(a.x < b.x + b.width - 0.01 && b.x < a.x + a.width - 0.01 && a.y < b.y + b.height - 0.01 && b.y < a.y + a.height - 0.01), `buttons ${i} and ${j} overlap`);
              }
            }
            for (const o of m.others) {
              if (!o.width) continue;
              const hit = m.panel.x < o.x + o.width && o.x < m.panel.x + m.panel.width && m.panel.y < o.y + o.height && o.y < m.panel.y + m.panel.height;
              assert.ok(!hit, `panel overlaps another element at ${Math.round(o.x)},${Math.round(o.y)}`);
            }
            assert.ok(m.panel.y >= m.screen.y + m.screen.height - 1, 'panel is below the picture');
            assert.ok(m.scrollW <= m.innerW, 'no horizontal scroll');
            assert.deepEqual(errors, []);
          } finally { await context.close(); }
        }
      });
    }

    test('landscape: the panel is hidden (no free space beside the picture)', async (t) => {
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
