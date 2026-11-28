// Tier 1 (Chromium + WebKit, iPhone 14 Pro profiles): the battle scene crop
// (#136, Labs flag `battle-crop`). The backend is stubbed: the test posts
// synthetic 320x240 frames and drives mode() from a fake source, and the
// battle panel (#116) and status strip (#133) from a fake semantic layer, so
// this runs without the Wasm core or any game data.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { BROWSERS, launch, loadPlaywright, serveWeb, until } from './helpers.js';

const pw = loadPlaywright();
let server;
before(async () => { server = await serveWeb(); });
after(() => server?.close());

const STUB = `export async function createWorkerBackend() {
  const listeners = new Set();
  let n = 0;
  window.pads = [];
  // Post one frame: grey everywhere (no black border for the border crop to find).
  window.pushFrame = (w = 320, h = 240) => {
    const px = new Uint32Array(w * h).fill(0xff808080);
    n += 1;
    const f = { frame: n, width: w, height: h, buffer: px.buffer };
    for (const fn of listeners) fn(f);
  };
  return { loaded: false, readMem: async () => new Uint8Array(4), get frame() { return n; },
    onFrameEnd(fn) { listeners.add(fn); return () => listeners.delete(fn); }, setPad(m) { window.pads.push(m); } };
}`;

const SCENE = { x: 0, y: 0, w: 320, h: 160 };
const FULL = { x: 0, y: 0, w: 320, h: 240 };

// The iPhone 14 Pro safe-area insets #106 uses (Home Screen web app, viewport-fit=cover).
const ZERO = { top: 0, right: 0, bottom: 0, left: 0 };
const LANDSCAPE = [
  { name: 'landscape standalone', insets: { top: 0, right: 59, bottom: 21, left: 59 }, viewport: { width: 852, height: 393 } },
  { name: 'landscape browser', insets: ZERO },
];

async function openApp(browser, query, viewport = 'portrait', { insets = ZERO, size } = {}) {
  const device = viewport === 'portrait' ? 'iPhone 14 Pro' : 'iPhone 14 Pro landscape';
  const context = await browser.newContext({ ...pw.devices[device], ...(size && { viewport: size }) });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/js/backend.js', (route) => route.fulfill({ contentType: 'text/javascript', body: STUB }));
  await page.route('**/css/app.css', async (route) => {
    const res = await route.fetch();
    const css = (await res.text()).replace(/env\(safe-area-inset-(top|right|bottom|left)\)/g, (_, side) => `${insets[side]}px`);
    await route.fulfill({ response: res, body: css });
  });
  await page.goto(server.url + query);
  await page.evaluate(() => window.ff7web.ready);
  await page.evaluate(() => {
    window.fakeMode = { mode: 'battle', confirmed: true };
    const modeNow = async () => (window.fakeMode
      ? { value: { mode: window.fakeMode.mode, raw: 0, previous: null }, confirmed: window.fakeMode.confirmed }
      : null);
    window.ff7web.battleCrop.setSource(modeNow);
    // Cloud's command menu is open, so the panel shows (when its flag is on).
    const sem = {
      frame: 1000,
      battleInput: async () => ({ value: { actor: 0, row: 0, targeting: window.fakeTargeting ?? null }, confirmed: true }),
      mode: modeNow,
      partyStatus: async () => ({ value: { hp: 271, maxHp: 314, mp: 41, maxMp: 54, limit: 100, atb: 0x8000 }, confirmed: true }),
    };
    window.ff7web.battlePanel.setSource(sem);
    window.ff7web.battlePanel.setGate({ active: true });
    window.ff7web.battleHud.setSource(sem);
    window.ff7web.battleHud.setGate({ active: true });
  });
  return { context, page, errors };
}

