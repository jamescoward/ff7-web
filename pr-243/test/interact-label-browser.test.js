// Tier 1 (Chromium + WebKit): the context-aware Interact label (#25) with a
// fake nearby() source. The backend is stubbed, so this runs without the core.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { BROWSERS, launch, loadPlaywright, serveWeb, until } from './helpers.js';

const pw = loadPlaywright();
let server;
before(async () => { server = await serveWeb(); });
after(() => server?.close());

const CIRCLE = 1 << 8;
const NPC_IN = { kind: 'npc', model: 1, dx: 5, dy: 0, distance: 5, inRange: true, near: true, facing: true };
const NPC_OUT = { ...NPC_IN, inRange: false, near: false };
const EXIT_IN = { kind: 'exit', gateway: 0, to: 3, dx: 0, dy: 8, distance: 8, inRange: true };

async function openApp(browser, query) {
  const context = await browser.newContext({ ...(pw.devices['iPhone 14 Pro'] ?? {}) });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/js/backend.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: 'export async function createWorkerBackend() { window.pads = []; return { loaded: false, onFrameEnd() {}, setPad(m) { window.pads.push(m); } }; }',
  }));
  await page.goto(server.url + query);
  await page.evaluate(() => window.ff7web.ready);
  await page.click('#controls-btn'); // drag-to-walk
  await page.evaluate(() => {
    window.fake = { sample: { value: [], confirmed: true }, reads: 0 };
    window.ff7web.interactLabel.setSource({ nearby: async () => { window.fake.reads += 1; return structuredClone(window.fake.sample); } });
    window.ff7web.interactLabel.setGate({ active: true });
  });
  return { context, page, errors };
}

const setSample = (page, sample) => page.evaluate((s) => { window.fake.sample = s; }, sample);
const interact = (page) => page.$eval('#field [data-id="interact"]', (el) => ({
  text: el.textContent, id: el.dataset.interact ?? null, dim: el.classList.contains('field-dim'), action: el.dataset.action,
}));
const shows = (page, text, dim) => until(async () => {
  const s = await interact(page);
  return s.text === text && s.dim === dim;
}, { timeout: 3000, what: `Interact shows ${text}${dim ? ' (dimmed)' : ''}` });

for (const name of BROWSERS) {
  describe(`interact label: ${name}`, () => {
    let browser;
    let skip;
    before(async () => {
      const r = await launch(pw, name);
      browser = r.browser;
      skip = r.skip;
    });
    after(() => browser?.close());

    test('flag on: Talk, Exit, dimmed and plain follow nearby()', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=interact-label');
      try {
        await shows(page, 'Interact ○', true);
        await setSample(page, { value: [NPC_IN, EXIT_IN], confirmed: true });
        await shows(page, 'Talk ○', false);
        assert.equal((await interact(page)).id, 'talk');
        await setSample(page, { value: [NPC_OUT, EXIT_IN], confirmed: true });
        await shows(page, 'Exit ○', false);
        await setSample(page, { value: [NPC_IN], confirmed: false });
        await shows(page, 'Interact ○', false);
        await setSample(page, { value: null, confirmed: false, reason: 'read failed' });
        await shows(page, 'Interact ○', false);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('flag on: a tap on Talk still presses Circle, then releases', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=interact-label');
      try {
        await setSample(page, { value: [NPC_IN], confirmed: true });
        await shows(page, 'Talk ○', false);
        await page.evaluate(() => { window.pads.length = 0; });
        await page.locator('#field [data-id="interact"]').tap();
        await until(async () => (await page.evaluate(() => window.pads.slice())).includes(0), { timeout: 3000, what: 'press and release' });
        assert.deepEqual(await page.evaluate(() => window.pads.slice()), [CIRCLE, 0]);
        assert.equal((await interact(page)).action, 'circle');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('turning the flag off restores the plain label and stops reading', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=interact-label');
      try {
        await setSample(page, { value: [NPC_IN], confirmed: true });
        await shows(page, 'Talk ○', false);
        await page.evaluate(() => window.ff7web.labs.setFlag('interact-label', false));
        await shows(page, 'Interact ○', false);
        assert.equal(await page.evaluate(() => window.ff7web.interactLabel.running), false);
        const reads = await page.evaluate(() => window.fake.reads);
        await page.waitForTimeout(600);
        assert.equal(await page.evaluate(() => window.fake.reads), reads);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('flag off: never reads, label stays Interact', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '');
      try {
        await setSample(page, { value: [NPC_IN], confirmed: true });
        await page.waitForTimeout(600);
        assert.deepEqual(await interact(page), { text: 'Interact ○', id: null, dim: false, action: 'circle' });
        assert.equal(await page.evaluate(() => window.fake.reads), 0);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('classic pad shown: no reads', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=interact-label');
      try {
        await page.click('#controls-btn'); // back to the classic pad
        await page.evaluate(() => { window.fake.reads = 0; });
        await page.waitForTimeout(600);
        assert.equal(await page.evaluate(() => window.fake.reads), 0);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  });
}
