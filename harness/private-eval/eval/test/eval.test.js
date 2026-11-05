// Tests for the Tier 2 trusted eval (issue #35). Tier 1: no game data.
// The "disc" is random bytes and the "build" is a few lines of JavaScript.
//
//   node --test harness/private-eval/eval/test/
//
// The gate is tested against sample event payloads (payloads/) and a fake
// GitHub API on localhost. The end-to-end tests run the real sandbox (#33)
// and validator (#34): they need Docker and root or passwordless sudo, and
// are skipped without them unless SANDBOX_REQUIRE=1 (use it in CI).
// SANDBOX_IMAGE_REPO may name a mirror of the pinned image (same digest).

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync,
  truncateSync, writeFileSync,
} from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ARTIFACT_NAME, buildExpect, checkRunOutput, checkWork, cleanup, evaluate, gateDispatch, gateWorkflowRun,
  layout, MAX_ARTIFACT_BYTES, MAX_WORK_BYTES, MAX_WORK_DEPTH, makeSummary, permissionAllows, pickArtifact,
  pickBuildRun, prepare, SANDBOX_COMMAND, Tier2Error,
} from '../lib.js';
import { prepareOutput } from '../../sandbox/sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');
const CLI = path.resolve(HERE, '../tier2.js');
const REPO = 'jamescoward/ff7-web';
const load = (f) => JSON.parse(readFileSync(path.join(HERE, 'payloads', f), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const REQUIRE = process.env.SANDBOX_REQUIRE === '1';

function dockerUsable() {
  const v = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' });
  if (v.status !== 0) return 'docker daemon not reachable';
  if (process.getuid() !== 0 && spawnSync('sudo', ['-n', 'true']).status !== 0) return 'needs root or passwordless sudo';
  return null;
}
const missing = dockerUsable();
if (missing && REQUIRE) throw new Error(`SANDBOX_REQUIRE=1 but ${missing}`);
const dockerTest = (name, fn) => test(name, { skip: missing ? `skipped: ${missing}` : false, timeout: 120_000 }, fn);
const asRoot = (cmd, args) => (process.getuid() === 0 ? spawnSync(cmd, args) : spawnSync('sudo', ['-n', cmd, ...args]));

const SCRATCH = mkdtempSync(path.join(os.tmpdir(), 'ff7-tier2-test-'));
let n = 0;
const scratch = () => path.join(SCRATCH, `t${n++}`);
test.after(() => {
  for (const d of readdirSync(SCRATCH)) cleanup(path.join(SCRATCH, d));
  rmSync(SCRATCH, { recursive: true, force: true });
});

// ---------------------------------------------------------------- gate: workflow_run

test('gate: a successful build of a same-repo PR runs', () => {
  const g = gateWorkflowRun(load('workflow_run-same-repo.json'), REPO);
  assert.deepEqual(g, { run: true, pr: 99, headSha: 'a'.repeat(40), buildRunId: 555, actors: ['jamescoward'] });
});

test('gate: a fork PR is skipped (sample payload)', () => {
  assert.deepEqual(gateWorkflowRun(load('workflow_run-fork.json'), REPO), { run: false, reason: 'fork' });
});

test('gate: every way a payload can point outside this repo or this build is skipped', () => {
  const base = load('workflow_run-same-repo.json');
  const cases = [
    ['fork head repository, PR list still filled', (p) => { p.workflow_run.head_repository = { id: 2002, full_name: 'mallory/ff7-web' }; }, 'fork'],
    ['fork with the same name but another id', (p) => { p.workflow_run.head_repository.id = 2002; }, 'fork'],
    ['PR head in another repo', (p) => { p.workflow_run.pull_requests[0].head.repo.id = 2002; }, 'fork'],
    ['PR base in another repo', (p) => { p.workflow_run.pull_requests[0].base.repo.id = 2002; }, 'fork'],
    ['no PR (fork style)', (p) => { p.workflow_run.pull_requests = []; }, 'no-single-pull-request'],
    ['two PRs', (p) => { p.workflow_run.pull_requests.push(clone(p.workflow_run.pull_requests[0])); }, 'no-single-pull-request'],
    ['build failed', (p) => { p.workflow_run.conclusion = 'failure'; }, 'build-not-successful'],
    ['build cancelled', (p) => { p.workflow_run.conclusion = 'cancelled'; }, 'build-not-successful'],
    ['push event', (p) => { p.workflow_run.event = 'push'; }, 'not-a-pull-request'],
    ['pull_request_target', (p) => { p.workflow_run.event = 'pull_request_target'; }, 'not-a-pull-request'],
    ['another workflow named tier2-build', (p) => { p.workflow_run.path = '.github/workflows/evil.yml'; }, 'other-workflow'],
    ['requested, not completed', (p) => { p.action = 'requested'; }, 'not-completed'],
    ['another repository', (p) => { p.repository.full_name = 'mallory/ff7-web'; }, 'other-repository'],
    ['head moved after the build', (p) => { p.workflow_run.pull_requests[0].head.sha = 'c'.repeat(40); }, 'head-moved'],
    ['no actor', (p) => { delete p.workflow_run.actor; }, 'bad-payload'],
    ['not an object', () => null, 'bad-payload'],
  ];
  for (const [what, mutate, reason] of cases) {
    const p = clone(base);
    const r = mutate(p);
    assert.deepEqual(gateWorkflowRun(r === null ? null : p, REPO), { run: false, reason }, what);
  }
});

test('gate: a workflow path with a ref suffix is still this build', () => {
  const p = load('workflow_run-same-repo.json');
  p.workflow_run.path = '.github/workflows/tier2-build.yml@refs/pull/99/merge';
  assert.equal(gateWorkflowRun(p, REPO).run, true);
});

test('gate: both the actor and the triggering actor need a permission check', () => {
  const p = load('workflow_run-same-repo.json');
  p.workflow_run.triggering_actor.login = 'someone-else';
  assert.deepEqual(gateWorkflowRun(p, REPO).actors, ['jamescoward', 'someone-else']);
});

// ---------------------------------------------------------------- gate: dispatch, permissions, build, artifact

test('gate: workflow_dispatch re-checks the PR', () => {
  const pr = load('pull-same-repo.json');
  const ok = { ref: 'refs/heads/main', input: '99', actor: 'jamescoward' };
  assert.deepEqual(gateDispatch(ok, pr, REPO), { run: true, pr: 99, headSha: 'a'.repeat(40), buildRunId: null, actors: ['jamescoward'] });
  const cases = [
    ['dispatched from a branch', { ...ok, ref: 'refs/heads/issue-99-x' }, pr, 'not-main'],
    ['no input', { ...ok, input: '' }, pr, 'bad-input'],
    ['input with junk', { ...ok, input: '99;rm' }, pr, 'bad-input'],
    ['input for another PR', { ...ok, input: '98' }, pr, 'bad-payload'],
    ['closed PR', ok, { ...clone(pr), state: 'closed' }, 'pull-request-not-open'],
    ['fork PR', ok, { ...clone(pr), head: { ...pr.head, repo: { id: 2002, full_name: 'mallory/ff7-web' } } }, 'fork'],
    ['fork deleted (head.repo null)', ok, { ...clone(pr), head: { ...pr.head, repo: null } }, 'fork'],
    ['no PR document', ok, null, 'bad-payload'],
  ];
  for (const [what, ctx, doc, reason] of cases) assert.deepEqual(gateDispatch(ctx, doc, REPO), { run: false, reason }, what);
  const other = gateDispatch({ ...ok, actor: 'helper' }, pr, REPO);
  assert.deepEqual(other.actors, ['helper', 'jamescoward'], 'the dispatcher and the PR author are both checked');
});

test('gate: only write, maintain (reported as write) and admin may run', () => {
  assert.equal(permissionAllows({ permission: 'admin' }), true);
  assert.equal(permissionAllows({ permission: 'write', role_name: 'maintain' }), true);
  assert.equal(permissionAllows({ permission: 'write' }), true);
  for (const p of ['read', 'triage', 'none', '', undefined]) assert.equal(permissionAllows({ permission: p }), false, String(p));
  assert.equal(permissionAllows(null), false);
});

test('gate: the build run for a dispatch is the newest successful same-repo PR build', () => {
  const sha = 'a'.repeat(40);
  const run = (id, extra = {}) => ({
    id, head_sha: sha, event: 'pull_request', conclusion: 'success', path: '.github/workflows/tier2-build.yml',
    head_repository: { full_name: REPO }, created_at: `2026-11-05T10:0${id}:00Z`, ...extra,
  });
  assert.equal(pickBuildRun([run(1), run(3), run(2)], sha, REPO), 3);
  assert.equal(pickBuildRun([run(1), run(3, { conclusion: 'failure' })], sha, REPO), 1);
  assert.equal(pickBuildRun([run(4, { head_repository: { full_name: 'mallory/ff7-web' } })], sha, REPO), null);
  assert.equal(pickBuildRun([run(4, { event: 'push' })], sha, REPO), null);
  assert.equal(pickBuildRun([run(4, { head_sha: 'b'.repeat(40) })], sha, REPO), null);
  assert.equal(pickBuildRun([run(4, { path: '.github/workflows/evil.yml' })], sha, REPO), null);
  assert.equal(pickBuildRun(undefined, sha, REPO), null);
});

test('artifact: exactly one live artifact under the size cap', () => {
  const a = (extra = {}) => ({ id: 7, name: ARTIFACT_NAME, size_in_bytes: 1000, expired: false, ...extra });
  assert.deepEqual(pickArtifact([a()]), { id: 7 });
  assert.deepEqual(pickArtifact([a(), { id: 8, name: 'other', size_in_bytes: 1 }]), { id: 7 });
  assert.deepEqual(pickArtifact([]), { reason: 'no-artifact' });
  assert.deepEqual(pickArtifact([a(), a({ id: 9 })]), { reason: 'several-artifacts' });
  assert.deepEqual(pickArtifact([a({ expired: true })]), { reason: 'artifact-expired' });
  assert.deepEqual(pickArtifact([a({ size_in_bytes: MAX_ARTIFACT_BYTES + 1 })]), { reason: 'artifact-too-large' });
  assert.deepEqual(pickArtifact([a({ size_in_bytes: MAX_ARTIFACT_BYTES })]), { id: 7 });
  assert.deepEqual(pickArtifact([a({ size_in_bytes: '5' })]), { reason: 'artifact-too-large' });
  assert.deepEqual(pickArtifact(null), { reason: 'bad-payload' });
});

// ---------------------------------------------------------------- gate CLI, against a fake API

/** A fake GitHub REST API: `routes` maps "METHOD /path" to [status, body]. Records requests. */
async function fakeApi(routes) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const key = `${req.method} ${req.url.split('?')[0]}`;
      seen.push({ key, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
      const [status, doc] = routes[key] ?? [404, { message: 'Not Found' }];
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(doc));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((r) => server.close(r)) };
}

function runCli(args, env) {
  const outFile = path.join(SCRATCH, `gh-output-${n++}`);
  writeFileSync(outFile, '');
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, ...args], {
      env: { PATH: process.env.PATH, GITHUB_OUTPUT: outFile, GITHUB_TOKEN: 'test-token', GITHUB_REPOSITORY: REPO, ...env },
    });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (c) => { stdout += c; });
    p.stderr.on('data', (c) => { stderr += c; });
    p.on('exit', (code) => {
      const outputs = Object.fromEntries(readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2)));
      resolve({ code, stdout, stderr, outputs });
    });
  });
}

