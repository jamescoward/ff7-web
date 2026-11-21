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

async function openApp(browser, query, viewport = 'portrait') {
  const device = viewport === 'portrait' ? 'iPhone 14 Pro' : 'iPhone 14 Pro landscape';
  const context = await browser.newContext({ ...pw.devices[device] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/js/backend.js', (route) => route.fulfill({ contentType: 'text/javascript', body: STUB }));
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
      battleInput: async () => ({ value: { actor: 0, row: 0, targeting: null }, confirmed: true }),
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

    test('landscape: the full frame (no room for the panel there)', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=battle-crop,battle-panel', 'landscape');
      try {
        await settle(page);
        await post(page);
        assert.equal(await page.evaluate(() => window.ff7web.battleCrop.active), false);
        assert.deepEqual(await shown(page), FULL);
        assert.equal(await cropOn(page), false);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('turning to landscape mid-battle shows the full frame, and back to portrait the scene', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page } = await openApp(browser, '?labs=battle-crop,battle-panel');
      try {
        await settle(page);
        await post(page);
        assert.deepEqual(await shown(page), SCENE);
        await page.setViewportSize({ width: 852, height: 393 });
        await waitShown(page, FULL, 'full frame in landscape');
        await page.setViewportSize({ width: 393, height: 852 });
        await waitShown(page, SCENE, 'scene back in portrait');
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
