// Tier 1: Card panel placement and status messages (owner's iPhone report on PR #63).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { BROWSERS, launch, loadPlaywright, serveWeb, until } from './helpers.js';

const pw = loadPlaywright();
let server;
before(async () => { server = await serveWeb(); });
after(() => server?.close());

async function openApp(browser, viewport) {
  const context = await browser.newContext({ viewport, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/js/backend.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `export async function createWorkerBackend() {
      return { loaded: false, onFrameEnd() {}, setPad() {} };
    }`,
  }));
  await page.clock.install();
  await page.goto(server.url);
  await page.evaluate(() => window.ff7web.ready);
  return { context, page, errors };
}

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const name of BROWSERS) {
  describe(`card menu and status: ${name}`, () => {
    let browser;
    let skip;
    before(async () => {
      const r = await launch(pw, name);
      browser = r.browser;
      skip = r.skip;
    });
    after(() => browser?.close());

    test('the Card panel never covers the Card button, and a tap outside closes it', async (t) => {
      if (skip) return t.skip(skip);
      // 393 is an iPhone 14 Pro in portrait, where the top bar wraps to two rows.
      for (const viewport of [{ width: 393, height: 852 }, { width: 320, height: 568 }, { width: 852, height: 393 }]) {
        const { context, page, errors } = await openApp(browser, viewport);
        try {
          await page.click('summary');
          const summary = await page.locator('summary').boundingBox();
          const panel = await page.locator('.menu-body').boundingBox();
          assert.ok(!overlaps(summary, panel),
            `${viewport.width}x${viewport.height}: panel ${JSON.stringify(panel)} covers button ${JSON.stringify(summary)}`);
          assert.ok(panel.y + panel.height <= viewport.height, 'panel fits vertically');
          // The button itself closes it (it is not covered)...
          await page.click('summary');
          assert.equal(await page.locator('.menu').evaluate((d) => d.open), false);
          // ...and so does a tap anywhere else.
          await page.click('summary');
          await page.touchscreen.tap(Math.round(viewport.width / 2), Math.round(viewport.height - 20));
          assert.equal(await page.locator('.menu').evaluate((d) => d.open), false);
          assert.deepEqual(errors, []);
        } finally { await context.close(); }
      }
    });

    test('"Card imported" clears itself, closes the panel, and any message can be tapped away', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, { width: 393, height: 852 });
      try {
        const { blankCard } = await import('../js/memcard.js');
        const status = page.locator('#status');
        await page.click('summary');
        await page.setInputFiles('#card-input', { name: 'blank.mcr', mimeType: 'application/octet-stream', buffer: Buffer.from(blankCard()) });
        await until(async () => /Card imported/.test(await status.textContent()), { what: 'the import notice' });
        assert.equal(await page.locator('.menu').evaluate((d) => d.open), false, 'panel closed after import');
        await page.clock.fastForward(5000);
        assert.ok(await status.isVisible(), 'still readable for a few seconds');
        await page.clock.fastForward(2000);
        assert.ok(await status.isHidden(), 'gone after the notice time');

        // A refusal also clears; before that, a tap dismisses it.
        await page.setInputFiles('#card-input', { name: 'bad.mcr', mimeType: 'application/octet-stream', buffer: Buffer.alloc(1000) });
        await until(async () => /Import failed/.test(await status.textContent()), { what: 'the refusal' });
        await status.tap();
        assert.ok(await status.isHidden(), 'tapped away');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('the start-up hint stays until it is tapped or a program loads', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page } = await openApp(browser, { width: 393, height: 852 });
      try {
        const status = page.locator('#status');
        await page.clock.fastForward(60000);
        assert.match(await status.textContent(), /Choose a disc image/);
        assert.ok(await status.isVisible());
      } finally { await context.close(); }
    });
  });
}
