#!/usr/bin/env node
// Tier 2 sandbox: run untrusted code (the PR's runner and scenarios) in a
// locked-down container next to the disc image, and report which limits it
// hit. Trusted code: it runs from `main` in the private-eval workflow
// (docs/AUTOMATION.md, Tier 2; docs/SECURITY.md, trust boundary).
//
//   node harness/private-eval/sandbox/sandbox.js run \
//        --work DIR --disc FILE --out DIR [limits] -- COMMAND [ARGS...]
//   node harness/private-eval/sandbox/sandbox.js release --out DIR
//
// `run` prints one JSON report (format below) on stdout and nothing else.
// The untrusted program's own stdout and stderr are discarded, never
// printed: Actions logs are public. Its only channel out is the output
// directory, which trusted code (#34's validator) reads afterwards.
//
// Inside the container:
//   /work       the untrusted build, read-only (also the working directory)
//   /disc/disc.bin   the disc image, read-only
//   /disc/disc-1.bin the same image under its own name, read-only
//               (individual file mounts; no host directory is exposed; no
//               cue: FF7's discs are single data tracks, owner decision
//               2026-11-05)
//   /out        the only persistent writable place: a host tmpfs with a size
//               cap, remounted read-only on the host when the run ends
//   /tmp        private scratch (tmpfs, capped, noexec), discarded at exit
// Everything else is read-only. No network (--network none), no IPC
// namespace sharing and no /dev/shm (--ipc none), no capabilities, no
// privilege gain, uid/gid 65534, no environment variables from the host, and
// limits on memory, CPU, process count, open files and wall time.
//
// Needs Docker and root (or passwordless sudo) to mount the output tmpfs.
// The image is pinned by digest in pins.json; SANDBOX_IMAGE_REPO may point
// at a mirror of the same repository (the digest still has to match).
//
// Exit status of the CLI: 0 when the sandbox itself worked (whatever the
// program did; read the report), 2 on usage errors or a sandbox failure.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, lstatSync, statfsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PINS = JSON.parse(readFileSync(path.join(HERE, 'pins.json'), 'utf8'));

export const SANDBOX_UID = 65534;

/** Default limits, and the bounds a caller may choose within. */
export const LIMITS = {
  timeoutS: { def: 600, min: 1, max: 3600 },
  memoryMiB: { def: 1024, min: 64, max: 8192 },
  cpus: { def: 2, min: 1, max: 8 },
  pids: { def: 64, min: 8, max: 1024 },
  outMiB: { def: 4, min: 1, max: 64 },
  tmpMiB: { def: 64, min: 1, max: 512 },
};
const NOFILE = 256;

export class SandboxError extends Error {}

export function imageRef(env = process.env) {
  const repo = env.SANDBOX_IMAGE_REPO || PINS.image.repository;
  if (!/^[a-z0-9.\-/:]+$/.test(repo)) throw new SandboxError(`bad SANDBOX_IMAGE_REPO: ${repo}`);
  return `${repo}@${PINS.image.digest}`;
}

function sh(cmd, args, { allowFail = false } = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 20 });
  if (r.error) throw new SandboxError(`${cmd}: ${r.error.message}`);
  if (r.status !== 0 && !allowFail) {
    throw new SandboxError(`${cmd} ${args.slice(0, 2).join(' ')} failed (${r.status}): ${r.stderr.trim().slice(0, 500)}`);
  }
  return r;
}

const asRoot = (cmd, args, opts) =>
  process.getuid() === 0 ? sh(cmd, args, opts) : sh('sudo', ['-n', cmd, ...args], opts);