const artifacts = { artifacts: [{ id: 42, name: ARTIFACT_NAME, size_in_bytes: 5_000_000, expired: false }] };

test('gate CLI: same-repo PR by a collaborator runs, with the artifact id', async () => {
  const api = await fakeApi({
    'GET /repos/jamescoward/ff7-web/collaborators/jamescoward/permission': [200, { permission: 'admin' }],
    'GET /repos/jamescoward/ff7-web/actions/runs/555/artifacts': [200, artifacts],
  });
  try {
    const r = await runCli(['gate'], {
      GITHUB_API_URL: api.url, GITHUB_EVENT_NAME: 'workflow_run', GITHUB_EVENT_PATH: path.join(HERE, 'payloads/workflow_run-same-repo.json'),
    });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.outputs, { run: 'true', reason: '', pr: '99', head_sha: 'a'.repeat(40), build_run_id: '555', artifact_id: '42' });
    assert.ok(api.seen.every((s) => s.auth === 'Bearer test-token'));
  } finally {
    await api.close();
  }
});

test('gate CLI: a fork is skipped before any API call', async () => {
  const api = await fakeApi({});
  try {
    const r = await runCli(['gate'], {
      GITHUB_API_URL: api.url, GITHUB_EVENT_NAME: 'workflow_run', GITHUB_EVENT_PATH: path.join(HERE, 'payloads/workflow_run-fork.json'),
    });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.outputs.run, 'false');
    assert.equal(r.outputs.reason, 'fork');
    assert.equal(r.outputs.artifact_id, '');
    assert.equal(api.seen.length, 0);
  } finally {
    await api.close();
  }
});

