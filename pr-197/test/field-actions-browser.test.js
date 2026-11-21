// Tier 1: the field buttons the page renders match semantic/controls.js
// FIELD_ACTIONS (#146): same order, labels, classes and pad bits as before.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { FIELD_ACTIONS } from '../../semantic/controls.js';
import { BROWSERS, launch, loadPlaywright, serveWeb } from './helpers.js';

const pw = loadPlaywright();
let server;
before(async () => { server = await serveWeb(); });
after(() => server?.close());

for (const name of BROWSERS) {
  describe(`field actions from semantic/: ${name}`, () => {
    let browser;
    let skip;
    before(async () => {
      const r = await launch(pw, name);
      browser = r.browser;
      skip = r.skip;
    });
    after(() => browser?.close());

    test('the #field buttons are FIELD_ACTIONS, as #23 laid them out', async (t) => {
      if (skip) return t.skip(skip);
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
      try {
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
        const buttons = await page.$$eval('#field .field-actions > *', (els) => els.map((el) => ({
          tag: el.tagName, type: el.type, className: el.className, action: el.dataset.action, text: el.textContent,
        })));
        // The markup before #146, written out.
        const before146 = [
          { tag: 'BUTTON', type: 'button', className: 'btn field-action', action: 'circle', text: 'Interact ○' },
          { tag: 'BUTTON', type: 'button', className: 'btn field-action', action: 'triangle', text: 'Menu △' },
          { tag: 'BUTTON', type: 'button', className: 'btn field-back', action: 'cross', text: 'Back ✕' },
        ];
        assert.deepEqual(buttons, before146);
        assert.deepEqual(buttons.map((b) => [b.action, b.text]), FIELD_ACTIONS.map((a) => [a.button, a.label]));
        assert.equal(await page.$$eval('#field .field-cue', (els) => els.length), 1);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  });
}
