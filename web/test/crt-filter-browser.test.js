// Tier 1 (Chromium + WebKit, iPhone 14 Pro profiles): the CRT filter (#251,
// Labs flag `crt-filter`). The backend is stubbed: the test posts synthetic
// frames whose rows each have their own grey level, and drives mode() from a
// fake source for the crops, so this runs without the Wasm core or any game data.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { BROWSERS, launch, loadPlaywright, serveWeb, until } from './helpers.js';

const pw = loadPlaywright();
let server;
before(async () => { server = await serveWeb(); });
after(() => server?.close());

// Row y of a frame is grey level lv(y) inside the insets, black outside. The
// stub keeps a copy of the last frame's bytes, to check nothing wrote to it.
const STUB = `export async function createWorkerBackend() {
  const listeners = new Set();
  let n = 0;
  window.lv = (y) => 40 + ((y * 37) % 200);
  window.pushFrame = (ins = { top: 0, right: 0, bottom: 0, left: 0 }, w = 320, h = 240) => {
    const px = new Uint32Array(w * h).fill(0xff000000);
    for (let y = ins.top; y < h - ins.bottom; y++) {
      const v = window.lv(y);
      for (let x = ins.left; x < w - ins.right; x++) px[y * w + x] = 0xff000000 | (v << 16) | (v << 8) | v;
    }
    n += 1;
    const f = { frame: n, width: w, height: h, buffer: px.buffer };
    window.lastPosted = { f, copy: new Uint8Array(px.buffer.slice(0)) };
    for (const fn of listeners) fn(f);
  };
  return { loaded: false, readMem: async () => new Uint8Array(4), get frame() { return n; },
    onFrameEnd(fn) { listeners.add(fn); return () => listeners.delete(fn); }, setPad() {} };
}`;

const ZERO = { top: 0, right: 0, bottom: 0, left: 0 };
const BOX = { top: 24, right: 32, bottom: 24, left: 32 };

