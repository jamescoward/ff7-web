#!/usr/bin/env node
// Tier 2 entry point: the untrusted program the private eval runs inside the
// sandbox (#33, #35, #55). The command is fixed by #35
// (harness/private-eval/eval/lib.js, SANDBOX_COMMAND):
//
//   node runner/tier2.js --disc /disc/disc.bin --out /out
//
// run with the tier2-build artifact as the working directory, no network,
// and a read-only /work. Options for tests and local runs:
//   --scenarios DIR    scenario directory (default harness/scenarios)
//   --fixtures DIR     fixture directory (default harness/fixtures)
//   --baselines DIR    baseline directory (default harness/baselines)
//   --deadline-s N     stop starting scenarios after N seconds (default 1140,
//                      under the sandbox's 1200 s limit); the rest report error
//
// It runs every scenario file with "tier": 2 and writes OUT/results.json in
// the #34 format (harness/schema/tier2-result.schema.json): per scenario,
// pass/fail/error, plus the numeric metrics the scenario lists. Only that
// file counts. stdout stays empty; stderr gets one line per scenario, which
// the trusted side never reads.
//
// Each scenario runs in its own child process (`--one FILE`), so a crash,
// an abort or a hang in one scenario is reported as "error" for that
// scenario and the others still run. results.json is rewritten atomically
// after every scenario, so if the sandbox kills the run, the scenarios
// already finished are still reported (the rest count as missing).
//
// Scenario files are picked with the same rules as the trusted expect
// builder (lib.js buildExpect): *.json in the scenario directory, "tier": 2,
// and "name" equal to the file name. A file the builder would reject stops
// the eval before this program runs, so here it is skipped.
//
// --disc is required by the contract and passed on to scenarios. A scenario
// with "boot": {"disc": "disc-1"} boots an image with no same-named cue:
// in the private eval that is /disc/disc.bin, since /disc/disc-1.bin has the
// R2 cue beside it (#36; scenario.js resolveDisc). Fixture scenarios ignore it.
//
// Format 2 scenarios (#37) that start from a boot point share one snapshot
// per run: before the first of them, a child (`--make-snapshot NAME`) boots
// the boot point and hands its snapshot back on stdout; this process keeps
// it in memory and passes it to each scenario's child on stdin. Nothing is
// written to a file. If the snapshot can't be made, each scenario boots the
// boot point itself and reports what went wrong (a failed boot_stage, or
// error for "no disc").
//
// Chains (#74): a scenario with "snapshot": NAME that passes hands the state
// at the end of its script back on stdout, after its result line (the child
// is started with --save-snapshot). This process keeps it in memory under
// NAME, with the chain of scenario files that led to it, until the end of
// the run. A later scenario with "boot": { "from": NAME } gets the bytes on
// stdin and the chain as --chain FILE arguments (so a "boot" check can
// replay the chain from power-on). Scenarios run in file name order, which
// decides what exists: a scenario from a snapshot that no earlier scenario
// kept is not started and reports error ("no snapshot"). Nothing is written
// to a file.
//
// Exit status: 0 results written (or no tier 2 scenarios), 1 the results
// could not be written, 2 usage error.

import { spawnSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { POWER_ON, SAVE_BOOT_POINT } from './bootpoints.js';
import { makeSnapshot } from './format2.js';
import { DEFAULT_BASELINES, DEFAULT_FIXTURES, loadScenario, runScenario, savesDirFor } from './scenario.js';
import { segmentsDirFor } from './segments.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);
export const DEFAULT_SCENARIOS = path.resolve(HERE, '../harness/scenarios');
export const RESULTS_FILE = 'results.json';
export const DEFAULT_DEADLINE_S = 1140;

// The #34 result rules, restated: the artifact holds runner/ and harness/
// data only, never harness/private-eval/. runner/test/unit/tier2.test.js
// checks that these agree with the validator.
export const MAX_SCENARIOS = 64;
export const MAX_METRICS = 8;
export const MAX_SCENARIO_BYTES = 64 * 1024;
export const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const METRIC_RE = /^[a-z][a-z0-9_]{0,31}$/;
const MAX_INT = 2 ** 32;
// A snapshot is 4,456,448 bytes (notes/31-card-and-snapshots.md); allow headroom.
const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const MAX_FLOAT = 1e6;

/** Whether the validator (#34) accepts v as a metric value. */
export function validMetricValue(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  if (Number.isInteger(v)) return Math.abs(v) <= MAX_INT;
  return Math.abs(v) <= MAX_FLOAT && Math.round(v * 1000) / 1000 === v;
}

/**
 * The tier 2 scenario files in dir, sorted by file name:
 * [{ file, name, metrics, from, after, snapshot }], where `from` is the boot
 * point a format 2 scenario starts from (null for format 1, power-on and a
 * named snapshot), `after` the named snapshot it starts from (a boot with no
 * source, #74), and `snapshot` the name it keeps its end state under (null
 * if none). Files the trusted expect builder would refuse are skipped (the
 * eval never runs with them).
 */
export function findTier2Scenarios(dir) {
  let names;
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
  } catch {
    return [];
  }
  const found = [];
  for (const file of names) {
    const p = path.join(dir, file);
    let doc;
    try {
      const st = lstatSync(p);
      if (!st.isFile() || st.size > MAX_SCENARIO_BYTES) continue;
      doc = JSON.parse(readFileSync(p, 'utf8'));
    } catch {
      continue;
    }
    if (doc === null || typeof doc !== 'object' || Array.isArray(doc) || doc.tier !== 2) continue;
    if (typeof doc.name !== 'string' || !NAME_RE.test(doc.name) || `${doc.name}.json` !== file) continue;
    const metrics = Array.isArray(doc.metrics) ? doc.metrics.filter((k) => typeof k === 'string' && METRIC_RE.test(k)) : [];
    const f2 = doc.format === 2 && doc.boot !== null && typeof doc.boot === 'object';
    const nameOf = (v) => (typeof v === 'string' && NAME_RE.test(v) ? v : null);
    // A save boot (#38) with no "from" starts from SAVE_BOOT_POINT.
    const bootFrom = f2 ? nameOf(doc.boot.from ?? (doc.boot.save !== undefined ? SAVE_BOOT_POINT : undefined)) : null;
    const hasSource = f2 && (doc.boot.disc !== undefined || doc.boot.fixture !== undefined);
    const from = hasSource && bootFrom !== POWER_ON ? bootFrom : null;
    const after = f2 && !hasSource ? bootFrom : null;
    const snapshot = f2 ? nameOf(doc.snapshot) : null;
    found.push({ file: p, name: doc.name, metrics: metrics.slice(0, MAX_METRICS), from, after, snapshot });
  }
  return found.slice(0, MAX_SCENARIOS);
}

/**
 * One scenario's entry in results.json, from what its child reported.
 * Anything malformed becomes "error"; metrics are kept only when the key is
 * listed and the value is one the validator accepts, so one scenario can't
 * get the whole output rejected.
 */
export function resultEntry(scenario, child) {
  if (!child || (child.status !== 'pass' && child.status !== 'fail')) return { name: scenario.name, status: 'error' };
  const entry = { name: scenario.name, status: child.status };
  const m = child.metrics;
  if (m !== null && typeof m === 'object' && !Array.isArray(m)) {
    const metrics = {};
    for (const k of scenario.metrics) if (Object.hasOwn(m, k) && validMetricValue(m[k])) metrics[k] = m[k];
    if (Object.keys(metrics).length) entry.metrics = metrics;
  }
  return entry;
}

/** Write results.json atomically: a reader sees the old file or the new one. */
export function writeResults(outDir, entries) {
  const tmp = path.join(outDir, `.${RESULTS_FILE}.tmp`);
  writeFileSync(tmp, `${JSON.stringify({ format: 1, scenarios: entries })}\n`);
  renameSync(tmp, path.join(outDir, RESULTS_FILE));
}