const setMode = (page, mode, confirmed = true) => page.evaluate((m) => { window.fakeMode = m; }, mode ? { mode, confirmed } : null);
async function post(page, n = 3) {
  await page.evaluate(async (n) => {
    for (let i = 0; i < n; i++) {
      window.pushFrame();
      await new Promise((r) => requestAnimationFrame(r));
    }
  }, n);
}
const shown = (page) => page.evaluate(() => window.ff7web.shownRect());
const canvasSize = (page) => page.evaluate(() => {
  const c = document.getElementById('screen');
  return { w: c.width, h: c.height };
});
const box = (page, sel) => page.evaluate((s) => document.querySelector(s).getBoundingClientRect().toJSON(), sel);
const settle = (page) => page.waitForTimeout(700); // several 4 Hz polls
const cropOn = (page) => page.evaluate(() => 'battleCropOn' in document.documentElement.dataset);
const waitShown = (page, want, what) => until(async () => JSON.stringify(await shown(page)) === JSON.stringify(want), { timeout: 3000, what });
const overlaps = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
// The panel, its shown buttons, and every other thing it must stay clear of:
// the picture, the top bar's buttons, the status strip, and each pad control.
const layout = (page) => page.evaluate(() => {
  const r = (el, what) => ({ what, ...el.getBoundingClientRect().toJSON() });
  const shownEls = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden');
  const others = [
    r(document.querySelector('.screen'), 'the picture'),
    ...shownEls('.bar > *').map((e) => r(e, `top bar ${e.id || e.className}`)),
    ...shownEls('#hud').map((e) => r(e, 'the status strip')),
    ...shownEls('#pad .vp-btn, #pad .vp-dpad').map((e) => r(e, `pad ${e.className}`)),
  ];
  return {
    vw: window.innerWidth,
    vh: window.innerHeight,
    scrollW: document.documentElement.scrollWidth,
    scrollH: document.documentElement.scrollHeight,
    screen: r(document.querySelector('.screen'), 'the picture'),
    panel: r(document.getElementById('battle-panel'), 'panel'),
    buttons: shownEls('#battle-panel .bp-btn').map((e) => r(e, 'button')),
    others,
  };
});

