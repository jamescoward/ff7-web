// Tier 1: Card panel placement (owner's iPhone report on PR #63).
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
  await page.goto(server.url);
  await page.evaluate(() => window.ff7web.ready);
  return { context, page, errors };
}

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const name of BROWSERS) {
  describe(`card menu: ${name}`, () => {
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

    test('finishing an export closes the Card panel', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, { width: 393, height: 852 });
      try {
        // No stored card yet: export ends with a message, and the panel closes.
        await page.click('summary');
        await page.click('#card-export');
        await until(async () => /no memory card yet/.test(await page.locator('#status').textContent()), { what: 'the export result' });
        assert.equal(await page.locator('.menu').evaluate((d) => d.open), false, 'panel closed after export');
        // With a card, export downloads it, and the panel closes too.
        await page.evaluate(async () => {
          const { blankCard } = await import('./js/memcard.js');
          await window.ff7web.cards.save(blankCard());
        });
        await page.click('summary');
        const [download] = await Promise.all([page.waitForEvent('download'), page.click('#card-export')]);
        assert.equal(download.suggestedFilename(), 'ff7-web-card1.mcr');
        await until(() => page.locator('.menu').evaluate((d) => !d.open), { what: 'panel closed after a download' });
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('finishing an import closes the Card panel', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, { width: 393, height: 852 });
      try {
        const { blankCard } = await import('../js/memcard.js');
        await page.click('summary');
        await page.setInputFiles('#card-input', { name: 'blank.mcr', mimeType: 'application/octet-stream', buffer: Buffer.from(blankCard()) });
        await until(async () => /Card imported/.test(await page.locator('#status').textContent()), { what: 'the import notice' });
        assert.equal(await page.locator('.menu').evaluate((d) => d.open), false, 'panel closed after import');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  });
}