/**
 * Parse a --one child's stdout (a Buffer): one JSON line { status, metrics,
 * snapshot? } and, when it holds snapshot: { frames, boot_ms, bytes }, that
 * many raw snapshot bytes after it (--save-snapshot). Returns
 * { line, snapshot }: line null if the output isn't that; snapshot
 * { bytes, frames, bootMs } or null.
 */
export function parseChild(stdout) {
  const none = { line: null, snapshot: null };
  if (!Buffer.isBuffer(stdout)) return none;
  const nl = stdout.indexOf(0x0a);
  if (nl < 0 || nl > 64 * 1024) return none;
  let line;
  try {
    line = JSON.parse(stdout.subarray(0, nl).toString('utf8'));
  } catch {
    return none;
  }
  if (line === null || typeof line !== 'object' || Array.isArray(line)) return none;
  const rest = stdout.length - nl - 1;
  const s = line.snapshot;
  if (s === undefined) return rest === 0 ? { line, snapshot: null } : none;
  delete line.snapshot;
  const valid = s !== null && typeof s === 'object' && Number.isInteger(s.frames) && s.frames >= 1 && s.boot_ms >= 0
    && Number.isInteger(s.bytes) && s.bytes >= 1 && s.bytes <= MAX_SNAPSHOT_BYTES && rest === s.bytes;
  if (!valid) return none;
  return { line, snapshot: { bytes: Uint8Array.from(stdout.subarray(nl + 1)), frames: s.frames, bootMs: s.boot_ms } };
}

/**
 * Parse a --make-snapshot child's stdout: one JSON line
 * { ok, frames, boot_ms, bytes }, then `bytes` raw snapshot bytes.
 * Returns { bytes, frames, bootMs }, or null if it isn't that.
 */
export function parseSnapshot(stdout) {
  if (!Buffer.isBuffer(stdout)) return null;
  const nl = stdout.indexOf(0x0a);
  if (nl < 0 || nl > 256) return null;
  let head;
  try {
    head = JSON.parse(stdout.subarray(0, nl).toString('utf8'));
  } catch {
    return null;
  }
  if (head === null || typeof head !== 'object' || head.ok !== true) return null;
  const { frames, boot_ms: bootMs, bytes } = head;
  if (!Number.isInteger(frames) || frames < 1 || !(bootMs >= 0) || !Number.isInteger(bytes) || bytes < 1) return null;
  if (stdout.length !== nl + 1 + bytes) return null;
  return { bytes: Uint8Array.from(stdout.subarray(nl + 1)), frames, bootMs };
}

/** Boot a boot point in a child and return its snapshot (parseSnapshot), or null. */
function snapshotFor(name, { disc, fixtures, timeout }) {
  const args = [SELF, '--make-snapshot', name, '--disc', disc];
  if (fixtures) args.push('--fixtures', fixtures);
  const r = spawnSync(process.execPath, args, {
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout,
    killSignal: 'SIGKILL',
    maxBuffer: MAX_SNAPSHOT_BYTES + 4096,
  });
  if (r.error || r.signal !== null || r.status !== 0) return null;
  return parseSnapshot(r.stdout);
}

