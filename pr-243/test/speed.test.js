// Tier 1: the speed toggle (#118), Labs flag `speed`. Unit tests for the step
// rules, and browser tests on pad-echo homebrew (no game data).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { BUTTONS_ADDR, build as buildPadEcho } from '../../harness/fixtures/pad-echo.js';
import { buildExe as buildVblankCounter } from '../../runner/synth/vblank-counter.js';
import { clampSpeed, createGovernor, nextSpeed, SPEEDS, stepDown } from '../js/speed.js';
import { BROWSERS, CORE_BUILT, launch, loadPlaywright, serveWeb, until } from './helpers.js';

const pw = loadPlaywright();
const NEEDS_CORE = CORE_BUILT ? false : 'web/core/ is not built (core/build.sh, core/web/link.sh)';

let server;
before(async () => { server = await serveWeb(); });
after(() => server?.close());

test('speed steps cycle 1x, 2x, 3x and step down to 1x at most', () => {
  assert.deepEqual([...SPEEDS], [1, 2, 3]);
  assert.deepEqual([1, 2, 3].map(nextSpeed), [2, 3, 1]);
  assert.deepEqual([1, 2, 3].map(stepDown), [1, 1, 2]);
  assert.equal(nextSpeed(7), 1);
  assert.equal(clampSpeed(4), 1);
  assert.equal(clampSpeed('2'), 1);
  assert.equal(clampSpeed(3), 3);
});

// Fake ticks at ~60 Hz; `behind(i)` says whether tick i fell behind.
function run(gov, { from = 0, ms = 5000, behind }) {
  const trips = [];
  for (let t = from, i = 0; t < from + ms; t += 16.7, i++) if (gov.note(t, behind(i, t - from))) trips.push(Math.round(t));
  return trips;
}

test('the governor trips once a window is mostly behind', () => {
  const trips = run(createGovernor(), { behind: () => true });
  assert.ok(trips.length >= 1 && trips[0] >= 2000 && trips[0] < 2100, `first trip at ${trips[0]}`);
});

test('the governor ignores a single hiccup and a healthy run', () => {
  assert.deepEqual(run(createGovernor(), { behind: (i) => i === 40 }), []);
  assert.deepEqual(run(createGovernor(), { behind: () => false }), []);
  // A burst under the ratio, spread over the window, does not trip.
  assert.deepEqual(run(createGovernor(), { behind: (i) => i % 4 === 0 }), []);
});

test('a gap with no ticks (tab hidden) restarts the window', () => {
  const gov = createGovernor();
  assert.deepEqual(run(gov, { ms: 1500, behind: () => true }), []);
  // Hidden for 10 s, then behind for 1.5 s: the old window must not count.
  assert.deepEqual(run(gov, { from: 11500, ms: 1500, behind: () => true }), []);
});

test('reset forgets the window', () => {
  const gov = createGovernor();
  run(gov, { ms: 1900, behind: () => true });
  gov.reset();
  assert.deepEqual(run(gov, { from: 1900, ms: 1500, behind: () => true }), []);
});

