// Tier 1: scenario format 2 (#37) on the real core with homebrew only.
// - snapshot reuse: scenarios run from one shared snapshot give the same
//   results as each booted from scratch (in process, and through tier2.js,
//   whose results the trusted validator accepts);
// - wait.until passes on a condition pad-echo meets, and fails cleanly with
//   a timeout on one it never meets;
// - without a disc, a disc boot fails cleanly with "no disc";
// - a disc boot point on a synthetic disc, verified against disc bytes.
// Needs core/build.sh and runner/build.sh.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { build as buildPadEcho } from '../../../harness/fixtures/pad-echo.js';
import { buildExpect } from '../../../harness/private-eval/eval/lib.js';
import { loadExpect, summarize } from '../../../harness/private-eval/validate/validate.js';
import { createBackend } from '../../backend.js';
import { makeSnapshot, stateDigest } from '../../format2.js';
import { loadScenario, runScenario, ScenarioError } from '../../scenario.js';
import { buildIso } from '../../synth/iso9660.js';
import { synthExe } from './helpers.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '../../scenario.js');
const TIER2 = path.resolve(HERE, '../../tier2.js');
const EXAMPLE = path.resolve(HERE, '../../../harness/scenarios/pad-echo-script.json');
const TITLE = path.resolve(HERE, '../../../harness/scenarios/title-determinism.json');
const TIMING = ['run_ms', 'fps', 'saved_ms'];

const example = () => JSON.parse(readFileSync(EXAMPLE, 'utf8'));
const memory = example().memory;

/** Two scenarios from pad-echo-ready with different scripts. */
const scenarioA = () => ({ ...example(), name: 'f2-a' });
const scenarioB = () => ({
  format: 2,
  name: 'f2-b',
  tier: 1,
  boot: { fixture: 'pad-echo', from: 'pad-echo-ready' },
  memory,
  input: [
    { buttons: ['triangle', 'l1'], frames: 7 },
    { wait: { until: { mem: 'counter', equals: 50 }, timeout: 40 }, metric: 'to_50' },
    { buttons: ['start'], frames: 2 },
  ],
  assert: [
    { expect: { mem: 'buttons', differs: '0xffff' }, metric: 'held' },
    { expect: { mem: 'counter', equals: 52 } },
    { sameState: 'rerun', metric: 'same_rerun' },
  ],
  metrics: ['frames', 'snapshot_frames', 'to_50', 'held', 'same_rerun', 'buttons', 'counter', 'failed_assertions'],
});

/** A result without wall-clock metrics, for comparing runs. */
const stable = (r) => ({ ...r, metrics: Object.fromEntries(Object.entries(r.metrics ?? {}).filter(([k]) => !TIMING.includes(k))) });

describe('snapshot reuse', () => {
  test('two scenarios from one snapshot give the same results as each booted from scratch', async () => {
    const snap = await makeSnapshot('pad-echo-ready');
    assert.equal(snap.ok, true);
    assert.equal(snap.frames, 30);
    for (const doc of [scenarioA(), scenarioB()]) {
      const sc = loadScenario(doc);
      const shared = await runScenario(sc, { snapshot: snap });
      const own = await runScenario(sc); // boots the boot point, snapshots and restores
      const fresh = await runScenario(sc, { fresh: true }); // boots and plays on, no snapshot at all
      assert.equal(shared.status, 'pass', `${doc.name}: ${JSON.stringify(shared)}`);
      assert.deepEqual(stable(shared), stable(own), doc.name);
      assert.deepEqual(stable(shared), stable(fresh), doc.name);
      assert.equal(shared.metrics.snapshot_frames, 30);
    }
  });

  test('tier2.js boots the boot point once per run and passes the snapshot to each scenario; the validator accepts the results', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ff7-f2-tier2-'));
    cleanups.push(dir);
    const work = path.join(dir, 'work');
    const scenarios = path.join(work, 'harness/scenarios');
    mkdirSync(scenarios, { recursive: true });
    const a = { ...scenarioA(), tier: 2, metrics: ['frames', 'snapshot_frames', 'saved_ms', 'release_wait', 'counter_wait', 'same_rerun', 'same_boot', 'boot_stage'] };
    const b = { ...scenarioB(), tier: 2 };
    writeFileSync(path.join(scenarios, 'f2-a.json'), JSON.stringify(a));
    writeFileSync(path.join(scenarios, 'f2-b.json'), JSON.stringify(b));
    const out = path.join(dir, 'out');
    mkdirSync(out);
    const r = spawnSync(process.execPath, [TIER2, '--disc', '/nonexistent/disc.bin', '--out', out, '--scenarios', scenarios], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '');
    assert.deepEqual(readdirSync(out), ['results.json']);
    assert.equal(r.stderr.match(/^snapshot /gm).length, 1, r.stderr);
    assert.match(r.stderr, /^snapshot pad-echo-ready: 30 frames$/m);

    const summary = summarize(out, loadExpect(buildExpect(work)));
    assert.equal(summary.output, 'accepted', JSON.stringify(summary));
    assert.equal(summary.ok, true, JSON.stringify(summary));
    const by = Object.fromEntries(summary.scenarios.map((s) => [s.name, s]));
    assert.ok(Number.isInteger(by['f2-a'].metrics.saved_ms));

    // The same as each scenario run on its own, booted from scratch.
    for (const d of [a, b]) {
      const own = await runScenario(loadScenario(d, { allowTier2: true }), { fresh: true });
      assert.equal(by[d.name].status, own.status, d.name);
      assert.deepEqual(stable(by[d.name]).metrics, stable(own).metrics, d.name);
    }
  });
});