/** Run every tier 2 scenario; returns the entries written to results.json. */
export function runAll({ disc, out, scenarios = DEFAULT_SCENARIOS, fixtures, baselines, deadlineS = DEFAULT_DEADLINE_S }) {
  const list = findTier2Scenarios(scenarios);
  const entries = [];
  const deadline = Date.now() + deadlineS * 1000;
  const snapshots = new Map(); // boot point -> snapshot, or null when it could not be made
  const kept = new Map(); // named snapshot (#74) -> { bytes, frames, bootMs, chain: [file] }
  for (const sc of list) {
    let left = deadline - Date.now();
    let child = null;
    if (sc.after && !kept.has(sc.after)) {
      // Not started: no earlier scenario in this run kept that snapshot.
      entries.push(resultEntry(sc, null));
      writeResults(out, entries);
      process.stderr.write(`${sc.name}: error (no snapshot)\n`);
      continue;
    }
    if (left > 0 && sc.from && !snapshots.has(sc.from)) {
      const snap = snapshotFor(sc.from, { disc, fixtures, timeout: left });
      snapshots.set(sc.from, snap);
      process.stderr.write(`snapshot ${sc.from}: ${snap ? `${snap.frames} frames` : 'none'}\n`);
      left = deadline - Date.now();
    }
    if (left > 0) {
      const args = [SELF, '--one', sc.file, '--disc', disc];
      if (fixtures) args.push('--fixtures', fixtures);
      if (baselines) args.push('--baselines', baselines);
      const named = sc.after ? kept.get(sc.after) : null;
      const snap = named ?? (sc.from ? snapshots.get(sc.from) : null);
      if (named) {
        args.push('--snapshot-of', sc.after, '--snapshot-frames', String(named.frames), '--boot-ms', String(named.bootMs));
        for (const f of named.chain) args.push('--chain', f);
      } else if (snap) {
        // A boot point's frames come from the boot point itself.
        args.push('--snapshot-of', sc.from, '--boot-ms', String(snap.bootMs));
      }
      if (sc.snapshot) args.push('--save-snapshot');
      const r = spawnSync(process.execPath, args, {
        stdio: [snap ? 'pipe' : 'ignore', 'pipe', 'ignore'],
        ...(snap ? { input: snap.bytes } : {}),
        timeout: left,
        killSignal: 'SIGKILL',
        maxBuffer: (sc.snapshot ? MAX_SNAPSHOT_BYTES : 0) + 1024 * 1024,
      });
      // Only a clean exit counts; a signal, a timeout or an exit code other
      // than 0 leaves child null, so the scenario reports "error".
      if (!r.error && r.signal === null && r.status === 0) {
        const parsed = parseChild(r.stdout);
        child = parsed.line;
        if (sc.snapshot && parsed.snapshot && child?.status === 'pass') {
          kept.set(sc.snapshot, { ...parsed.snapshot, chain: [...(named?.chain ?? []), sc.file] });
          process.stderr.write(`kept ${sc.snapshot}: ${parsed.snapshot.frames} frames\n`);
        }
      }
    }
    const entry = resultEntry(sc, child);
    entries.push(entry);
    writeResults(out, entries);
    process.stderr.write(`${sc.name}: ${entry.status}\n`);
  }
  return entries;
}

