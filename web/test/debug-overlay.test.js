// Tier 1: the debug overlay (#79) with a fake backend that runs the real
// semantic layer, state poller and page code over a synthetic RAM image.
// No game data. The test-only hook is the page.route below: it replaces
// js/backend.js for that page only, so there is no switch in the shipped app
// that could turn the overlay on for a disc that doesn't pass the hash gate.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { build as buildPadEcho } from '../../harness/fixtures/pad-echo.js';
import { buildIso, cueFor } from '../../runner/synth/iso9660.js';
import { PAD } from '../js/pad.js';
import { OVERLAY_HZ, createStatePoller, sampleState } from '../js/overlay-state.js';
import { ADDRESS_TABLE as SHIPPED_TABLE } from '../js/semantic/addresses.js';
import { BROWSERS, CORE_BUILT, WEB, launch, loadPlaywright, serveWeb, until } from './helpers.js';

// The Mode row's badge for the shipped table: mode() reads gameState and
// prevGameState, so it is confirmed only when both entries are (and, since #92,
// only for their confirmed values: the real-worker test checks that). Taken from the
// table, not hard-coded, so these tests follow address confirmations (#76).
const SHIPPED_MODE_BADGE = ['gameState', 'prevGameState']
  .every((n) => SHIPPED_TABLE.entries.find((e) => e.name === n).status === 'confirmed') ? 'confirmed' : 'hypothesis';
const shippedBadge = (...names) => (names.every((n) => SHIPPED_TABLE.entries.find((e) => e.name === n).status === 'confirmed') ? 'confirmed' : 'hypothesis');
const SHIPPED_FIELD_BADGE = shippedBadge('fieldId');
// #99: playerPosition() reads playerModel, then that model's fieldX/fieldY (RAM here leaves it 0, the confirmed value).
const SHIPPED_POS_BADGE = shippedBadge('playerModel', 'fieldX', 'fieldY');
const SHIPPED_CURSOR_BADGE = shippedBadge('menuCursor');
const SHIPPED_PARTY_BADGE = shippedBadge('partySlot0', 'partySlot1', 'partySlot2');
const SHIPPED_HP_BADGE = shippedBadge('partyHp0', 'partyHp1', 'partyHp2');

const pw = loadPlaywright();
let server;
before(async () => { server = await serveWeb(); });
after(() => server?.close());

// The fake backend. window.fake.load(active, tableName) plays the worker's
// part: the gate verdict, then (if active) a poller over window.fake.ram.
const FAKE_BACKEND = `
import { ADDRESS_TABLE, EXE_USA_SHA1, makeTable } from './semantic/addresses.js';
import { createSemantic } from './semantic/layer.js';
import { createStatePoller } from './overlay-state.js';

// A synthetic table: confirmed and hypothesis entries, and some with no address.
const e = (name, address, type, status, extra = {}) => ({
  name, address, type, meaning: 'synthetic', source: 'synthetic test table', status,
  ...(status === 'confirmed' ? { scenario: 'synthetic' } : {}), ...extra });
export const SYNTHETIC = makeTable(EXE_USA_SHA1, [
  e('gameState', 0x80001000, 's16', 'confirmed', { values: { 1: 'field', 2: 'battle', 5: 'menu' } }),
  e('prevGameState', 0x80001002, 's16', 'confirmed', { values: { 1: 'field', 2: 'battle', 5: 'menu' } }),
  e('fieldId', 0x80001004, 'u16', 'hypothesis'),
  e('playerModel', 0x8000100c, 's16', 'hypothesis'),
  e('fieldX', 0x80001006, 's16', 'hypothesis'),
  e('fieldY', 0x80001008, 's16', 'hypothesis'),
  e('menuCursor', 0x8000100a, 'u8', 'confirmed'),
  e('partySlot0', 0x80001010, 'u8', 'hypothesis'),
  e('partySlot1', 0x80001011, 'u8', 'hypothesis'),
  e('partySlot2', 0x80001012, 'u8', 'hypothesis'),
  e('partyHp0', 0x80001020, 'u16', 'hypothesis'),
  e('partyHp1', 0x80001022, 'u16', 'hypothesis'),
  e('partyHp2', 0x80001024, 'u16', 'confirmed'),
]);

export async function createWorkerBackend(opts) {
  const ram = new Uint8Array(0x200000);
  const view = new DataView(ram.buffer);
  const state = { reads: 0, writes: 0, poller: null, overlayCalls: [], overlayWanted: false };
  window.padCalls = [];
  window.fake = {
    ram, view, state,
    set(addr, type, v) { view['set' + type](addr & 0x1fffffff, v, true); },
    load(active, which = 'real') {
      if (active) {
        const semantic = createSemantic({
          backend: { readMem: (a, l) => { state.reads++; return ram.slice(a & 0x1fffffff, (a & 0x1fffffff) + l); } },
          exeSha1: EXE_USA_SHA1, table: which === 'real' ? ADDRESS_TABLE : SYNTHETIC });
        state.poller = createStatePoller({ semantic, post: (sample) => opts.onState?.(sample), hz: 20 });
        if (state.overlayWanted) state.poller.start();
      }
      opts.onSemantic?.({ active, reason: active ? null : 'boot executable is not the one the address table describes' });
    },
  };
  return {
    loaded: false,
    onFrameEnd() {},
    setPad(m) { window.padCalls.push(m); },
    setOverlay(on) {
      state.overlayCalls.push(on);
      state.overlayWanted = on;
      if (state.poller) { if (on) state.poller.start(); else state.poller.stop(); }
    },
  };
}`;

