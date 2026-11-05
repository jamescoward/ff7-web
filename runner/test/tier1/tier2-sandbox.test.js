// Tier 1, end to end: the real runner/tier2.js inside the real sandbox (#33),
// called the way the trusted eval (#35) calls it. The work tree is assembled
// like the tier2-build artifact, and the trusted functions run in workflow
// order: prepare, checkWork, buildExpect, evaluate, cleanup. The "disc" is a
// file of zeros: format 1 scenarios boot fixtures, so nothing reads it.
//
// Needs core/build.sh, runner/build.sh, Docker and root or passwordless sudo.
// Without them the test is skipped, unless SANDBOX_REQUIRE=1, which makes
// that a failure (the convention of harness/private-eval/sandbox/test/).
// SANDBOX_IMAGE_REPO may name a mirror of the pinned image (same digest).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildExpect, checkWork, cleanup, evaluate, layout, prepare } from '../../../harness/private-eval/eval/lib.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');

const REQUIRE = process.env.SANDBOX_REQUIRE === '1';
const docker = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8' });
const root = process.getuid?.() === 0 || spawnSync('sudo', ['-n', 'true']).status === 0;
const missing = !existsSync(path.join(REPO, 'runner/dist/core.wasm')) ? 'runner not built (core/build.sh, runner/build.sh)'
  : docker.status !== 0 ? 'Docker not available'
    : !root ? 'needs root or passwordless sudo' : null;
if (missing && REQUIRE) throw new Error(`SANDBOX_REQUIRE=1 but ${missing}`);

const base = mkdtempSync(path.join(tmpdir(), 'ff7-tier2-sandbox-'));
after(() => rmSync(base, { recursive: true, force: true }));

/**
 * The tier2-build artifact's layout (.github/workflows/tier2-build.yml,
 * "Assemble the build"), except that harness/scenarios starts empty: the
 * test writes its own scenarios, so committed tier 2 scenarios (#36 and
 * later) don't change its counts.
 */
function assemble(work) {
  const runner = path.join(REPO, 'runner');
  cpSync(runner, path.join(work, 'runner'), { recursive: true, filter: (src) => path.relative(runner, src).split(path.sep)[0] !== 'test' });
  for (const d of ['fixtures', 'schema', 'saves', 'baselines']) {
    const src = path.join(REPO, 'harness', d);
    if (existsSync(src)) cpSync(src, path.join(work, 'harness', d), { recursive: true });
  }
  mkdirSync(path.join(work, 'harness/scenarios'), { recursive: true });
}

test('the real entry point in the sandbox: pass, fail and a crash, accepted by the validator', { skip: missing ? `skipped: ${missing}` : false, timeout: 600_000 }, async () => {
  const L = layout(path.join(base, 'tier2'));
  prepare(L.root);
  assemble(L.work);

  // Homebrew tier 2 scenarios, made from the committed tier 1 example.
  const example = JSON.parse(readFileSync(path.join(REPO, 'harness/scenarios/pad-echo-buttons.json'), 'utf8'));
  delete example.checkpoints;
  const put = (name, mutate) => {
    const d = structuredClone(example);
    Object.assign(d, { name, tier: 2 });
    mutate(d);
    writeFileSync(path.join(L.work, 'harness/scenarios', `${name}.json`), JSON.stringify(d));
  };
  put('sbx-pass', (d) => { d.metrics = ['failed_assertions', 'fps']; });
  put('sbx-fail', (d) => {
    d.metrics = ['failed_assertions'];
    d.assert.find((a) => a.at === 10 && a.mem === 'buttons').equals = '0xffff';
  });
  put('sbx-crash', (d) => { d.boot.fixture = 'crash'; });
  const reg = JSON.parse(readFileSync(path.join(L.work, 'harness/fixtures/fixtures.json'), 'utf8'));
  reg.fixtures.crash = { kind: 'generator', module: 'crash.js', export: 'build', sha256: '0'.repeat(64), licence: 'GPL-2.0-or-later', origin: 'test', redistributable: true };
  writeFileSync(path.join(L.work, 'harness/fixtures/fixtures.json'), JSON.stringify(reg));
  writeFileSync(path.join(L.work, 'harness/fixtures/crash.js'), "export function build() { process.kill(process.pid, 'SIGKILL'); }\n");

  writeFileSync(L.disc, Buffer.alloc(1 << 20), { mode: 0o644 });
  writeFileSync(L.cue, "FILE \"disc-1.bin\" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n", { mode: 0o644 });
  checkWork(L.work);
  writeFileSync(L.expect, JSON.stringify(buildExpect(L.work)));
  try {
    const s = await evaluate(L.root);
    assert.equal(s.result, 'fail', JSON.stringify(s));
    assert.equal(s.validator.output, 'accepted', JSON.stringify(s));
    assert.deepEqual(s.validator.limits_hit, []);
    assert.deepEqual(s.validator.counts, { pass: 1, fail: 1, error: 1, missing: 0 });
    const by = Object.fromEntries(s.validator.scenarios.map((x) => [x.name, x]));
    assert.equal(by['sbx-pass'].status, 'pass');
    assert.equal(by['sbx-pass'].metrics.failed_assertions, 0);
    assert.ok(by['sbx-pass'].metrics.fps > 0);
    assert.deepEqual(by['sbx-fail'], { name: 'sbx-fail', status: 'fail', metrics: { failed_assertions: 1 } });
    assert.deepEqual(by['sbx-crash'], { name: 'sbx-crash', status: 'error' });
  } finally {
    cleanup(L.root);
  }
});

