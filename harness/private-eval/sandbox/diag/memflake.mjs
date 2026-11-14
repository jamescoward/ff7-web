// Diagnostic for issue #149 (sandbox memory-limit test is flaky). Tier 1:
// no game data; the "disc" is random bytes and the program is the test's
// own memory hog. Not a test: it measures and prints, and always exits 0.
//
//   node harness/private-eval/sandbox/diag/memflake.mjs [RUNS]
//
// Needs Docker and root or passwordless sudo, like the sandbox tests.
//
// Part A: runSandbox() with the memory hog, RUNS times, exactly as the test
//   does. Per run: exit_code, limits_hit, limit_counters (no "memory" there
//   means the init Pid was 0 or its cgroup was gone at `docker inspect`),
//   and the change in the Docker parent cgroup's hierarchical memory.events
//   oom_kill (candidate counter 1: it survives the container's own cgroup).
// Part B: the same create/start/inspect steps by hand, with a per-run
//   --cgroup-parent (candidate counter 2). Per run: the Pid inspect saw,
//   whether /proc/<pid>/cgroup was readable, whether the parent cgroup still
//   exists after exit, its oom_kill, the exit code and State.OOMKilled.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createArgs, ensureImage, imageRef, prepareOutput, releaseOutput, runSandbox } from '../sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOSTILE = path.resolve(HERE, '../test/hostile');
const RUNS = Math.max(1, Math.min(200, Number(process.argv[2]) || 60));
const RUNS_B = Math.min(RUNS, 30);
const MEM_MIB = 128;

function sh(cmd, args) {
  return spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 20 });
}
const asRoot = (cmd, args) => (process.getuid() === 0 ? sh(cmd, args) : sh('sudo', ['-n', cmd, ...args]));

