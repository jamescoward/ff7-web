// TEMPORARY (#50): runs the "later tap resumes a suspended context" steps
// 50 times per browser to measure the WebKit failure rate in CI. Removed
// before the #50 PR merges. Mirrors browser.test.js exactly.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { BROWSERS, launch, loadPlaywright, serveWeb, until } from './helpers.js';

const pw = loadPlaywright();
const RUNS = 50;
let server;
before(async () => { server = await serveWeb(); });
after(() => server?.close());

for (const name of BROWSERS) {
  describe(`${name} audio repeat`, () => {
    let browser;
    let skip = false;
    before(async () => {
      const r = await launch(pw, name);
      skip = r.skip ?? false;
      browser = r.browser;
    });
    after(() => browser?.close());

    test(`a later tap resumes a suspended context, ${RUNS} runs`, async (t) => {
      if (skip) return t.skip(skip);
      const failures = [];
      for (let i = 0; i < RUNS; i++) {
        const context = await browser.newContext();
        await context.addInitScript(() => {
          Object.defineProperty(navigator, 'audioSession', { value: { type: 'auto' }, configurable: true });
        });
        const page = await context.newPage();
        try {
          await page.goto(server.url);
          await page.evaluate(() => window.ff7web.ready);
          await page.click('#mute-btn');
          await page.click('#mute-btn');
          await until(() => page.evaluate(() => window.ff7web.audio.context !== null), { what: 'an AudioContext' });
          const resumed = await page.evaluate(async () => {
            const ctx = window.ff7web.audio.context;
            await ctx.suspend();
            window.__resumes = 0;
            const orig = ctx.resume.bind(ctx);
            ctx.resume = () => {
              window.__resumes++;
              return orig();
            };
            return window.ff7web.audio.needsResume;
          });
          assert.ok(resumed, 'a suspended context reports needsResume');
          await page.click('#screen');
          await until(() => page.evaluate(() => window.__resumes > 0), { what: 'a resume on tap' });
        } catch (e) {
          failures.push(`run ${i}: ${e.message.split('\n')[0]}`);
        } finally {
          await context.close();
        }
      }
      t.diagnostic(`${name}: ${failures.length}/${RUNS} failed`);
      console.log(`[#50] ${name}: ${failures.length}/${RUNS} failed${failures.length ? '\n  ' + failures.join('\n  ') : ''}`);
      assert.deepEqual(failures, []);
    });
  });
}