async function openApp(browser, { viewport = { width: 390, height: 844 } } = {}) {
  const context = await browser.newContext({ viewport, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/js/backend.js', (route) => route.fulfill({ contentType: 'text/javascript', body: FAKE_BACKEND }));
  await page.goto(server.url);
  await page.evaluate(() => window.ff7web.ready);
  return { context, page, errors };
}

const rows = (page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#debug .dbg-row')].map((r) => [
  r.dataset.key,
  { val: r.querySelector('.dbg-val').textContent, badge: r.querySelector('.dbg-badge')?.dataset.status ?? null, reason: r.querySelector('.dbg-reason')?.textContent ?? null },
])));
const visible = (page, sel) => page.locator(sel).isVisible();

describe('overlay state (no browser)', () => {
  test('polls a few times a second, and the bound is documented in one place', () => {
    assert.ok(OVERLAY_HZ >= 1 && OVERLAY_HZ <= 5);
  });

  test('the poller posts only changed samples, never overlaps, and stops', async () => {
    let calls = 0;
    let n = 7;
    const semantic = new Proxy({}, { get: (_, k) => async () => { calls++; return k === 'fieldId' ? { value: n, confirmed: false } : { value: null, confirmed: false, reason: 'no address' }; } });
    const ticks = [];
    const timers = { setInterval: (fn) => { ticks.push(fn); return 1; }, clearInterval: () => ticks.pop() };
    const posted = [];
    const p = createStatePoller({ semantic, post: (s) => posted.push(s), timers });
    p.start();
    await new Promise((r) => setImmediate(r)); // start() samples once at once
    await p.tick();
    await p.tick();
    assert.equal(posted.length, 1, 'unchanged samples are not posted again');
    n = 8;
    await p.tick();
    assert.equal(posted.length, 2);
    p.stop();
    assert.equal(p.running, false);
    const before = posted.length;
    n = 9;
    await p.tick();
    assert.equal(posted.length, before, 'nothing is posted after stop');
    assert.ok(calls > 0);
  });

  test('the layer handed to the overlay has no way to write', async () => {
    const { createSemantic } = await import('../js/semantic/layer.js');
    const s = createSemantic({ backend: { readMem: () => new Uint8Array(8) }, exeSha1: null });
    assert.deepEqual(Object.keys(s).filter((k) => /write|poke|set/i.test(k)), []);
    assert.equal((await sampleState(s)).rows.every((r) => r.text === null && r.reason === 'inactive'), true);
  });
});

