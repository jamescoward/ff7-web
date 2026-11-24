// Tier 1 (Chromium + WebKit): 2x internal resolution (#252, Labs flag `hi-res`).
//
// Stubbed backend (no core): which core options the page asks for, the reload
// notice, and that the border and battle crops scale with a 2x frame.
// Real core (needs core/build.sh and core/web/link.sh): the homebrew program
// runner/synth/vblank-counter.js sets a 320x240 15-bit mode; with the flag the
// core's frames double to 640x480. Heap size and frame rates are measured and
// reported as diagnostics (headless host numbers, not device claims).
// No game data is used.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { buildExe as buildVblankCounter } from '../../runner/synth/vblank-counter.js';
import { BROWSERS, CORE_BUILT, launch, loadPlaywright, serveWeb, until } from './helpers.js';

const pw = loadPlaywright();
const NEEDS_CORE = CORE_BUILT ? false : 'web/core/ is not built (core/build.sh, core/web/link.sh)';
const COUNTER_ADDR = 0x800f0000;
const HIRES_OPTIONS = {
  pcsx_rearmed_neon_enhancement_enable: 'enabled',
  pcsx_rearmed_neon_enhancement_no_main: 'disabled',
  pcsx_rearmed_neon_enhancement_tex_adj_v2: 'enabled',
};

let server;
before(async () => { server = await serveWeb(); });
after(() => server?.close());