test('gate CLI: a non-collaborator (404 or read access) is skipped', async () => {
  for (const [status, doc] of [[404, { message: 'Not Found' }], [200, { permission: 'read' }], [200, { permission: 'none' }]]) {
    const api = await fakeApi({
      'GET /repos/jamescoward/ff7-web/collaborators/jamescoward/permission': [status, doc],
      'GET /repos/jamescoward/ff7-web/actions/runs/555/artifacts': [200, artifacts],
    });
    try {
      const r = await runCli(['gate'], {
        GITHUB_API_URL: api.url, GITHUB_EVENT_NAME: 'workflow_run', GITHUB_EVENT_PATH: path.join(HERE, 'payloads/workflow_run-same-repo.json'),
      });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.outputs.run, 'false', `${status} ${doc.permission}`);
      assert.equal(r.outputs.reason, 'not-a-collaborator');
      assert.ok(!api.seen.some((s) => s.key.includes('/artifacts')), 'no artifact lookup after a failed permission check');
    } finally {
      await api.close();
    }
  }
});

test('gate CLI: an oversized artifact is refused before download', async () => {
  const api = await fakeApi({
    'GET /repos/jamescoward/ff7-web/collaborators/jamescoward/permission': [200, { permission: 'write' }],
    'GET /repos/jamescoward/ff7-web/actions/runs/555/artifacts': [200, { artifacts: [{ ...artifacts.artifacts[0], size_in_bytes: MAX_ARTIFACT_BYTES + 1 }] }],
  });
  try {
    const r = await runCli(['gate'], {
      GITHUB_API_URL: api.url, GITHUB_EVENT_NAME: 'workflow_run', GITHUB_EVENT_PATH: path.join(HERE, 'payloads/workflow_run-same-repo.json'),
    });
    assert.equal(r.outputs.run, 'false');
    assert.equal(r.outputs.reason, 'artifact-too-large');
  } finally {
    await api.close();
  }
});

