// Tier 1: chained snapshots and input segments (#74) on the real core with
// homebrew only.
// - chain equals scratch: on pad-echo, scenario B run from the snapshot A
//   kept gives the same results as A's script followed by B's in one
//   scenario from the boot point; B's "boot" check (replaying the chain from
//   power-on with no snapshot) matches, and fails when the chain differs;
// - the same through runner/tier2.js, with snapshots passed between child
//   processes on pipes, segments read from segments/, and "no snapshot" for
//   a scenario whose snapshot no earlier scenario kept; the trusted
//   validator accepts the results;
// - a scenario that fails keeps no snapshot;
// - the CLI expands segments beside the scenario file and refuses a
//   scenario from a named snapshot ("no snapshot").
// Needs core/build.sh and runner/build.sh.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildExpect } from '../../../harness/private-eval/eval/lib.js';
import { loadExpect, summarize } from '../../../harness/private-eval/validate/validate.js';
import { runScenario2, runSequence } from '../../format2.js';
import { loadScenario } from '../../scenario.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '../../scenario.js');
const TIER2 = path.resolve(HERE, '../../tier2.js');

const cleanups = [];
after(() => cleanups.forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = (prefix) => {
  const d = mkdtempSync(path.join(tmpdir(), prefix));
  cleanups.push(d);
  return d;
};

const memory = {
  counter: { addr: '0x800f0000', type: 'u32', description: 'VBLANKs seen by pad-echo' },
  buttons: { addr: '0x800f0008', type: 'u16', description: 'pad button word, active low' },
};
const SEGMENTS = {
  sa: {
    name: 'sa',
    steps: [
      { wait: { frames: 4 } },
      { buttons: ['circle'], frames: 3 },
      { wait: { until: { mem: 'counter', in: [45, 50] }, timeout: 30, press: { buttons: ['up'], every: 4 } } },
    ],
  },
  sb: {
    name: 'sb',
    steps: [
      { buttons: ['triangle', 'l1'], frames: 5 },
      { wait: { frames: 7 } },
      { wait: { until: { mem: 'buttons', equals: '0xbfff' }, timeout: 20, press: { buttons: ['cross'], every: 6, hold: 2 } }, metric: 'cross_wait' },
    ],
  },
};
const ENDS = [
  { expect: { mem: 'buttons', equals: '0xbfff' } },
  { expect: { mem: 'counter', in: [55, 60] }, metric: 'counter_ok' },
];
const MEM_METRICS = ['cross_wait', 'counter', 'buttons', 'counter_ok'];

/** A: pad-echo-ready, segment sa, keeps "pe-a". */
const docA = (tier = 1) => ({
  format: 2,
  name: 'chain-a',
  tier,
  boot: { fixture: 'pad-echo', from: 'pad-echo-ready' },
  memory,
  input: [{ segment: 'sa' }],
  assert: [{ expect: { mem: 'counter', in: [45, 50] } }, { sameState: 'rerun', metric: 'match' }],
  snapshot: 'pe-a',
  metrics: ['frames', 'match', 'snapshot_frames'],
});
/** B: from "pe-a", segment sb. */
const docB = (tier = 1) => ({
  format: 2,
  name: 'chain-b',
  tier,
  boot: { from: 'pe-a' },
  memory,
  input: [{ segment: 'sb' }],
  assert: [...ENDS, { sameState: 'boot', metric: 'match_boot' }, { sameState: 'rerun', metric: 'match_rerun' }],
  metrics: [...MEM_METRICS, 'match_boot', 'match_rerun', 'snapshot_frames', 'frames'],
});
/** C: A's script then B's, in one scenario from the boot point. */
const docC = (tier = 1) => ({
  format: 2,
  name: 'chain-c-scratch',
  tier,
  boot: { fixture: 'pad-echo', from: 'pad-echo-ready' },
  memory,
  input: [{ segment: 'sa' }, { segment: 'sb' }],
  assert: [...ENDS, { sameState: 'boot', metric: 'match_boot' }],
  metrics: [...MEM_METRICS, 'match_boot', 'snapshot_frames', 'frames'],
});

/** A scenario directory with segments/, as harness/scenarios is laid out. */
function scenarioDir(docs, base = tmp('ff7-chain-')) {
  const dir = path.join(base, 'harness/scenarios');
  mkdirSync(path.join(dir, 'segments'), { recursive: true });
  for (const [name, seg] of Object.entries(SEGMENTS)) writeFileSync(path.join(dir, 'segments', `${name}.json`), JSON.stringify(seg));
  for (const d of docs) writeFileSync(path.join(dir, `${d.name}.json`), JSON.stringify(d));
  return dir;
}

const pick = (m, keys) => Object.fromEntries(keys.map((k) => [k, m[k]]));

describe('chain equals scratch (pad-echo, in process)', () => {
  const segmentsDir = path.join(scenarioDir([]), 'segments');
  const load = (d) => loadScenario(d, { segmentsDir });

  test('B from the snapshot A kept gives the same results as A\'s script followed by B\'s from the boot point', async () => {
    const [a, b, c] = await runSequence([load(docA()), load(docB()), load(docC())]);
    assert.equal(a.status, 'pass', JSON.stringify(a));
    assert.deepEqual(a.snapshot, { name: 'pe-a', kept: true });
    assert.equal(b.status, 'pass', JSON.stringify(b));
    assert.equal(c.status, 'pass', JSON.stringify(c));
    assert.deepEqual(b.from, { snapshot: 'pe-a', chain: ['chain-a'], frames: 30 + a.metrics.frames });

    // The same memory values, waits and end checks.
    assert.deepEqual(pick(b.metrics, MEM_METRICS), pick(c.metrics, MEM_METRICS));
    assert.deepEqual(b.assertions.slice(0, ENDS.length), c.assertions.slice(0, ENDS.length));
    assert.deepEqual(b.waits.map((w) => [w.frames, w.pass]), c.waits.slice(-1).map((w) => [w.frames, w.pass]));
    // The same frame, counted from power-on.
    assert.equal(b.metrics.snapshot_frames, 30 + a.metrics.frames);
    assert.equal(b.metrics.snapshot_frames + b.metrics.frames, c.metrics.snapshot_frames + c.metrics.frames);
    // The same RAM and picture: B's "boot" check replays power-on, the boot
    // point, A's script and B's script in one core with no snapshot.
    assert.equal(b.metrics.match_boot, 1);
    assert.equal(b.metrics.match_rerun, 1);
    assert.equal(c.metrics.match_boot, 1);
  });

  test('"fresh" (no snapshot at all) gives the same results as the snapshot', async () => {
    let kept;
    await runScenario2(load(docA()), { onSnapshot: (s) => { kept = s; } });
    const a = load(docA());
    const b = load(docB());
    const timing = ['saved_ms'];
    const strip = (r) => ({ ...r, metrics: Object.fromEntries(Object.entries(r.metrics).filter(([k]) => !timing.includes(k))) });
    const shared = await runScenario2(b, { snapshot: { ...kept, chain: [a] } });
    const fresh = await runScenario2(b, { snapshot: { ...kept, chain: [a] }, fresh: true });
    assert.equal(shared.status, 'pass');
    assert.deepEqual(strip(fresh), strip(shared));
  });

  test('the "boot" check fails when the chain does not lead to the snapshot\'s state', async () => {
    let kept;
    await runScenario2(load(docA()), { onSnapshot: (s) => { kept = s; } });
    // Same names, another script: replaying it from power-on ends elsewhere.
    const other = { ...docA(), input: [{ segment: 'sa' }, { wait: { frames: 1 } }] };
    const r = await runScenario2(load(docB()), { snapshot: { ...kept, chain: [load(other)] } });
    assert.equal(r.status, 'fail');
    assert.equal(r.metrics.match_boot, 0);
    assert.equal(r.metrics.match_rerun, 1);
  });

  test('a scenario that fails keeps no snapshot, so a later one reports "no snapshot" without running', async () => {
    const failing = { ...docA(), assert: [{ expect: { mem: 'counter', equals: 1 } }, { sameState: 'rerun', metric: 'match' }] };
    const [a, b] = await runSequence([load(failing), load(docB())]);
    assert.equal(a.status, 'fail');
    assert.deepEqual(a.snapshot, { name: 'pe-a', kept: false });
    assert.deepEqual(b, { scenario: 'chain-b', status: 'error', error: 'no snapshot' });
  });

  test('order decides what exists: B before A reports "no snapshot"', async () => {
    const [b, a] = await runSequence([load(docB()), load(docA())]);
    assert.deepEqual(b, { scenario: 'chain-b', status: 'error', error: 'no snapshot' });
    assert.equal(a.status, 'pass');
  });
});

describe('chain through tier2.js', () => {
  test('snapshots pass between children in memory; unknown and not-yet-kept snapshots report error; the validator accepts the results', async () => {
    const base = tmp('ff7-chain-t2-');
    const early = { ...docB(2), name: '0-early' }; // sorts before chain-a
    const orphan = { ...docB(2), name: 'x-orphan', boot: { from: 'nowhere' } };
    const scenarios = scenarioDir([docA(2), docB(2), docC(2), early, orphan], path.join(base, 'work'));
    const out = path.join(base, 'out');
    mkdirSync(out);
    const r = spawnSync(process.execPath, [TIER2, '--disc', '/nonexistent/disc.bin', '--out', out, '--scenarios', scenarios], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '');
    assert.deepEqual(readdirSync(out), ['results.json'], 'no snapshot is written to a file');
    assert.match(r.stderr, /^0-early: error \(no snapshot\)$/m);
    assert.match(r.stderr, /^x-orphan: error \(no snapshot\)$/m);
    assert.match(r.stderr, /^kept pe-a: \d+ frames$/m);

    const summary = summarize(out, loadExpect(buildExpect(path.join(base, 'work'))));
    assert.equal(summary.output, 'accepted', JSON.stringify(summary));
    const by = Object.fromEntries(summary.scenarios.map((s) => [s.name, s]));
    assert.equal(by['0-early'].status, 'error');
    assert.equal(by['x-orphan'].status, 'error');
    for (const n of ['chain-a', 'chain-b', 'chain-c-scratch']) assert.equal(by[n].status, 'pass', `${n}: ${JSON.stringify(by[n])}`);
    const b = by['chain-b'].metrics;
    const c = by['chain-c-scratch'].metrics;
    assert.deepEqual(pick(b, MEM_METRICS), pick(c, MEM_METRICS));
    assert.equal(b.match_boot, 1);
    assert.equal(b.match_rerun, 1);
    assert.equal(b.snapshot_frames, 30 + by['chain-a'].metrics.frames);
    assert.equal(b.snapshot_frames + b.frames, c.snapshot_frames + c.frames);

    // The same as in process.
    const segmentsDir = path.join(scenarios, 'segments');
    const seq = await runSequence([docA(2), docB(2)].map((d) => loadScenario(d, { allowTier2: true, segmentsDir })));
    assert.deepEqual(pick(seq[1].metrics, [...MEM_METRICS, 'match_boot', 'snapshot_frames', 'frames']), pick(b, [...MEM_METRICS, 'match_boot', 'snapshot_frames', 'frames']));
  });
});

describe('CLI', () => {
  test('expands segments from segments/ beside the scenario file; two runs are byte-identical', () => {
    const dir = scenarioDir([docC()]);
    const file = path.join(dir, 'chain-c-scratch.json');
    const x = spawnSync(process.execPath, [CLI, file], { encoding: 'utf8' });
    const y = spawnSync(process.execPath, [CLI, file], { encoding: 'utf8' });
    assert.equal(x.status, 0, x.stderr);
    assert.equal(JSON.parse(x.stdout).status, 'pass');
    assert.equal(x.stdout, y.stdout);
  });

  test('a scenario from a named snapshot, run alone: "no snapshot" (exit 2); a missing segment: exit 2', () => {
    const dir = scenarioDir([docB(), { ...docC(), name: 'missing-seg', input: [{ segment: 'nope' }] }]);
    const b = spawnSync(process.execPath, [CLI, path.join(dir, 'chain-b.json')], { encoding: 'utf8' });
    assert.equal(b.status, 2);
    assert.match(b.stderr, /no snapshot: "pe-a"/);
    const m = spawnSync(process.execPath, [CLI, path.join(dir, 'missing-seg.json')], { encoding: 'utf8' });
    assert.equal(m.status, 2);
    assert.match(m.stderr, /no segment named "nope"/);
  });
});