for (const name of BROWSERS) {
  describe(`battle crop: ${name}`, () => {
    let browser;
    let skip;
    before(async () => { ({ browser, skip } = await launch(pw, name)); });
    after(() => browser?.close());

    test('flag off: no poll, and a battle shows the full frame at 4:3', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=battle-panel');
      try {
        await settle(page);
        assert.equal(await page.evaluate(() => window.ff7web.battleCrop.running), false);
        await post(page);
        assert.deepEqual(await shown(page), FULL);
        assert.deepEqual(await canvasSize(page), { w: 320, h: 240 });
        const b = await box(page, '.screen');
        assert.ok(Math.abs(b.width / b.height - 4 / 3) < 0.01, `4:3 box, got ${b.width}x${b.height}`);
        assert.equal(await cropOn(page), false);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('flag on without the battle panel flag: the full frame (the game\'s command window stays)', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=battle-crop');
      try {
        await settle(page);
        assert.equal(await page.evaluate(() => window.ff7web.battleCrop.running), true);
        assert.equal(await page.evaluate(() => window.ff7web.battleCrop.active), false);
        await post(page);
        assert.deepEqual(await shown(page), FULL);
        assert.equal(await cropOn(page), false);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('both flags on, confirmed battle, portrait: the scene only, panel and strip below, no overlap', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=battle-crop,battle-panel,battle-hud');
      try {
        const before = await box(page, '.screen');
        await settle(page);
        await post(page);
        assert.deepEqual(await shown(page), SCENE);
        assert.deepEqual(await canvasSize(page), { w: 320, h: 160 });
        assert.equal(await cropOn(page), true);
        const scr = await box(page, '.screen');
        // 320x160 of 320x240 keeps the pixel aspect: 4:3 × (240/160) = 2:1.
        assert.ok(Math.abs(scr.width / scr.height - 2) < 0.01, `2:1 box, got ${scr.width}x${scr.height}`);
        assert.ok(scr.height < before.height - 40, 'the picture gives up height');
        await until(() => page.locator('#battle-panel').isVisible(), { timeout: 3000, what: 'the battle panel shows' });
        await until(() => page.locator('#hud').isVisible(), { timeout: 3000, what: 'the status strip shows' });
        const panel = await box(page, '#battle-panel');
        const hud = await box(page, '#hud');
        assert.ok(hud.top >= scr.bottom - 0.5, `strip below the picture (${hud.top} vs ${scr.bottom})`);
        assert.ok(panel.top >= scr.bottom - 0.5, `panel below the picture (${panel.top} vs ${scr.bottom})`);
        assert.ok(panel.top >= hud.bottom - 0.5, 'panel below the strip');
        for (const b of await page.locator('#battle-panel .bp-btn:visible').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
          assert.ok(b.height >= 44 && b.width >= 44, `≥44 px button, got ${b.width}x${b.height}`);
        }
        const scrollX = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(scrollX <= 0, 'no horizontal scroll');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    for (const [mode, confirmed] of [['field', true], ['menu', true], ['movie', true], ['world', true], ['unknown', true], ['battle', false], [null, true]]) {
      const what = mode === null ? 'a failed read' : `${mode}${confirmed ? '' : ' (unconfirmed)'}`;
      test(`leaving the battle (${what}): the full frame at once, with no new frame posted`, async (t) => {
        if (skip) return t.skip(skip);
        const { context, page, errors } = await openApp(browser, '?labs=battle-crop,battle-panel');
        try {
          await settle(page);
          await post(page);
          assert.deepEqual(await shown(page), SCENE);
          await setMode(page, mode, confirmed);
          await waitShown(page, FULL, 'full frame after leaving the battle');
          assert.deepEqual(await canvasSize(page), { w: 320, h: 240 });
          assert.equal(await cropOn(page), false);
          const b = await box(page, '.screen');
          assert.ok(Math.abs(b.width / b.height - 4 / 3) < 0.01, `4:3 again, got ${b.width}x${b.height}`);
          // Back in a confirmed battle: the scene crop again.
          await setMode(page, 'battle');
          await waitShown(page, SCENE, 'scene again in battle');
          assert.deepEqual(errors, []);
        } finally { await context.close(); }
      });
    }

    test('switching either flag off mid-battle shows the full frame at once', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page } = await openApp(browser, '?labs=battle-crop,battle-panel');
      try {
        await settle(page);
        await post(page);
        assert.deepEqual(await shown(page), SCENE);
        await page.evaluate(() => window.ff7web.labs.setFlag('battle-panel', false));
        await waitShown(page, FULL, 'full frame with the panel flag off');
        await page.evaluate(() => window.ff7web.labs.setFlag('battle-panel', true));
        await waitShown(page, SCENE, 'scene with the panel flag back on');
        await page.evaluate(() => window.ff7web.labs.setFlag('battle-crop', false));
        await waitShown(page, FULL, 'full frame with the crop flag off');
        assert.equal(await page.evaluate(() => window.ff7web.battleCrop.running), false);
      } finally { await context.close(); }
    });

    // #235: landscape crops too; the panel is one row in the band below the picture.
    for (const prof of LANDSCAPE) {
      for (const safe of [false, true]) {
        const label = `${prof.name}${safe ? ', safe-layout' : ''}`;
        test(`landscape (${label}): the scene crop, and the panel in a row below the picture, clear of every control`, async (t) => {
          if (skip) return t.skip(skip);
          const q = `?labs=battle-crop,battle-panel,battle-hud${safe ? ',safe-layout' : ''}`;
          const { context, page, errors } = await openApp(browser, q, 'landscape', { insets: prof.insets, size: prof.viewport });
          try {
            // The same page outside battle: the scroll size the crop and panel must not add to.
            // (Without safe-layout, the landscape browser profile already overflows by Start/Select's
            // 17 px today; safe-layout, #152, fixes that, and there the test asks for no scroll at all.)
            await setMode(page, 'field');
            await settle(page);
            await post(page);
            const base = await layout(page);
            if (safe) assert.ok(base.scrollW <= base.vw && base.scrollH <= base.vh, 'safe-layout: no scroll outside battle');
            await setMode(page, 'battle');
            await settle(page);
            await post(page);
            assert.equal(await page.evaluate(() => window.ff7web.battleCrop.active), true);
            assert.deepEqual(await shown(page), SCENE);
            assert.equal(await cropOn(page), true);
            const scr = await box(page, '.screen');
            assert.ok(Math.abs(scr.width / scr.height - 2) < 0.01, `2:1 box, got ${scr.width}x${scr.height}`);
            for (const view of ['command', 'targeting']) {
              await page.evaluate((v) => { window.fakeTargeting = v === 'targeting' ? { index: 4 } : null; }, view);
              await until(() => page.evaluate((v) => {
                const p = document.getElementById('battle-panel');
                return p.dataset.view === v && getComputedStyle(p).display !== 'none';
              }, view), { timeout: 3000, what: `the panel shows the ${view} view` });
              const m = await layout(page);
              assert.equal(m.buttons.length, 4, `four ${view} buttons in one row`);
              for (const b of m.buttons) {
                assert.ok(b.height >= 44 && b.width >= 44, `≥44 px button, got ${b.width}x${b.height}`);
                assert.ok(Math.abs(b.top - m.buttons[0].top) < 0.5, 'one row');
                assert.ok(b.left >= 0 && b.right <= m.vw && b.top >= 0 && b.bottom <= m.vh, `button inside the viewport (${JSON.stringify(b)})`);
              }
              assert.ok(m.panel.top >= m.screen.bottom - 0.5, `panel below the picture (${m.panel.top} vs ${m.screen.bottom})`);
              for (const o of m.others) {
                assert.ok(!overlaps(m.panel, o), `panel ${JSON.stringify(m.panel)} overlaps ${o.what} ${JSON.stringify(o)}`);
              }
              assert.ok(m.scrollW <= m.vw && m.scrollH <= Math.max(m.vh, base.scrollH), `no scroll added (${m.scrollW}x${m.scrollH} in ${m.vw}x${m.vh}; ${base.scrollH} outside battle)`);
            }
            assert.deepEqual(errors, []);
          } finally { await context.close(); }
        });
      }
    }

    test('landscape: leaving the battle restores the full-frame layout at once, with no new frame posted', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=battle-crop,battle-panel', 'landscape');
      try {
        await setMode(page, 'field');
        await settle(page);
        await post(page);
        const full = await box(page, '.screen');
        await setMode(page, 'battle');
        await waitShown(page, SCENE, 'the scene in battle');
        await until(() => page.locator('#battle-panel').isVisible(), { timeout: 3000, what: 'the battle panel shows' });
        await setMode(page, 'field');
        await waitShown(page, FULL, 'full frame after leaving the battle');
        assert.equal(await cropOn(page), false);
        assert.deepEqual(await box(page, '.screen'), full, 'the picture is back to its full-frame box');
        await until(async () => !(await page.locator('#battle-panel').isVisible()), { timeout: 3000, what: 'the panel hides' });
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('turning the phone mid-battle keeps the scene, and the panel moves between below-the-strip and the landscape row', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page } = await openApp(browser, '?labs=battle-crop,battle-panel');
      try {
        await settle(page);
        await post(page);
        assert.deepEqual(await shown(page), SCENE);
        await until(() => page.locator('#battle-panel').isVisible(), { timeout: 3000, what: 'the battle panel shows' });
        await page.setViewportSize({ width: 852, height: 393 });
        await post(page, 1);
        assert.deepEqual(await shown(page), SCENE);
        let m = await layout(page);
        assert.ok(m.panel.top >= m.screen.bottom - 0.5 && m.panel.bottom <= 393, 'landscape: the row below the picture');
        assert.equal(new Set(m.buttons.map((b) => Math.round(b.top))).size, 1, 'landscape: one row');
        await page.setViewportSize({ width: 393, height: 852 });
        await post(page, 1);
        assert.deepEqual(await shown(page), SCENE);
        m = await layout(page);
        assert.ok(m.panel.top >= m.screen.bottom - 0.5, 'portrait: the panel below the picture');
        assert.equal(new Set(m.buttons.map((b) => Math.round(b.top))).size, 2, 'portrait: two rows, as before');
      } finally { await context.close(); }
    });

    test('with the border crop on too, a battle uses the scene rectangle', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page } = await openApp(browser, '?labs=battle-crop,battle-panel,border-crop');
      try {
        await page.evaluate(() => window.ff7web.borderCrop.setSource(async () => ({ value: { mode: 'battle', raw: 0, previous: null }, confirmed: true })));
        await settle(page);
        await post(page, 80);
        assert.deepEqual(await shown(page), SCENE);
      } finally { await context.close(); }
    });

    test('with safe-layout on: the panel stays below the picture and the page has no horizontal scroll', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=battle-crop,battle-panel,battle-hud,safe-layout');
      try {
        await settle(page);
        await post(page);
        assert.deepEqual(await shown(page), SCENE);
        await until(() => page.locator('#battle-panel').isVisible(), { timeout: 3000, what: 'the battle panel shows' });
        const scr = await box(page, '.screen');
        const panel = await box(page, '#battle-panel');
        assert.ok(panel.top >= scr.bottom - 0.5, `panel below the picture (${panel.top} vs ${scr.bottom})`);
        assert.ok(Math.abs(scr.width / scr.height - 2) < 0.01, `2:1 box, got ${scr.width}x${scr.height}`);
        const scrollX = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(scrollX <= 0, 'no horizontal scroll');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  });
}
