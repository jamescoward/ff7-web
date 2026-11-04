// Tier 1 browser tests for the wrapper (issue #7), on Chromium and WebKit
// through Playwright. Tests that run the core need core/build.sh and
// core/web/link.sh; the gamepad and memory card tests do not.
//
// Test programs are original homebrew built at test time (no game data):
// runner/synth/vblank-counter.js (picture changes every frame) and
// harness/fixtures/pad-echo.js (stores the pad's button word in RAM).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { BUTTONS_ADDR, build as buildPadEcho } from '../../harness/fixtures/pad-echo.js';
import { buildExe as buildVblankCounter } from '../../runner/synth/vblank-counter.js';
import { BROWSERS, CORE_BUILT, launch, loadPlaywright, serveWeb, until } from './helpers.js';

const pw = loadPlaywright();
const NEEDS_CORE = CORE_BUILT ? false : 'web/core/ is not built (core/build.sh, core/web/link.sh)';

let server;
before(async () => {
  server = await serveWeb();
});
after(() => server?.close());

/** A small, stable digest of the canvas pixels, read in the page. */
const canvasDigest = (page) => page.evaluate(() => {
  const c = document.getElementById('screen');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let h = 0x811c9dc5;
  for (let i = 0; i < d.length; i += 4) {
    h ^= d[i] | (d[i + 1] << 8) | (d[i + 2] << 16);
    h = Math.imul(h, 0x01000193);
  }
  return `${c.width}x${c.height}:${h >>> 0}`;
});

async function openApp(browser) {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(server.url);
  await page.evaluate(() => window.ff7web.ready);
  return { context, page, errors };
}

