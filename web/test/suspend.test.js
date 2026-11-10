// Tier 1: suspend/resume (#119), Labs flag `suspend`. Unit tests for the disc
// key and the state file, and browser tests on homebrew (pad-echo, vblank
// counter): no game data. The real-core tests need web/core/.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { BUTTONS_ADDR, COUNTER_ADDR, build as buildPadEcho } from '../../harness/fixtures/pad-echo.js';
import { buildExe as buildVblankCounter } from '../../runner/synth/vblank-counter.js';
import {
  decodeStateFile, discKey, encodeStateFile, HEAD_BYTES, MAGIC, SMALL_FILE, sha256Hex, sha256Js, StateFileError, TAIL_BYTES,
} from '../js/state-file.js';
import { BROWSERS, CORE_BUILT, launch, loadPlaywright, serveWeb, until } from './helpers.js';

const pw = loadPlaywright();
const NEEDS_CORE = CORE_BUILT ? false : 'web/core/ is not built (core/build.sh, core/web/link.sh)';

let server;
before(async () => { server = await serveWeb(); });
after(() => server?.close());

// ---- unit ----------------------------------------------------------------

test('the JS SHA-256 fallback matches node:crypto', () => {
  for (const n of [0, 1, 55, 56, 63, 64, 65, 1000, 70_001]) {
    const b = new Uint8Array(n).map((_, i) => (i * 31 + 7) & 255);
    assert.equal(Buffer.from(sha256Js(b)).toString('hex'), createHash('sha256').update(b).digest('hex'), `length ${n}`);
  }
});

test('disc key: whole file when small; size + head + tail when large', async () => {
  const small = new Uint8Array(1000).fill(3);
  const k = await discKey(new Blob([small]));
  assert.match(k, /^[0-9a-f]{64}$/);
  assert.equal(await discKey(new Blob([small])), k);
  const changed = small.slice();
  changed[500] ^= 1;
  assert.notEqual(await discKey(new Blob([changed])), k, 'small files are hashed whole');

  const size = SMALL_FILE + 1000;
  const big = new Uint8Array(size).map((_, i) => i & 255);
  const bk = await discKey(new Blob([big]));
  for (const at of [0, HEAD_BYTES - 1, size - TAIL_BYTES, size - 1]) {
    const c = big.slice();
    c[at] ^= 1;
    assert.notEqual(await discKey(new Blob([c])), bk, `byte ${at} is covered`);
  }
  const mid = big.slice();
  mid[HEAD_BYTES + 5] ^= 1; // outside head and tail: the documented blind spot
  assert.equal(await discKey(new Blob([mid])), bk);
  assert.notEqual(await discKey(new Blob([big.subarray(0, size - 1)])), bk, 'the size is part of the key');
});

const STATE = new Uint8Array(5000).map((_, i) => (i * 7) & 255);
const KEY = 'a'.repeat(64);

async function reject(bytes, opts, re) {
  await assert.rejects(() => decodeStateFile(bytes, { discKey: KEY, ...opts }), (e) => e instanceof StateFileError && re.test(e.message));
}

test('state file: round trip and every kind of damage is rejected', async () => {
  const file = await encodeStateFile({ discKey: KEY, build: 'b1', state: STATE });
  assert.equal(new TextDecoder().decode(file.subarray(0, 8)), MAGIC);
  const ok = await decodeStateFile(file, { discKey: KEY, build: 'b1', stateLength: STATE.length });
  assert.deepEqual(ok.state, STATE);

  const mut = (fn) => { const c = file.slice(); fn(c); return c; };
  await reject(new Uint8Array(0), {}, /not a saved-state/);
  await reject(mut((c) => { c[0] = 0x41; }), {}, /not a saved-state/);
  await reject(file.subarray(0, file.length - 10), {}, /wrong length/);
  await reject(mut((c) => { c[c.length - 1] ^= 1; }), {}, /checksum/);
  await reject(mut((c) => { c[8] = 0xff; c[9] = 0xff; }), {}, /bad header/);
  await reject(mut((c) => { c[13] = 0x00; }), {}, /unreadable header|version/);
  await reject(file, { discKey: 'b'.repeat(64) }, /different disc/);
  await reject(file, { build: 'b2' }, /different emulator core build/);
  await reject(file, { stateLength: STATE.length + 1 }, /does not fit/);
  const v2 = await encodeStateFile({ discKey: KEY, state: STATE });
  const text = new TextDecoder().decode(v2).replace('"version":1', '"version":2');
  assert.ok(text.includes('"version":2'));
  await reject(new TextEncoder().encode(text), {}, /different version/);
  // Unknown builds on either side are not a mismatch.
  await decodeStateFile(v2, { discKey: KEY, build: 'b9' });
  assert.equal(await sha256Hex(STATE), createHash('sha256').update(STATE).digest('hex'));
});