/** A path we pass to `docker --mount` and `mount`: absolute, no separators Docker would misread. */
function safePath(p, what) {
  const abs = path.resolve(p);
  if (/[,\n\r=:"]/.test(abs)) throw new SandboxError(`${what} path has a character the mount syntax can't take: ${abs}`);
  return abs;
}

function isMountPoint(dir) {
  const mounts = readFileSync('/proc/self/mounts', 'utf8').split('\n');
  return mounts.some((l) => l.split(' ')[1] === dir);
}

function bounded(name, raw) {
  const { def, min, max } = LIMITS[name];
  if (raw === undefined) return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new SandboxError(`--${name} must be an integer in [${min}, ${max}]`);
  return n;
}

export function dockerServerVersion() {
  return sh('docker', ['version', '--format', '{{.Server.Version}}']).stdout.trim();
}

/** Make sure the pinned image is present; `docker pull` by digest verifies it. */
export function ensureImage(ref = imageRef()) {
  if (sh('docker', ['image', 'inspect', ref], { allowFail: true }).status === 0) return ref;
  sh('docker', ['pull', '--quiet', ref]);
  return ref;
}

/**
 * Mount a fresh, empty, size-capped tmpfs at `out` for the sandbox to write.
 * It's owned by the sandbox uid, and noexec, nosuid, nodev.
 */
export function prepareOutput(out, outMiB) {
  mkdirSync(out, { recursive: true });
  if (isMountPoint(out)) throw new SandboxError(`${out} is already a mount point; release it first`);
  if (readdirSync(out).length) throw new SandboxError(`${out} is not empty`);
  asRoot('mount', ['-t', 'tmpfs', '-o',
    `size=${outMiB}m,nr_inodes=1024,mode=0700,uid=${SANDBOX_UID},gid=${SANDBOX_UID},noexec,nosuid,nodev`,
    'ff7-sandbox-out', out]);
}

/** After the run: freeze the output (read-only, and readable by the host's trusted code). */
function freezeOutput(out) {
  asRoot('mount', ['-o', 'remount,ro', out]);
}

/** Unmount the output directory once trusted code has read it. */
export function releaseOutput(out) {
  const dir = safePath(out, '--out');
  if (isMountPoint(dir)) asRoot('umount', [dir]);
}

/** cgroup files for a running container's init process, v1 or v2. */
function cgroupFiles(pid) {
  let lines;
  try {
    lines = readFileSync(`/proc/${pid}/cgroup`, 'utf8').trim().split('\n');
  } catch {
    return {};
  }
  // Candidates for cgroup v2 (GitHub's ubuntu-24.04), v1, and hybrid hosts
  // (v1 controllers plus an empty unified tree at /sys/fs/cgroup/unified).
  // Only files that exist are used.
  const candidates = { pidsEvents: [], memEvents: [], memOom: [] };
  for (const l of lines) {
    const [, ctrls, rel] = l.split(':');
    if (ctrls === '') {
      candidates.pidsEvents.push(`/sys/fs/cgroup${rel}/pids.events`);
      candidates.memEvents.push(`/sys/fs/cgroup${rel}/memory.events`);
    } else if (ctrls.split(',').includes('pids')) {
      candidates.pidsEvents.push(`/sys/fs/cgroup/pids${rel}/pids.events`);
    } else if (ctrls.split(',').includes('memory')) {
      candidates.memOom.push(`/sys/fs/cgroup/memory${rel}/memory.oom_control`);
    }
  }
  const files = {};
  for (const [k, list] of Object.entries(candidates)) {
    const found = list.find((f) => existsSync(f));
    if (found) files[k] = found;
  }
  return files;
}

function readCounter(file, key) {
  if (!file) return 0;
  try {
    const text = readFileSync(file, 'utf8');
    const m = text.match(new RegExp(`^${key} (\\d+)$`, 'm'));
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

/** Sample the limit counters; a counter only ever goes up, so keep the max. */
function sample(files, seen) {
  seen.pidsMax = Math.max(seen.pidsMax, readCounter(files.pidsEvents, 'max'));
  seen.oomKill = Math.max(
    seen.oomKill,
    readCounter(files.memEvents, 'oom_kill'),
    readCounter(files.memOom, 'oom_kill'),
  );
}

/**
 * A per-run parent cgroup for the container, on cgroup v2 hosts (#149).
 * The container's own cgroup is removed when it exits, so a memory kill
 * just before exit can be missed by polling it, and Docker's OOMKilled flag
 * is unreliable on cgroup v2. The parent outlives the container, and its
 * memory.events counts kills in the whole subtree (measured on GitHub's
 * runner: 30/30, including runs where inspect saw Pid 0 or OOMKilled was
 * false; notes/149-sandbox-memory-flake.md). Returns null elsewhere.
 */
export function cgroupParentFor(runId, { driver, version }) {
  if (String(version) !== '2' || !/^[a-z0-9_]+$/.test(runId)) return null;
  if (driver === 'systemd') {
    // A '-' in a slice name means nesting, so the id uses '_' only.
    const name = `ff7sandbox_${runId}.slice`;
    return { name, dir: `/sys/fs/cgroup/${name}`, stop: ['systemctl', ['stop', name]] };
  }
  if (driver === 'cgroupfs') {
    const name = `/ff7sandbox_${runId}`;
    return { name, dir: `/sys/fs/cgroup${name}`, stop: ['rmdir', [`/sys/fs/cgroup${name}`]] };
  }
  return null;
}

function dockerCgroup() {
  const r = sh('docker', ['info', '--format', '{{.CgroupDriver}} {{.CgroupVersion}}'], { allowFail: true });
  const [driver, version] = r.status === 0 ? r.stdout.trim().split(' ') : [];
  return { driver, version };
}

/** The docker create arguments: every isolation setting is here, in one place. */
export function createArgs({ name, image, work, disc, out, limits, command, cgroupParent = null }) {
  return [
    'create',
    '--name', name,
    ...(cgroupParent ? ['--cgroup-parent', cgroupParent] : []),
    '--pull', 'never',
    '--network', 'none',
    '--ipc', 'none',
    '--read-only',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--user', `${SANDBOX_UID}:${SANDBOX_UID}`,
    '--init',
    '--log-driver', 'none',
    '--hostname', 'sandbox',
    '--no-healthcheck',
    '--memory', `${limits.memoryMiB}m`,
    '--memory-swap', `${limits.memoryMiB}m`,
    '--cpus', String(limits.cpus),
    '--pids-limit', String(limits.pids),
    '--ulimit', `nofile=${NOFILE}:${NOFILE}`,
    '--ulimit', 'core=0:0',
    '--tmpfs', `/tmp:rw,size=${limits.tmpMiB}m,mode=1777,noexec,nosuid,nodev`,
    '--mount', `type=bind,src=${work},dst=/work,readonly`,
    '--mount', `type=bind,src=${disc},dst=/disc/disc.bin,readonly`,
    '--mount', `type=bind,src=${disc},dst=/disc/disc-1.bin,readonly`,
    '--mount', `type=bind,src=${out},dst=/out`,
    '--workdir', '/work',
    '--entrypoint', command[0],
    image,
    ...command.slice(1),
  ];
}

/**
 * Run `command` in the sandbox. Returns the report:
 *   { format: 1, exit_code, limits_hit: [...], limit_counters: [...],
 *     output_bytes, elapsed_s, docker_server, image }
 * limits_hit is a subset of ["time", "memory", "pids", "output"], sorted.
 * "output" means the output directory is full (the program got ENOSPC).
 */
export async function runSandbox({ work, disc, out, command, limits: rawLimits = {}, image } = {}) {
  if (!Array.isArray(command) || command.length === 0) throw new SandboxError('no command given');
  work = safePath(work, '--work');
  disc = safePath(disc, '--disc');
  out = safePath(out, '--out');
  if (!existsSync(work) || !statSync(work).isDirectory()) throw new SandboxError(`--work is not a directory: ${work}`);
  if (!existsSync(disc) || !statSync(disc).isFile()) throw new SandboxError(`--disc is not a file: ${disc}`);
  const limits = Object.fromEntries(Object.keys(LIMITS).map((k) => [k, bounded(k, rawLimits[k])]));

  image = ensureImage(image || imageRef());
  const docker = dockerServerVersion();
  prepareOutput(out, limits.outMiB);

  const runId = `${process.pid}_${Date.now()}`;
  const name = `ff7-sandbox-${runId.replace('_', '-')}`;
  const parent = cgroupParentFor(runId, dockerCgroup());
  const parentFiles = parent ? { memEvents: path.join(parent.dir, 'memory.events') } : {};
  const seen = { pidsMax: 0, oomKill: 0 };
  const counters = [];
  let timedOut = false;
  const t0 = Date.now();
  try {
    sh('docker', createArgs({ name, image, work, disc, out, limits, command, cgroupParent: parent?.name }));
    sh('docker', ['start', name]);

    const pid = Number(sh('docker', ['inspect', '--format', '{{.State.Pid}}', name]).stdout.trim());
    const files = pid > 0 ? cgroupFiles(pid) : {};
    if (files.pidsEvents) counters.push('pids');
    if (files.memEvents || files.memOom || (parent && existsSync(parentFiles.memEvents))) counters.push('memory');
    const waiter = spawn('docker', ['wait', name], { stdio: 'ignore' });
    const exited = new Promise((resolve) => waiter.on('exit', resolve));
    const poll = setInterval(() => sample(files, seen), 100);
    let deadline;
    const timer = new Promise((resolve) => {
      deadline = setTimeout(() => resolve('timeout'), limits.timeoutS * 1000);
    });
    const first = await Promise.race([exited.then(() => 'exited'), timer]);
    clearTimeout(deadline);
    if (first === 'timeout') {
      timedOut = true;
      sample(files, seen);
      sh('docker', ['kill', name], { allowFail: true });
      await exited;
    }
    clearInterval(poll);
    sample(files, seen);
    // The parent cgroup is still there after the container's own is gone.
    sample(parentFiles, seen);

    const state = JSON.parse(sh('docker', ['inspect', '--format', '{{json .State}}', name]).stdout);
    const elapsed = Math.round((Date.now() - t0) / 1000);

    freezeOutput(out);
    const fs = statfsSync(out);
    const used = (fs.blocks - fs.bfree) * fs.bsize;
    const full = fs.bavail * fs.bsize < 64 * 1024 || fs.ffree === 0;

    const hit = [];
    if (timedOut) hit.push('time');
    if (state.OOMKilled || seen.oomKill > 0) hit.push('memory');
    if (seen.pidsMax > 0) hit.push('pids');
    if (full) hit.push('output');
    return {
      format: 1,
      exit_code: timedOut ? null : state.ExitCode,
      limits_hit: hit.sort(),
      // Which cgroup counters the host could read. If one is missing, a hit
      // on that limit can't be reported (Docker's OOM flag still covers memory).
      limit_counters: counters,
      output_bytes: used,
      elapsed_s: elapsed,
      docker_server: docker,
      image,
    };
  } catch (e) {
    // Leave nothing half-run: the output can't be trusted to be complete.
    try {
      releaseOutput(out);
    } catch {
      /* best effort */
    }
    throw e;
  } finally {
    sh('docker', ['rm', '--force', '--volumes', name], { allowFail: true });
    if (parent) {
      try {
        asRoot(parent.stop[0], parent.stop[1], { allowFail: true });
      } catch {
        /* best effort: a cleanup failure must not replace the report */
      }
    }
  }
}

const LIMIT_FLAGS = {
  'timeout-s': 'timeoutS',
  'memory-mib': 'memoryMiB',
  cpus: 'cpus',
  pids: 'pids',
  'out-mib': 'outMiB',
  'tmp-mib': 'tmpMiB',
};

async function main(argv) {
  const usage =
    'usage: sandbox.js run --work DIR --disc FILE --out DIR [--timeout-s N] [--memory-mib N] [--cpus N]\n' +
    '                      [--pids N] [--out-mib N] [--tmp-mib N] -- COMMAND [ARGS...]\n' +
    '       sandbox.js release --out DIR';
  const [verb, ...rest] = argv;
  const options = {
    work: { type: 'string' },
    disc: { type: 'string' },
    out: { type: 'string' },
    ...Object.fromEntries(Object.keys(LIMIT_FLAGS).map((f) => [f, { type: 'string' }])),
  };
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({ args: rest, options, allowPositionals: true }));
  } catch (e) {
    console.error(`error: ${e.message}\n${usage}`);
    return 2;
  }
  try {
    if (verb === 'release') {
      if (!values.out) throw new SandboxError('--out is required');
      releaseOutput(values.out);
      return 0;
    }
    if (verb !== 'run' || !values.work || !values.disc || !values.out) throw new SandboxError('missing arguments');
    const limits = {};
    for (const [flag, key] of Object.entries(LIMIT_FLAGS)) if (values[flag] !== undefined) limits[key] = values[flag];
    const report = await runSandbox({ work: values.work, disc: values.disc, out: values.out, command: positionals, limits });
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return 0;
  } catch (e) {
    console.error(`error: ${e.message}\n${usage}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}

