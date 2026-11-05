// Tier 1: runner/tier2.js on the real core, with homebrew tier 2 scenarios.
// Its results.json must be accepted by the trusted validator (#34) against
// the expect file the trusted eval (#35) builds from the same scenario files,
// and a crash, a hang or an invalid scenario must report "error" rather than
// a missing result. Needs core/build.sh and runner/build.sh.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildExpect } from '../../../harness/private-eval/eval/lib.js';
import { loadExpect, summarize } from '../../../harness/private-eval/validate/validate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '../../tier2.js');
const REPO_FIXTURES = path.resolve(HERE, '../../../harness/fixtures');
const EXAMPLE = path.resolve(HERE, '../../../harness/scenarios/pad-echo-buttons.json');

let dir;
let work;
let scenarios;
let fixtures;
before(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ff7-tier2-'));
  // A work tree laid out like the tier2-build artifact.
  work = path.join(dir, 'work');
  scenarios = path.join(work, 'harness/scenarios');
  mkdirSync(scenarios, { recursive: true });

  // The real pad-echo fixture, plus two that never produce a program: one
  // kills its own process (a crash the scenario can't catch), one never
  // returns (a hang).
  fixtures = path.join(dir, 'fixtures');
  mkdirSync(fixtures);
  const reg = JSON.parse(readFileSync(path.join(REPO_FIXTURES, 'fixtures.json'), 'utf8'));
  reg.fixtures['pad-echo'].module = path.relative(fixtures, path.join(REPO_FIXTURES, 'pad-echo.js'));
  const test = { kind: 'generator', export: 'build', sha256: '0'.repeat(64), licence: 'GPL-2.0-or-later', origin: 'test', redistributable: true };
  reg.fixtures.crash = { ...test, module: 'crash.js' };
  reg.fixtures.hang = { ...test, module: 'hang.js' };
  writeFileSync(path.join(fixtures, 'fixtures.json'), JSON.stringify(reg));
  writeFileSync(path.join(fixtures, 'crash.js'), "export function build() { process.kill(process.pid, 'SIGKILL'); }\n");
  writeFileSync(path.join(fixtures, 'hang.js'), 'export function build() { for (;;); }\n');

  const example = JSON.parse(readFileSync(EXAMPLE, 'utf8'));
  delete example.checkpoints; // no baselines for these names
  const put = (name, mutate) => {
    const d = structuredClone(example);
    d.name = name;
    d.tier = 2;
    mutate(d);
    writeFileSync(path.join(scenarios, `${name}.json`), JSON.stringify(d));
  };
  put('t2-pass', (d) => { d.metrics = ['buttons', 'failed_assertions', 'fps', 'run_ms']; });
  put('t2-fail', (d) => {
    d.metrics = ['failed_assertions'];
    d.assert.find((a) => a.at === 10 && a.mem === 'buttons').equals = '0xffff';
  });
  put('t2-crash', (d) => { d.boot.fixture = 'crash'; d.metrics = ['fps']; });
  put('t2-invalid', (d) => { d.boot.fixture = 'no-such-fixture'; });
  put('t2-load-error', (d) => { d.assert[0].at = 999; }); // valid for the builder, refused by loadScenario
  put('z-hang', (d) => { d.boot.fixture = 'hang'; }); // last, so the deadline only cuts this one
  writeFileSync(path.join(scenarios, 'pad-echo-buttons.json'), JSON.stringify(example)); // tier 1: ignored
});
after(() => rmSync(dir, { recursive: true, force: true }));

function runTier2(out, ...extra) {
  mkdirSync(out);
  return spawnSync(process.execPath, [CLI, '--disc', '/nonexistent/disc.bin', '--out', out, '--scenarios', scenarios,
    '--fixtures', fixtures, ...extra], { encoding: 'utf8' });
}

test('results.json is accepted by the validator against the trusted expect file; crashes and hangs report error', () => {
  const out = path.join(dir, 'out');
  const t0 = Date.now();
  const r = runTier2(out, '--deadline-s', '20');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(Date.now() - t0 < 60_000, 'the hang was cut at the deadline');

  // Only /out counts: nothing on stdout, and one file in /out.
  assert.equal(r.stdout, '');
  assert.deepEqual(readdirSync(out), ['results.json']);

  const expect = buildExpect(work);
  assert.deepEqual(Object.keys(expect.scenarios).sort(), ['t2-crash', 't2-fail', 't2-invalid', 't2-load-error', 't2-pass', 'z-hang']);
  const summary = summarize(out, loadExpect(expect));
  assert.equal(summary.output, 'accepted', JSON.stringify(summary));
  assert.equal(summary.ok, false);
  assert.deepEqual(summary.counts, { pass: 1, fail: 1, error: 4, missing: 0 });

  const by = Object.fromEntries(summary.scenarios.map((s) => [s.name, s]));
  assert.equal(by['t2-pass'].status, 'pass');
  assert.equal(by['t2-pass'].metrics.buttons, 0xffff, 'nothing held at the last frame');
  assert.equal(by['t2-pass'].metrics.failed_assertions, 0);
  assert.ok(by['t2-pass'].metrics.fps > 0);
  assert.ok(Number.isInteger(by['t2-pass'].metrics.run_ms));
  assert.deepEqual(by['t2-fail'], { name: 't2-fail', status: 'fail', metrics: { failed_assertions: 1 } });
  for (const n of ['t2-crash', 't2-invalid', 't2-load-error', 'z-hang']) assert.deepEqual(by[n], { name: n, status: 'error' }, n);
});

test('a run that passes everything gives ok', () => {
  const only = path.join(dir, 'only-pass');
  mkdirSync(only);
  writeFileSync(path.join(only, 't2-pass.json'), readFileSync(path.join(scenarios, 't2-pass.json')));
  const out = path.join(dir, 'out-pass');
  mkdirSync(out);
  const r = spawnSync(process.execPath, [CLI, '--disc', '/nonexistent/disc.bin', '--out', out, '--scenarios', only, '--fixtures', fixtures],
    { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const expect = loadExpect({ format: 1, scenarios: { 't2-pass': ['buttons', 'failed_assertions', 'fps', 'run_ms'] } });
  const summary = summarize(out, expect);
  assert.equal(summary.ok, true, JSON.stringify(summary));
  assert.deepEqual(summary.counts, { pass: 1, fail: 0, error: 0, missing: 0 });
});

test('runner/scenario.js still refuses tier 2', () => {
  const r = spawnSync(process.execPath, [path.resolve(HERE, '../../scenario.js'), path.join(scenarios, 't2-pass.json')], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /only tier 1/);
});