for (const name of BROWSERS) {
  describe(`debug overlay: ${name}`, () => {
    let browser;
    let skip;
    before(async () => {
      const r = await launch(pw, name);
      browser = r.browser;
      skip = r.skip;
    });
    after(() => browser?.close());

    test('gate off: the toggle is hidden and disabled, nothing is polled, and it stays off if forced', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser);
      try {
        assert.equal(await visible(page, '#debug-btn'), false, 'hidden before any disc');
        await page.evaluate(() => window.fake.load(false));
        assert.equal(await visible(page, '#debug-btn'), false);
        assert.equal(await page.locator('#debug-btn').isDisabled(), true);
        assert.equal(await visible(page, '#debug'), false);
        // Even a forced click (the button is disabled and hidden) turns nothing on.
        await page.locator('#debug-btn').dispatchEvent('click');
        assert.equal(await page.evaluate(() => window.ff7web.overlay.on), false);
        assert.deepEqual(await page.evaluate(() => window.fake.state.overlayCalls), []);
        assert.equal(await page.evaluate(() => window.fake.state.reads), 0);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('gate on, real table: off by default; a value in every row; updates with memory; marks the status from the shipped table', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser);
      try {
        await page.evaluate(() => {
          window.fake.set(0x8009c560, 'Int16', 1);
          window.fake.set(0x800965ec, 'Int16', 5);
          window.fake.set(0x8009a05c, 'Int16', 0x74); // fieldId (#77)
          window.fake.set(0x80074eb0, 'Int32', -70000); // fieldX (#77)
          window.fake.set(0x80074eb4, 'Int32', 123456); // fieldY (#77)
          window.fake.set(0x8009a0d3, 'Int8', 2); // menuCursor (#78)
          window.fake.set(0x8009cbdc, 'Uint8', 0); // partySlot0..2 (#78): Cloud, empty, empty
          window.fake.set(0x8009cbdd, 'Uint8', 0xff);
          window.fake.set(0x8009cbde, 'Uint8', 0xff);
          window.fake.set(0x8009d85c, 'Int16', 287); // partyHp0..2 (#78)
          window.fake.set(0x8009dc9c, 'Int16', 0);
          window.fake.set(0x8009e0dc, 'Int16', 0);
          window.fake.load(true, 'real');
        });
        assert.equal(await visible(page, '#debug-btn'), true);
        assert.equal(await page.locator('#debug-btn').isEnabled(), true);
        assert.equal(await visible(page, '#debug'), false, 'off by default');
        assert.equal(await page.evaluate(() => window.fake.state.reads), 0, 'nothing is read while it is off');

        await page.click('#debug-btn');
        await page.waitForSelector('#debug .dbg-row');
        let r = await rows(page);
        assert.deepEqual(r.mode, { val: 'field (1), was menu', badge: SHIPPED_MODE_BADGE, reason: null });
        assert.deepEqual(r.fieldId, { val: '116', badge: SHIPPED_FIELD_BADGE, reason: null });
        assert.deepEqual(r.position, { val: 'x -70000, y 123456', badge: SHIPPED_POS_BADGE, reason: null });
        // #78 gave the menu cursor and the party addresses: every row now reads the shipped table's address.
        assert.deepEqual(r.menuCursor, { val: '2', badge: SHIPPED_CURSOR_BADGE, reason: null });
        assert.deepEqual(r.party, { val: '#0 empty empty', badge: SHIPPED_PARTY_BADGE, reason: null });
        assert.deepEqual(r.partyHp, { val: '287 / 0 / 0', badge: SHIPPED_HP_BADGE, reason: null });

        await page.evaluate(() => window.fake.set(0x8009c560, 'Int16', 2));
        await until(async () => (await rows(page)).mode?.val === 'battle (2), was menu', { what: 'the mode to update' });

        await page.click('#debug-btn');
        assert.equal(await visible(page, '#debug'), false);
        assert.deepEqual(await page.evaluate(() => window.fake.state.overlayCalls), [true, false]);
        // Polling stopped: no more reads after toggling off.
        const reads = await page.evaluate(() => window.fake.state.reads);
        await page.waitForTimeout(250);
        assert.equal(await page.evaluate(() => window.fake.state.reads), reads);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('a synthetic table marks confirmed and hypothesis per value, and shows every field', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page } = await openApp(browser);
      try {
        await page.evaluate(() => {
          const f = window.fake;
          f.set(0x80001000, 'Int16', 5);
          f.set(0x80001002, 'Int16', 1);
          f.set(0x80001004, 'Uint16', 0x0123);
          f.set(0x80001006, 'Int16', -120);
          f.set(0x80001008, 'Int16', 340);
          f.set(0x8000100a, 'Uint8', 3);
          f.set(0x80001010, 'Uint8', 0);
          f.set(0x80001011, 'Uint8', 4);
          f.set(0x80001012, 'Uint8', 0xff);
          f.set(0x80001020, 'Uint16', 321);
          f.set(0x80001022, 'Uint16', 0);
          f.set(0x80001024, 'Uint16', 9999);
          f.load(true, 'synthetic');
        });
        await page.click('#debug-btn');
        await until(async () => Object.keys(await rows(page)).length === 6, { what: 'six rows' });
        const r = await rows(page);
        assert.deepEqual(r.mode, { val: 'menu (5), was field', badge: 'confirmed', reason: null });
        assert.deepEqual(r.fieldId, { val: '291', badge: 'hypothesis', reason: null });
        assert.deepEqual(r.position, { val: 'x -120, y 340', badge: 'hypothesis', reason: null });
        assert.deepEqual(r.menuCursor, { val: '3', badge: 'confirmed', reason: null });
        assert.deepEqual(r.party, { val: '#0 #4 empty', badge: 'hypothesis', reason: null });
        // One hypothesis address among the three makes the whole value a hypothesis.
        assert.deepEqual(r.partyHp, { val: '321 / 0 / 9999', badge: 'hypothesis', reason: null });
        // Memory changes show up.
        await page.evaluate(() => { window.fake.set(0x80001004, 'Uint16', 0x0042); window.fake.set(0x80001020, 'Uint16', 100); });
        await until(async () => (await rows(page)).fieldId?.val === '66' && (await rows(page)).partyHp?.val === '100 / 0 / 9999', { what: 'updates' });
      } finally {
        await context.close();
      }
    });

    test('the overlay does not cover the gamepad or field controls, and the classic pad works with it on', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser);
      try {
        await page.evaluate(() => { window.fake.set(0x8009c560, 'Int16', 1); window.fake.load(true, 'real'); });
        await page.click('#debug-btn');
        await page.waitForSelector('#debug .dbg-row');

        const toggle = await page.locator('#debug-btn').boundingBox();
        assert.ok(toggle.width >= 44 && toggle.height >= 44, `toggle is ${toggle.width}x${toggle.height}`);
        const panel = await page.locator('#debug').boundingBox();
        const pad = await page.locator('#pad').boundingBox();
        assert.ok(panel.y + panel.height <= pad.y + 1, 'the panel sits over the picture, above the pad');
        assert.equal(await page.locator('#debug').evaluate((el) => getComputedStyle(el).pointerEvents), 'none');

        // The classic gamepad: a real press on Cross reaches the mixer and the backend.
        const cross = await page.locator('[data-btn="cross"]').boundingBox();
        await page.mouse.move(cross.x + cross.width / 2, cross.y + cross.height / 2);
        await page.mouse.down();
        assert.equal(await page.evaluate(() => window.ff7web.mixer.mask), PAD.cross);
        await page.mouse.up();
        assert.equal(await page.evaluate(() => window.ff7web.mixer.mask), 0);

        // Field controls: switch modes, drag right, and the overlay stays out of the way.
        await page.click('#controls-btn');
        const field = await page.locator('#field').boundingBox();
        const fx = field.x + field.width / 2;
        const fy = field.y + field.height / 2;
        await page.mouse.move(fx, fy);
        await page.mouse.down();
        await page.mouse.move(fx + 60, fy, { steps: 4 });
        assert.equal(await page.evaluate(() => window.ff7web.mixer.mask & 0xffff), PAD.right);
        await page.mouse.up();
        assert.equal(await page.evaluate(() => window.ff7web.mixer.mask), 0);
        assert.equal(await page.evaluate(() => window.ff7web.overlay.on), true, 'still on after using the controls');
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    // #93: on the owner's iPhone in portrait, the panel over the picture hid the in-game
    // menu's text. In portrait it is now a strip below the picture: off the picture, off
    // the pad, and the picture keeps its size.
    for (const viewport of [{ width: 390, height: 844 }, { width: 393, height: 759 }, { width: 375, height: 667 }]) {
      test(`portrait ${viewport.width}x${viewport.height}: the panel is below the picture, not on it, and off the pad`, async (t) => {
        if (skip) return t.skip(skip);
        const { context, page, errors } = await openApp(browser, { viewport });
        try {
          await page.evaluate(() => {
            window.fake.set(0x8009c560, 'Int16', 5);
            window.fake.set(0x800965ec, 'Int16', 1);
            window.fake.load(true, 'real');
          });
          const box = (sel) => page.locator(sel).boundingBox();
          const canvasBefore = await box('#screen');
          const padBefore = await box('#pad');
          await page.click('#debug-btn');
          await page.waitForSelector('#debug .dbg-row');
          const canvas = await box('#screen');
          const panel = await box('#debug');
          const pad = await box('#pad');
          assert.deepEqual(canvas, canvasBefore, 'the picture keeps its place and size');
          assert.ok(panel.y >= canvas.y + canvas.height - 1, `the panel (y ${panel.y}) starts below the picture (ends ${canvas.y + canvas.height})`);
          assert.ok(panel.y + panel.height <= pad.y + 1, 'the panel ends above the pad');
          assert.ok(panel.height <= 100, `the strip is compact (${panel.height} px)`);
          const status = await box('#status');
          if (status) assert.ok(status.y + status.height <= panel.y + 1, 'the status line is not over the strip');
          assert.ok(pad.height >= 300 || pad.height === padBefore.height, `the pad keeps its space (${pad.height} px)`);
          // Every row is still there, with its status, inside the strip.
          const r = await rows(page);
          assert.deepEqual(Object.keys(r).sort(), ['fieldId', 'menuCursor', 'mode', 'party', 'partyHp', 'position']);
          assert.equal(r.mode.badge, SHIPPED_MODE_BADGE);
          for (const key of Object.keys(r)) {
            const b = await box(`#debug .dbg-row[data-key="${key}"]`);
            assert.ok(b.y >= panel.y - 1 && b.y + b.height <= panel.y + panel.height + 1, `${key} row is inside the strip`);
          }
          // No pad button is under the strip, and the classic pad still works.
          for (const sel of ['[data-btn="cross"]', '[data-btn="l1"]', '[data-btn="r1"]', '.vp-dpad']) {
            const b = await box(sel);
            assert.ok(b.y >= panel.y + panel.height - 1, `${sel} is below the panel`);
          }
          // A short screen already scrolled before #93 (the top bar wraps to two lines).
          await page.locator('[data-btn="cross"]').scrollIntoViewIfNeeded();
          const cross = await box('[data-btn="cross"]');
          await page.mouse.move(cross.x + cross.width / 2, cross.y + cross.height / 2);
          await page.mouse.down();
          assert.equal(await page.evaluate(() => window.ff7web.mixer.mask), PAD.cross);
          await page.mouse.up();
          await page.evaluate(() => window.scrollTo(0, 0));
          // Off again: the layout is what it was.
          await page.click('#debug-btn');
          assert.deepEqual(await box('#screen'), canvasBefore);
          assert.deepEqual(await box('#pad'), padBefore);
          assert.equal(await page.locator('.screen').getAttribute('data-debug-on'), null);
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      });
    }

    test('landscape phone: the panel stays on the picture and off the pad halves', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page } = await openApp(browser, { viewport: { width: 844, height: 390 } });
      try {
        await page.evaluate(() => { window.fake.set(0x8009c560, 'Int16', 1); window.fake.load(true, 'real'); });
        await page.click('#debug-btn');
        await page.waitForSelector('#debug .dbg-row');
        const panel = await page.locator('#debug').boundingBox();
        const screen = await page.locator('.screen').boundingBox();
        assert.ok(panel.x >= screen.x && panel.x + panel.width <= screen.x + screen.width + 1, 'inside the picture');
        for (const sel of ['[data-btn="cross"]', '.vp-dpad']) {
          const b = await page.locator(sel).boundingBox();
          const overlap = panel.x < b.x + b.width && b.x < panel.x + panel.width && panel.y < b.y + b.height && b.y < panel.y + panel.height;
          assert.equal(overlap, false, `${sel} is not under the panel`);
        }
      } finally {
        await context.close();
      }
    });

    // The worker end to end: the real core, the real worker, hash gate and poller. The only
    // substitution is the table's executable hash, which the test points at a synthetic disc's
    // boot file (the worker's module request is rewritten by the test; nothing in the shipped
    // app does this). The disc's boot file is the pad-echo homebrew, so the core runs and the
    // mode address reads whatever a homebrew leaves there (not a game state): a live read
    // through the worker, labelled "unknown".
    test('real worker: with the gate on for a synthetic disc, the overlay shows live reads from the core', { skip: !CORE_BUILT && 'core is not built' }, async (t) => {
      if (skip) return t.skip(skip);
      const exe = Buffer.from(buildPadEcho()); // a tiny homebrew program the core can boot
      const sha = createHash('sha1').update(exe).digest('hex');
      const disc = buildIso({ files: { 'SYSTEM.CNF': 'BOOT = cdrom:\\SYNTH_000.00;1\r\n', 'SYNTH_000.00': exe } });
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
      await context.route('**/js/semantic/addresses.js', async (route) => {
        const src = readFileSync(path.join(WEB, 'js', 'semantic', 'addresses.js'), 'utf8');
        await route.fulfill({ contentType: 'text/javascript', body: src.replace(/'[0-9a-f]{40}'/, `'${sha}'`) });
      });
      const page = await context.newPage();
      try {
        await page.goto(server.url);
        await page.evaluate(() => window.ff7web.ready);
        await page.setInputFiles('#file-input', [{ name: 'synth.bin', mimeType: 'application/octet-stream', buffer: disc },
          { name: 'synth.cue', mimeType: 'text/plain', buffer: Buffer.from(cueFor('synth.bin')) }]);
        const g = await until(() => page.evaluate(() => window.ff7web.backend?.semanticGate), { what: 'the gate verdict' });
        assert.deepEqual(g, { active: true, reason: null });
        assert.equal(await visible(page, '#debug-btn'), true);
        assert.equal(await visible(page, '#debug'), false, 'off by default');
        await page.click('#debug-btn');
        await until(async () => (await rows(page)).mode, { what: 'the first sample from the worker' });
        const r = await rows(page);
        const [, label, raw, previous] = r.mode.val.match(/^(\w+) \((-?\d+)\), was (\w+)$/);
        // #92: mode() is confirmed only for a confirmed raw value (field, battle, menu) and a
        // confirmed previous one; whatever the homebrew leaves there is most likely "unknown".
        const state = SHIPPED_TABLE.entries.find((e) => e.name === 'gameState');
        const prev = SHIPPED_TABLE.entries.find((e) => e.name === 'prevGameState');
        const prevOk = Object.keys(prev.confirmedValues).some((v) => prev.values[v] === previous);
        const modeOk = label === 'movie' ? raw === '1' : raw in state.confirmedValues;
        assert.equal(r.mode.badge, SHIPPED_MODE_BADGE === 'confirmed' && modeOk && prevOk ? 'confirmed' : 'hypothesis');
        // #77 confirmed the field ID's address: the row is a live read of whatever the homebrew
        // left there, badged as the shipped table says; so is the menu cursor's (#78).
        assert.match(r.fieldId.val, /^-?\d+$/);
        assert.deepEqual({ badge: r.fieldId.badge, reason: r.fieldId.reason }, { badge: SHIPPED_FIELD_BADGE, reason: null });
        assert.match(r.menuCursor.val, /^-?\d+$/);
        assert.deepEqual({ badge: r.menuCursor.badge, reason: r.menuCursor.reason }, { badge: SHIPPED_CURSOR_BADGE, reason: null });
        // Toggling off tells the worker to stop (no more state messages).
        await page.click('#debug-btn');
        assert.equal(await visible(page, '#debug'), false);
      } finally {
        await context.close();
      }
    });

    test('real worker: a bare executable leaves the gate off, so the toggle stays hidden', { skip: !CORE_BUILT && 'core is not built' }, async (t) => {
      if (skip) return t.skip(skip);
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
      const page = await context.newPage();
      try {
        await page.goto(server.url);
        await page.evaluate(() => window.ff7web.ready);
        await page.setInputFiles('#file-input', { name: 'pad-echo.exe', mimeType: 'application/octet-stream', buffer: buildPadEcho() });
        await until(() => page.evaluate(() => window.ff7web.backend?.semanticGate), { what: 'the gate verdict' });
        assert.equal(await visible(page, '#debug-btn'), false);
        assert.equal(await page.locator('#debug-btn').isDisabled(), true);
      } finally {
        await context.close();
      }
    });
  });
}