// The stub records the options the page passed, and posts frames of any size:
// grey inside the insets, black outside.
const STUB = `export async function createWorkerBackend(opts = {}) {
  window.coreOptions = opts.coreOptions ?? null;
  const listeners = new Set();
  let n = 0;
  window.pushFrame = (ins, w, h) => {
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

async function openStubbed(browser, query, mode = 'field') {
  const context = await browser.newContext({ ...pw.devices['iPhone 14 Pro'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/js/backend.js', (route) => route.fulfill({ contentType: 'text/javascript', body: STUB }));
  await page.goto(server.url + query);
  await page.evaluate(() => window.ff7web.ready);
  await page.evaluate((m) => {
    const modeNow = async () => ({ value: { mode: m, raw: 0, previous: null }, confirmed: true });
    window.ff7web.borderCrop.setSource(modeNow);
    window.ff7web.battleCrop.setSource(modeNow);
  }, mode);
  return { context, page, errors };
}

// Post frames until the shown rectangle settles on `want` (the border crop
// narrows only after ~60 steady frames).
async function shownAfterFrames(page, ins, w, h, want) {
  await page.waitForTimeout(700); // several 4 Hz mode polls
  let last = null;
  await until(async () => {
    last = await page.evaluate(async ({ ins, w, h }) => {
      for (let i = 0; i < 10; i++) {
        window.pushFrame(ins, w, h);
        await new Promise((r) => requestAnimationFrame(r));
      }
      await new Promise((r) => requestAnimationFrame(r));
      return window.ff7web.shownRect();
    }, { ins, w, h });
    return JSON.stringify(last) === JSON.stringify(want);
  }, { timeout: 10000, what: `shown rect ${JSON.stringify(want)}` }).catch(() => {});
  return last;
}

async function openReal(browser, query) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(server.url + query);
  await page.evaluate(() => window.ff7web.ready);
  await page.setInputFiles('#file-input', { name: 'vblank-counter.exe', mimeType: 'application/octet-stream', buffer: buildVblankCounter() });
  await until(() => page.evaluate(() => Boolean(window.ff7web.backend?.loaded)), { what: 'the program to boot' });
  await until(() => page.evaluate(() => window.ff7web.drawnFrame() > 2), { what: 'drawn frames' });
  return { context, page, errors };
}

const frameSize = (page) => page.evaluate(() => {
  const f = window.ff7web.backend.lastFrame();
  return { w: f.width, h: f.height, canvas: [document.getElementById('screen').width, document.getElementById('screen').height] };
});
const counter = (page) => page.evaluate(async (addr) => {
  const b = await window.ff7web.backend.readMem(addr, 4);
  return (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;
}, COUNTER_ADDR);

// Core frames run per second of wall time, over `ms`.
async function rate(page, ms) {
  const a = await page.evaluate(() => ({ f: window.ff7web.backend.frame, t: performance.now() }));
  await page.waitForTimeout(ms);
  const b = await page.evaluate(() => ({ f: window.ff7web.backend.frame, t: performance.now() }));
  return ((b.f - a.f) * 1000) / (b.t - a.t);
}

for (const name of BROWSERS) {
  describe(`2x resolution: ${name}`, () => {
    let browser;
    let skip;
    before(async () => { ({ browser, skip } = await launch(pw, name)); });
    after(() => browser?.close());

    test('flag off: no core option is added; flag on: the three enhancement options are', async (t) => {
      if (skip) return t.skip(skip);
      const off = await openStubbed(browser, '');
      try {
        assert.deepEqual(await off.page.evaluate(() => window.coreOptions), {});
        assert.equal(await off.page.evaluate(() => 'hiRes' in document.documentElement.dataset), false);
        assert.deepEqual(off.errors, []);
      } finally { await off.context.close(); }
      const on = await openStubbed(browser, '?labs=hi-res');
      try {
        assert.deepEqual(await on.page.evaluate(() => window.coreOptions), HIRES_OPTIONS);
        assert.equal(await on.page.evaluate(() => 'hiRes' in document.documentElement.dataset), true);
        assert.deepEqual(on.errors, []);
      } finally { await on.context.close(); }
    });

    test('toggling the flag after load says it takes effect on reload, and changes nothing now', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openStubbed(browser, '');
      try {
        await page.evaluate(() => window.ff7web.labs.setFlag('hi-res', true));
        assert.match(await page.locator('#status').textContent(), /reloaded/);
        assert.equal(await page.evaluate(() => 'hiRes' in document.documentElement.dataset), false);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    // Field border crop: maxInsets are 48 (top/bottom) and 64 (left/right) PS1
    // pixels. Content inset by 80/100 output pixels in a 640x480 frame is
    // inside the limits only when they are scaled by 2 (96/128).
    const INS = { top: 80, right: 100, bottom: 80, left: 100 };
    test('border crop with the flag: PS1-pixel limits scale with a 2x frame', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openStubbed(browser, '?labs=hi-res,border-crop');
      try {
        const want = { x: 100, y: 80, w: 440, h: 320 };
        assert.deepEqual(await shownAfterFrames(page, INS, 640, 480, want), want);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('border crop without the flag: the same 640x480 frame keeps today\'s unscaled limits', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openStubbed(browser, '?labs=border-crop');
      try {
        const want = { x: 64, y: 48, w: 512, h: 384 };
        assert.deepEqual(await shownAfterFrames(page, INS, 640, 480, want), want);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('battle crop with the flag: the scene rectangle scales to a 2x frame', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openStubbed(browser, '?labs=hi-res,battle-crop,battle-panel', 'battle');
      try {
        const zero = { top: 0, right: 0, bottom: 0, left: 0 };
        const want = { x: 0, y: 0, w: 640, h: 320 };
        assert.deepEqual(await shownAfterFrames(page, zero, 640, 480, want), want);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('real core, flag off: 320x240 frames, as today', { skip: NEEDS_CORE }, async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openReal(browser, '');
      try {
        assert.deepEqual(await frameSize(page), { w: 320, h: 240, canvas: [320, 240] });
        t.diagnostic(`flag off: heap ${(await page.evaluate(() => window.ff7web.backend.heapBytes)) / 2 ** 20} MiB`);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('real core, flag on: 640x480 frames, heap within 256 MiB; fps reported', { skip: NEEDS_CORE }, async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openReal(browser, '?labs=hi-res,speed');
      try {
        assert.deepEqual(await frameSize(page), { w: 640, h: 480, canvas: [640, 480] });
        // The picture is the program's solid fill: every pixel of a frame is the same colour.
        const uniform = await page.evaluate(() => {
          const c = document.getElementById('screen');
          const d = new Uint32Array(c.getContext('2d').getImageData(0, 0, c.width, c.height).data.buffer);
          return d.every((p) => p === d[0]);
        });
        assert.equal(uniform, true);
        const r1 = await rate(page, 2000);
        await page.click('#speed-btn');
        await page.waitForTimeout(200);
        const r2 = await rate(page, 1500);
        const heap = await page.evaluate(() => window.ff7web.backend.heapBytes);
        assert.ok(heap > 0 && heap <= 256 * 2 ** 20, `heap ${heap}`);
        t.diagnostic(`flag on: heap ${heap / 2 ** 20} MiB; core fps at 1x ${r1.toFixed(1)}, at 2x ${r2.toFixed(1)} (speed now ${await page.evaluate(() => window.ff7web.backend.speed)})`);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('real core, flag off: fps reported at 1x and 2x for comparison', { skip: NEEDS_CORE }, async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openReal(browser, '?labs=speed');
      try {
        const r1 = await rate(page, 2000);
        await page.click('#speed-btn');
        await page.waitForTimeout(200);
        const r2 = await rate(page, 1500);
        t.diagnostic(`flag off: core fps at 1x ${r1.toFixed(1)}, at 2x ${r2.toFixed(1)}`);
        assert.ok(r1 > 0);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('real core, flag on: a state saves and loads back, and frames stay 2x', { skip: NEEDS_CORE }, async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openReal(browser, '?labs=hi-res');
      try {
        // The saved counter lies between the reads just before and after the save.
        const c0 = await counter(page);
        await page.evaluate(async () => { window.saved = await window.ff7web.backend.saveState(); });
        const c1 = await counter(page);
        await until(async () => (await counter(page)) > c1 + 60, { what: 'the program to run on' });
        await page.evaluate(async () => { await window.ff7web.backend.loadState(window.saved); });
        const c2 = await counter(page);
        assert.ok(c2 >= c0 && c2 < c1 + 30, `counter back between ${c0} and ${c1} (+ frames since the load), got ${c2}`);
        await until(async () => (await counter(page)) > c2 + 3, { what: 'the program to run on after the load' });
        assert.deepEqual(await frameSize(page), { w: 640, h: 480, canvas: [640, 480] });
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('real core: a state saved with the flag off loads with it on', { skip: NEEDS_CORE }, async (t) => {
      if (skip) return t.skip(skip);
      const off = await openReal(browser, '');
      let bytes;
      let c0;
      let c1;
      try {
        // Counters are read in the page, next to the save; the ~4 MB state
        // crosses to the test as base64 (a number array is slow to serialise).
        ({ bytes, c0, c1 } = await off.page.evaluate(async (addr) => {
          const b = window.ff7web.backend;
          const read = async () => { const m = await b.readMem(addr, 4); return (m[0] | (m[1] << 8) | (m[2] << 16) | (m[3] << 24)) >>> 0; };
          const c0 = await read();
          const st = await b.saveState();
          const c1 = await read();
          let bin = '';
          for (let i = 0; i < st.length; i += 0x8000) bin += String.fromCharCode(...st.subarray(i, i + 0x8000));
          return { bytes: btoa(bin), c0, c1 };
        }, COUNTER_ADDR));
        assert.deepEqual(off.errors, []);
      } finally { await off.context.close(); }
      const { context, page, errors } = await openReal(browser, '?labs=hi-res');
      try {
        await until(async () => (await counter(page)) > c1 + 60, { what: 'the program to run past the saved point' });
        await page.evaluate(async (b64) => {
          const bin = atob(b64);
          const st = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) st[i] = bin.charCodeAt(i);
          await window.ff7web.backend.loadState(st);
        }, bytes);
        const c2 = await counter(page);
        assert.ok(c2 >= c0 && c2 < c1 + 30, `counter back between ${c0} and ${c1} (+ frames since the load), got ${c2}`);
        await until(async () => (await counter(page)) > c2 + 3, { what: 'the program to run on' });
        assert.deepEqual(await frameSize(page), { w: 640, h: 480, canvas: [640, 480] });
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  });
}
