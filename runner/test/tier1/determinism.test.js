// Tier 1: two CLI runs of the same input give byte-identical JSON, and the
// output carries per-frame hashes and the requested RAM values.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { COUNTER_ADDR, MARKER_ADDR } from '../../synth/vblank-counter.js';
import { synthExe } from './helpers.js';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../cli.js');
const FRAMES = 300;

let fx;
before(() => {
  fx = synthExe();
});
after(() => fx?.cleanup());

const runCli = (...args) =>
  execFileSync(process.execPath, [CLI, ...args, fx.exe], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

test('same program and inputs give identical output across processes', () => {
  const args = ['--frames', String(FRAMES), '--peek', `0x${COUNTER_ADDR.toString(16)}`, '--pad', '10-20=start,cross'];
  const a = runCli(...args);
  const b = runCli(...args);
  assert.equal(a, b);

  const out = JSON.parse(a);
  assert.equal(out.frames, FRAMES);
  assert.equal(out.samples.length, FRAMES);
  assert.deepEqual(out.samples.map((s) => s.frame), Array.from({ length: FRAMES }, (_, i) => i + 1));
  for (const s of out.samples) {
    assert.match(s.hash, /^[0-9a-f]{64}$/);
    // The counter is little-endian and equals the frame number.
    const counter = Buffer.from(s.mem[`0x${COUNTER_ADDR.toString(16)}:4`], 'hex').readUInt32LE(0);
    assert.equal(counter, s.frame);
  }
  // The fill colour encodes 15 bits of the counter, so no frame repeats here.
  assert.equal(new Set(out.samples.map((s) => s.hash)).size, FRAMES);
  assert.ok(out.core?.wasm_sha256, 'core provenance recorded');
  assert.match(out.program.sha256, /^[0-9a-f]{64}$/);
});

test('--hash-every samples every k frames plus the last frame', () => {
  const out = JSON.parse(runCli('--frames', '25', '--hash-every', '10', '--peek', `0x${MARKER_ADDR.toString(16)}:4`));
  assert.deepEqual(out.samples.map((s) => s.frame), [10, 20, 25]);
  for (const s of out.samples) assert.equal(s.mem[`0x${MARKER_ADDR.toString(16)}:4`], '46463757');
});

test('sampled hashes match the per-frame hashes of a full run', () => {
  const full = JSON.parse(runCli('--frames', '30'));
  const sparse = JSON.parse(runCli('--frames', '30', '--hash-every', '7'));
  for (const s of sparse.samples) assert.equal(s.hash, full.samples[s.frame - 1].hash);
});