test('gate CLI: workflow_dispatch finds the PR and its newest successful build', async () => {
  const sha = 'a'.repeat(40);
  const api = await fakeApi({
    'GET /repos/jamescoward/ff7-web/pulls/99': [200, load('pull-same-repo.json')],
    'GET /repos/jamescoward/ff7-web/actions/workflows/tier2-build.yml/runs': [200, {
      workflow_runs: [{ id: 556, head_sha: sha, event: 'pull_request', conclusion: 'success', path: '.github/workflows/tier2-build.yml', head_repository: { full_name: REPO }, created_at: '2026-11-05T11:00:00Z' }],
    }],
    'GET /repos/jamescoward/ff7-web/collaborators/jamescoward/permission': [200, { permission: 'admin' }],
    'GET /repos/jamescoward/ff7-web/actions/runs/556/artifacts': [200, artifacts],
  });
  try {
    const r = await runCli(['gate'], {
      GITHUB_API_URL: api.url, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_ACTOR: 'jamescoward', TIER2_PR: '99',
    });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.outputs, { run: 'true', reason: '', pr: '99', head_sha: sha, build_run_id: '556', artifact_id: '42' });
    const runsReq = api.seen.find((s) => s.key.endsWith('/runs'));
    assert.match(runsReq.url, new RegExp(`head_sha=${sha}`));
    assert.match(runsReq.url, /event=pull_request/);
  } finally {
    await api.close();
  }
});

test('gate CLI: workflow_dispatch from a branch is skipped', async () => {
  const api = await fakeApi({ 'GET /repos/jamescoward/ff7-web/pulls/99': [200, load('pull-same-repo.json')] });
  try {
    const r = await runCli(['gate'], {
      GITHUB_API_URL: api.url, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/evil', GITHUB_ACTOR: 'jamescoward', TIER2_PR: '99',
    });
    assert.equal(r.outputs.run, 'false');
    assert.equal(r.outputs.reason, 'not-main');
  } finally {
    await api.close();
  }
});

// ---------------------------------------------------------------- artifact checks

/** A fresh job root with a work tree made by `fill(work)`. */
function jobWith(fill) {
  const L = prepare(scratch());
  fill(L.work);
  return L;
}
const put = (work, rel, content, mode) => {
  const p = path.join(work, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content, mode ? { mode } : undefined);
  return p;
};
/** The smallest tree checkWork accepts. */
const base = (w) => { put(w, 'runner/tier2.js', ''); put(w, 'harness/README.md', ''); };
const scenario = (name, extra = {}) => JSON.stringify({ format: 1, name, tier: 2, boot: { fixture: 'x' }, frames: 1, ...extra });

test('prepare: makes empty directories and refuses an existing root', () => {
  const root = scratch();
  const L = prepare(root);
  assert.deepEqual(readdirSync(L.work), []);
  assert.equal(statSync(L.root).mode & 0o777, 0o700);
  assert.throws(() => prepare(root), Tier2Error);
});

test('artifact: regular files pass, and every execute bit is cleared', () => {
  const L = jobWith((w) => {
    put(w, 'runner/tier2.js', '#!/usr/bin/env node\n', 0o755);
    put(w, 'runner/dist/core.wasm', randomBytes(100), 0o777);
    put(w, 'harness/scenarios/a.json', '{}', 0o600);
  });
  const r = checkWork(L.work);
  assert.equal(r.files, 3);
  assert.equal(r.bytes, 20 + 100 + 2);
  assert.match(r.digest, /^[0-9a-f]{64}$/);
  for (const f of ['runner/tier2.js', 'runner/dist/core.wasm', 'harness/scenarios/a.json']) {
    assert.equal(statSync(path.join(L.work, f)).mode & 0o777, 0o644, f);
  }
  assert.equal(statSync(path.join(L.work, 'runner')).mode & 0o777, 0o755);
});

