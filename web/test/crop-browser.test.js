// Tier 1 browser tests for the automatic picture crop (issue #24), on
// Chromium and WebKit through Playwright, with the real core running the
// original homebrew harness/fixtures/border-box.js (no game data).
//
// The page records every frame message: its frame number, the crop the worker
// sent, the fixture's phase read from probe pixels, and whether any lit pixel
// lies outside the crop. Timing is checked in emulated frames, not wall time.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { build as buildBorderBox, HEIGHT, PHASES, WIDTH } from '../../harness/fixtures/border-box.js';
import { CROP_DEFAULTS } from '../js/crop.js';
import { BROWSERS, CORE_BUILT, launch, loadPlaywright, serveWeb, until } from './helpers.js';

const pw = loadPlaywright();
const NEEDS_CORE = CORE_BUILT ? false : 'web/core/ is not built (core/build.sh, core/web/link.sh)';
const rectOf = (b) => ({ x: b.left, y: b.top, w: WIDTH - b.left - b.right, h: HEIGHT - b.top - b.bottom });
const FULL = { x: 0, y: 0, w: WIDTH, h: HEIGHT };
const BOX_A = rectOf(PHASES[1].box);
const BOX_B = rectOf(PHASES[2].box);

let server;
before(async () => {
  server = await serveWeb();
});
after(() => server?.close());

async function openApp(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(server.url);
  await page.evaluate(() => window.ff7web.ready);
  // Record frames from the first one the core sends.
  await page.evaluate(({ blackMax, W, H }) => {
    window.cropLog = [];
    const lit = (p) => (p & 0xff) > blackMax || ((p >>> 8) & 0xff) > blackMax || ((p >>> 16) & 0xff) > blackMax;
    window.ff7web.backend.onFrameEnd((f) => {
      const px = new Uint32Array(f.buffer);
      let phase = -1; // not the fixture's picture (yet)
      if (f.width === W && f.height === H) {
        // (160,120) is inside both boxes; (8,16) only inside the second.
        if (!lit(px[120 * W + 160])) phase = 0;
        else phase = lit(px[16 * W + 8]) ? 2 : 1;
      }
      const c = f.crop;
      let cut = 0;
      for (let y = 0; y < f.height; y++) {
        for (let x = 0; x < f.width; x++) {
          const inside = x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h;
          if (!inside && lit(px[y * f.width + x])) cut++;
        }
      }
      window.cropLog.push({ frame: f.frame, phase, crop: { ...c }, cut });
    });
  }, { blackMax: CROP_DEFAULTS.blackMax, W: WIDTH, H: HEIGHT });
  return { context, page, errors };
}

async function boot(page) {
  await page.setInputFiles('#file-input', { name: 'border-box.exe', mimeType: 'application/octet-stream', buffer: buildBorderBox() });
  await until(() => page.evaluate(() => Boolean(window.ff7web.backend?.loaded)), { what: 'border-box to boot' });
}

const shown = (page) => page.evaluate(() => window.ff7web.shownRect());
const canvasSize = (page) => page.evaluate(() => {
  const c = document.getElementById('screen');
  return { w: c.width, h: c.height };
});

for (const name of BROWSERS) {
  describe(name, () => {
    let browser;
    let skip = false;
    before(async () => {
      const r = await launch(pw, name);
      skip = r.skip ?? false;
      browser = r.browser;
    });
    after(() => browser?.close());

    test('crops to the fixture\'s borders after the delay, widens at once, never cuts content', { skip: NEEDS_CORE }, async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser);
      try {
        await boot(page);
        // The page shows the narrowed crop during the first box...
        await until(async () => JSON.stringify(await shown(page)) === JSON.stringify(BOX_A),
          { timeout: 15_000, what: `the first box to be shown cropped (${JSON.stringify(BOX_A)})` });
        // ...and the wider box once it comes.
        await until(() => page.evaluate(() => window.cropLog.filter((r) => r.phase === 2).length >= 30),
          { timeout: 15_000, what: '30 frames of the second box' });
        await until(async () => JSON.stringify(await shown(page)) === JSON.stringify(BOX_B), { what: 'the second box shown' });
        assert.deepEqual(await canvasSize(page), { w: BOX_B.w, h: BOX_B.h });

        const log = await page.evaluate(() => window.cropLog);
        assert.deepEqual(log.filter((r) => r.cut).map((r) => r.frame), [], 'no frame had content outside its crop');

        const blank = log.filter((r) => r.phase === 0);
        assert.ok(blank.length > 0, 'saw the black phase');
        assert.ok(blank.every((r) => JSON.stringify(r.crop) === JSON.stringify(FULL)), 'black frames: full frame');

        const a = log.filter((r) => r.phase === 1);
        const fA = a[0].frame;
        const firstCropped = a.find((r) => JSON.stringify(r.crop) === JSON.stringify(BOX_A));
        assert.ok(firstCropped, 'the first box was cropped');
        const delay = firstCropped.frame - fA;
        assert.ok(delay >= CROP_DEFAULTS.stableFrames && delay <= CROP_DEFAULTS.stableFrames + 8,
          `narrowed ${delay} frames after the borders appeared`);
        assert.ok(a.filter((r) => r.frame < firstCropped.frame).every((r) => JSON.stringify(r.crop) === JSON.stringify(FULL)),
          'full frame until then');

        const b = log.filter((r) => r.phase === 2);
        assert.ok(b.every((r) => JSON.stringify(r.crop) === JSON.stringify(BOX_B)),
          'the wider box is shown in full from its first frame');

        // The screen box takes the crop's 4:3 share.
        const box = await page.evaluate(() => {
          const r = document.querySelector('.screen').getBoundingClientRect();
          return r.width / r.height;
        });
        const want = (4 / 3) * (BOX_B.w / WIDTH) / (BOX_B.h / HEIGHT);
        assert.ok(Math.abs(box - want) < 0.02, `screen aspect ${box.toFixed(3)}, want ${want.toFixed(3)}`);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('the toggle shows the full frame, and is remembered', { skip: NEEDS_CORE }, async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser);
      try {
        assert.equal(await page.textContent('#crop-btn'), 'Crop on');
        assert.equal(await page.getAttribute('#crop-btn', 'aria-pressed'), 'true');
        const btn = await page.locator('#crop-btn').boundingBox();
        assert.ok(btn.width >= 44 && btn.height >= 44, `toggle is ${btn.width}x${btn.height}`);
        await boot(page);
        await until(async () => (await shown(page))?.h === BOX_A.h, { timeout: 15_000, what: 'a cropped picture' });

        await page.click('#crop-btn');
        assert.equal(await page.textContent('#crop-btn'), 'Crop off');
        assert.equal(await page.getAttribute('#crop-btn', 'aria-pressed'), 'false');
        // Applied to the frame on screen at once, even if no new frame came.
        await page.evaluate(() => window.ff7web.backend.pause());
        await page.click('#crop-btn');
        await page.click('#crop-btn');
        await until(async () => JSON.stringify(await shown(page)) === JSON.stringify(FULL), { what: 'the full frame while paused' });
        assert.deepEqual(await canvasSize(page), { w: WIDTH, h: HEIGHT });
        await page.evaluate(() => window.ff7web.backend.resume());

        await page.reload();
        await page.evaluate(() => window.ff7web.ready);
        assert.equal(await page.textContent('#crop-btn'), 'Crop off', 'the choice survives a reload');
        await page.click('#crop-btn');
        assert.equal(await page.textContent('#crop-btn'), 'Crop on');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  });
}
