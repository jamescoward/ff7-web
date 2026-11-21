// Tier 1 (Chromium + WebKit, iPhone 14 Pro profile): the mode-gated border crop
// (#24, Labs flag `border-crop`). The backend is stubbed: the test posts
// synthetic frames (a grey box on black) and drives mode() from a fake source,
// so this runs without the Wasm core or any game data.
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
  // Post one 320x240 frame: grey inside the given insets, black outside.
  window.pushFrame = (ins, w = 320, h = 240) => {
    const px = new Uint32Array(w * h).fill(0xff000000);
    for (let y = ins.top; y < h - ins.bottom; y++) {
      for (let x = ins.left; x < w - ins.right; x++) px[y * w + x] = 0xff808080;
    }
    n += 1;
    const f = { frame: n, width: w, height: h, buffer: px.buffer };
    for (const fn of listeners) fn(f);
  };
  return { loaded: false, readMem: async () => new Uint8Array(4), get frame() { return n; },
    onFrameEnd(fn) { listeners.add(fn); return () => listeners.delete(fn); }, setPad() {} };
}`;

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
    window.fakeMode = { mode: 'field', confirmed: true };
    window.ff7web.borderCrop.setSource(async () => (window.fakeMode
      ? { value: { mode: window.fakeMode.mode, raw: 0, previous: null }, confirmed: window.fakeMode.confirmed }
      : null));
  });
  return { context, page, errors };
}

const BOX = { top: 24, right: 32, bottom: 24, left: 32 };
const FULL = { x: 0, y: 0, w: 320, h: 240 };
const setMode = (page, mode, confirmed = true) => page.evaluate((m) => { window.fakeMode = m; }, mode ? { mode, confirmed } : null);
// Post `n` frames of the box, one per animation frame, so each is drawn.
async function post(page, n, ins = BOX) {
  await page.evaluate(async ({ n, ins }) => {
    for (let i = 0; i < n; i++) {
      window.pushFrame(ins);
      await new Promise((r) => requestAnimationFrame(r));
    }
  }, { n, ins });
}
const shown = (page) => page.evaluate(() => window.ff7web.shownRect());
const canvasSize = (page) => page.evaluate(() => {
  const c = document.getElementById('screen');
  return { w: c.width, h: c.height };
});
const screenBox = (page) => page.evaluate(() => document.querySelector('.screen').getBoundingClientRect().toJSON());
const settle = (page) => page.waitForTimeout(700); // several 4 Hz polls

for (const name of BROWSERS) {
  describe(`border crop: ${name}`, () => {
    let browser;
    let skip;
    before(async () => { ({ browser, skip } = await launch(pw, name)); });
    after(() => browser?.close());

    test('flag off: no poll, every frame is drawn in full at 4:3', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '');
      try {
        await settle(page);
        assert.equal(await page.evaluate(() => window.ff7web.borderCrop.running), false);
        await post(page, 90);
        assert.deepEqual(await shown(page), FULL);
        assert.deepEqual(await canvasSize(page), { w: 320, h: 240 });
        const b = await screenBox(page);
        assert.ok(Math.abs(b.width / b.height - 4 / 3) < 0.01, `4:3 box, got ${b.width}x${b.height}`);
        assert.equal(await page.evaluate(() => 'borderCropOn' in document.documentElement.dataset), false);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('flag on, confirmed field: full frame first, the box after ~1 s, and a larger picture', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=border-crop');
      try {
        const before = await screenBox(page);
        await settle(page);
        assert.equal(await page.evaluate(() => window.ff7web.borderCrop.allowed), true);
        await post(page, 30);
        assert.deepEqual(await shown(page), FULL, 'not before the stability delay');
        await post(page, 50);
        assert.deepEqual(await shown(page), { x: 32, y: 24, w: 256, h: 192 });
        assert.deepEqual(await canvasSize(page), { w: 256, h: 192 });
        // The crop keeps the pixel aspect: 256x192 of 320x240 is still 4:3.
        const b = await screenBox(page);
        assert.ok(Math.abs(b.width / b.height - 4 / 3) < 0.01);
        assert.deepEqual(errors, []);
        assert.ok(before.width > 0);
      } finally { await context.close(); }
    });

    test('flag on: content at the edge widens on the same frame', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page } = await openApp(browser, '?labs=border-crop');
      try {
        await settle(page);
        await post(page, 80);
        assert.deepEqual(await shown(page), { x: 32, y: 24, w: 256, h: 192 });
        await post(page, 1, { top: 8, right: 0, bottom: 8, left: 0 });
        assert.deepEqual(await shown(page), { x: 0, y: 8, w: 320, h: 224 });
      } finally { await context.close(); }
    });

    test('flag on: battle limits apply (sides are never cropped)', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page } = await openApp(browser, '?labs=border-crop');
      try {
        await setMode(page, 'battle');
        await settle(page);
        await post(page, 80);
        assert.deepEqual(await shown(page), { x: 0, y: 16, w: 320, h: 208 });
      } finally { await context.close(); }
    });

    for (const [mode, confirmed] of [['menu', true], ['movie', true], ['world', true], ['unknown', true], ['field', false], [null, true]]) {
      const what = mode === null ? 'a failed read' : `${mode}${confirmed ? '' : ' (unconfirmed)'}`;
      test(`flag on, ${what}: the full frame, and a crop in the field widens at once`, async (t) => {
        if (skip) return t.skip(skip);
        const { context, page, errors } = await openApp(browser, '?labs=border-crop');
        try {
          await settle(page);
          await post(page, 80);
          assert.deepEqual(await shown(page), { x: 32, y: 24, w: 256, h: 192 }, 'cropped in the field first');
          await setMode(page, mode, confirmed);
          await settle(page);
          // Redrawn at once on the mode change, with no new frame.
          assert.deepEqual(await shown(page), FULL);
          await post(page, 90);
          assert.deepEqual(await shown(page), FULL);
          assert.deepEqual(await canvasSize(page), { w: 320, h: 240 });
          assert.equal(await page.evaluate(() => 'borderCropOn' in document.documentElement.dataset), false);
          // Back in the field the crop starts again from the full frame.
          await setMode(page, 'field');
          await settle(page);
          await post(page, 30);
          assert.deepEqual(await shown(page), FULL);
          await post(page, 50);
          assert.deepEqual(await shown(page), { x: 32, y: 24, w: 256, h: 192 });
          assert.deepEqual(errors, []);
        } finally { await context.close(); }
      });
    }

    test('switching the flag off in the panel shows the full frame at once', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page } = await openApp(browser, '?labs=border-crop');
      try {
        await settle(page);
        await post(page, 80);
        assert.deepEqual(await shown(page), { x: 32, y: 24, w: 256, h: 192 });
        await page.evaluate(() => window.ff7web.labs.setFlag('border-crop', false));
        await until(async () => (await shown(page)).w === 320, { timeout: 2000, what: 'full frame' });
        assert.deepEqual(await shown(page), FULL);
        assert.equal(await page.evaluate(() => window.ff7web.borderCrop.running), false);
      } finally { await context.close(); }
    });

    test('letterbox crop in portrait: a wider, shorter box at the same width', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page } = await openApp(browser, '?labs=border-crop');
      try {
        const full = await screenBox(page);
        await settle(page);
        await post(page, 80, { top: 40, right: 0, bottom: 40, left: 0 });
        assert.deepEqual(await shown(page), { x: 0, y: 40, w: 320, h: 160 });
        const b = await screenBox(page);
        assert.ok(Math.abs(b.width - full.width) < 1, `same width: ${b.width} vs ${full.width}`);
        assert.ok(Math.abs(b.width / b.height - 2) < 0.02, `crop aspect 2:1 (4:3 over 160/240), got ${b.width / b.height}`);
      } finally { await context.close(); }
    });

    test('landscape: the picture stays inside the viewport with a letterbox crop', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page } = await openApp(browser, '?labs=border-crop', 'landscape');
      try {
        await settle(page);
        await post(page, 80, { top: 40, right: 0, bottom: 40, left: 0 });
        assert.deepEqual(await shown(page), { x: 0, y: 40, w: 320, h: 160 });
        const vp = page.viewportSize();
        const b = await screenBox(page);
        assert.ok(b.x >= -1 && b.x + b.width <= vp.width + 1, `inside the viewport: ${JSON.stringify(b)}`);
        const scroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
        assert.equal(scroll, true, 'no horizontal scroll');
      } finally { await context.close(); }
    });
  });
}