// ---- browser ---------------------------------------------------------------

const HIDE = () => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
};
const SHOW = () => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  document.dispatchEvent(new Event('visibilitychange'));
};

async function openApp(browser, query = '', context) {
  context ??= await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(server.url + query);
  await page.evaluate(() => window.ff7web.ready);
  return { context, page, errors };
}
async function boot(page, name, buffer) {
  await page.setInputFiles('#file-input', { name, mimeType: 'application/octet-stream', buffer });
  await until(() => page.evaluate(() => Boolean(window.ff7web.backend?.loaded)), { what: `${name} to boot` });
}
const counter = (page) => page.evaluate(async (a) => {
  const b = await window.ff7web.backend.readMem(a, 4);
  return (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;
}, COUNTER_ADDR);
const buttons = (page) => page.evaluate(async (a) => {
  const b = await window.ff7web.backend.readMem(a, 2);
  return b[0] | (b[1] << 8);
}, BUTTONS_ADDR);
const canvasHash = (page) => page.evaluate(() => {
  const c = document.getElementById('screen');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let h = 0x811c9dc5;
  for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
});
/** Pause the core and wait until it has really stopped. */
async function freeze(page) {
  await page.evaluate(() => window.ff7web.backend.pause());
  let last = -1;
  await until(async () => { const c = await counter(page); const same = c === last; last = c; return same; }, { interval: 120, what: 'the core to stop' });
  return last;
}
const unfreeze = (page) => page.evaluate(() => window.ff7web.backend.resume());
const stateKeys = (page) => page.evaluate(async () => {
  const dbs = (await indexedDB.databases?.()) ?? [];
  if (!dbs.some((d) => d.name === 'ff7-web-states')) return null;
  return new Promise((res, rej) => {
    const r = indexedDB.open('ff7-web-states');
    r.onsuccess = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('states')) { db.close(); res([]); return; }
      const q = db.transaction('states').objectStore('states').getAllKeys();
      q.onsuccess = () => { db.close(); res(q.result); };
      q.onerror = () => rej(q.error);
    };
    r.onerror = () => rej(r.error);
  });
});
const status = (page) => page.locator('#status').textContent();
const stateBytes = (page) => page.evaluate(async () => [...(await window.ff7web.backend.saveState())]);
const cardBytes = (page) => page.evaluate(async () => { const c = await window.ff7web.backend.getCard(); return c ? [...c] : null; });

