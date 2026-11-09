// Tier 1 (#157): the `safe-layout` Labs flag (#152) in portrait Safari
// (393x660, the toolbars take the insets) with the debug strip (#93) on and off.
// With Debug on, the flag steps back to the old picture sizing so the strip is
// neither clamped nor clipped; with Debug off, the picture shrinks so the whole
// pad fits with no page scroll. The Debug toggle needs the semantic gate, so this
// uses a fake backend (no game data) that passes the gate with a synthetic RAM
// image, like web/test/debug-overlay.test.js; it is replaced for this page only.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { BROWSERS, launch, loadPlaywright, serveWeb } from './helpers.js';

const pw = loadPlaywright();
let server;
before(async () => { server = await serveWeb(); });
after(() => server?.close());

const FAKE_BACKEND = `
import { ADDRESS_TABLE, EXE_USA_SHA1 } from './semantic/addresses.js';
import { createSemantic } from './semantic/layer.js';
import { createStatePoller } from './overlay-state.js';

export async function createWorkerBackend(opts) {
  const ram = new Uint8Array(0x200000);
  let poller = null;
  let wanted = false;
  window.fake = {
    load() {
      const semantic = createSemantic({ backend: { readMem: (a, l) => ram.slice(a & 0x1fffffff, (a & 0x1fffffff) + l) }, exeSha1: EXE_USA_SHA1, table: ADDRESS_TABLE });
      poller = createStatePoller({ semantic, post: (s) => opts.onState?.(s), hz: 20 });
      if (wanted) poller.start();
      opts.onSemantic?.({ active: true, reason: null });
    },
  };
  return {
    loaded: false,
    onFrameEnd() {},
    setPad() {},
    setOverlay(on) { wanted = on; if (poller) { if (on) poller.start(); else poller.stop(); } },
  };
}`;

const VIEWPORT = { width: 393, height: 660 }; // iPhone 14 Pro, Safari with its toolbars
const TOL = 1; // px
// Expected picture sizes (CSS px). Old sizing: full width at 4:3, 393 x 294.75.
// Flag sizing: height = 660 - bar - 316 (pad), width at 4:3; measured 309 x 232 (#152).
const OLD = { width: 393, height: 295 };
const SHRUNK = { width: 309, height: 232 };

async function openApp(browser, query) {
  const context = await browser.newContext({ viewport: VIEWPORT, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/js/backend.js', (route) => route.fulfill({ contentType: 'text/javascript', body: FAKE_BACKEND }));
  await page.goto(server.url + query);
  await page.evaluate(() => window.ff7web.ready);
  return { context, page, errors };
}

const measure = (page) => page.evaluate(() => {
  const dbg = document.getElementById('debug');
  return {
    canvas: document.getElementById('screen').getBoundingClientRect().toJSON(),
    pageScrollH: document.documentElement.scrollHeight,
    innerH: window.innerHeight,
    debugShown: !dbg.hidden && dbg.getBoundingClientRect().height > 0,
    debugScrollH: dbg.scrollHeight,
    debugClientH: dbg.clientHeight,
  };
});
const near = (got, want, what) => {
  assert.ok(Math.abs(got.width - want.width) <= TOL && Math.abs(got.height - want.height) <= TOL,
    `${what}: picture ${got.width.toFixed(1)}x${got.height.toFixed(1)}, want ${want.width}x${want.height} (±${TOL})`);
};

for (const name of BROWSERS) {
  describe(`safe-layout with the debug strip: ${name}`, () => {
    let browser;
    let skip;
    before(async () => {
      const r = await launch(pw, name);
      browser = r.browser;
      skip = r.skip;
    });
    after(() => browser?.close());

    test('portrait 393x660: Debug on keeps the strip whole at the old sizing; Debug off shrinks the picture with no page scroll', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=safe-layout');
      try {
        assert.equal(await page.evaluate(() => window.ff7web.labs.isOn('safe-layout')), true);
        assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-safe-layout')), true);

        let m = await measure(page);
        near(m.canvas, SHRUNK, 'flag on, before Debug');
        assert.ok(m.pageScrollH <= m.innerH, `no page scroll before Debug (${m.pageScrollH} > ${m.innerH})`);

        await page.evaluate(() => window.fake.load());
        await page.click('#debug-btn');
        await page.waitForSelector('#debug .dbg-row');
        m = await measure(page);
        assert.equal(m.debugShown, true, 'the debug strip is shown');
        assert.equal(m.debugScrollH, m.debugClientH, `the debug strip is not clipped (scrollHeight ${m.debugScrollH}, clientHeight ${m.debugClientH})`);
        near(m.canvas, OLD, 'Debug on');

        await page.click('#debug-btn');
        m = await measure(page);
        assert.equal(m.debugShown, false, 'the debug strip is hidden');
        near(m.canvas, SHRUNK, 'Debug off again');
        assert.ok(m.pageScrollH <= m.innerH, `no page scroll after Debug off (${m.pageScrollH} > ${m.innerH})`);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  });
}