test('artifact: links, FIFOs, hard links, empty trees and oversize trees are rejected', () => {
  const cases = [
    ['symlink to a file outside', (w) => { put(w, 'a', 'x'); symlinkSync('/etc/passwd', path.join(w, 'b')); }],
    ['symlink to a directory', (w) => { put(w, 'a', 'x'); symlinkSync('/', path.join(w, 'root')); }],
    ['dangling symlink', (w) => { put(w, 'a', 'x'); symlinkSync('/nonexistent', path.join(w, 'b')); }],
    ['FIFO', (w) => { put(w, 'a', 'x'); spawnSync('mkfifo', [path.join(w, 'fifo')]); }],
    ['hard link', (w) => { const p = put(w, 'a', 'x'); linkSync(p, path.join(w, 'b')); }],
    ['over the size cap (sparse)', (w) => { const p = put(w, 'big', ''); truncateSync(p, MAX_WORK_BYTES + 1); }],
    ['too deep', (w) => { put(w, `${Array.from({ length: MAX_WORK_DEPTH + 2 }, () => 'd').join('/')}/f`, 'x'); }],
  ];
  for (const [what, fill] of cases) {
    // A valid base, so each case is rejected for its own reason.
    const L = jobWith((w) => { base(w); fill(w); });
    assert.throws(() => checkWork(L.work), (e) => e instanceof Tier2Error && e.code === 'artifact-rejected', what);
  }
  const ok = jobWith(base);
  assert.equal(checkWork(ok.work).files, 2, 'the base alone is accepted');
});

test('artifact: an empty tree, or one with only directories, is rejected', () => {
  const empty = jobWith(() => {});
  assert.throws(() => checkWork(empty.work), (e) => e.code === 'artifact-rejected', 'empty');
  const dirs = jobWith((w) => { mkdirSync(path.join(w, 'runner')); mkdirSync(path.join(w, 'harness')); });
  assert.throws(() => checkWork(dirs.work), (e) => e.code === 'artifact-rejected', 'only directories');
});

test('artifact: runner/ and harness/ must be directories at the top (no silent "no scenarios")', () => {
  for (const [what, fill] of [
    ['nested one level down', (w) => { put(w, 'tier2-build/runner/x.js', ''); put(w, 'tier2-build/harness/x', ''); }],
    ['no harness', (w) => put(w, 'runner/x.js', '')],
    ['no runner', (w) => put(w, 'harness/x', '')],
    ['runner is a file', (w) => { put(w, 'runner', ''); put(w, 'harness/x', ''); }],
  ]) {
    const L = jobWith(fill);
    assert.throws(() => checkWork(L.work), (e) => e.code === 'artifact-rejected', what);
  }
});

test('artifact: the digest covers paths and contents, not timestamps or modes', () => {
  const a = jobWith((w) => { base(w); put(w, 'runner/a.js', 'one'); });
  const b = jobWith((w) => { base(w); put(w, 'runner/a.js', 'one', 0o755); });
  const c = jobWith((w) => { base(w); put(w, 'runner/a.js', 'two'); });
  const d = jobWith((w) => { base(w); put(w, 'runner/b.js', 'one'); });
  const [da, db, dc, dd] = [a, b, c, d].map((L) => checkWork(L.work).digest);
  assert.equal(da, db);
  assert.notEqual(da, dc);
  assert.notEqual(da, dd);
});

test('artifact: the work directory itself must be a real directory', () => {
  const L = prepare(scratch());
  rmSync(L.work, { recursive: true });
  symlinkSync(REPO_ROOT, L.work);
  assert.throws(() => checkWork(L.work), (e) => e.code === 'artifact-rejected');
});

// ---------------------------------------------------------------- expect

test('expect: tier 2 scenarios only, with their metric keys, sorted', () => {
  const L = jobWith((w) => {
    put(w, 'harness/scenarios/pad-echo-buttons.json', JSON.stringify({ format: 1, name: 'pad-echo-buttons', tier: 1 }));
    put(w, 'harness/scenarios/disc-boot.json', scenario('disc-boot', { metrics: ['speed', 'boot_frames'] }));
    put(w, 'harness/scenarios/b-plain.json', scenario('b-plain'));
    put(w, 'harness/scenarios/README.md', 'not json');
    put(w, 'runner/tier2.js', '');
  });
  checkWork(L.work);
  assert.deepEqual(buildExpect(L.work), { format: 1, scenarios: { 'b-plain': [], 'disc-boot': ['boot_frames', 'speed'] } });
});

test('expect: no scenario directory, or no tier 2 scenarios, gives an empty list', () => {
  const L = jobWith((w) => put(w, 'runner/x.js', ''));
  assert.deepEqual(buildExpect(L.work), { format: 1, scenarios: {} });
  const M = jobWith((w) => put(w, 'harness/scenarios/a.json', JSON.stringify({ name: 'a', tier: 1 })));
  assert.deepEqual(buildExpect(M.work), { format: 1, scenarios: {} });
});

