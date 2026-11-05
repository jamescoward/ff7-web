// runner/tier2.js without the core: scenario discovery agrees with the
// trusted expect builder, result entries always pass the validator's rules,
// and the CLI's usage and empty cases. The runs on the real core are in
// test/tier1/tier2.test.js.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import * as eval_ from '../../../harness/private-eval/eval/lib.js';
import * as validator from '../../../harness/private-eval/validate/validate.js';
import * as t2 from '../../tier2.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '../../tier2.js');

let dir;
before(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ff7-tier2-unit-'));
});
after(() => rmSync(dir, { recursive: true, force: true }));

const scenario = (name, extra = {}) => JSON.stringify({ format: 1, name, tier: 2, boot: { fixture: 'pad-echo' }, frames: 1, ...extra });
/** A work tree laid out like the tier2-build artifact; returns { work, scenarios }. */
function work(name, files) {
  const w = path.join(dir, name);
  const sdir = path.join(w, 'harness/scenarios');
  mkdirSync(sdir, { recursive: true });
  for (const [f, body] of Object.entries(files)) writeFileSync(path.join(sdir, f), body);
  return { work: w, scenarios: sdir };
}

describe('rules restated from the validator (#34)', () => {
  test('the limits and patterns are the same', () => {
    assert.equal(t2.MAX_SCENARIOS, validator.MAX_SCENARIOS);
    assert.equal(t2.MAX_METRICS, validator.MAX_METRICS);
    assert.equal(t2.NAME_RE.source, validator.NAME_RE.source);
    assert.equal(t2.METRIC_RE.source, validator.METRIC_RE.source);
    assert.equal(t2.MAX_SCENARIO_BYTES, eval_.MAX_SCENARIO_BYTES);
    assert.equal(t2.RESULTS_FILE, validator.RESULTS_FILE);
  });

  test('validMetricValue agrees with the validator', () => {
    const values = [0, 1, -1, 2 ** 32, -(2 ** 32), 2 ** 32 + 1, 59.94, 0.001, 0.0001, 1e6, 1e6 + 0.5, 999999.999,
      -12.345, Number.NaN, Infinity, -Infinity, '1', null, true, 1.5e300, 2 ** 53];
    for (const v of values) assert.equal(t2.validMetricValue(v), validator.validMetricValue(v), String(v));
  });
});

describe('scenario discovery', () => {
  test('finds the same scenarios and metric keys as the trusted expect builder', () => {
    const { work: w, scenarios } = work('agree', {
      'b-two.json': scenario('b-two', { metrics: ['run_ms', 'fps'] }),
      'a-one.json': scenario('a-one'),
      'tier-one.json': JSON.stringify({ format: 1, name: 'tier-one', tier: 1 }),
      'notes.txt': 'not a scenario',
    });
    const found = t2.findTier2Scenarios(scenarios);
    const expect = eval_.buildExpect(w);
    assert.deepEqual(found.map((s) => s.name), ['a-one', 'b-two']);
    assert.deepEqual(Object.keys(expect.scenarios).sort(), found.map((s) => s.name));
    for (const s of found) assert.deepEqual([...s.metrics].sort(), expect.scenarios[s.name]);
    assert.equal(found[0].file, path.join(scenarios, 'a-one.json'));
  });

  // Files the builder refuses stop the eval before tier2.js runs; here they
  // are skipped, never fatal. Files the builder skips are skipped here too.
  const skipped = {
    'name differs from the file name': ['x.json', scenario('y'), 'refuses'],
    'name outside the pattern': ['Bad.json', scenario('Bad'), 'refuses'],
    'not JSON': ['a.json', '{"tier": 2,', 'refuses'],
    'too large': ['a.json', scenario('a', { description: 'x'.repeat(64 * 1024) }), 'refuses'],
    'JSON but not an object': ['a.json', '[2]', 'skips'],
    'tier as a string': ['a.json', scenario('a', { tier: '2' }), 'skips'],
  };
  for (const [name, [file, body, trusted]] of Object.entries(skipped)) {
    test(`skips: ${name} (the trusted builder ${trusted} it)`, () => {
      const { work: w, scenarios } = work(`skip-${file}-${body.length}`, { [file]: body, 'ok.json': scenario('ok') });
      assert.deepEqual(t2.findTier2Scenarios(scenarios).map((s) => s.name), ['ok']);
      if (trusted === 'refuses') assert.throws(() => eval_.buildExpect(w), eval_.Tier2Error);
      else assert.deepEqual(Object.keys(eval_.buildExpect(w).scenarios), ['ok']);
    });
  }

  test('skips a symlinked scenario file', () => {
    const { scenarios } = work('symlink', { 'ok.json': scenario('ok') });
    writeFileSync(path.join(dir, 'outside.json'), scenario('linked'));
    symlinkSync(path.join(dir, 'outside.json'), path.join(scenarios, 'linked.json'));
    assert.deepEqual(t2.findTier2Scenarios(scenarios).map((s) => s.name), ['ok']);
  });

  test('a missing directory means no scenarios', () => {
    assert.deepEqual(t2.findTier2Scenarios(path.join(dir, 'nope')), []);
  });
});