async function bootProgram(page, name, buffer) {
  await page.setInputFiles('#file-input', { name, mimeType: 'application/octet-stream', buffer });
  await until(() => page.evaluate(() => Boolean(window.ff7web.backend?.loaded)), { what: `${name} to boot` });
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

    test('loads a homebrew program from the file input and the canvas changes over frames', { skip: NEEDS_CORE }, async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser);
      try {
        const blank = await canvasDigest(page);
        await bootProgram(page, 'vblank-counter.exe', buildVblankCounter());
        await until(() => page.evaluate(() => window.ff7web.drawnFrame() > 0), { what: 'a drawn frame' });
        const seen = new Set();
        await until(async () => {
          seen.add(await canvasDigest(page));
          return seen.size >= 3;
        }, { what: 'three different pictures' });
        assert.ok(!seen.has(blank), 'the drawn picture differs from the empty canvas');
        const frame = await page.evaluate(() => window.ff7web.drawnFrame());
        assert.ok(frame > 3, `frames advance (at ${frame})`);
        // The program counts VBLANKs in RAM: the core really ran.
        const counter = await page.evaluate(async () => {
          const b = await window.ff7web.backend.readMem(0x800f0000, 4);
          return b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24);
        });
        assert.ok(counter > 0, `VBLANK counter ${counter}`);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('virtual gamepad presses reach setPad (fake backend)', async (t) => {
      if (skip) return t.skip(skip);
      const context = await browser.newContext({ hasTouch: true });
      const page = await context.newPage();
      try {
        await page.goto(`${server.url}css/app.css`); // same origin, no app
        const calls = await page.evaluate(async (base) => {
          document.documentElement.innerHTML = `<head><link rel="stylesheet" href="${base}css/app.css"></head>
            <body><div class="pad" id="pad" style="height:420px;width:400px"></div></body>`;
          await new Promise((r) => document.querySelector('link').addEventListener('load', r, { once: true }));
          const { createVirtualGamepad } = await import(`${base}js/gamepad.js`);
          const { createInputMixer } = await import(`${base}js/pad.js`);
          const fake = { calls: [], setPad(mask) { this.calls.push(mask); } };
          const mixer = createInputMixer((m) => fake.setPad(m));
          const root = document.getElementById('pad');
          createVirtualGamepad(root, { onChange: (m) => mixer.set('touch', m) });

          const centre = (sel) => {
            const r = root.querySelector(sel).getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2, r };
          };
          const fire = (type, id, { x, y }) => root.dispatchEvent(new PointerEvent(type, {
            pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y,
            bubbles: true, cancelable: true,
          }));
          const sizes = [...root.querySelectorAll('[data-btn], [data-dpad]')].map((el) => {
            const r = el.getBoundingClientRect();
            return [el.dataset.btn ?? 'dpad', Math.round(r.width), Math.round(r.height)];
          });

          // One finger on Cross, a second on Start, release Cross, release Start.
          fire('pointerdown', 1, centre('[data-btn="cross"]'));
          fire('pointerdown', 2, centre('[data-btn="start"]'));
          fire('pointerup', 1, centre('[data-btn="cross"]'));
          fire('pointerup', 2, centre('[data-btn="start"]'));
          // Slide from Square to Triangle without lifting.
          fire('pointerdown', 3, centre('[data-btn="square"]'));
          fire('pointermove', 3, centre('[data-btn="triangle"]'));
          fire('pointerup', 3, centre('[data-btn="triangle"]'));
          // D-pad: up-right diagonal, then slide to down.
          const d = centre('[data-dpad]');
          fire('pointerdown', 4, { x: d.x + d.r.width * 0.3, y: d.y - d.r.height * 0.3 });
          fire('pointermove', 4, { x: d.x, y: d.y + d.r.height * 0.4 });
          fire('pointercancel', 4, { x: d.x, y: d.y + d.r.height * 0.4 });
          return { calls: fake.calls, sizes };
        }, server.url);

        const { PAD } = await import('../js/pad.js');
        assert.deepEqual(calls.calls, [
          PAD.cross,
          PAD.cross | PAD.start,
          PAD.start,
          0,
          PAD.square,
          PAD.triangle,
          0,
          PAD.up | PAD.right,
          PAD.down,
          0,
        ]);
        for (const [what, w, h] of calls.sizes) {
          assert.ok(w >= 44 && h >= 44, `${what} touch target is ${w}x${h}, needs >= 44x44`);
        }
      } finally {
        await context.close();
      }
    });

    test('memory card export -> import round trip with a synthetic card', async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser);
      try {
        // A synthetic card: formatted, plus a recognisable pattern in block 1.
        const { blankCard } = await import('../js/memcard.js');
        const card = blankCard();
        for (let i = 0; i < 8192; i++) card[8192 + i] = (i * 7 + 3) & 0xff;
        const cardBuf = Buffer.from(card);

        await page.setInputFiles('#card-input', { name: 'synthetic.mcr', mimeType: 'application/octet-stream', buffer: cardBuf });
        await until(async () => {
          const stored = await page.evaluate(async () => {
            const c = await window.ff7web.cards.load();
            return c ? Array.from(c.subarray(8192, 8200)) : null;
          });
          return stored && stored[0] === 3;
        }, { what: 'the imported card to be stored' });

        // Export it as a file...
        await page.click('summary');
        const [download] = await Promise.all([page.waitForEvent('download'), page.click('#card-export')]);
        const exported = await download.createReadStream().then(async (s) => {
          const chunks = [];
          for await (const c of s) chunks.push(c);
          return Buffer.concat(chunks);
        });
        assert.equal(download.suggestedFilename(), 'ff7-web-card1.mcr');
        assert.ok(exported.equals(cardBuf), 'exported card equals the imported one');

        // ...clear storage, import the exported file, and compare again.
        await page.evaluate(async () => {
          const { blankCard: blank } = await import('./js/memcard.js');
          await window.ff7web.cards.save(blank());
        });
        await page.setInputFiles('#card-input', { name: 'ff7-web-card1.mcr', mimeType: 'application/octet-stream', buffer: exported });
        const roundTrip = await until(async () => {
          const c = await page.evaluate(async () => Array.from((await window.ff7web.cards.load()) ?? []));
          return c[8192] === 3 ? Buffer.from(c) : null;
        }, { what: 'the re-imported card' });
        assert.ok(roundTrip.equals(cardBuf), 'round-tripped card is byte-identical');

        // A file that isn't a card is refused with a reason, and storage is untouched.
        await page.setInputFiles('#card-input', { name: 'bad.mcr', mimeType: 'application/octet-stream', buffer: Buffer.alloc(1000) });
        await until(() => page.evaluate(() => /Import failed/.test(document.getElementById('status').textContent)), { what: 'the refusal' });
        const still = await page.evaluate(async () => (await window.ff7web.cards.load())[8192]);
        assert.equal(still, 3);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('the stored card is in slot 1 when a program boots, and an import reaches the running core', { skip: NEEDS_CORE }, async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser);
      try {
        const { blankCard } = await import('../js/memcard.js');
        const first = blankCard();
        first[8192] = 0x11;
        await page.setInputFiles('#card-input', { name: 'a.mcr', mimeType: 'application/octet-stream', buffer: Buffer.from(first) });
        await until(() => page.evaluate(async () => (await window.ff7web.cards.load())?.[8192] === 0x11), { what: 'storage' });

        await bootProgram(page, 'vblank-counter.exe', buildVblankCounter());
        const inCore = await page.evaluate(async () => Array.from(await window.ff7web.backend.getCard()));
        assert.ok(Buffer.from(inCore).equals(Buffer.from(first)), 'core slot 1 holds the stored card');

        const second = blankCard();
        second[8192] = 0x22;
        await page.setInputFiles('#card-input', { name: 'b.mcr', mimeType: 'application/octet-stream', buffer: Buffer.from(second) });
        const live = await until(async () => {
          const c = await page.evaluate(async () => Array.from(await window.ff7web.backend.getCard()));
          return c[8192] === 0x22 ? Buffer.from(c) : null;
        }, { what: 'the import to reach the core' });
        assert.ok(live.equals(Buffer.from(second)));
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    // Owner's iPhone check on PR #21: double-tap zoomed the page, and the
    // Card panel ran off the right edge.
    test('phone layout: no double-tap zoom, the card panel stays on screen', async (t) => {
      if (skip) return t.skip(skip);
      for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 568 }]) {
        const context = await browser.newContext({ viewport, hasTouch: true });
        const page = await context.newPage();
        try {
          await page.goto(server.url);
          const r = await page.evaluate(() => {
            const pad = document.querySelector('[data-btn="cross"]');
            const ev = new Event('touchstart', { bubbles: true, cancelable: true });
            pad.dispatchEvent(ev);
            return {
              touchAction: getComputedStyle(document.documentElement).touchAction,
              padTouchCancelled: ev.defaultPrevented,
            };
          });
          assert.equal(r.touchAction, 'manipulation', `${viewport.width}x${viewport.height}: html touch-action`);
          assert.ok(r.padTouchCancelled, 'a touch on the pad is cancelled (no zoom, no callout)');

          await page.click('summary');
          const box = await page.locator('.menu-body').boundingBox();
          assert.ok(box.x >= 0 && box.x + box.width <= viewport.width,
            `${viewport.width}x${viewport.height}: card panel spans ${box.x}..${box.x + box.width}`);
          assert.ok(box.y + box.height <= viewport.height, 'card panel fits vertically');
        } finally {
          await context.close();
        }
      }
    });

    // Owner's iPhone check: sound played only after toggling it off and on
    // (the context stayed suspended after the file picker), and only on
    // headphones (the silent switch mutes "ambient" Web Audio).
    test('audio: asks for a playback session, and a later tap resumes a suspended context', async (t) => {
      if (skip) return t.skip(skip);
      const context = await browser.newContext();
      await context.addInitScript(() => {
        // The Audio Session API exists only in Safari 16.4+: stub it so the
        // request is observable in every browser.
        Object.defineProperty(navigator, 'audioSession', { value: { type: 'auto' }, configurable: true });
      });
      const page = await context.newPage();
      try {
        await page.goto(server.url);
        await page.evaluate(() => window.ff7web.ready);
        assert.equal(await page.evaluate(() => window.ff7web.audio.state), 'off');
        // Sound off, then on: the second tap unlocks audio.
        await page.click('#mute-btn');
        await page.click('#mute-btn');
        await until(() => page.evaluate(() => window.ff7web.audio.context !== null), { what: 'an AudioContext' });
        assert.equal(await page.evaluate(() => navigator.audioSession.type), 'playback');

        // Simulate iOS suspending the context, then tap the page.
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

        // Muted: a tap must not restart sound.
        await page.click('#mute-btn');
        assert.equal(await page.evaluate(() => window.ff7web.audio.needsResume), false);
      } finally {
        await context.close();
      }
    });

    test('a virtual gamepad press reaches the PS1 program (pad-echo)', { skip: NEEDS_CORE }, async (t) => {
      if (skip) return t.skip(skip);
      const { context, page, errors } = await openApp(browser);
      try {
        await bootProgram(page, 'pad-echo.exe', buildPadEcho());
        const buttons = () => page.evaluate(async (addr) => {
          const b = await window.ff7web.backend.readMem(addr, 2);
          return b[0] | (b[1] << 8);
        }, BUTTONS_ADDR);
        await until(async () => (await buttons()) === 0xffff, { what: 'pad-echo to see an idle pad' });

        const box = await page.locator('[data-btn="cross"]').boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        // Cross is bit 14 of the active-low PS1 button word.
        await until(async () => (await buttons()) === 0xbfff, { what: 'Cross to reach the program' });
        await page.mouse.up();
        await until(async () => (await buttons()) === 0xffff, { what: 'the release' });

        // Keyboard too: Enter is Start (bit 3).
        await page.keyboard.down('Enter');
        await until(async () => (await buttons()) === 0xfff7, { what: 'Start from the keyboard' });
        await page.keyboard.up('Enter');
        await until(async () => (await buttons()) === 0xffff, { what: 'the key release' });
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  });
}
