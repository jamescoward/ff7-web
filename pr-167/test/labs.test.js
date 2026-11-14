// Tier 1: Labs flags (#105).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { BROWSERS, launch, loadPlaywright, serveWeb } from './helpers.js';

const pw = loadPlaywright();
let server;
before(async () => { server = await serveWeb(); });
after(() => server?.close());

async function openApp(browser, { viewport = { width: 390, height: 844 }, query = '', context: existing } = {}) {
  const context = existing ?? await browser.newContext({ viewport, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/js/backend.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: 'export async function createWorkerBackend() { return { loaded: false, onFrameEnd() {}, setPad() {} }; }',
  }));
  await page.goto(server.url + query);
  await page.evaluate(() => window.ff7web.ready);
  return { context, page, errors };
}
const stored = (page) => page.evaluate(() => localStorage.getItem('ff7web.labs'));
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const name of BROWSERS) {
  describe(`labs: ${name}`, () => {
    let browser;
    let skip;
    before(async () => {
      const r = await launch(pw, name);
      browser = r.browser;
      skip = r.skip;
    });
    after(() => browser?.close());

    test('every flag is off by default and nothing is stored', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser);
      try {
        const r = await page.evaluate(() => window.ff7web.labs.listFlags().map((f) => [f.name, f.on]));
        assert.ok(r.length >= 1);
        assert.ok(r.every(([, on]) => !on));
        assert.equal(await stored(page), null);
        assert.equal(await page.locator('#labs-panel').isVisible(), false);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('a flag toggled in the panel persists across reload', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser);
      try {
        await page.click('#labs-btn');
        await page.locator('input[data-flag="labs-demo"]').check();
        assert.equal(await page.evaluate(() => window.ff7web.labs.isOn('labs-demo')), true);
        await page.reload();
        await page.evaluate(() => window.ff7web.ready);
        assert.equal(await page.evaluate(() => window.ff7web.labs.isOn('labs-demo')), true);
        await page.click('#labs-btn');
        assert.equal(await page.locator('input[data-flag="labs-demo"]').isChecked(), true);
        await page.locator('input[data-flag="labs-demo"]').uncheck();
        await page.reload();
        await page.evaluate(() => window.ff7web.ready);
        assert.equal(await page.evaluate(() => window.ff7web.labs.isOn('labs-demo')), false);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('?labs= enables a flag for that load only, and unknown names are ignored', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, { query: '?labs=labs-demo,nope' });
      try {
        assert.equal(await page.evaluate(() => window.ff7web.labs.isOn('labs-demo')), true);
        assert.equal(await page.evaluate(() => window.ff7web.labs.isOn('nope')), false);
        // Only registered flags are listed: the unknown name is not (other features register their own flags).
        const names = await page.evaluate(() => window.ff7web.labs.listFlags().map((f) => f.name));
        assert.ok(names.includes('labs-demo') && !names.includes('nope'), String(names));
        assert.deepEqual(await page.evaluate(() => window.ff7web.labs.listFlags().filter((f) => f.on).map((f) => f.name)), ['labs-demo']);
        assert.equal(await stored(page), null, 'the URL writes nothing');
        await page.click('#labs-btn');
        assert.match(await page.locator('.labs-row').first().textContent(), /this visit/);
        // Next load without the query: off again.
        await page.goto(server.url);
        await page.evaluate(() => window.ff7web.ready);
        assert.equal(await page.evaluate(() => window.ff7web.labs.isOn('labs-demo')), false);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('an unknown name in storage is ignored and kept', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page } = await openApp(browser);
      try {
        await page.evaluate(() => localStorage.setItem('ff7web.labs', JSON.stringify(['ghost'])));
        await page.reload();
        await page.evaluate(() => window.ff7web.ready);
        assert.equal(await page.evaluate(() => window.ff7web.labs.isOn('ghost')), false);
        await page.evaluate(() => window.ff7web.labs.setFlag('labs-demo', true));
        assert.deepEqual(JSON.parse(await stored(page)), ['ghost', 'labs-demo']);
      } finally { await context.close(); }
    });

    test('blocked storage does not break the panel', async (t) => {
      if (skip) return t.skip(skip);
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
      await context.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
      });
      const { page, errors } = await openApp(browser, { context });
      try {
        await page.click('#labs-btn');
        await page.locator('input[data-flag="labs-demo"]').check();
        assert.equal(await page.evaluate(() => window.ff7web.labs.isOn('labs-demo')), true);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('the Labs panel stays clear of the pad and field, targets are >=44px, outside tap closes', async (t) => {
      if (skip) return t.skip(skip);
      for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 568 }]) {
        for (const field of [false, true]) {
          const { context, page, errors } = await openApp(browser, { viewport });
          try {
            if (field) await page.click('#controls-btn');
            await page.click('#labs-btn');
            const label = `${viewport.width}x${viewport.height} field=${field}`;
            const panel = await page.locator('#labs-panel').boundingBox();
            assert.ok(panel.x >= 0 && panel.y >= 0 && panel.x + panel.width <= viewport.width && panel.y + panel.height <= viewport.height, `${label}: panel inside viewport`);
            const btn = await page.locator('#labs-btn').boundingBox();
            assert.ok(!overlaps(panel, btn), `${label}: panel covers the Labs button`);
            // Controls that take touches: the pad's own buttons, or the field area.
            const targets = await page.evaluate(() => {
              const out = [];
              const f = document.getElementById('field');
              // In landscape the drag surface spans the whole screen (like the pad
              // box), so only its buttons are checked there; in portrait the whole area.
              const landscape = window.innerWidth > window.innerHeight && window.innerHeight <= 600;
              if (!f.hidden && !landscape) out.push(f.getBoundingClientRect().toJSON());
              if (!f.hidden) for (const el of f.querySelectorAll('button')) out.push(el.getBoundingClientRect().toJSON());
              for (const el of document.querySelectorAll('#pad button, #pad [data-btn], #pad > * > *')) {
                const r = el.getBoundingClientRect();
                if (r.width && r.height && getComputedStyle(el).pointerEvents !== 'none') out.push(r.toJSON());
              }
              return out;
            });
            assert.ok(targets.length > 0, `${label}: found controls`);
            for (const r of targets) assert.ok(!overlaps(panel, r), `${label}: panel ${JSON.stringify(panel)} covers ${JSON.stringify(r)}`);
            for (const sel of ['#labs-btn', '.labs-row']) {
              const b = await page.locator(sel).first().boundingBox();
              assert.ok(b.width >= 44 && b.height >= 44, `${label}: ${sel} >=44px`);
            }
            // A tap outside (on the picture's far corner) closes it.
            await page.touchscreen.tap(2, viewport.height - 2);
            assert.equal(await page.locator('#labs-panel').isVisible(), false, `${label}: closed`);
            assert.deepEqual(errors, []);
          } finally { await context.close(); }
        }
      }
    });
  });
}