for (const name of BROWSERS) {
  describe(`suspend: ${name}`, () => {
    let browser;
    let skip;
    before(async () => {
      const r = await launch(pw, name);
      browser = r.browser;
      skip = r.skip;
    });
    after(() => browser?.close());

    test('flag off: nothing is stored, no buttons, hiding the page does nothing', { skip: NEEDS_CORE }, async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser);
      try {
        await boot(page, 'pad-echo.exe', buildPadEcho());
        await page.evaluate(HIDE);
        await page.waitForTimeout(500);
        await page.evaluate(SHOW);
        await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
        await page.waitForTimeout(300);
        assert.equal(await stateKeys(page), null, 'the state database was never created');
        assert.equal(await page.evaluate(() => window.ff7web.suspend.offered), false);
        for (const id of ['#resume-btn', '#fresh-btn', '#state-export', '#state-tools']) assert.equal(await page.locator(id).isVisible(), false, id);
        await page.click('summary');
        assert.equal(await page.locator('#state-export').isVisible(), false);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('flag on: Export/Import state show in the Card menu only', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=suspend');
      try {
        await page.click('summary');
        assert.equal(await page.locator('#state-export').isVisible(), true);
        assert.equal(await page.locator('#state-input').locator('..').isVisible(), true);
        await page.evaluate(() => window.ff7web.labs.setFlag('suspend', false));
        assert.equal(await page.locator('#state-export').isVisible(), false);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('suspend, reload, resume: same counter and same frame hash; card untouched; other disc not offered', { skip: NEEDS_CORE }, async (t) => {
      if (skip) return t.skip(skip);
      const first = await openApp(browser, '?labs=suspend');
      const { context } = first;
      try {
        let { page, errors } = first;
        await boot(page, 'pad-echo.exe', buildPadEcho());
        await until(async () => (await buttons(page)) === 0xffff, { what: 'an idle pad' });
        const idleHash = await canvasHash(page);
        await page.evaluate(() => window.ff7web.backend.setPad('cross'));
        await until(async () => (await buttons(page)) !== 0xffff, { what: 'the held button' });
        await until(async () => (await canvasHash(page)) !== idleHash, { what: 'the held-button picture' });
        const cardBefore = await cardBytes(page);
        const storedCardBefore = await page.evaluate(async () => { const c = await window.ff7web.cards.load(); return c ? [...c] : null; });

        await page.evaluate(HIDE); // visibilitychange -> hidden: the save, then the pause
        await until(async () => (await stateKeys(page))?.length === 1, { what: 'the state to be stored' });
        const c1 = await freeze(page);
        const h1 = await canvasHash(page);
        assert.ok(c1 > 0);

        await page.reload();
        await page.evaluate(() => window.ff7web.ready);
        await boot(page, 'pad-echo.exe', buildPadEcho());
        await until(() => page.locator('#resume-btn').isVisible(), { what: 'the Resume offer' });
        const c0 = await freeze(page);
        assert.notEqual(c0, c1, 'the fresh boot is somewhere else');
        // The offer must survive a suspend that happens before Resume is tapped.
        await page.evaluate(HIDE);
        await page.waitForTimeout(300);
        await page.evaluate(SHOW);
        await freeze(page);
        assert.equal(await page.locator('#resume-btn').isVisible(), true);

        await page.click('#resume-btn');
        await until(async () => (await status(page)).includes('Resumed'), { what: 'the resume notice' });
        assert.equal(await counter(page), c1, 'RAM is the suspended RAM');
        assert.equal(await page.locator('#resume-btn').isVisible(), false);

        // Running on from the restored state: same picture for the same pad.
        await page.evaluate(() => window.ff7web.backend.setPad('cross'));
        await unfreeze(page);
        await until(async () => (await counter(page)) > c1 + 3, { what: 'the game to run on' });
        await until(async () => (await canvasHash(page)) === h1, { what: 'the same frame hash' });
        assert.ok((await counter(page)) < c1 + 10_000);

        assert.deepEqual(await cardBytes(page), cardBefore, 'the memory card bytes are unchanged');
        assert.deepEqual(await page.evaluate(async () => { const c = await window.ff7web.cards.load(); return c ? [...c] : null; }), storedCardBefore);

        // Another disc: the stored state is not offered.
        const other = await openApp(browser, '?labs=suspend', context);
        page = other.page;
        await boot(page, 'vblank-counter.exe', buildVblankCounter());
        await page.waitForTimeout(800);
        assert.equal(await page.locator('#resume-btn').isVisible(), false);
        assert.equal(await page.evaluate(() => window.ff7web.suspend.offered), false);
        errors = [...errors, ...other.errors];
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('pagehide alone also stores a state; Start fresh deletes it', { skip: NEEDS_CORE }, async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=suspend');
      try {
        await boot(page, 'pad-echo.exe', buildPadEcho());
        await page.waitForTimeout(300);
        await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
        await until(async () => (await stateKeys(page))?.length === 1, { what: 'the state to be stored' });
        await page.reload();
        await page.evaluate(() => window.ff7web.ready);
        await boot(page, 'pad-echo.exe', buildPadEcho());
        await until(() => page.locator('#fresh-btn').isVisible(), { what: 'the offer' });
        await page.click('#fresh-btn');
        assert.equal(await page.locator('#resume-btn').isVisible(), false);
        assert.deepEqual(await stateKeys(page), []);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    test('export then import round-trips; corrupt, truncated and other-disc files are rejected and change nothing', { skip: NEEDS_CORE }, async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser, '?labs=suspend');
      try {
        await boot(page, 'pad-echo.exe', buildPadEcho());
        await page.waitForTimeout(300);
        const c1 = await freeze(page);
        const exported = await stateBytes(page);
        await page.click('summary');
        const [download] = await Promise.all([page.waitForEvent('download'), page.click('#state-export')]);
        const fs = await import('node:fs/promises');
        const file = await fs.readFile(await download.path());
        assert.equal(file.subarray(0, 8).toString(), MAGIC);
        assert.equal(file.length > exported.length, true);

        const importFile = async (buffer, label = 'state.f7s') => {
          await page.setInputFiles('#state-input', { name: label, mimeType: 'application/octet-stream', buffer });
        };
        await unfreeze(page);
        await until(async () => (await counter(page)) > c1 + 5, { what: 'the game to run on' });
        const c2 = await freeze(page);
        await importFile(file);
        await until(async () => (await status(page)).includes('State imported'), { what: 'the import notice' });
        assert.equal(await counter(page), c1, 'import put the game back where it was exported');
        assert.notEqual(c2, c1);

        // Rejections: the paused core's state must be byte-identical afterwards.
        const before = await stateBytes(page);
        const cardBefore = await cardBytes(page);
        const flipped = Buffer.from(file);
        flipped[flipped.length - 100] ^= 0xff;
        const cases = [
          ['a flipped byte', flipped, /checksum/],
          ['a truncated file', file.subarray(0, file.length - 500), /wrong length/],
          ['not a state file', Buffer.from('hello'), /not a saved-state/],
          ['a card file', Buffer.alloc(131072, 1), /not a saved-state/],
        ];
        for (const [what, buf, re] of cases) {
          await page.evaluate(() => document.getElementById('status').click());
          await importFile(buf);
          await until(async () => /Import failed/.test(await status(page)), { what: `${what} to be rejected` });
          assert.match(await status(page), re, what);
          assert.match(await status(page), /unchanged/);
          assert.equal(await page.locator('#status').getAttribute('data-kind'), 'error');
          assert.deepEqual(await stateBytes(page), before, `${what} changed the game`);
        }
        assert.deepEqual(await cardBytes(page), cardBefore);

        // A state for another disc: the file is valid but its key is not this disc's.
        const other = await openApp(browser, '?labs=suspend', context);
        await boot(other.page, 'vblank-counter.exe', buildVblankCounter());
        await freeze(other.page);
        const otherBefore = await stateBytes(other.page);
        await other.page.setInputFiles('#state-input', { name: 'x.f7s', mimeType: 'application/octet-stream', buffer: file });
        await until(async () => /Import failed/.test(await status(other.page)), { what: 'the other-disc file to be rejected' });
        assert.match(await status(other.page), /different disc/);
        assert.deepEqual(await stateBytes(other.page), otherBefore);

        assert.deepEqual([...errors, ...other.errors], []);
      } finally { await context.close(); }
    });

    test('the core refuses a wrong-size state and the game is unchanged', { skip: NEEDS_CORE }, async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser);
      try {
        await boot(page, 'pad-echo.exe', buildPadEcho());
        await freeze(page);
        const before = await stateBytes(page);
        const msg = await page.evaluate(async () => {
          try { await window.ff7web.backend.loadState(new Uint8Array(100)); return 'accepted'; } catch (e) { return e.message; }
        });
        assert.match(msg, /does not fit/);
        assert.deepEqual(await stateBytes(page), before);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  });
}
