// Tier 1: full page with a fake backend, plus homebrew pad-echo end to end.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { BUTTONS_ADDR, build as buildPadEcho } from '../../harness/fixtures/pad-echo.js';
import { PAD } from '../js/pad.js';
import { BROWSERS, CORE_BUILT, launch, loadPlaywright, serveWeb, until } from './helpers.js';

const pw = loadPlaywright();
let server;
before(async () => { server = await serveWeb(); });
after(() => server?.close());

async function openApp(browser, { fake = true, blockedStorage = false, viewport = { width: 390, height: 844 } } = {}) {
  const context = await browser.newContext({ viewport, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (blockedStorage) {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('disabled', 'SecurityError'); } });
    });
  }
  if (fake) {
    await page.route('**/js/backend.js', (route) => route.fulfill({
      contentType: 'text/javascript',
      body: `export async function createWorkerBackend() {
        window.padCalls = [];
        return { loaded: false, onFrameEnd() {}, setPad(m) { window.padCalls.push(m); } };
      }`,
    }));
  }
  await page.goto(server.url);
  await page.evaluate(() => window.ff7web.ready);
  return { context, page, errors };
}

async function point(page, selector) {
  const box = await page.locator(selector).boundingBox();
  assert.ok(box, `${selector} is visible`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// Synthetic PointerEvents allow two independent fingers in both engines.
// Separate mouse tests below exercise real pointer capture and the core.
async function fire(page, type, id, p, root = '#field') {
  await page.locator(root).dispatchEvent(type, {
    pointerId: id, pointerType: 'touch', isPrimary: id === 1,
    clientX: p.x, clientY: p.y, bubbles: true, cancelable: true,
  });
}
const mask = (page) => page.evaluate(() => window.ff7web.mixer.mask);

for (const name of BROWSERS) {
  describe(`field controls: ${name}`, () => {
    let browser;
    let skip;
    before(async () => {
      const r = await launch(pw, name);
      browser = r.browser;
      skip = r.skip;
    });
    after(() => browser?.close());

    test('drag around eight directions, run, Interact with a second finger, and fade the origin cue', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser);
      try {
        await page.click('#controls-btn');
        const origin = await point(page, '#field');
        await fire(page, 'pointerdown', 1, origin);
        assert.equal(await mask(page), 0);
        const cue = await page.locator('.field-cue').boundingBox();
        assert.ok(Math.abs(cue.x + cue.width / 2 - origin.x) < 1);
        assert.ok(Math.abs(cue.y + cue.height / 2 - origin.y) < 1);
        assert.equal(await page.locator('.field-cue').evaluate((el) => getComputedStyle(el).opacity), '0.3');
        await fire(page, 'pointermove', 1, { x: origin.x + 5, y: origin.y });
        assert.equal(await mask(page), 0);
        const expected = [PAD.right, PAD.right | PAD.up, PAD.up, PAD.up | PAD.left,
          PAD.left, PAD.left | PAD.down, PAD.down, PAD.down | PAD.right];
        for (let i = 0; i < 8; i++) {
          await fire(page, 'pointermove', 1, {
            x: origin.x + 30 * Math.cos(i * Math.PI / 4),
            y: origin.y - 30 * Math.sin(i * Math.PI / 4),
          });
          assert.equal(await mask(page), expected[i]);
        }
        await fire(page, 'pointermove', 1, { x: origin.x, y: origin.y - 30 });
        const interact = await point(page, '[data-action="circle"]');
        await fire(page, 'pointerdown', 2, interact);
        assert.equal(await mask(page), PAD.up | PAD.circle);
        await fire(page, 'pointerup', 2, interact);
        assert.equal(await mask(page), PAD.up);
        await fire(page, 'pointermove', 1, { x: origin.x, y: origin.y - 80 });
        assert.equal(await mask(page), PAD.up | PAD.cross);
        await fire(page, 'pointermove', 1, { x: origin.x, y: origin.y - 30 });
        await fire(page, 'pointerup', 1, origin);
        assert.equal(await mask(page), 0);
        await until(() => page.locator('.field-cue').evaluate((el) => getComputedStyle(el).opacity === '0'), { what: 'cue to fade' });
        assert.deepEqual(await page.evaluate(() => window.padCalls), [
          ...expected, PAD.up, PAD.up | PAD.circle, PAD.up,
          PAD.up | PAD.cross, PAD.up, 0,
        ]);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('action buttons send Circle, Triangle and Cross; sliding off releases without starting a walk', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page } = await openApp(browser);
      try {
        await page.click('#controls-btn');
        for (const name of ['circle', 'triangle', 'cross']) {
          const p = await point(page, `[data-action="${name}"]`);
          await fire(page, 'pointerdown', 1, p);
          assert.equal(await mask(page), PAD[name]);
          await fire(page, 'pointermove', 1, await point(page, '#field'));
          assert.equal(await mask(page), 0);
          await fire(page, 'pointermove', 1, p);
          assert.equal(await mask(page), PAD[name]);
          await fire(page, 'pointercancel', 1, p);
          assert.equal(await mask(page), 0);
        }
        assert.deepEqual(await page.evaluate(() => window.padCalls), [
          PAD.circle, 0, PAD.circle, 0, PAD.triangle, 0, PAD.triangle, 0, PAD.cross, 0, PAD.cross, 0,
        ]);
      } finally { await context.close(); }
    });

    test('a second empty-space finger cannot take over, and cancellation releases only its own input', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page } = await openApp(browser);
      try {
        await page.click('#controls-btn');
        const p = await point(page, '#field');
        const up = { x: p.x, y: p.y - 30 };
        await fire(page, 'pointerdown', 1, p);
        await fire(page, 'pointermove', 1, up);
        await fire(page, 'pointerdown', 2, p);
        await fire(page, 'pointermove', 2, { x: p.x - 40, y: p.y });
        await fire(page, 'pointerup', 2, p);
        assert.equal(await mask(page), PAD.up);
        const interact = await point(page, '[data-action="circle"]');
        await fire(page, 'pointerdown', 3, interact);
        await fire(page, 'lostpointercapture', 1, up);
        assert.equal(await mask(page), PAD.circle);
        await fire(page, 'pointercancel', 3, interact);
        assert.equal(await mask(page), 0);
        // A new touch gets its own origin, without an old sector or run bit.
        const fresh = { x: p.x - 60, y: p.y };
        await fire(page, 'pointerdown', 4, fresh);
        await fire(page, 'pointermove', 4, { x: fresh.x + 30, y: fresh.y });
        assert.equal(await mask(page), PAD.right);
        await fire(page, 'pointerup', 4, fresh);
      } finally { await context.close(); }
    });

    test('toggle releases held touch, preserves keyboard, and remembers either mode on reload', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser);
      try {
        assert.ok(await page.locator('#pad').isVisible());
        await page.click('#controls-btn');
        assert.ok(await page.locator('#field').isVisible());
        assert.ok(await page.locator('#pad').isHidden());
        await page.reload();
        await page.evaluate(() => window.ff7web.ready);
        assert.ok(await page.locator('#field').isVisible());
        const p = await point(page, '#field');
        await fire(page, 'pointerdown', 1, p);
        await fire(page, 'pointermove', 1, { x: p.x, y: p.y - 30 });
        await page.keyboard.down('Enter');
        await page.click('#controls-btn');
        assert.equal(await mask(page), PAD.start);
        await page.keyboard.up('Enter');
        assert.equal(await mask(page), 0);
        assert.ok(await page.locator('#field').isHidden());
        const cross = await point(page, '[data-btn="cross"]');
        await fire(page, 'pointerdown', 2, cross, '#pad');
        assert.equal(await mask(page), PAD.cross);
        await page.click('#controls-btn');
        assert.equal(await mask(page), 0);
        await page.click('#controls-btn');
        await page.reload();
        await page.evaluate(() => window.ff7web.ready);
        assert.ok(await page.locator('#pad').isVisible());
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('blocked storage does not prevent switching controls', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, { blockedStorage: true });
      try {
        await page.click('#controls-btn');
        assert.ok(await page.locator('#field').isVisible());
        await page.click('#controls-btn');
        assert.ok(await page.locator('#pad').isVisible());
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('resize, blur and hiding the page release input even before a program loads', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page } = await openApp(browser);
      try {
        await page.click('#controls-btn');
        const p = await point(page, '#field');
        for (const event of ['resize', 'blur', 'visibilitychange']) {
          await fire(page, 'pointerdown', 1, p);
          await fire(page, 'pointermove', 1, { x: p.x, y: p.y - 80 });
          assert.equal(await mask(page), PAD.up | PAD.cross);
          await page.evaluate((event) => {
            if (event === 'visibilitychange') {
              Object.defineProperty(document, 'hidden', { configurable: true, value: true });
              document.dispatchEvent(new Event(event));
            } else window.dispatchEvent(new Event(event));
          }, event);
          assert.equal(await mask(page), 0);
          await fire(page, 'pointermove', 1, { x: p.x, y: p.y - 80 });
          assert.equal(await mask(page), 0, 'stale pointer cannot resume walking');
        }
      } finally { await context.close(); }
    });

    test('buttons stay inside portrait and landscape viewports with targets >=44px', async (t) => {
      if (skip) return t.skip(skip);
      for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
        const { context, page } = await openApp(browser, { viewport });
        try {
          await page.click('#controls-btn');
          for (const selector of ['#controls-btn', '[data-action="circle"]', '[data-action="triangle"]', '[data-action="cross"]']) {
            const b = await page.locator(selector).boundingBox();
            assert.ok(b.width >= 44 && b.height >= 44, `${selector}: >=44px`);
            assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= viewport.width && b.y + b.height <= viewport.height,
              `${selector} inside ${viewport.width}x${viewport.height}: ${JSON.stringify(b)}`);
          }
          // Also checks the landscape overlay does not intercept top-bar buttons.
          await page.click('#mute-btn');
          assert.equal(await page.locator('#mute-btn').getAttribute('aria-pressed'), 'true');
          const cancelled = await page.locator('#field').evaluate((root) => {
            const event = new Event('touchstart', { bubbles: true, cancelable: true });
            root.dispatchEvent(event);
            return event.defaultPrevented;
          });
          assert.ok(cancelled);
        } finally { await context.close(); }
      }
    });

    test('real pointer capture tracks a drag outside the surface and releases on mouseup', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page } = await openApp(browser);
      try {
        await page.click('#controls-btn');
        const p = await point(page, '#field');
        await page.mouse.move(p.x, p.y);
        await page.mouse.down();
        await page.mouse.move(p.x, 10);
        assert.equal(await mask(page), PAD.up | PAD.cross);
        await page.mouse.up();
        assert.equal(await mask(page), 0);
      } finally { await context.close(); }
    });

    test('upward drag reaches Up in PS1 RAM (pad-echo)', {
      skip: CORE_BUILT ? false : 'web/core/ is not built (core/build.sh, core/web/link.sh)',
    }, async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, { fake: false });
      try {
        await page.setInputFiles('#file-input', { name: 'pad-echo.exe', mimeType: 'application/octet-stream', buffer: buildPadEcho() });
        await until(() => page.evaluate(() => window.ff7web.backend.loaded), { what: 'pad-echo boot' });
        const buttons = () => page.evaluate(async (addr) => {
          const b = await window.ff7web.backend.readMem(addr, 2);
          return b[0] | (b[1] << 8);
        }, BUTTONS_ADDR);
        await until(async () => (await buttons()) === 0xffff, { what: 'idle pad' });
        await page.click('#controls-btn');
        const p = await point(page, '#field');
        await page.mouse.move(p.x, p.y);
        await page.mouse.down();
        await page.mouse.move(p.x, p.y - 30);
        // Up is bit 4 of the active-low PS1 pad word.
        await until(async () => (await buttons()) === 0xffef, { what: 'Up in PS1 RAM' });
        await page.mouse.up();
        await until(async () => (await buttons()) === 0xffff, { what: 'released pad' });
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  });
}