describe('result entries', () => {
  const sc = { name: 'a', metrics: ['fps', 'run_ms'] };
  const expect = new Map([['a', new Set(sc.metrics)]]);
  const accepted = (entry) => validator.checkResults(Buffer.from(JSON.stringify({ format: 1, scenarios: [entry] })), expect);

  const cases = {
    'pass with metrics': [{ status: 'pass', metrics: { fps: 59.94, run_ms: 1000 } }, { name: 'a', status: 'pass', metrics: { fps: 59.94, run_ms: 1000 } }],
    'fail without metrics': [{ status: 'fail' }, { name: 'a', status: 'fail' }],
    'no report (crash)': [null, { name: 'a', status: 'error' }],
    'a status the format does not have': [{ status: 'ok' }, { name: 'a', status: 'error' }],
    'error from the child': [{ status: 'error', metrics: { fps: 1 } }, { name: 'a', status: 'error' }],
    'unlisted metric dropped': [{ status: 'pass', metrics: { fps: 1, secret: 7 } }, { name: 'a', status: 'pass', metrics: { fps: 1 } }],
    'invalid values dropped': [{ status: 'pass', metrics: { fps: 1.23456, run_ms: 'x' } }, { name: 'a', status: 'pass' }],
    'metrics not an object': [{ status: 'pass', metrics: [1, 2] }, { name: 'a', status: 'pass' }],
  };
  for (const [name, [child, want]] of Object.entries(cases)) {
    test(`${name}, and the validator accepts it`, () => {
      const entry = t2.resultEntry(sc, child);
      assert.deepEqual(entry, want);
      assert.doesNotThrow(() => accepted(entry));
    });
  }

  test('writeResults replaces the file and leaves no temporary file', () => {
    const out = path.join(dir, 'write');
    mkdirSync(out);
    t2.writeResults(out, [{ name: 'a', status: 'pass' }]);
    t2.writeResults(out, [{ name: 'a', status: 'pass' }, { name: 'b', status: 'error' }]);
    assert.deepEqual(readdirSync(out), ['results.json']);
    assert.equal(JSON.parse(readFileSync(path.join(out, 'results.json'), 'utf8')).scenarios.length, 2);
  });
});

describe('CLI', () => {
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

  for (const [name, args] of Object.entries({
    'no --out': ['--disc', 'd'],
    'no --disc': ['--out', 'o'],
    'unknown option': ['--disc', 'd', '--out', 'o', '--bogus'],
    'bad deadline': ['--disc', 'd', '--out', 'o', '--deadline-s', '0'],
  })) {
    test(`usage error: ${name}`, () => {
      const r = run(...args);
      assert.equal(r.status, 2);
      assert.equal(r.stdout, '');
    });
  }

  test('no tier 2 scenarios: exit 0, no results file, nothing on stdout', () => {
    const { scenarios } = work('none', { 't1.json': JSON.stringify({ tier: 1, name: 't1' }) });
    const out = path.join(dir, 'none-out');
    mkdirSync(out);
    const r = run('--disc', '/nonexistent', '--out', out, '--scenarios', scenarios);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '');
    assert.equal(existsSync(path.join(out, 'results.json')), false);
  });

  test('an unwritable output directory exits 1', () => {
    const { scenarios } = work('unwritable', { 'a.json': scenario('a', { boot: { fixture: 'no-such-fixture' } }) });
    const r = run('--disc', '/nonexistent', '--out', path.join(dir, 'missing-out'), '--scenarios', scenarios);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
  });
});