/** Read all of stdin (the snapshot a --one child is given). */
async function readStdin() {
  const chunks = [];
  let n = 0;
  for await (const c of process.stdin) {
    n += c.length;
    if (n > MAX_SNAPSHOT_BYTES) throw new Error('snapshot too large');
    chunks.push(c);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/** Load a scenario file as a run does: segments come from segments/ beside it. */
const loadFile = (file) => loadScenario(JSON.parse(readFileSync(file, 'utf8')), { allowTier2: true, segmentsDir: segmentsDirFor(file), savesDir: savesDirFor(file) });

/**
 * The child: run one scenario and print { status, metrics } as one line.
 * With --save-snapshot and a kept snapshot, the line also holds
 * snapshot: { frames, boot_ms, bytes }, and the bytes follow it.
 */
async function runOne(file, { disc, fixtures, baselines, ...rest }) {
  let line;
  let keptSnap = null;
  try {
    const sc = loadFile(file);
    let snapshot;
    if (rest['snapshot-of'] !== undefined) {
      const bytes = await readStdin();
      const bootMs = Number(rest['boot-ms']);
      if (sc.format === 2 && sc.fromSnapshot !== null && sc.fromSnapshot === rest['snapshot-of']) {
        // A named snapshot, with the chain of scenarios that kept it.
        const chain = (rest.chain ?? []).map(loadFile);
        snapshot = { bytes, frames: Number(rest['snapshot-frames']), bootMs, chain };
      } else if (sc.format === 2 && sc.bootPoint?.name === rest['snapshot-of']) {
        // Only for the boot point it was made from.
        snapshot = { bytes, frames: sc.bootPoint.frames, bootMs };
      }
    }
    const onSnapshot = rest['save-snapshot'] ? (s) => { keptSnap = s; } : undefined;
    const result = await runScenario(sc, { disc, fixturesDir: fixtures ?? DEFAULT_FIXTURES, baselinesDir: baselines ?? DEFAULT_BASELINES, snapshot, onSnapshot });
    line = { status: result.status, ...(result.metrics ? { metrics: result.metrics } : {}) };
  } catch {
    // An invalid scenario, "no snapshot" or a runtime failure: report error, never the message.
    line = { status: 'error' };
    keptSnap = null;
  }
  let body = Buffer.from(`${JSON.stringify(line)}\n`);
  if (keptSnap) {
    const head = { ...line, snapshot: { frames: keptSnap.frames, boot_ms: keptSnap.bootMs, bytes: keptSnap.bytes.length } };
    body = Buffer.concat([Buffer.from(`${JSON.stringify(head)}\n`), Buffer.from(keptSnap.bytes)]);
  }
  // Pipe writes are synchronous on Linux; exit so nothing the core left
  // behind keeps the process alive.
  process.stdout.write(body, () => process.exit(0));
}

/** The snapshot child: boot a boot point, print a JSON line and the snapshot bytes. */
async function makeOne(name, { disc, fixtures }) {
  let snap = { ok: false };
  try {
    snap = await makeSnapshot(name, { disc, fixturesDir: fixtures ?? DEFAULT_FIXTURES });
  } catch {
    // "no disc", or a crash: no snapshot; each scenario reports for itself.
  }
  const head = snap.ok ? { ok: true, frames: snap.frames, boot_ms: snap.bootMs, bytes: snap.bytes.length } : { ok: false };
  const body = snap.ok ? Buffer.concat([Buffer.from(`${JSON.stringify(head)}\n`), Buffer.from(snap.bytes)]) : Buffer.from(`${JSON.stringify(head)}\n`);
  process.stdout.write(body, () => process.exit(0));
}

async function main(argv) {
  const usage = 'usage: node runner/tier2.js --disc PATH --out DIR [--scenarios DIR] [--fixtures DIR] [--baselines DIR] [--deadline-s N]';
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        disc: { type: 'string' },
        out: { type: 'string' },
        one: { type: 'string' },
        'make-snapshot': { type: 'string' },
        'snapshot-of': { type: 'string' },
        'snapshot-frames': { type: 'string' },
        'boot-ms': { type: 'string' },
        chain: { type: 'string', multiple: true },
        'save-snapshot': { type: 'boolean' },
        scenarios: { type: 'string' },
        fixtures: { type: 'string' },
        baselines: { type: 'string' },
        'deadline-s': { type: 'string' },
      },
    }));
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n${usage}\n`);
    return 2;
  }
  if (values.one) {
    await runOne(values.one, values);
    return 0;
  }
  if (values['make-snapshot']) {
    await makeOne(values['make-snapshot'], values);
    return 0;
  }
  const deadlineS = values['deadline-s'] === undefined ? DEFAULT_DEADLINE_S : Number(values['deadline-s']);
  if (!values.disc || !values.out || !(deadlineS > 0)) {
    process.stderr.write(`${usage}\n`);
    return 2;
  }
  try {
    const entries = runAll({ ...values, deadlineS });
    if (!entries.length) process.stderr.write('no tier 2 scenarios\n');
    return 0;
  } catch (e) {
    process.stderr.write(`error: cannot write results (${e.code ?? 'unknown'})\n`);
    return 1;
  }
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(SELF);
if (isMain) {
  process.exitCode = await main(process.argv.slice(2));
}