test('expect: a tier 2 scenario that could smuggle text is rejected', () => {
  const cases = [
    ['name differs from the file name', 'x.json', scenario('y')],
    ['name not in the pattern', 'Bad Name.json', scenario('Bad Name')],
    ['long name', `${'a'.repeat(65)}.json`, scenario('a'.repeat(65))],
    ['metric key not in the pattern', 'a.json', scenario('a', { metrics: ['Bad Key'] })],
    ['too many metrics', 'a.json', scenario('a', { metrics: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] })],
    ['duplicate metric', 'a.json', scenario('a', { metrics: ['a', 'a'] })],
    ['metrics not an array', 'a.json', scenario('a', { metrics: 'speed' })],
    ['not JSON', 'a.json', '{"tier": 2,'],
    ['over the size cap', 'a.json', scenario('a', { pad: 'x'.repeat(70 * 1024) })],
  ];
  for (const [what, file, content] of cases) {
    const L = jobWith((w) => put(w, `harness/scenarios/${file}`, content));
    assert.throws(() => buildExpect(L.work), (e) => e instanceof Tier2Error && e.code === 'bad-scenario', what);
  }
  const many = jobWith((w) => { for (let i = 0; i < 33; i++) put(w, `harness/scenarios/s${i}.json`, scenario(`s${i}`)); });
  assert.throws(() => buildExpect(many.work), (e) => e.code === 'bad-scenario', 'more than 32 tier 2 scenarios');
});

test('check-work CLI: the eval job accepts only the tree the inspect job checked', async () => {
  const L = jobWith((w) => { base(w); put(w, 'harness/scenarios/a.json', scenario('a', { metrics: ['x'] })); });
  const first = await runCli(['check-work', '--root', L.root], {});
  assert.equal(first.code, 0, first.stdout);
  assert.equal(first.outputs.scenarios, '1');
  assert.match(first.outputs.digest, /^[0-9a-f]{64}$/);
  assert.deepEqual(JSON.parse(readFileSync(L.expect, 'utf8')), { format: 1, scenarios: { a: ['x'] } });
  const same = await runCli(['check-work', '--root', L.root, '--digest', first.outputs.digest], {});
  assert.equal(same.code, 0);
  assert.equal(existsSync(L.summary), false);
  put(L.work, 'runner/extra.js', 'swapped in between the jobs');
  const changed = await runCli(['check-work', '--root', L.root, '--digest', first.outputs.digest], {});
  assert.equal(changed.code, 1);
  assert.deepEqual(JSON.parse(readFileSync(L.summary, 'utf8')), makeSummary({ result: 'error', error: 'artifact-rejected' }));
  const M = jobWith(base);
  const junk = await runCli(['check-work', '--root', M.root, '--digest', 'not-hex'], {});
  assert.equal(junk.code, 1);
});

test('check-work CLI: a rejected build exits 1 and leaves an error summary', async () => {
  const L = jobWith((w) => { base(w); symlinkSync('/etc/passwd', path.join(w, 'runner/link')); });
  const r = await runCli(['check-work', '--root', L.root], {});
  assert.equal(r.code, 1);
  assert.equal(r.stdout.trim(), 'check-work: rejected (artifact-rejected)');
  assert.equal(JSON.parse(readFileSync(L.summary, 'utf8')).error, 'artifact-rejected');
});

test('record-error CLI: writes a fixed-code summary, never overwrites one, and refuses unknown codes', async () => {
  const L = prepare(scratch());
  assert.equal((await runCli(['record-error', '--root', L.root, '--code', 'artifact-rejected'], {})).code, 0);
  assert.equal(JSON.parse(readFileSync(L.summary, 'utf8')).error, 'artifact-rejected');
  await runCli(['record-error', '--root', L.root, '--code', 'internal'], {});
  assert.equal(JSON.parse(readFileSync(L.summary, 'utf8')).error, 'artifact-rejected');
  const M = prepare(scratch());
  assert.equal((await runCli(['record-error', '--root', M.root, '--code', 'free text'], {})).code, 1);
  assert.equal(existsSync(M.summary), false);
});

// ---------------------------------------------------------------- check run

test('check run: pass and no-scenarios are green; fail, error and junk are red', () => {
  const v = { format: 1, ok: false, output: 'accepted', reason: null, limits_hit: ['time'], counts: { pass: 0, fail: 1, error: 0, missing: 0 }, scenarios: [] };
  assert.equal(checkRunOutput(makeSummary({ result: 'pass', validator: { ...v, ok: true } })).conclusion, 'success');
  assert.equal(checkRunOutput(makeSummary({ result: 'no-scenarios' })).conclusion, 'success');
  const fail = checkRunOutput(makeSummary({ result: 'fail', validator: v }));
  assert.equal(fail.conclusion, 'failure');
  assert.equal(fail.output.title, 'Tier 2 failed');
  assert.match(fail.output.summary, /0 pass, 1 fail, 0 error, 0 missing/);
  assert.match(fail.output.summary, /Limits hit:\*\* time/);
  assert.equal(checkRunOutput(makeSummary({ result: 'error', error: 'disc-missing' })).conclusion, 'failure');
  for (const junk of [null, 'x', {}, { ok: 'true' }, { ok: 1, result: 'pass' }]) {
    assert.equal(checkRunOutput(junk).conclusion, 'failure', JSON.stringify(junk));
  }
});

