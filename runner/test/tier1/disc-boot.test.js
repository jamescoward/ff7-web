// Tier 1: disc boot (#36) on the real core with a synthetic disc. The
// pad-echo homebrew is written as the boot executable of a MODE2/2352
// ISO9660 image (runner/synth/iso9660.js) with a cue, laid out the way the
// private eval mounts disc 1 (/disc/disc-1.cue, /disc/disc-1.bin and the
// /disc/disc.bin alias). Also: without a disc, the committed smoke
// scenario fails cleanly with "no disc". Needs core/build.sh and
// runner/build.sh.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { build as buildPadEcho } from '../../../harness/fixtures/pad-echo.js';
import { buildExpect } from '../../../harness/private-eval/eval/lib.js';
import { loadExpect, summarize } from '../../../harness/private-eval/validate/validate.js';
import { loadScenario, metricValues, runScenario, ScenarioError } from '../../scenario.js';
import { buildIso, cueFor } from '../../synth/iso9660.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TIER2 = path.resolve(HERE, '../../tier2.js');
const SMOKE = path.resolve(HERE, '../../../harness/scenarios/disc-boot-smoke.json');

const exe = Buffer.from(buildPadEcho());
const exeSha1 = createHash('sha1').update(exe).digest('hex');
const loadAddr = exe.readUInt32LE(0x18); // PS-X EXE t_addr; the body follows the 2 KiB header
const CODE_LEN = 256;

let dir;
let discDir;
before(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ff7-disc-boot-'));
  discDir = path.join(dir, 'disc');
  mkdirSync(discDir);
  const bin = buildIso({
    files: {
      'SYSTEM.CNF': 'BOOT = cdrom:\\PADECHO.EXE;1\r\nTCB = 4\r\nEVENT = 10\r\nSTACK = 801FFF00\r\n',
      'PADECHO.EXE': exe,
    },
  });
  writeFileSync(path.join(discDir, 'disc-1.bin'), bin);
  writeFileSync(path.join(discDir, 'disc.bin'), bin);
  writeFileSync(path.join(discDir, 'disc-1.cue'), cueFor('disc-1.bin'));
});
after(() => rmSync(dir, { recursive: true, force: true }));

const scenario = (over = {}) => ({
  format: 1,
  name: 'synthetic-disc-boot',
  tier: 2,
  boot: { disc: 'disc-1' },
  frames: 120,
  memory: {
    marker: { addr: '0x800f0004', type: 'bytes', len: 4 },
    code: { addr: `0x${loadAddr.toString(16)}`, type: 'bytes', len: CODE_LEN },
  },
  assert: [
    { discFile: 'SYSTEM.CNF:BOOT', sha1: exeSha1, metric: 'boot_exe_match' },
    { within: 120, mem: 'code', equalsDiscFile: { path: 'PADECHO.EXE', offset: 2048 }, metric: 'code_frame' },
    { within: 120, mem: 'marker', equals: '50414445', metric: 'marker_frame' },
  ],
  probes: [
    { discFile: 'PADECHO.EXE', sha1: '0'.repeat(40), metric: 'wrong_sha1' },
    { discFile: 'NOPE.EXE', sha1: exeSha1, metric: 'missing_file' },
    { within: 61, stillFrames: 60, metric: 'still_frame', note: 'pad-echo fills the screen with one colour: never counts' },
  ],
  metrics: ['boot_exe_match', 'code_frame', 'marker_frame', 'wrong_sha1', 'missing_file', 'still_frame', 'fps'],
  ...over,
});

test('a synthetic disc boots through its cue; disc checks report pass/fail and frames only', async () => {
  const sc = loadScenario(scenario(), { allowTier2: true });
  const r = await runScenario(sc, { disc: path.join(discDir, 'disc.bin') });
  assert.equal(r.status, 'pass', JSON.stringify(r.assertions));
  assert.deepEqual(r.disc, { name: 'disc-1', image: 'cue' });
  assert.equal(r.fixture, undefined);
  const m = r.metrics;
  assert.equal(m.boot_exe_match, 1);
  assert.equal(m.wrong_sha1, 0);
  assert.equal(m.missing_file, 0);
  assert.equal(m.still_frame, 0, 'a single-colour picture is not a still');
  assert.ok(m.code_frame >= 1 && m.code_frame <= m.marker_frame, `code resident by frame ${m.code_frame}, marker at ${m.marker_frame}`);
  assert.ok(m.fps > 0);
  // Nothing from the disc leaves: no hash of a disc file, no disc bytes.
  const text = JSON.stringify(r);
  assert.ok(!text.includes(exeSha1), 'the boot executable hash is not echoed');
  assert.ok(!text.includes(exe.subarray(2048, 2048 + 8).toString('hex')), 'disc bytes are not echoed');
  assert.deepEqual(r.probes.map((p) => [p.metric, p.pass]), [['wrong_sha1', false], ['missing_file', false], ['still_frame', false]]);
});

test('a wrong boot hash or a value never seen fails the scenario', async () => {
  const d = scenario();
  d.assert[0].sha1 = 'f'.repeat(40);
  d.assert[2].equals = '41414141'; // the marker is "PADE", never "AAAA"
  const r = await runScenario(loadScenario(d, { allowTier2: true }), { disc: path.join(discDir, 'disc.bin') });
  assert.equal(r.status, 'fail');
  assert.equal(r.metrics.boot_exe_match, 0);
  assert.equal(r.metrics.marker_frame, 0);
  assert.deepEqual(r.assertions.map((a) => a.pass), [false, true, false]);
});

