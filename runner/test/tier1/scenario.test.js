// Tier 1: the example scenario passes on the real core, deterministically,
// and the runner fails a scenario whose expectations are wrong. Needs
// core/build.sh and runner/build.sh.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '../../scenario.js');
const EXAMPLE = path.resolve(HERE, '../../../harness/scenarios/pad-echo-buttons.json');

let dir;
before(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ff7-scenario-test-'));
});
after(() => rmSync(dir, { recursive: true, force: true }));

const run = (file, ...args) => {
  const r = spawnSync(process.execPath, [CLI, ...args, file], { encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json: r.stdout ? JSON.parse(r.stdout) : null };
};
const variant = (name, mutate) => {
  const doc = JSON.parse(readFileSync(EXAMPLE, 'utf8'));
  mutate(doc);
  const p = path.join(dir, name);
  writeFileSync(p, JSON.stringify(doc));
  return p;
};

test('the example scenario passes twice in a row with identical output', () => {
  const a = run(EXAMPLE);
  const b = run(EXAMPLE);
  assert.equal(a.code, 0, a.stderr);
  assert.equal(b.code, 0, b.stderr);
  assert.equal(a.stdout, b.stdout);
  assert.equal(a.json.status, 'pass');
  assert.ok(a.json.assertions.length >= 10);
  assert.ok(a.json.assertions.every((x) => x.pass));
  assert.equal(a.json.fixture.licence, 'GPL-2.0-or-later');
  assert.ok(a.json.core?.wasm_sha256);
});

test('a wrong memory expectation fails, reporting the actual value', () => {
  const r = run(variant('wrong-mem.json', (d) => {
    d.assert.find((x) => x.at === 10 && x.mem === 'buttons').equals = '0xffff';
  }));
  assert.equal(r.code, 1);
  assert.equal(r.json.status, 'fail');
  const failed = r.json.assertions.filter((x) => !x.pass);
  assert.deepEqual(failed, [{ at: 10, mem: 'buttons', expected: '0xffff', actual: '0xbfff', pass: false }]);
});

test('a wrong frame-hash relation fails', () => {
  const r = run(variant('wrong-hash.json', (d) => {
    d.assert.push({ at: 10, frameHash: { sameAs: 9 } });
  }));
  assert.equal(r.code, 1);
  assert.deepEqual(r.json.assertions.filter((x) => !x.pass), [{ at: 10, frameHash: { sameAs: 9 }, pass: false }]);
});

test('checkpoints are compared with a baseline when one exists', () => {
  const rec = run(EXAMPLE, '--record');
  assert.equal(rec.code, 0, rec.stderr);
  assert.deepEqual(rec.json.unverified, ['no baseline file for "pad-echo-buttons": checkpoint hashes recorded, not compared']);
  const baselines = path.join(dir, 'baselines');
  mkdirSync(baselines);
  const file = path.join(baselines, 'pad-echo-buttons.json');
  writeFileSync(file, JSON.stringify(rec.json.record));

  const ok = run(EXAMPLE, '--baselines', baselines);
  assert.equal(ok.code, 0, ok.stderr);
  assert.ok(ok.json.checkpoints.every((c) => c.pass === true));
  assert.equal(ok.json.unverified, undefined);

  const tampered = structuredClone(rec.json.record);
  tampered.checkpoints['30'] = '0'.repeat(64);
  writeFileSync(file, JSON.stringify(tampered));
  const bad = run(EXAMPLE, '--baselines', baselines);
  assert.equal(bad.code, 1);
  assert.deepEqual(bad.json.checkpoints.filter((c) => !c.pass).map((c) => c.frame), [30]);
});

test('an invalid scenario is rejected before running, with exit status 2', () => {
  const r = run(variant('invalid.json', (d) => {
    d.input[0].buttons = ['x'];
  }));
  assert.equal(r.code, 2);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /does not match the schema/);
});