test('check-finish CLI: posts the conclusion and the summary only', async () => {
  const api = await fakeApi({ 'PATCH /repos/jamescoward/ff7-web/check-runs/77': [200, { id: 77 }] });
  try {
    const L = prepare(scratch());
    const s = makeSummary({ result: 'error', error: 'sandbox-failed' });
    writeFileSync(L.summary, JSON.stringify(s));
    const r = await runCli(['check-finish', '--id', '77', '--root', L.root], { GITHUB_API_URL: api.url });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(api.seen.length, 1);
    const body = api.seen[0].body;
    assert.deepEqual(Object.keys(body).sort(), ['conclusion', 'output', 'status']);
    assert.equal(body.conclusion, 'failure');
    assert.deepEqual(Object.keys(body.output).sort(), ['summary', 'title']);
    assert.ok(body.output.summary.includes(JSON.stringify(s, null, 2)));
    // A missing summary (the job broke before evaluate) is a red check, not a skipped one.
    rmSync(L.summary);
    await runCli(['check-finish', '--id', '77', '--root', L.root], { GITHUB_API_URL: api.url });
    assert.equal(api.seen[1].body.conclusion, 'failure');
  } finally {
    await api.close();
  }
});

// ---------------------------------------------------------------- cleanup

test('cleanup: removes the disc and everything else, and is safe to repeat', () => {
  const L = prepare(scratch());
  writeFileSync(L.disc, randomBytes(4096));
  put(L.work, 'a', 'x');
  writeFileSync(L.summary, '{}');
  assert.deepEqual(cleanup(L.root), { disc: 'removed', out: 'absent', root: 'removed' });
  assert.equal(existsSync(L.root), false);
  assert.deepEqual(cleanup(L.root), { disc: 'absent', out: 'absent', root: 'absent' });
});

test('cleanup CLI: works when the job failed halfway (disc there, no build)', async () => {
  const L = prepare(scratch());
  writeFileSync(L.disc, randomBytes(4096));
  rmSync(L.work, { recursive: true });
  const r = await runCli(['cleanup', '--root', L.root], {});
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /"disc":"removed"/);
  assert.equal(existsSync(L.disc), false);
});

dockerTest('cleanup: releases a mounted output directory, even read-only', () => {
  const L = prepare(scratch());
  writeFileSync(L.disc, randomBytes(4096));
  prepareOutput(L.out, 1);
  assert.equal(asRoot('mount', ['-o', 'remount,ro', L.out]).status, 0);
  assert.deepEqual(cleanup(L.root), { disc: 'removed', out: 'removed', root: 'removed' });
  assert.ok(!readFileSync('/proc/self/mounts', 'utf8').includes(L.out));
});

// ---------------------------------------------------------------- end to end (sandbox + validator)

/**
 * A fake build: harness/scenarios with the given tier 2 scenarios, and a
 * runner/tier2.js that writes `results` to /out/results.json and prints a
 * marker to stdout and stderr, which must never reach the summary.
 */
function fakeBuild(names, results, { metrics = {} } = {}) {
  const L = jobWith((w) => {
    for (const name of names) put(w, `harness/scenarios/${name}.json`, scenario(name, metrics[name] ? { metrics: metrics[name] } : {}));
    put(w, 'runner/tier2.js', [
      "import { readFileSync, writeFileSync, openSync } from 'node:fs';",
      "const a = process.argv.slice(2);",
      "if (a[0] !== '--disc' || a[1] !== '/disc/disc.bin' || a[2] !== '--out' || a[3] !== '/out') process.exit(9);",
      "readFileSync('/disc/disc.bin');",
      "if (!readFileSync('/disc/disc-1.cue', 'utf8').includes('disc-1.bin')) process.exit(10);",
      "if (!readFileSync('/disc/disc-1.bin').equals(readFileSync('/disc/disc.bin'))) process.exit(11);",
      "for (const p of ['/disc/disc-1.cue', '/disc/disc-1.bin']) { try { openSync(p, 'r+'); process.exit(12); } catch (e) { if (e.code !== 'EROFS') process.exit(13); } }",
      "console.log('MARKER-STDOUT'); console.error('MARKER-STDERR');",
      `writeFileSync('/out/results.json', ${JSON.stringify(JSON.stringify(results))});`,
    ].join('\n'), 0o755);
  });
  writeFileSync(L.disc, randomBytes(1 << 20), { mode: 0o644 });
  writeFileSync(L.cue, 'FILE "disc-1.bin" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n', { mode: 0o644 });
  // Make the synthetic inputs writable on the host to test mount protection.
  chmodSync(L.disc, 0o666);
  chmodSync(L.cue, 0o666);
  checkWork(L.work);
  writeFileSync(L.expect, JSON.stringify(buildExpect(L.work)));
  return L;
}