test('without a disc the smoke scenario fails cleanly with "no disc"', async () => {
  const sc = loadScenario(JSON.parse(readFileSync(SMOKE, 'utf8')), { allowTier2: true });
  for (const disc of [undefined, path.join(dir, 'nowhere', 'disc.bin')]) {
    await assert.rejects(runScenario(sc, { disc }), (e) => e instanceof ScenarioError && /^no disc/.test(e.message));
  }

  // Through the sandbox entry point: an "error" result, not a crash or a missing entry.
  const out = path.join(dir, 'out-nodisc');
  mkdirSync(out);
  const r = spawnSync(process.execPath, [TIER2, '--disc', '/nonexistent/disc.bin', '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  const results = JSON.parse(readFileSync(path.join(out, 'results.json'), 'utf8'));
  assert.deepEqual(results.scenarios.find((s) => s.name === 'disc-boot-smoke'), { name: 'disc-boot-smoke', status: 'error' });
});

test('a disc that is there but unusable fails at its boot stage, with metrics, instead of erroring', async () => {
  const sc = loadScenario(JSON.parse(readFileSync(SMOKE, 'utf8')), { allowTier2: true });
  // No ISO9660 volume: the image opens (stage 2), the file system is not found.
  const junk = path.join(dir, 'junk');
  mkdirSync(junk);
  writeFileSync(path.join(junk, 'disc.bin'), Buffer.alloc(2352 * 20));
  let r = await runScenario(sc, { disc: path.join(junk, 'disc.bin') });
  assert.equal(r.status, 'fail');
  assert.equal(r.stopped, true);
  assert.equal(r.metrics.boot_stage, 2);
  assert.equal(r.metrics.disc_error, 7, 'no ISO9660 volume');
  assert.equal(r.metrics.frames, 0);
  assert.ok(r.assertions.every((a) => !a.pass));

  // A cue whose image is missing: stage 1, booted from the cue.
  const lone = path.join(dir, 'lone');
  mkdirSync(lone);
  writeFileSync(path.join(lone, 'disc-1.cue'), cueFor('disc-1.bin'));
  r = await runScenario(sc, { disc: path.join(lone, 'disc.bin') });
  assert.equal(r.status, 'fail');
  assert.equal(r.metrics.boot_stage, 1);
  assert.equal(r.metrics.disc_error, 5, 'the image the cue names is missing');
  assert.equal(metricValues({ metrics: ['disc_cue'], memory: {} }, { frames: 0, failed: 0, runMs: 0, finalMem: new Map(), discCue: true }).disc_cue, 1);

  // A cue the reader can't parse (BOM-prefixed cues are fine, see the unit tests).
  writeFileSync(path.join(lone, 'disc-1.cue'), 'not a cue sheet\n');
  r = await runScenario(sc, { disc: path.join(lone, 'disc.bin') });
  assert.deepEqual([r.metrics.boot_stage, r.metrics.disc_error], [1, 2], 'no FILE line');
  writeFileSync(path.join(lone, 'disc-1.cue'), 'FILE "disc-1.bin" BINARY\n');
  r = await runScenario(sc, { disc: path.join(lone, 'disc.bin') });
  assert.deepEqual([r.metrics.boot_stage, r.metrics.disc_error], [1, 3], 'no TRACK line');
  writeFileSync(path.join(lone, 'disc-1.cue'), 'FILE "disc-1.bin" BINARY\n  TRACK 01 AUDIO\n');
  r = await runScenario(sc, { disc: path.join(lone, 'disc.bin') });
  assert.deepEqual([r.metrics.boot_stage, r.metrics.disc_error], [1, 4], 'unsupported first track');

  // A full run reports stage 6.
  r = await runScenario(loadScenario(scenario({ probes: [], metrics: ['boot_stage', 'disc_cue', 'frames', 'boot_exe_match', 'code_frame', 'marker_frame'] }),
    { allowTier2: true }), { disc: path.join(discDir, 'disc.bin') });
  assert.equal(r.status, 'pass');
  assert.deepEqual([r.metrics.boot_stage, r.metrics.disc_cue, r.metrics.frames], [6, 1, 120]);
  assert.equal(r.metrics.disc_error, undefined, 'only listed metrics are reported');
});

test('runner/tier2.js boots the cue next to --disc; the validator accepts the result', () => {
  const work = path.join(dir, 'work');
  const scenarios = path.join(work, 'harness/scenarios');
  mkdirSync(scenarios, { recursive: true });
  writeFileSync(path.join(scenarios, 'synthetic-disc-boot.json'), JSON.stringify(scenario()));
  const out = path.join(dir, 'out-disc');
  mkdirSync(out);
  const r = spawnSync(process.execPath, [TIER2, '--disc', path.join(discDir, 'disc.bin'), '--out', out, '--scenarios', scenarios],
    { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const summary = summarize(out, loadExpect(buildExpect(work)));
  assert.equal(summary.output, 'accepted', JSON.stringify(summary));
  assert.equal(summary.ok, true, JSON.stringify(summary));
  const [s] = summary.scenarios;
  assert.equal(s.status, 'pass');
  assert.equal(s.metrics.boot_exe_match, 1);
  assert.ok(s.metrics.code_frame >= 1);
});