async function openApp(browser, query, viewport = 'portrait', mode = 'field') {
  const device = viewport === 'portrait' ? 'iPhone 14 Pro' : 'iPhone 14 Pro landscape';
  const context = await browser.newContext({ ...pw.devices[device] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/js/backend.js', (route) => route.fulfill({ contentType: 'text/javascript', body: STUB }));
  await page.goto(server.url + query);
  await page.evaluate(() => window.ff7web.ready);
  await page.evaluate((m) => {
    window.fakeMode = { mode: m, confirmed: true };
    const modeNow = async () => ({ value: { mode: window.fakeMode.mode, raw: 0, previous: null }, confirmed: true });
    window.ff7web.borderCrop.setSource(modeNow);
    window.ff7web.battleCrop.setSource(modeNow);
  }, mode);
  return { context, page, errors };
}

async function post(page, n = 3, ins = ZERO) {
  await page.evaluate(async ({ n, ins }) => {
    for (let i = 0; i < n; i++) {
      window.pushFrame(ins);
      await new Promise((r) => requestAnimationFrame(r));
    }
    await new Promise((r) => requestAnimationFrame(r));
  }, { n, ins });
}

// What the canvas holds: its size, and per output row the R value of a few
// columns (left edge, middle, right edge) plus whether the row is uniform.
const canvasRows = (page) => page.evaluate(() => {
  const c = document.getElementById('screen');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const rows = [];
  for (let y = 0; y < c.height; y++) {
    const at = (x) => d[(y * c.width + x) * 4];
    let uniform = true;
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (d[i] !== at(0) || d[i + 1] !== d[i] || d[i + 2] !== d[i]) { uniform = false; break; }
    }
    rows.push({ v: at(0), uniform });
  }
  return { w: c.width, h: c.height, rows };
});
const frameUnchanged = (page) => page.evaluate(() => {
  const { f, copy } = window.lastPosted;
  const now = new Uint8Array(f.buffer);
  return now.length === copy.length && now.every((b, i) => b === copy[i]);
});
const screenBox = (page) => page.evaluate(() => document.querySelector('.screen').getBoundingClientRect().toJSON());

// Each source row k of the shown rectangle (starting at source row y0) is two
// output rows: the first exactly the source, the second dimmed by `dim`.
function assertScanlines(got, { w, h, y0 = 0, dim }) {
  assert.equal(got.w, w * 2);
  assert.equal(got.h, h * 2);
  for (let k = 0; k < h; k++) {
    const v = 40 + (((y0 + k) * 37) % 200);
    const top = got.rows[2 * k];
    const low = got.rows[2 * k + 1];
    assert.ok(top.uniform && low.uniform, `output rows ${2 * k}/${2 * k + 1} are uniform grey`);
    assert.equal(top.v, v, `output row ${2 * k} is source row ${y0 + k} as it is`);
    const want = v * (1 - dim);
    assert.ok(Math.abs(low.v - want) <= 1.5, `output row ${2 * k + 1}: ${low.v}, want ≈${want.toFixed(1)} (source row ${y0 + k} dimmed)`);
  }
}

for (const name of BROWSERS) {
  describe(`CRT filter: ${name}`, () => {
    let browser;
    let skip;
    before(async () => { ({ browser, skip } = await launch(pw, name)); });
    after(() => browser?.close());

    test('flag off: the canvas holds the frame byte for byte, at source size', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '');
      try {
        await post(page);
        const same = await page.evaluate(() => {
          const c = document.getElementById('screen');
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          const src = new Uint8Array(window.lastPosted.f.buffer);
          return { w: c.width, h: c.height, equal: d.length === src.length && d.every((b, i) => b === src[i]) };
        });
        assert.deepEqual(same, { w: 320, h: 240, equal: true });
        assert.deepEqual(await page.evaluate(() => window.ff7web.crt.stats().frames), 0);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    for (const viewport of ['portrait', 'landscape']) {
      test(`flag on (${viewport}): one dimmed line per source row; the core's frame and the picture box are unchanged`, async (t) => {
        if (skip) return t.skip(skip);
        const off = await openApp(browser, '', viewport);
        let boxOff;
        try {
          await post(off.page);
          boxOff = await screenBox(off.page);
        } finally { await off.context.close(); }
        const { context, page, errors } = await openApp(browser, '?labs=crt-filter', viewport);
        try {
          await post(page);
          assertScanlines(await canvasRows(page), { w: 320, h: 240, dim: 0.22 });
          assert.equal(await frameUnchanged(page), true, 'the posted frame bytes are untouched');
          assert.deepEqual(await page.evaluate(() => window.ff7web.shownRect()), { x: 0, y: 0, w: 320, h: 240 });
          const boxOn = await screenBox(page);
          for (const k of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(boxOn[k] - boxOff[k]) < 0.5, `picture box ${k}: ${boxOn[k]} vs ${boxOff[k]}`);
          assert.deepEqual(errors, []);
        } finally { await context.close(); }
      });
    }

    test('strength: the Labs panel offers it while the flag is on, it is kept, and it redraws at once', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '');
      try {
        await post(page);
        await page.click('#labs-btn');
        assert.equal(await page.locator('select[data-setting="crt-filter"]').count(), 0, 'no setting while the flag is off');
        await page.check('input[data-flag="crt-filter"]');
        const select = page.locator('select[data-setting="crt-filter"]');
        await until(async () => (await select.count()) === 1, { what: 'the strength select' });
        assert.equal(await select.inputValue(), 'subtle');
        const h = await select.evaluate((el) => el.getBoundingClientRect().height);
        assert.ok(h >= 44, `select is ${h} px tall`);
        // Toggling the flag on redrew the last frame without a new one.
        await until(async () => (await canvasRows(page)).h === 480, { what: 'redraw at 2x after the toggle' });
        await page.locator('select[data-setting="crt-filter"]').selectOption('strong');
        await until(async () => {
          const r = await canvasRows(page);
          return Math.abs(r.rows[1].v - 40 * (1 - 0.55)) <= 1.5;
        }, { what: 'redraw at the strong strength' });
        assertScanlines(await canvasRows(page), { w: 320, h: 240, dim: 0.55 });
        assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('ff7web.labs.settings'))), { 'crt-filter': 'strong' });
        // Off again: back to the plain draw at source size.
        await page.uncheck('input[data-flag="crt-filter"]');
        await until(async () => (await canvasRows(page)).h === 240, { what: 'redraw at 1x after the toggle' });
        // Reset all flags clears the setting too.
        await page.click('.labs-reset');
        assert.equal(await page.evaluate(() => localStorage.getItem('ff7web.labs.settings')), null);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('with the border crop: scanlines follow the cropped picture\'s rows', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=crt-filter,border-crop');
      try {
        await page.waitForTimeout(700); // several 4 Hz mode polls
        await until(async () => {
          await post(page, 10, BOX);
          const s = await page.evaluate(() => window.ff7web.shownRect());
          return s.w === 256;
        }, { timeout: 8000, what: 'the border crop' });
        assert.deepEqual(await page.evaluate(() => window.ff7web.shownRect()), { x: 32, y: 24, w: 256, h: 192 });
        assertScanlines(await canvasRows(page), { w: 256, h: 192, y0: 24, dim: 0.22 });
        assert.equal(await frameUnchanged(page), true);
        const b = await screenBox(page);
        assert.ok(Math.abs(b.width / b.height - 4 / 3) < 0.01, `4:3 box, got ${b.width}x${b.height}`);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('with the battle crop: scanlines follow the battle scene\'s rows', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=crt-filter,battle-crop,battle-panel', 'portrait', 'battle');
      try {
        await until(async () => {
          await post(page, 2);
          return (await page.evaluate(() => window.ff7web.shownRect())).h === 160;
        }, { timeout: 5000, what: 'the battle crop' });
        assertScanlines(await canvasRows(page), { w: 320, h: 160, y0: 0, dim: 0.22 });
        assert.equal(await frameUnchanged(page), true);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('frame time: the filtered draw costs under 2 ms a frame (headless measurement)', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=crt-filter');
      try {
        await post(page, 10);
        await page.evaluate(() => window.ff7web.crt.resetStats());
        await post(page, 120);
        const s = await page.evaluate(() => window.ff7web.crt.stats());
        t.diagnostic(`${name}: ${s.frames} frames, mean ${s.meanMs.toFixed(3)} ms per filtered draw`);
        console.log(`# crt-filter ${name}: ${s.frames} frames, mean ${s.meanMs.toFixed(3)} ms per filtered draw`);
        assert.ok(s.frames >= 100, `${s.frames} frames drawn`);
        assert.ok(s.meanMs < 2, `mean ${s.meanMs.toFixed(3)} ms`);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  });
}