async function openStubbed(browser, query) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // A backend that records what the page asks of it and lets the test play the worker.
  await page.route('**/js/backend.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `export async function createWorkerBackend(opts) {
      const b = { loaded: false, speed: 1, calls: [], onFrameEnd() {}, setPad() {},
        setSpeed(n) { b.calls.push(n); b.speed = n; return n; }, auto(n) { b.speed = n; opts.onSpeed(n, true); } };
      window.__stub = b;
      return b;
    }`,
  }));
  await page.goto(server.url + query);
  await page.evaluate(() => window.ff7web.ready);
  return { context, page, errors };
}

async function openApp(browser, query = '') {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(server.url + query);
  await page.evaluate(() => window.ff7web.ready);
  return { context, page, errors };
}

async function bootProgram(page, name, buffer) {
  await page.setInputFiles('#file-input', { name, mimeType: 'application/octet-stream', buffer });
  await until(() => page.evaluate(() => Boolean(window.ff7web.backend?.loaded)), { what: `${name} to boot` });
}

/**
 * Per second of wall time over `ms`: the frames the core ran, and the frames
 * the worker's time base asked for (fps x speed, whether or not the host
 * kept up). Both come from the same frame message, so they line up.
 */
const rates = (page, ms) => page.evaluate(async (span) => {
  const b = window.ff7web.backend;
  const f0 = b.frame;
  const g0 = b.targetFrames;
  const t0 = performance.now();
  await new Promise((r) => setTimeout(r, span));
  const s = (performance.now() - t0) / 1000;
  return { ran: (b.frame - f0) / s, target: (b.targetFrames - g0) / s };
}, ms);

for (const name of BROWSERS) {
  describe(`speed: ${name}`, () => {
    let browser;
    let skip;
    before(async () => {
      const r = await launch(pw, name);
      browser = r.browser;
      skip = r.skip;
    });
    after(() => browser?.close());

    test('flag off: no speed button, and the speed stays 1x', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openStubbed(browser, '');
      try {
        assert.equal(await page.locator('#speed-btn').isVisible(), false);
        assert.equal(await page.evaluate(() => window.__stub.speed), 1);
        assert.deepEqual(await page.evaluate(() => window.__stub.calls), []);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('flag on: the button cycles 1x, 2x, 3x; switching the flag off returns to 1x and hides it', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openStubbed(browser, '?labs=speed');
      try {
        const btn = page.locator('#speed-btn');
        assert.equal(await btn.isVisible(), true);
        assert.equal(await btn.textContent(), '1x');
        await btn.click();
        assert.equal(await btn.textContent(), '2x');
        await btn.click();
        assert.equal(await btn.textContent(), '3x');
        await btn.click();
        assert.equal(await btn.textContent(), '1x');
        await btn.click();
        assert.equal(await page.evaluate(() => window.__stub.speed), 2);
        await page.evaluate(() => window.ff7web.labs.setFlag('speed', false));
        assert.equal(await page.evaluate(() => window.__stub.speed), 1);
        assert.equal(await btn.isVisible(), false);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('an automatic step-down by the worker shows on the button and in a notice', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openStubbed(browser, '?labs=speed');
      try {
        await page.click('#speed-btn');
        await page.click('#speed-btn');
        assert.equal(await page.locator('#speed-btn').textContent(), '3x');
        await page.evaluate(() => window.__stub.auto(2));
        assert.equal(await page.locator('#speed-btn').textContent(), '2x');
        assert.equal(await page.locator('#speed-btn').getAttribute('data-stepped'), 'true');
        assert.match(await page.locator('#status').textContent(), /could not keep up.*2x/);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    // #173: the time base must double; how many of those frames the host
    // manages to run depends on spare CPU, so that part is only a lower bound.
    test('2x doubles the time base, and runs more frames than 1x', { skip: NEEDS_CORE }, async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=speed');
      try {
        await bootProgram(page, 'vblank-counter.exe', buildVblankCounter());
        await until(() => page.evaluate(() => window.ff7web.drawnFrame() > 0), { what: 'a drawn frame' });
        const fps = await page.evaluate(() => window.ff7web.backend.loaded.fps);
        const r1 = await rates(page, 2000);
        await page.click('#speed-btn');
        assert.equal(await page.evaluate(() => window.ff7web.backend.speed), 2);
        // 1 s, starting 200 ms after the switch: over before the governor's
        // 2 s window could step a slow host down (step-down has its own test).
        await page.waitForTimeout(200);
        const r2 = await rates(page, 1000);
        const speedAfter = await page.evaluate(() => window.ff7web.backend.speed);
        const msg = `fps ${fps}; 1x target ${r1.target.toFixed(1)} ran ${r1.ran.toFixed(1)}; `
          + `2x target ${r2.target.toFixed(1)} ran ${r2.ran.toFixed(1)}; speed after ${speedAfter}`;
        assert.equal(speedAfter, 2, `no automatic step-down during the measurement (${msg})`);
        assert.ok(Math.abs(r1.target / fps - 1) < 0.2, `1x time base is the core's fps (${msg})`);
        const ratio = r2.target / r1.target;
        assert.ok(ratio > 1.7 && ratio < 2.3, `2x time base is twice 1x, ratio ${ratio.toFixed(2)} (${msg})`);
        assert.ok(r2.ran > r1.ran, `2x runs more frames than 1x (${msg})`);
        t.diagnostic(msg);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('pad input reaches the program at 2x, and audio is dropped above 1x and back at 1x', { skip: NEEDS_CORE }, async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=speed');
      try {
        await bootProgram(page, 'pad-echo.exe', buildPadEcho());
        const buttons = () => page.evaluate(async (addr) => {
          const b = await window.ff7web.backend.readMem(addr, 2);
          return b[0] | (b[1] << 8);
        }, BUTTONS_ADDR);
        const pushes = () => page.evaluate(() => window.ff7web.backend.audioPushes);
        await until(async () => (await buttons()) === 0xffff, { what: 'an idle pad' });

        // At 1x the core's audio reaches the page. (Pad-echo may be silent:
        // the check below is on the pushes that do arrive.)
        const at1 = await pushes();
        await page.waitForTimeout(500);
        const silent = (await pushes()) === at1;

        await page.click('#speed-btn');
        assert.equal(await page.evaluate(() => window.ff7web.backend.speed), 2);
        await page.evaluate(() => window.ff7web.backend.setPad('cross'));
        await until(async () => (await buttons()) === 0xbfff, { what: 'Cross at 2x' });
        await page.evaluate(() => window.ff7web.backend.setPad(0));
        await until(async () => (await buttons()) === 0xffff, { what: 'the release at 2x' });
        const during = await pushes();
        await page.waitForTimeout(500);
        assert.equal(await pushes(), during, 'no audio batches above 1x');

        // Back to 1x: audio flows again (when the program makes sound at all).
        await page.click('#speed-btn');
        await page.click('#speed-btn');
        assert.equal(await page.evaluate(() => window.ff7web.backend.speed), 1);
        await page.evaluate(() => window.ff7web.backend.setPad('start'));
        await until(async () => (await buttons()) === 0xfff7, { what: 'Start at 1x' });
        if (!silent) await until(async () => (await pushes()) > during, { what: 'audio back at 1x' });
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  });
}