function oomKill(dir) {
  try {
    const m = readFileSync(path.join(dir, 'memory.events'), 'utf8').match(/^oom_kill (\d+)$/m);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

const info = sh('docker', ['info', '--format', '{{.CgroupDriver}} {{.CgroupVersion}} {{.KernelVersion}} {{.ServerVersion}}']).stdout.trim();
const [driver, cgVersion] = info.split(' ');
const dockerParent = driver === 'systemd' ? '/sys/fs/cgroup/system.slice' : '/sys/fs/cgroup/docker';
console.log(`docker: driver cgroupVersion kernel server = ${info}`);
console.log(`docker parent cgroup: ${dockerParent} (exists: ${existsSync(dockerParent)}, oom_kill ${oomKill(dockerParent)})`);

const scratch = mkdtempSync(path.join(os.tmpdir(), 'ff7-memflake-'));
const disc = path.join(scratch, 'disc.bin');
writeFileSync(disc, randomBytes(1 << 20));
chmodSync(disc, 0o666);
let outN = 0;
const freshOut = () => path.join(scratch, `out-${outN++}`);

// Part A
const a = [];
for (let i = 0; i < RUNS; i++) {
  const out = freshOut();
  const before = oomKill(dockerParent);
  const t0 = Date.now();
  let row;
  try {
    const r = await runSandbox({ work: HOSTILE, disc, out, command: ['node', 'memhog.mjs'], limits: { memoryMiB: MEM_MIB, timeoutS: 60 } });
    const after = oomKill(dockerParent);
    row = {
      i, exit: r.exit_code, hit: r.limits_hit.join(',') || '-', counters: r.limit_counters.join(',') || '-',
      parentDelta: before === null || after === null ? null : after - before, ms: Date.now() - t0,
    };
  } catch (e) {
    row = { i, error: String(e.message).slice(0, 200) };
  }
  try {
    releaseOutput(out);
  } catch {
    /* not mounted */
  }
  a.push(row);
  console.log(`A ${JSON.stringify(row)}`);
}

// Part B
const image = ensureImage(imageRef());
const b = [];
for (let i = 0; i < RUNS_B; i++) {
  const out = freshOut();
  const name = `ff7-memflake-${process.pid}-${i}`;
  const parentName = driver === 'systemd' ? `ff7memflake${i}.slice` : `/ff7memflake${i}`;
  const parentDir = driver === 'systemd' ? `/sys/fs/cgroup/${parentName}` : `/sys/fs/cgroup${parentName}`;
  let row = { i };
  try {
    prepareOutput(out, 4);
    const args = createArgs({
      name, image, work: HOSTILE, disc, out, command: ['node', 'memhog.mjs'],
      limits: { memoryMiB: MEM_MIB, cpus: 2, pids: 64, tmpMiB: 64 },
    });
    args.splice(1, 0, '--cgroup-parent', parentName);
    const c = sh('docker', args);
    if (c.status !== 0) throw new Error(`create: ${c.stderr.trim()}`);
    const t0 = Date.now();
    const s = sh('docker', ['start', name]);
    if (s.status !== 0) throw new Error(`start: ${s.stderr.trim()}`);
    const pid = Number(sh('docker', ['inspect', '--format', '{{.State.Pid}}', name]).stdout.trim());
    const inspectMs = Date.now() - t0;
    let procCgroup = null;
    try {
      procCgroup = readFileSync(`/proc/${pid}/cgroup`, 'utf8').trim().replace(/\n/g, ' | ');
    } catch {
      /* gone */
    }
    sh('docker', ['wait', name]);
    const state = JSON.parse(sh('docker', ['inspect', '--format', '{{json .State}}', name]).stdout);
    row = {
      i, pid, inspectMs, procCgroup: pid > 0 ? procCgroup : null, exit: state.ExitCode, oomKilledFlag: state.OOMKilled,
      parentExistsAfter: existsSync(parentDir), parentOomKill: oomKill(parentDir),
    };
  } catch (e) {
    row = { i, error: String(e.message).slice(0, 300) };
  } finally {
    sh('docker', ['rm', '--force', name]);
    try {
      releaseOutput(out);
    } catch {
      /* not mounted */
    }
    if (driver === 'systemd') asRoot('systemctl', ['stop', parentName]);
    else if (existsSync(parentDir)) asRoot('rmdir', [parentDir]);
  }
  b.push(row);
  console.log(`B ${JSON.stringify(row)}`);
}
rmSync(scratch, { recursive: true, force: true });

// Summary
const count = (rows, f) => rows.filter(f).length;
const lines = [
  `## #149 memory-flake diagnostic`,
  ``,
  `Docker: \`${info}\`; parent cgroup \`${dockerParent}\`.`,
  ``,
  `**Part A** (runSandbox, memory hog at ${MEM_MIB} MiB, ${a.length} runs):`,
  `- errors: ${count(a, (r) => r.error)}`,
  `- exit 137: ${count(a, (r) => r.exit === 137)}; other exits: ${JSON.stringify(a.filter((r) => !r.error && r.exit !== 137).map((r) => r.exit))}`,
  `- limits_hit = memory: ${count(a, (r) => r.hit === 'memory')}; empty: ${count(a, (r) => r.hit === '-')}`,
  `- limit_counters without memory: ${count(a, (r) => !r.error && !r.counters.includes('memory'))}`,
  `- empty limits_hit while counters lacked memory: ${count(a, (r) => r.hit === '-' && !String(r.counters).includes('memory'))}`,
  `- empty limits_hit while counters had memory: ${count(a, (r) => r.hit === '-' && String(r.counters).includes('memory'))}`,
  `- parent oom_kill rose by >= 1: ${count(a, (r) => r.parentDelta >= 1)}; unreadable: ${count(a, (r) => !r.error && r.parentDelta === null)}`,
  ``,
  `**Part B** (by hand, per-run --cgroup-parent, ${b.length} runs):`,
  `- errors: ${count(b, (r) => r.error)} ${JSON.stringify(b.filter((r) => r.error).slice(0, 2).map((r) => r.error))}`,
  `- Pid 0 at inspect: ${count(b, (r) => r.pid === 0)}; /proc/<pid>/cgroup unreadable: ${count(b, (r) => !r.error && r.procCgroup === null)}`,
  `- exit 137: ${count(b, (r) => r.exit === 137)}; State.OOMKilled true: ${count(b, (r) => r.oomKilledFlag === true)}`,
  `- parent exists after exit: ${count(b, (r) => r.parentExistsAfter)}; parent oom_kill >= 1: ${count(b, (r) => r.parentOomKill >= 1)}`,
  `- inspect ms (min/max): ${Math.min(...b.filter((r) => !r.error).map((r) => r.inspectMs))}/${Math.max(...b.filter((r) => !r.error).map((r) => r.inspectMs))}`,
];
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
console.log(`cgroup version ${cgVersion}; done`);