const cleanups = [];
after(() => cleanups.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('wait.until', () => {
  test('passes on a condition pad-echo meets, and reports the frames waited', async () => {
    const r = await runScenario(loadScenario(example()));
    assert.equal(r.status, 'pass', JSON.stringify(r));
    assert.deepEqual(r.waits, [{ step: 2, frames: 1, pass: true }, { step: 3, frames: 21, pass: true }]);
    assert.equal(r.metrics.release_wait, 1);
    assert.equal(r.metrics.counter_wait, 21);
  });

  test('fails cleanly with a timeout on a condition pad-echo never meets, and stops the script there', async () => {
    const d = example();
    d.input = [
      { buttons: ['cross'], frames: 2 },
      { wait: { until: { mem: 'buttons', equals: '0x0000' }, timeout: 15 }, metric: 'never' },
      { buttons: ['start'], frames: 100 },
    ];
    d.assert = [{ expect: { mem: 'counter', in: [0, '0xffffffff'] }, metric: 'any' }, { sameState: 'rerun' }];
    d.metrics = ['never', 'any', 'frames', 'failed_assertions', 'boot_stage'];
    const r = await runScenario(loadScenario(d));
    assert.equal(r.status, 'fail');
    assert.deepEqual(r.waits, [{ step: 1, frames: 0, pass: false }]);
    assert.deepEqual(r.metrics, { never: 0, any: 0, frames: 17, failed_assertions: 3, boot_stage: 6 });
    assert.ok(r.assertions.every((a) => a.pass === false), 'checks after a timeout fail');
    assert.equal(r.stopped, undefined, 'a timeout is a failed check, not a crash');
  });

  test('the CLI reports a timeout as a fail (exit 1) and two runs are byte-identical', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ff7-f2-cli-'));
    cleanups.push(dir);
    const d = example();
    d.input.push({ wait: { until: { mem: 'counter', equals: 1 }, timeout: 3 } });
    const file = path.join(dir, 'timeout.json');
    writeFileSync(file, JSON.stringify({ ...d, name: 'timeout' }));
    const run = (f) => spawnSync(process.execPath, [CLI, f], { encoding: 'utf8' });
    const t = run(file);
    assert.equal(t.status, 1, t.stderr);
    assert.equal(JSON.parse(t.stdout).status, 'fail');
    const x = run(EXAMPLE);
    const y = run(EXAMPLE);
    assert.equal(x.status, 0, x.stderr);
    assert.equal(x.stdout, y.stdout);
  });
});

describe('change checks (#77)', () => {
  test('compare the end of the script with its start; the metric is the sign', async () => {
    const d = example();
    d.assert = [
      { change: { mem: 'counter', is: 'increased' }, metric: 'up' },
      { change: { mem: 'counter', is: 'decreased', signed: true }, metric: 'down' },
      { change: { mem: 'buttons', is: 'unchanged' }, metric: 'same' },
      { change: { mem: 'buttons', is: 'changed', signed: true }, metric: 'moved' },
    ];
    d.metrics = ['up', 'down', 'same', 'moved', 'failed_assertions', 'release_wait', 'counter_wait'];
    const r = await runScenario(loadScenario(d));
    assert.equal(r.status, 'fail', 'two checks are false');
    assert.deepEqual(r.assertions.map((a) => a.pass), [true, false, true, false]);
    // The counter rises every frame; the pad is released at both ends.
    assert.deepEqual(r.metrics, { up: 1, down: 1, same: 0, moved: 0, failed_assertions: 2, release_wait: 1, counter_wait: 21 });
  });

  test('a timed-out wait fails change checks and reports sign 0', async () => {
    const d = example();
    d.input = [{ wait: { frames: 4 } }, { wait: { until: { mem: 'buttons', equals: '0x0000' }, timeout: 5 } }];
    d.assert = [{ change: { mem: 'counter', is: 'increased' }, metric: 'up' }];
    d.metrics = ['up', 'failed_assertions'];
    const r = await runScenario(loadScenario(d));
    assert.equal(r.status, 'fail');
    assert.deepEqual(r.metrics, { up: 0, failed_assertions: 2 });
  });
});

