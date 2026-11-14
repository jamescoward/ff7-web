// Tier 1 browser test for the benchmark page (issue #8), through Playwright
// (Chromium; WebKit too when installed). Needs core/build.sh and
// core/web/link.sh. The run is shortened by query parameters.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { validate } from '../../../runner/schema.js';
import { BROWSERS, CORE_BUILT, launch, loadPlaywright, serveWeb } from '../../test/helpers.js';
import { MAX_REPORT_URL } from '../report.js';
import * as stress from '../stress.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = JSON.parse(readFileSync(path.join(HERE, '..', 'report.schema.json'), 'utf8'));
const pw = loadPlaywright();
const NEEDS_CORE = CORE_BUILT ? false : 'web/core/ is not built (core/build.sh, core/web/link.sh)';
const SHORT = 'bench/?frames=120&seconds=4&audio=2&window=1';

let server;
before(async () => {
  server = await serveWeb();
});
after(() => server?.close());

async function openBench(browser, query = SHORT) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(server.url + query);
  await page.waitForFunction(() => ['ready', 'error'].includes(window.ff7bench?.state.phase), null, { timeout: 30_000 });
  assert.equal(await page.evaluate(() => window.ff7bench.state.error), null);
  return { context, page, errors };
}

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

    test('a short benchmark run produces a report that matches the schema', { skip: NEEDS_CORE, timeout: 120_000 }, async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openBench(browser);
      try {
        // Touch targets on the page are at least 44x44 px.
        for (const sel of ['#start', '#model']) {
          const box = await page.locator(sel).boundingBox();
          assert.ok(box.width >= 44 && box.height >= 44, `${sel} is ${box.width}x${box.height}`);
        }
        await page.click('#start'); // a real gesture, so audio can start
        const report = await page.evaluate(() => window.ff7bench.done);
        assert.ok(report, 'the run finished');
        assert.deepEqual(validate(SCHEMA, report), [], JSON.stringify(report));
        assert.equal(report.status, 'complete');
        assert.equal(report.short, true);
        assert.match(report.verdict, /^(pass-short|fail|incomplete)$/, 'a short run never reports a full pass');
        assert.equal(report.unthrottled.frames, 120);
        assert.ok(report.unthrottled.speed > 0);
        assert.ok(report.realtime.frames >= 60, `real-time frames: ${report.realtime.frames}`);
        assert.ok(report.realtime.p99 > 0 && report.realtime.p50 <= report.realtime.p99);
        assert.ok(report.memory.peakHeapMB >= 64 && report.memory.peakHeapMB <= 256);
        assert.ok(report.startup.firstFrameMs >= report.startup.coreMs);
        assert.equal(report.program.tris, stress.DEFAULT_TRIANGLES);
        assert.match(report.program.sha, /^[0-9a-f]{16}$/);
        // Every measured frame was really emulated: the program counts one VBLANK each
        // (plus the first frame at load).
        const counter = await page.evaluate(() => window.ff7bench.state.counter);
        assert.equal(counter, 1 + report.unthrottled.frames + report.realtime.frames);
        assert.ok(await page.evaluate(() => window.ff7bench.drawnFrame()) > 0, 'frames were drawn');

        assert.equal(await page.locator('#results').isVisible(), true);
        assert.equal(await page.locator('#stop').isVisible(), false, 'Stop is hidden after the run');
        const href = await page.locator('#report').getAttribute('href');
        assert.ok(href.startsWith('https://github.com/jamescoward/ff7-web/issues/new?'), href);
        assert.ok(href.length <= MAX_REPORT_URL, `${href.length} characters`);
        const body = new URL(href).searchParams.get('body');
        assert.deepEqual(JSON.parse(/```json\n(.*)\n```/.exec(body)[1]), report);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('Stop during the unthrottled phase ends the run without the real-time phase', { skip: NEEDS_CORE, timeout: 60_000 }, async (t) => {
      if (skip) return t.skip(skip);
      const { context, page } = await openBench(browser, 'bench/?frames=100000&seconds=600&audio=2&window=1');
      try {
        await page.click('#start');
        await page.waitForFunction(() => window.ff7bench.state.phase === 'unthrottled', null, { timeout: 10_000 });
        await page.click('#stop');
        const report = await page.evaluate(() => window.ff7bench.done);
        assert.deepEqual(validate(SCHEMA, report), [], JSON.stringify(report));
        assert.equal(report.status, 'interrupted');
        assert.equal(report.note, 'stopped');
        assert.ok(report.unthrottled.frames < 100000);
        assert.equal(report.realtime.frames, 0, 'the 10-minute real-time phase was skipped');
        assert.equal(report.verdict === 'pass' || report.verdict === 'pass-short', false);
      } finally {
        await context.close();
      }
    });

    test('a run cut off by a reload is reported as lost', { skip: NEEDS_CORE, timeout: 60_000 }, async (t) => {
      if (skip) return t.skip(skip);
      const { context, page } = await openBench(browser, `${SHORT.replace('seconds=4', 'seconds=60')}`);
      try {
        await page.click('#start');
        await page.waitForFunction(() => window.ff7bench.state.phase === 'realtime', null, { timeout: 30_000 });
        await page.reload();
        await page.waitForFunction(() => window.ff7bench?.state.phase === 'ready', null, { timeout: 30_000 });
        assert.equal(await page.locator('#lost').isVisible(), true);
        const lost = await page.evaluate(() => window.ff7bench.state.lostReport);
        assert.deepEqual(validate(SCHEMA, lost), []);
        assert.equal(lost.status, 'lost');
        assert.equal(lost.memory.lostRun, 'realtime');
        assert.equal(lost.checks.reload, 'fail');
        assert.equal(lost.verdict, 'fail');
        const href = await page.locator('#lost-report').getAttribute('href');
        assert.ok(href.length <= MAX_REPORT_URL);
      } finally {
        await context.close();
      }
    });
  });
}
