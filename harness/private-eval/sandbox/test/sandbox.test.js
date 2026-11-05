// Attack tests for the Tier 2 sandbox (issue #33). Tier 1: no game data.
// The "disc" is random bytes.
//
//   node --test harness/private-eval/sandbox/test/
//
// Needs Docker and root (or passwordless sudo) for the output tmpfs. When
// they're missing, the container tests are skipped, unless
// SANDBOX_REQUIRE=1, which makes that a failure (use it in CI). The
// scenario test also needs a built runner (runner/build.sh).
// SANDBOX_IMAGE_REPO may name a mirror of the pinned image (same digest).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statfsSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createArgs, imageRef, LIMITS, PINS, releaseOutput, runSandbox, SandboxError } from '../sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const HOSTILE = path.join(HERE, 'hostile');
const CLI = path.resolve(HERE, '../sandbox.js');
const REQUIRE = process.env.SANDBOX_REQUIRE === '1';

function dockerUsable() {
  const v = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' });
  if (v.status !== 0) return 'docker daemon not reachable';
  if (process.getuid() !== 0 && spawnSync('sudo', ['-n', 'true']).status !== 0) return 'needs root or passwordless sudo';
  return null;
}
const missing = dockerUsable();
if (missing && REQUIRE) throw new Error(`SANDBOX_REQUIRE=1 but ${missing}`);
const dockerTest = (name, opts, fn) => test(name, { ...opts, skip: missing ? `skipped: ${missing}` : false }, fn);

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * Read a file from a sandbox output directory the way trusted code does
 * (#34's validator): /out is 0700 and owned by the sandbox uid, so a
 * non-root host user (GitHub's runner) reads it through sudo.
 */
function readOut(file) {
  if (process.getuid() === 0) return readFileSync(file, 'utf8');
  const r = spawnSync('sudo', ['-n', 'cat', '--', file], { encoding: 'utf8', maxBuffer: 1 << 24 });
  if (r.status !== 0) throw new Error(`cannot read ${file}`);
  return r.stdout;
}

/** Whether a path exists in an output directory, checked as root (existsSync is false on EACCES too). */
function outExists(file) {
  if (process.getuid() === 0) return existsSync(file);
  const r = spawnSync('sudo', ['-n', 'test', '-e', file]);
  if (r.status !== 0 && r.status !== 1) throw new Error(`cannot check ${file}`);
  return r.status === 0;
}

/** Try to write a file in an output directory as root; returns the error text, or null if it worked. */
function writeOutAsRoot(file) {
  const cmd = ['sh', '-c', 'echo x > "$1"', 'sh', file];
  const r = process.getuid() === 0 ? spawnSync(cmd[0], cmd.slice(1), { encoding: 'utf8' })
    : spawnSync('sudo', ['-n', ...cmd], { encoding: 'utf8' });
  return r.status === 0 ? null : r.stderr;
}

// One scratch area for the whole file; the disc is world-writable on the
// host, so only the read-only mount can stop a write to it.
const SCRATCH = mkdtempSync(path.join(os.tmpdir(), 'ff7-sandbox-test-'));
const DISC = path.join(SCRATCH, 'disc.bin');
writeFileSync(DISC, randomBytes(1 << 20));
chmodSync(DISC, 0o666);
const DISC_HASH = sha256(readFileSync(DISC));

let outCount = 0;
async function inSandbox(command, limits = {}, work = HOSTILE) {
  const out = path.join(SCRATCH, `out-${outCount++}`);
  const report = await runSandbox({ work, disc: DISC, out, command, limits });
  const file = path.join(out, 'result.json');
  let result = null;
  try {
    result = JSON.parse(readOut(file));
  } catch {
    /* no or partial result */
  }
  return { report, result, out };
}

test.after(() => {
  for (const d of existsSync(SCRATCH) ? readdirSync(SCRATCH) : []) {
    if (d.startsWith('out-')) {
      try {
        releaseOutput(path.join(SCRATCH, d));
      } catch {
        /* not mounted */
      }
    }
  }
  rmSync(SCRATCH, { recursive: true, force: true });
});

// --- No Docker needed -------------------------------------------------------

test('pins: the image is pinned by digest', () => {
  assert.match(PINS.image.digest, /^sha256:[0-9a-f]{64}$/);
  assert.ok(imageRef({}).endsWith(`@${PINS.image.digest}`));
  assert.ok(imageRef({ SANDBOX_IMAGE_REPO: 'mirror.gcr.io/library/node' }).endsWith(`@${PINS.image.digest}`));
  assert.throws(() => imageRef({ SANDBOX_IMAGE_REPO: 'x y' }), SandboxError);
  assert.ok(PINS.docker.tested_server_versions.length > 0);
});

test('createArgs: every isolation setting is present', () => {
  const limits = Object.fromEntries(Object.entries(LIMITS).map(([k, v]) => [k, v.def]));
  const a = createArgs({ name: 'n', image: 'img', work: '/w', disc: '/d', out: '/o', limits, command: ['node', 'x.js'] });
  const has = (...pair) => {
    const i = a.indexOf(pair[0]);
    assert.ok(i >= 0, `missing ${pair[0]}`);
    if (pair.length > 1) assert.ok(a.some((v, j) => v === pair[0] && a[j + 1] === pair[1]), `missing ${pair.join(' ')}`);
  };
  has('--network', 'none');
  has('--ipc', 'none');
  has('--read-only');
  has('--cap-drop', 'ALL');
  has('--security-opt', 'no-new-privileges');
  has('--user', '65534:65534');
  has('--log-driver', 'none');
  has('--pull', 'never');
  has('--memory-swap', `${limits.memoryMiB}m`);
  has('--pids-limit', String(limits.pids));
  has('--mount', 'type=bind,src=/w,dst=/work,readonly');
  has('--mount', 'type=bind,src=/d,dst=/disc/disc.bin,readonly');
  // No way to pass environment variables in, and no privileged options.
  for (const bad of ['-e', '--env', '--env-file', '--privileged', '--cap-add', '-v', '--volume', '--device']) {
    assert.ok(!a.includes(bad), `unexpected ${bad}`);
  }
  // The command comes last, after the image.
  assert.deepEqual(a.slice(-2), ['img', 'x.js']);
});

test('runSandbox: rejects bad limits and unsafe paths before starting anything', async () => {
  await assert.rejects(runSandbox({ work: HOSTILE, disc: DISC, out: path.join(SCRATCH, 'x'), command: ['true'], limits: { pids: 100000 } }), SandboxError);
  await assert.rejects(runSandbox({ work: HOSTILE, disc: DISC, out: path.join(SCRATCH, 'a,b'), command: ['true'] }), SandboxError);
  await assert.rejects(runSandbox({ work: HOSTILE, disc: DISC, out: path.join(SCRATCH, 'y'), command: [] }), SandboxError);
});

// --- Container tests ----------------------------------------------------------

dockerTest('network: HTTP, DNS, UDP, TCP, IPv6, cloud metadata and the Docker host all fail', { timeout: 120000 }, async () => {
  const { report, result } = await inSandbox(['node', 'net.mjs'], { timeoutS: 90 });
  assert.equal(report.exit_code, 0);
  assert.deepEqual(result.interfaces, ['lo']);
  for (const [k, v] of Object.entries(result)) {
    if (['interfaces', 'cap_eff', 'cap_bnd', 'no_new_privs'].includes(k)) continue;
    assert.notEqual(v, 'ok', `${k} reached the network`);
  }
  // Raw sockets need CAP_NET_RAW: no capabilities at all, and none can be gained.
  assert.equal(result.cap_eff, '0000000000000000');
  assert.equal(result.cap_bnd, '0000000000000000');
  assert.equal(result.no_new_privs, '1');
});

dockerTest('network: raw IP and packet sockets are refused (EPERM)', { timeout: 60000 }, async () => {
  const { report, result } = await inSandbox(['perl', 'raw-socket.pl'], { timeoutS: 30 });
  assert.equal(report.exit_code, 0);
  // errno 1 is EPERM: no CAP_NET_RAW.
  assert.deepEqual(result, { packet: '1', raw_icmp: '1', raw_inet: '1' });
});

dockerTest('credentials: no host environment, credential files, Docker socket or planted canary', { timeout: 120000 }, async () => {
  const marker = `CANARY${randomBytes(8).toString('hex')}`;
  // A secret in the host's environment (as a workflow secret would be) ...
  process.env[`SECRET_${marker}`] = `value-${marker}`;
  // ... and a credential file on the host, next to the output directory.
  writeFileSync(path.join(SCRATCH, `${marker}.json`), JSON.stringify({ token: marker }));
  try {
    const { report, result } = await inSandbox(['node', 'creds.mjs', marker], { timeoutS: 90 });
    assert.equal(report.exit_code, 0);
    assert.equal(result.marker_in_env, false);
    assert.equal(result.marker_in_proc_environ, false);
    assert.deepEqual(result.marker_in_filenames, []);
    assert.ok(result.walked > 1000, 'the filesystem walk ran');
    for (const [p, v] of Object.entries(result.readable)) assert.notEqual(v, 'ok', `${p} is readable`);
    // Only the image's own variables are present.
    assert.deepEqual(result.env_keys, ['HOME', 'HOSTNAME', 'NODE_VERSION', 'PATH', 'YARN_VERSION']);
    assert.equal(result.uid, 65534);
  } finally {
    delete process.env[`SECRET_${marker}`];
  }
});

dockerTest('filesystem: nothing is writable except /out and /tmp, and the disc is untouched', { timeout: 120000 }, async () => {
  const before = readdirSync(HOSTILE).sort();
  const { report, result } = await inSandbox(['node', 'fs.mjs'], { timeoutS: 90 });
  assert.equal(report.exit_code, 0);
  for (const [t, v] of Object.entries(result.targets)) {
    if (t === '/out/ok' || t === '/tmp/ok') assert.equal(v, 'ok', `${t} should be writable`);
    else assert.notEqual(v, 'ok', `${t} was writable`);
  }
  // The disc is world-writable on the host: only the read-only mount stops this.
  assert.equal(result.targets['/disc/disc.bin (open r+)'], 'EROFS');
  for (const [m, { write }] of Object.entries(result.rw_mounts)) {
    if (m === '/out' || m === '/tmp') continue;
    assert.notEqual(write, 'ok', `mount ${m} was writable`);
  }
  assert.equal(sha256(readFileSync(DISC)), DISC_HASH, 'disc changed');
  assert.deepEqual(readdirSync(HOSTILE).sort(), before, 'work directory changed');
});

for (const mode of ['bytes', 'files']) {
  dockerTest(`output cap (${mode}): writing past the cap fails and the report says "output"`, { timeout: 120000 }, async () => {
    const { report, out } = await inSandbox(['node', 'fill.mjs', mode], { outMiB: 2, timeoutS: 60 });
    assert.ok(report.limits_hit.includes('output'), JSON.stringify(report));
    assert.ok(report.output_bytes <= 2 << 20);
    const fs = statfsSync(out);
    assert.ok((fs.blocks - fs.bfree) * fs.bsize <= 2 << 20, 'host-side usage over the cap');
  });
}

dockerTest('memory: a memory hog is killed and the report says "memory"', { timeout: 120000 }, async () => {
  const { report } = await inSandbox(['node', 'memhog.mjs'], { memoryMiB: 128, timeoutS: 60 });
  assert.deepEqual(report.limits_hit, ['memory']);
  assert.equal(report.exit_code, 137);
});

dockerTest('processes: a fork bomb is held at the pids limit and the report says "pids"', { timeout: 120000 }, async () => {
  const { report, result } = await inSandbox(['node', 'forkbomb.mjs'], { pids: 32, timeoutS: 5 });
  assert.ok(report.limit_counters.includes('pids'), 'pids counter not readable on this host');
  assert.ok(report.limits_hit.includes('pids'), JSON.stringify(report));
  // `started` counts spawns over the whole run, not processes alive at
  // once; the evidence of the cap is the kernel refusing a fork (EAGAIN)
  // and the cgroup's pids.events counter, which limits_hit reads.
  assert.ok(result.started > 0);
  assert.equal(result.refused, 'EAGAIN');
  const left = spawnSync('docker', ['ps', '-aq', '--filter', 'name=ff7-sandbox-'], { encoding: 'utf8' }).stdout.trim();
  assert.equal(left, '', 'a sandbox container was left behind');
});

dockerTest('time: a program that never exits is killed at the deadline and the report says "time"', { timeout: 60000 }, async () => {
  const { report } = await inSandbox(['node', 'sleeper.mjs'], { timeoutS: 2 });
  assert.deepEqual(report.limits_hit, ['time']);
  assert.equal(report.exit_code, null);
  assert.ok(report.elapsed_s <= 10, `took ${report.elapsed_s}s`);
});

dockerTest('after the run: a detached child cannot write later, and /out is read-only', { timeout: 60000 }, async () => {
  const { report, result, out } = await inSandbox(['node', 'late-writer.mjs'], { timeoutS: 20 });
  assert.equal(report.exit_code, 0);
  assert.equal(result.child, true);
  await new Promise((r) => setTimeout(r, 3000));
  assert.ok(!outExists(path.join(out, 'late.txt')), 'the late write landed');
  assert.match(writeOutAsRoot(path.join(out, 'host.txt')) ?? 'written', /Read-only file system/);
});

dockerTest("the program's stdout and stderr never reach the sandbox's own output", { timeout: 60000 }, () => {
  const marker = `LEAK${randomBytes(8).toString('hex')}`;
  const out = path.join(SCRATCH, `out-${outCount++}`);
  const r = spawnSync(process.execPath, [CLI, 'run', '--work', HOSTILE, '--disc', DISC, '--out', out, '--timeout-s', '30', '--',
    'node', '-e', `console.log('${marker}'); console.error('${marker}'); process.exit(3)`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stdout.includes(marker) && !r.stderr.includes(marker), 'program output leaked');
  const report = JSON.parse(r.stdout);
  assert.equal(report.exit_code, 3);
  assert.equal(r.stdout.trim().split('\n').length, 1, 'stdout is exactly one report line');
});

dockerTest('a normal Tier 1 scenario gives byte-identical output inside and outside the sandbox', { timeout: 300000 }, async (t) => {
  if (!existsSync(path.join(REPO, 'runner/dist/core.wasm'))) {
    if (REQUIRE) assert.fail('runner/dist/core.wasm missing: run core/build.sh and runner/build.sh');
    t.skip('runner not built (core/build.sh, runner/build.sh)');
    return;
  }
  const scenario = 'harness/scenarios/pad-echo-buttons.json';
  const outside = spawnSync(process.execPath, ['runner/scenario.js', scenario], { cwd: REPO, encoding: 'utf8' });
  assert.equal(outside.status, 0, outside.stderr);

  // The work directory is what the untrusted build job would upload.
  const work = path.join(SCRATCH, 'work');
  mkdirSync(work);
  cpSync(path.join(REPO, 'runner'), path.join(work, 'runner'), { recursive: true });
  cpSync(path.join(REPO, 'harness'), path.join(work, 'harness'), { recursive: true });
  const { report, out } = await inSandbox(['sh', '-c', `node runner/scenario.js ${scenario} > /out/result.json`], { timeoutS: 240 }, work);
  assert.equal(report.exit_code, 0);
  assert.deepEqual(report.limits_hit, []);
  assert.equal(readOut(path.join(out, 'result.json')), outside.stdout);
});


test('the disc is mounted read-only as disc.bin and disc-1.bin, with no cue', () => {
  const args = createArgs({ name: 'n', image: 'img', work: '/w', disc: '/d', out: '/o',
    limits: Object.fromEntries(Object.entries(LIMITS).map(([k, v]) => [k, v.def])), command: ['node', 'x.js'] });
  const mounts = args.flatMap((v, i) => v === '--mount' ? [args[i + 1]] : []);
  assert.deepEqual(mounts, ['type=bind,src=/w,dst=/work,readonly',
    'type=bind,src=/d,dst=/disc/disc.bin,readonly',
    'type=bind,src=/d,dst=/disc/disc-1.bin,readonly',
    'type=bind,src=/o,dst=/out']);
});