describe('state comparison', () => {
  test('the state digest separates different frames and matches equal runs', async () => {
    const fx = synthExe();
    const digests = [];
    try {
      for (const frames of [10, 10, 11]) {
        const b = await createBackend();
        b.loadProgram(fx.exe);
        b.runFrames(frames);
        digests.push(stateDigest(b));
        b.close();
      }
    } finally {
      fx.cleanup();
    }
    assert.equal(digests[0], digests[1]);
    assert.notEqual(digests[0], digests[2]);
    assert.match(digests[0], /^[0-9a-f]{64}$/);
  });
});

describe('disc boots', () => {
  let dir;
  let discFile;
  const exe = Buffer.from(buildPadEcho());
  const loadAddr = exe.readUInt32LE(0x18);
  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ff7-f2-disc-'));
    discFile = path.join(dir, 'disc.bin');
    const bin = buildIso({
      files: {
        'SYSTEM.CNF': 'BOOT = cdrom:\\PADECHO.EXE;1\r\nTCB = 4\r\nEVENT = 10\r\nSTACK = 801FFF00\r\n',
        'PADECHO.EXE': exe,
      },
    });
    writeFileSync(discFile, bin);
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  const points = (verifyPath) => ({
    'disc-ready': {
      source: { disc: 1 },
      script: [{ wait: { frames: 40 } }],
      verify: { addr: loadAddr, len: 256, equalsDiscFile: { path: verifyPath, offset: 2048 } },
    },
  });
  const discScenario = (from = 'disc-ready') => ({
    format: 2,
    name: 'f2-disc',
    tier: 2,
    boot: { disc: 1, from },
    memory,
    input: [{ buttons: ['cross'], frames: 2 }, { wait: { until: { mem: 'buttons', equals: '0xffff' }, timeout: 3 } }],
    assert: [{ sameState: 'rerun', metric: 'match' }, { sameState: 'boot', metric: 'match_boot' }],
    metrics: ['match', 'match_boot', 'snapshot_frames', 'boot_stage', 'disc_error', 'frames'],
  });

  test('a disc boot point verified against disc bytes: shared snapshot, rerun and fresh boot agree', async () => {
    const bootPoints = points('PADECHO.EXE');
    const snap = await makeSnapshot('disc-ready', { disc: discFile, bootPoints });
    assert.equal(snap.ok, true);
    const sc = loadScenario(discScenario(), { allowTier2: true, bootPoints });
    const shared = await runScenario(sc, { disc: discFile, snapshot: snap });
    assert.equal(shared.status, 'pass', JSON.stringify(shared));
    assert.deepEqual(shared.metrics, { match: 1, match_boot: 1, snapshot_frames: 40, boot_stage: 6, disc_error: 0, frames: 3 });
    assert.deepEqual(shared.disc, { name: 'disc-1' });
    assert.deepEqual(stable(await runScenario(sc, { disc: discFile })), stable(shared));
  });

  test('a boot point that is not reached fails at boot_stage 5 with snapshot_frames 0', async () => {
    const bootPoints = points('NOPE.EXE');
    assert.deepEqual(await makeSnapshot('disc-ready', { disc: discFile, bootPoints }), { ok: false });
    const r = await runScenario(loadScenario(discScenario(), { allowTier2: true, bootPoints }), { disc: discFile });
    assert.equal(r.status, 'fail');
    assert.equal(r.from.reached, false);
    assert.deepEqual(r.metrics, { match: 0, match_boot: 0, snapshot_frames: 0, boot_stage: 5, disc_error: 0, frames: 0 });
  });

  test('without a disc, a disc boot fails cleanly with "no disc" (and tier2.js reports error)', async () => {
    const title = loadScenario(JSON.parse(readFileSync(TITLE, 'utf8')), { allowTier2: true });
    await assert.rejects(runScenario(title), (e) => e instanceof ScenarioError && /^no disc/.test(e.message));
    await assert.rejects(runScenario(title, { disc: path.join(dir, 'missing.bin') }), (e) => e instanceof ScenarioError && /^no disc/.test(e.message));
    await assert.rejects(makeSnapshot('title'), (e) => e instanceof ScenarioError && /^no disc/.test(e.message));

    const sdir = path.join(dir, 'sc');
    const out = path.join(dir, 'out');
    mkdirSync(sdir);
    mkdirSync(out);
    writeFileSync(path.join(sdir, 'title-determinism.json'), readFileSync(TITLE));
    const r = spawnSync(process.execPath, [TIER2, '--disc', '/nonexistent/disc.bin', '--out', out, '--scenarios', sdir], { encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stderr, /^snapshot title: none$/m);
    assert.deepEqual(JSON.parse(readFileSync(path.join(out, 'results.json'), 'utf8')), {
      format: 1, scenarios: [{ name: 'title-determinism', status: 'error' }],
    });
  });
});