const cliEvaluate = (L) => runCli(['evaluate', '--root', L.root], {
  ...(process.env.SANDBOX_IMAGE_REPO ? { SANDBOX_IMAGE_REPO: process.env.SANDBOX_IMAGE_REPO } : {}),
});

dockerTest('end to end: a homebrew scenario made to fail gives a red summary, and the log holds only the summary', async () => {
  const L = fakeBuild(['dry-run-fail'], { format: 1, scenarios: [{ name: 'dry-run-fail', status: 'fail', metrics: { frames: 60 } }] },
    { metrics: { 'dry-run-fail': ['frames'] } });
  const r = await cliEvaluate(L);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, '');
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, 1, 'one line: the summary');
  const s = JSON.parse(lines[0]);
  assert.equal(s.result, 'fail');
  assert.equal(s.ok, false);
  assert.deepEqual(s.validator.counts, { pass: 0, fail: 1, error: 0, missing: 0 });
  assert.deepEqual(s.validator.scenarios, [{ name: 'dry-run-fail', status: 'fail', metrics: { frames: 60 } }]);
  assert.ok(!r.stdout.includes('MARKER'));
  assert.equal(checkRunOutput(s).conclusion, 'failure');
  assert.deepEqual(cleanup(L.root), { disc: 'removed', out: 'removed', root: 'removed' });
});

dockerTest('end to end: a passing scenario gives a green summary', async () => {
  const L = fakeBuild(['dry-run-pass'], { format: 1, scenarios: [{ name: 'dry-run-pass', status: 'pass' }] });
  const s = await evaluate(L.root);
  assert.equal(s.result, 'pass');
  assert.equal(checkRunOutput(s).conclusion, 'success');
  assert.ok(!readFileSync('/proc/self/mounts', 'utf8').includes(L.out), 'output released after validation');
  cleanup(L.root);
});

dockerTest('end to end: free text in the output is rejected by the validator', async () => {
  const L = fakeBuild(['a'], { format: 1, scenarios: [{ name: 'a', status: 'pass' }, { name: 'leaked-text-here', status: 'pass' }] });
  const s = await evaluate(L.root);
  assert.equal(s.result, 'fail');
  assert.equal(s.validator.output, 'rejected');
  assert.equal(s.validator.reason, 'unexpected-name');
  assert.ok(!JSON.stringify(s).includes('leaked'));
  cleanup(L.root);
});

dockerTest('end to end: a build with no entry point fails as missing, not as a pass', async () => {
  const L = fakeBuild(['a'], {});
  rmSync(path.join(L.work, 'runner/tier2.js'));
  const s = await evaluate(L.root);
  assert.equal(s.result, 'fail');
  assert.equal(s.validator.counts.missing, 1);
  cleanup(L.root);
});

test('evaluate: no tier 2 scenarios passes without touching the disc or the sandbox', async () => {
  const L = prepare(scratch());
  writeFileSync(L.expect, JSON.stringify({ format: 1, scenarios: {} }));
  assert.deepEqual(await evaluate(L.root, { command: ['false'], image: 'none' }), makeSummary({ result: 'no-scenarios' }));
  cleanup(L.root);
});

test('evaluate: a missing disc is an error, before the sandbox starts', async () => {
  const L = prepare(scratch());
  writeFileSync(L.expect, JSON.stringify({ format: 1, scenarios: { a: [] } }));
  const s = await evaluate(L.root, { image: 'none' });
  assert.deepEqual(s, makeSummary({ result: 'error', error: 'disc-missing' }));
  cleanup(L.root);
});

test('the sandbox command is the documented entry point contract', () => {
  assert.deepEqual(SANDBOX_COMMAND, ['node', 'runner/tier2.js', '--disc', '/disc/disc.bin', '--out', '/out']);
  assert.deepEqual(Object.keys(layout('/x')).sort(), ['cue', 'disc', 'discDir', 'expect', 'out', 'report', 'root', 'summary', 'work']);
});


for (const kind of ['missing', 'empty', 'directory', 'symlink', 'oversize']) {
  test(`evaluate: refuses ${kind} cue before starting the sandbox`, async () => {
    const L = prepare(scratch());
    writeFileSync(L.expect, JSON.stringify({ format: 1, scenarios: { a: [] } }));
    writeFileSync(L.disc, randomBytes(128));
    if (kind === 'empty') writeFileSync(L.cue, '');
    if (kind === 'directory') mkdirSync(L.cue);
    if (kind === 'symlink') symlinkSync(L.disc, L.cue);
    if (kind === 'oversize') writeFileSync(L.cue, Buffer.alloc(65537));
    assert.deepEqual(await evaluate(L.root, { image: 'none' }), makeSummary({ result: 'error', error: 'disc-missing' }));
    cleanup(L.root);
    assert.equal(existsSync(L.cue), false);
  });
}
