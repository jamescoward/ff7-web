// Tier 1: the semantic layer's hash gate in the browser (#75). The player's
// disc file is hashed locally in a worker with the shared ISO9660 reader.
// Synthetic discs only; no game data.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { build as buildPadEcho } from '../../harness/fixtures/pad-echo.js';
import { buildIso } from '../../runner/synth/iso9660.js';
import { BROWSERS, CORE_BUILT, launch, loadPlaywright, serveWeb, until } from './helpers.js';

const pw = loadPlaywright();
let server;
before(async () => { server = await serveWeb(); });
after(() => server?.close());

const exe = Buffer.from('synthetic boot executable, not a game file '.repeat(200));
const files = { 'SYSTEM.CNF': 'BOOT = cdrom:\\SYNTH_000.00;1\r\n', 'SYNTH_000.00': exe };
const sha = createHash('sha1').update(exe).digest('hex');

/** Run gateForFiles inside a module worker (FileReaderSync lives only there). */
async function gate(page, discBytes, name, tableSha) {
  return page.evaluate(async ({ bytes, name, tableSha, origin }) => {
    const src = `
      import { gateForFiles } from '${origin}/js/disc-gate.js';
      import { ADDRESS_TABLE } from '${origin}/js/semantic/addresses.js';
      self.onmessage = async ({ data }) => {
        const table = data.tableSha ? { ...ADDRESS_TABLE, exe: data.tableSha } : ADDRESS_TABLE;
        self.postMessage(await gateForFiles(data.files, table));
      };`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const w = new Worker(url, { type: 'module' });
    return new Promise((resolve, reject) => {
      w.onmessage = (e) => resolve(e.data);
      w.onerror = (e) => reject(new Error(e.message));
      w.postMessage({ files: [new File([new Uint8Array(bytes)], name)], tableSha });
    });
  }, { bytes: [...discBytes], name, tableSha, origin: server.url.replace(/\/$/, '') });
}

for (const name of BROWSERS) {
  describe(`hash gate: ${name}`, () => {
    let browser;
    let skip;
    before(async () => {
      const r = await launch(pw, name);
      browser = r.browser;
      skip = r.skip;
    });
    after(() => browser?.close());

    test('a synthetic disc with another boot executable leaves the layer off; a table with its hash turns it on', async (t) => {
      if (skip) return t.skip(skip);
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      try {
        await page.goto(`${server.url}index.html`);
        const disc = buildIso({ files });
        const off = await gate(page, disc, 'synth.bin');
        assert.equal(off.active, false);
        assert.match(off.reason, /not the one the address table describes/);
        assert.deepEqual(await gate(page, disc, 'synth.bin', sha), { active: true, reason: null });
        // Not a raw ISO9660 image, or not a disc at all: off, with a reason.
        assert.equal((await gate(page, Buffer.alloc(4096), 'junk.bin', sha)).active, false);
        assert.match((await gate(page, disc, 'synth.chd', sha)).reason, /no raw disc image/);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });

    test('loading a program reports the gate from the worker, off for a bare executable', { skip: !CORE_BUILT && 'core is not built' }, async (t) => {
      if (skip) return t.skip(skip);
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await page.goto(server.url);
        await page.evaluate(() => window.ff7web.ready);
        await page.setInputFiles('#file-input', { name: 'pad-echo.exe', mimeType: 'application/octet-stream', buffer: buildPadEcho() });
        const g = await until(() => page.evaluate(() => window.ff7web.backend?.semanticGate), { what: 'the gate verdict' });
        assert.equal(g.active, false);
        assert.match(g.reason, /no raw disc image/);
      } finally {
        await context.close();
      }
    });
  });
}
