// Tier 1: status notices clear themselves or on a tap (#66).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { BROWSERS, launch, loadPlaywright, serveWeb, until } from './helpers.js';

const pw = loadPlaywright();
let server;
before(async () => { server = await serveWeb(); });
after(() => server?.close());

async function openApp(browser) {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true });
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

for (const name of BROWSERS) {
  describe(`status notices: ${name}`, () => {
    let browser;
    let skip;
    before(async () => {
      const r = await launch(pw, name);
      browser = r.browser;
      skip = r.skip;
    });
    after(() => browser?.close());

    test('"Card imported" clears itself, and a refusal can be tapped away', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser);
      try {
        const { blankCard } = await import('../js/memcard.js');
        const status = page.locator('#status');
        await page.setInputFiles('#card-input', { name: 'blank.mcr', mimeType: 'application/octet-stream', buffer: Buffer.from(blankCard()) });
        await until(async () => /Card imported/.test(await status.textContent()), { what: 'the import notice' });
        await page.clock.fastForward(5000);
        assert.ok(await status.isVisible(), 'still readable for a few seconds');
        await page.clock.fastForward(2000);
        assert.ok(await status.isHidden(), 'gone after the notice time');

        await page.setInputFiles('#card-input', { name: 'bad.mcr', mimeType: 'application/octet-stream', buffer: Buffer.alloc(1000) });
        await until(async () => /Import failed/.test(await status.textContent()), { what: 'the refusal' });
        await status.tap();
        assert.ok(await status.isHidden(), 'tapped away');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('the start-up hint stays until it is tapped', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page } = await openApp(browser);
      try {
        const status = page.locator('#status');
        await page.clock.fastForward(60000);
        assert.match(await status.textContent(), /Choose a disc image/);
        assert.ok(await status.isVisible());
        await status.tap();
        assert.ok(await status.isHidden());
      } finally { await context.close(); }
    });
  });
}
