// Scenario format 2 (#37): start from a boot point (a snapshot) or
// power-on, play an ordered script of presses and waits, then check memory
// conditions and state equality. Original project code, GPL-2.0-or-later.
//
// runner/scenario.js dispatches here on "format": 2; the format is
// described in harness/README.md and harness/schema/scenario.schema.json.
//
// What leaves a run: pass/fail per check, frame counts, and the listed
// metrics (numbers). States are compared by SHA-256 of main RAM and the
// picture inside the run; no RAM, picture or hash is reported. Snapshots are
// bytes in memory (backend.saveState); nothing here writes one to a file.

import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { createBackend } from './backend.js';
import { BOOT_POINTS, POWER_ON, scriptFrames } from './bootpoints.js';
import { DiscError, openDisc } from './disc.js';
import { RAM_SIZE } from './memmap.js';
import { padMask } from './pad.js';
// scenario.js imports this module too; these are used only at call time.
import {
  BOOT_STAGES, ScenarioError, decode, expectedFor, fmtValue, readBuildInfo, resolveDisc, resolveFixture,
} from './scenario.js';

/**
 * Metric keys a format 2 scenario may list besides its numeric memory names
 * and the metrics its waits and checks name:
 *   frames             frames the script ran, counted from the start point
 *   failed_assertions  checks and waits that failed
 *   run_ms, fps        wall time and unthrottled speed of the script's frame loop
 *   boot_stage         how far the run got (scenario.js BOOT_STAGES); 6 = the script ran
 *   disc_error         why the disc could not be opened (disc.js DISC_ERRORS), 0 if it opened
 *   snapshot_frames    T: the boot point's frame, where the script starts; 0 from power-on
 *                      or when the boot point was not reached
 *   saved_ms           wall time a restore saves over booting to the boot point:
 *                      boot_ms - restore_ms, whole milliseconds; 0 from power-on
 * run_ms, fps and saved_ms vary between runs; the others are deterministic.
 */
export const BUILTIN_METRICS_2 = [
  'frames', 'failed_assertions', 'run_ms', 'fps', 'boot_stage', 'disc_error', 'snapshot_frames', 'saved_ms',
];

const NUMERIC = new Set(['u8', 'u16', 'u32']);
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Normalise a condition; throws ScenarioError. */
function loadCondition(c, memory, where) {
  const loc = memory[c.mem];
  if (!loc) throw new ScenarioError(`${where}: no memory location named "${c.mem}"`);
  if (!NUMERIC.has(loc.type)) throw new ScenarioError(`${where}: a condition needs a u8, u16 or u32 location, "${c.mem}" is ${loc.type}`);
  if ('equals' in c) return { mem: c.mem, op: 'equals', value: expectedFor(loc, c.equals, where) };
  if ('differs' in c) return { mem: c.mem, op: 'differs', value: expectedFor(loc, c.differs, where) };
  const [lo, hi] = c.in.map((v) => expectedFor(loc, v, where));
  if (lo > hi) throw new ScenarioError(`${where}: range [${c.in[0]}, ${c.in[1]}] is empty`);
  return { mem: c.mem, op: 'in', lo, hi };
}

/** Whether value satisfies a loaded condition. */
export function conditionHolds(cond, value) {
  if (cond.op === 'equals') return value === cond.value;
  if (cond.op === 'differs') return value !== cond.value;
  return value >= cond.lo && value <= cond.hi;
}

/** Normalise script steps: [{ kind: 'press'|'wait'|'until', ... }]. */
function loadScript(steps, memory, where, { allowUntil = true } = {}) {
  return steps.map((s, i) => {
    const w = `${where}[${i}]`;
    if (s.buttons) return { kind: 'press', mask: padMask(s.buttons), port: s.port ?? 0, frames: s.frames ?? 1 };
    if ('frames' in s.wait) return { kind: 'wait', frames: s.wait.frames };
    if (!allowUntil) throw new ScenarioError(`${w}: a boot point waits a fixed number of frames only`);
    return { kind: 'until', cond: loadCondition(s.wait.until, memory, `${w}.wait.until`), timeout: s.wait.timeout, metric: s.metric, index: i };
  });
}

/** The boot point a scenario names, normalised; null for power-on. Throws ScenarioError. */
export function loadBootPoint(name, source, points = BOOT_POINTS) {
  if (name === POWER_ON) return null;
  const bp = Object.hasOwn(points, name) ? points[name] : null;
  if (!bp) throw new ScenarioError(`boot.from: no boot point named "${name}" (runner/bootpoints.js)`);
  const same = bp.source.disc !== undefined ? source.disc === bp.source.disc : source.fixture === bp.source.fixture;
  if (!same) throw new ScenarioError(`boot.from: boot point "${name}" boots ${JSON.stringify(bp.source)}, not ${JSON.stringify(source)}`);
  const verify = bp.verify ?? null;
  return {
    name,
    steps: loadScript(bp.script, {}, `bootpoints.${name}.script`, { allowUntil: false }),
    frames: scriptFrames(bp.script),
    verify: verify && { addr: verify.addr, len: verify.len, equals: verify.equals ?? null, equalsDiscFile: verify.equalsDiscFile ?? null },
  };
}

/**
 * Validate the parts of a format 2 scenario the schema can't express.
 * `doc` already matched the schema. Returns the normalised scenario.
 */
export function loadScenario2(doc, memory, { bootPoints } = {}) {
  const fail = (msg) => {
    throw new ScenarioError(msg);
  };
  const source = doc.boot.disc !== undefined ? { disc: doc.boot.disc } : { fixture: doc.boot.fixture };
  const bootPoint = loadBootPoint(doc.boot.from, source, bootPoints);
  const declared = new Map(); // metric -> where
  const name = (metric, where) => {
    if (metric === undefined) return;
    if (declared.has(metric)) fail(`${where}: metric "${metric}" is already named by ${declared.get(metric)}`);
    declared.set(metric, where);
  };
  const steps = loadScript(doc.input, memory, 'input');
  steps.forEach((s) => s.kind === 'until' && name(s.metric, `input[${s.index}]`));
  const asserts = doc.assert.map((a, i) => {
    const where = `assert[${i}]`;
    name(a.metric, where);
    if ('expect' in a) return { kind: 'expect', cond: loadCondition(a.expect, memory, `${where}.expect`), metric: a.metric };
    return { kind: 'sameState', how: a.sameState, metric: a.metric };
  });

  const metrics = [...(doc.metrics ?? [])];
  metrics.forEach((k, i) => {
    const where = `metrics[${i}]`;
    const builtin = BUILTIN_METRICS_2.includes(k);
    const loc = memory[k];
    const named = declared.has(k);
    if (builtin && loc) fail(`${where}: "${k}" is both a built-in metric and a memory name`);
    if (named && (builtin || loc)) fail(`${where}: "${k}" is named by ${declared.get(k)} and is also a ${builtin ? 'built-in metric' : 'memory name'}`);
    if (!builtin && !loc && !named) {
      fail(`${where}: "${k}" is neither a built-in metric (${BUILTIN_METRICS_2.join(', ')}), a memory name, nor a wait's or check's metric`);
    }
    if (loc && !NUMERIC.has(loc.type)) fail(`${where}: memory "${k}" has type bytes; a metric must be a number (u8, u16 or u32)`);
  });
  for (const [k, where] of declared) {
    if (!metrics.includes(k)) fail(`${where}: metric "${k}" is not listed in metrics`);
  }

  return {
    format: 2,
    name: doc.name,
    fixture: source.fixture ?? null,
    disc: source.disc !== undefined ? `disc-${source.disc}` : null,
    bootPoint,
    memory,
    steps,
    asserts,
    metrics,
  };
}

/** Stops a run at its current stage. */
class StopRun extends Error {
  constructor(cause) {
    super('run stopped', { cause });
  }
}

/**
 * Play script steps on a backend. Returns { frames, waits: Map(step -> frames waited, 0 = timed out), timedOut }.
 * A timed-out wait stops the script.
 */
export function playScript(backend, steps, memory) {
  let frames = 0;
  const waits = new Map();
  const frame = (mask = 0, port = 0) => {
    backend.setPad(port === 0 ? mask : 0, 0);
    backend.setPad(port === 1 ? mask : 0, 1);
    backend.stepFrame();
    frames += 1;
  };
  for (const s of steps) {
    if (s.kind === 'press') {
      for (let i = 0; i < s.frames; i++) frame(s.mask, s.port);
    } else if (s.kind === 'wait') {
      for (let i = 0; i < s.frames; i++) frame();
    } else {
      const loc = memory[s.cond.mem];
      let waited = 0;
      for (let i = 1; i <= s.timeout; i++) {
        frame();
        if (conditionHolds(s.cond, decode(loc, backend.readMem(loc.addr, loc.len)))) {
          waited = i;
          break;
        }
      }
      waits.set(s, waited);
      if (!waited) return { frames, waits, timedOut: true };
    }
  }
  return { frames, waits, timedOut: false };
}

/** SHA-256 over main RAM and the last picture: compared inside the run, never reported. */
export function stateDigest(backend) {
  return sha256(Buffer.concat([Buffer.from(backend.readMem(0x80000000, RAM_SIZE)), Buffer.from(backend.frameHash(), 'hex')]));
}

/**
 * Resolve what a scenario or boot point boots: { program, discFile, cleanup }.
 * Throws ScenarioError ("no disc") when a disc boot has no disc.
 */
async function resolveSource({ fixture, disc }, opts) {
  if (fixture) {
    const fx = await resolveFixture(fixture, opts.fixturesDir);
    const dir = mkdtempSync(path.join(tmpdir(), 'ff7-scenario-'));
    const program = path.join(dir, `${fx.name}.exe`);
    writeFileSync(program, fx.bytes);
    return { program, discFile: null, fixture: fx, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }
  const { file } = resolveDisc(disc, opts.disc);
  return { program: file, discFile: file, fixture: null, cleanup: () => {} };
}

/**
 * The bytes a boot point's verify expects, read before boot. Throws
 * DiscError if the disc can't be read (stage tells how far it got).
 */
function verifyBytes(bp, discFile, setStage) {
  const v = bp?.verify;
  if (!v) return null;
  if (v.equals !== null) return Buffer.from(v.equals, 'hex');
  if (!discFile) throw new ScenarioError(`boot point "${bp.name}" verifies against a disc file but boots no disc`);
  let disc;
  try {
    disc = openDisc(discFile);
  } catch (e) {
    if (e instanceof DiscError && e.step === 'volume') setStage(BOOT_STAGES.image);
    throw e;
  }
  setStage(BOOT_STAGES.volume);
  try {
    const p = v.equalsDiscFile.path;
    let data;
    try {
      data = disc.read(p.endsWith(':BOOT') ? disc.bootPath() : p);
    } catch (e) {
      if (!(e instanceof DiscError)) throw e;
      return false; // missing file: the boot point can't be verified, so it isn't reached
    }
    const { offset } = v.equalsDiscFile;
    return offset + v.len <= data.length ? Buffer.from(data.subarray(offset, offset + v.len)) : false;
  } finally {
    disc.close();
  }
}

/**
 * Power on, play a boot point's script and check its verify. Returns
 * { backend, reached, bootMs }. The caller closes the backend.
 */
async function bootThrough(bp, program, want, { verbose } = {}) {
  const t0 = performance.now();
  const backend = await createBackend({ verbose });
  try {
    backend.loadProgram(program);
    playScript(backend, bp.steps, {});
    const reached = want === null || (want !== false && Buffer.from(backend.readMem(bp.verify.addr, bp.verify.len)).equals(want));
    return { backend, reached, bootMs: performance.now() - t0 };
  } catch (e) {
    try {
      backend.close();
    } catch {
      // a crashed core may not close cleanly
    }
    throw e;
  }
}

const closeQuietly = (b) => {
  try {
    b?.close();
  } catch {
    // a crashed core may not close cleanly
  }
};

/**
 * Boot a boot point and snapshot it, for runner/tier2.js to share between
 * scenarios. Returns { ok, bytes, frames, bootMs } (ok false: not reached,
 * or the disc could not be read). Throws ScenarioError ("no disc").
 */
export async function makeSnapshot(name, opts = {}) {
  const points = opts.bootPoints ?? BOOT_POINTS;
  if (!Object.hasOwn(points, name)) throw new ScenarioError(`no boot point named "${name}"`);
  const { source } = points[name];
  const bp = loadBootPoint(name, source, points);
  const src = await resolveSource({ fixture: source.fixture ?? null, disc: source.disc !== undefined ? `disc-${source.disc}` : null }, opts);
  let backend = null;
  try {
    let want;
    try {
      want = verifyBytes(bp, src.discFile, () => {});
    } catch (e) {
      if (e instanceof DiscError) return { ok: false };
      throw e;
    }
    const r = await bootThrough(bp, src.program, want, opts);
    backend = r.backend;
    if (!r.reached) return { ok: false };
    return { ok: true, bytes: backend.saveState(), frames: bp.frames, bootMs: r.bootMs };
  } finally {
    closeQuietly(backend);
    src.cleanup();
  }
}

/**
 * Run a loaded format 2 scenario. Options:
 *   disc, fixturesDir, verbose  as for format 1
 *   snapshot   { bytes, frames, bootMs } from makeSnapshot for this boot
 *              point: restore it instead of booting (runner/tier2.js)
 *   fresh      boot through the boot point and play the script on, with no
 *              snapshot at all (for tests)
 * Returns the result object (status pass or fail). Throws ScenarioError
 * ("no disc") before anything runs.
 */
export async function runScenario2(sc, opts = {}) {
  const src = await resolveSource({ fixture: sc.fixture, disc: sc.disc }, opts);
  const bp = sc.bootPoint;
  let stage = BOOT_STAGES.found;
  let discError = 0;
  let stopped = false;
  let reached = bp === null;
  let snapshotFrames = 0;
  let savedMs = 0;
  let run = null; // playScript result of the main run
  let runMs = 0;
  let digest = null;
  const finalMem = new Map();
  const sameStates = new Map(); // check -> boolean
  const actual = new Map(); // expect check -> value at the end of the script
  const live = new Set();
  const track = (b) => {
    live.add(b);
    return b;
  };
  const release = (b) => {
    live.delete(b);
    closeQuietly(b);
  };
  const needDigest = sc.asserts.some((a) => a.kind === 'sameState');

  /** Play the script from a started backend; returns { run, ms, digest }. */
  const play = (backend) => {
    const t0 = performance.now();
    const r = playScript(backend, sc.steps, sc.memory);
    return { run: r, ms: performance.now() - t0, digest: needDigest ? stateDigest(backend) : null };
  };
  /** A backend at the start point (power-on or boot point), plus the snapshot used. */
  const restoreInto = async (bytes) => {
    const t0 = performance.now();
    const b = track(await createBackend({ verbose: opts.verbose }));
    b.loadProgram(src.program);
    if (bytes) b.loadState(bytes);
    return { backend: b, ms: performance.now() - t0 };
  };

  try {
    let want = null;
    try {
      want = verifyBytes(bp, src.discFile, (n) => {
        stage = n;
      });
      stage = BOOT_STAGES.checks;
    } catch (e) {
      if (!(e instanceof DiscError)) throw e;
      discError = e.reason;
      throw new StopRun();
    }

    let snapshot = null;
    let main;
    try {
      if (bp === null) {
        main = await restoreInto(null);
      } else if (opts.fresh) {
        const r = await bootThrough(bp, src.program, want, opts);
        main = { backend: track(r.backend) };
        reached = r.reached;
      } else if (opts.snapshot) {
        snapshot = opts.snapshot;
        main = await restoreInto(snapshot.bytes);
        reached = true;
        savedMs = snapshot.bootMs - main.ms;
      } else {
        const r = await bootThrough(bp, src.program, want, opts);
        track(r.backend);
        reached = r.reached;
        if (reached) {
          snapshot = { bytes: r.backend.saveState(), frames: bp.frames, bootMs: r.bootMs };
          release(r.backend);
          main = await restoreInto(snapshot.bytes);
          savedMs = snapshot.bootMs - main.ms;
        } else {
          main = { backend: r.backend };
        }
      }
    } catch (e) {
      // The core refused the program or crashed booting it.
      if (e instanceof ScenarioError) throw e;
      throw new StopRun();
    }
    stage = BOOT_STAGES.loaded;
    if (!reached) throw new StopRun();
    snapshotFrames = bp ? bp.frames : 0;

    try {
      const p = play(main.backend);
      ({ run, digest } = p);
      runMs = p.ms;
      for (const k of sc.metrics) {
        const loc = sc.memory[k];
        if (loc) finalMem.set(k, decode(loc, main.backend.readMem(loc.addr, loc.len)));
      }
      for (const a of sc.asserts) {
        if (a.kind !== 'expect') continue;
        const loc = sc.memory[a.cond.mem];
        actual.set(a, decode(loc, main.backend.readMem(loc.addr, loc.len)));
      }
      release(main.backend);

      // Play the script again from another start, in a new core instance.
      for (const a of sc.asserts) {
        if (a.kind !== 'sameState') continue;
        // rerun: the same kind of start as the main run; boot: no snapshot.
        let again;
        if (bp === null) {
          again = (await restoreInto(null)).backend;
        } else if (a.how === 'rerun' && snapshot) {
          again = (await restoreInto(snapshot.bytes)).backend;
        } else {
          again = track((await bootThrough(bp, src.program, want, opts)).backend);
        }
        sameStates.set(a, play(again).digest === digest);
        release(again);
      }
    } catch (e) {
      // A core crash part-way: stop with what ran.
      throw new StopRun(e);
    }
    stage = BOOT_STAGES.done;
  } catch (e) {
    if (!(e instanceof StopRun)) throw e;
    stopped = true;
  } finally {
    for (const b of live) closeQuietly(b);
    src.cleanup();
  }

  const timedOut = run?.timedOut ?? false;
  // A stopped run or a timed-out wait fails every check: the state at the
  // end of the script is not the one the scenario describes.
  const ok = (v) => !stopped && !timedOut && v;
  const assertions = sc.asserts.map((a) => {
    if (a.kind === 'expect') {
      const c = a.cond;
      const loc = sc.memory[c.mem];
      const cond = c.op === 'in' ? { mem: c.mem, in: [fmtValue(loc, c.lo), fmtValue(loc, c.hi)] } : { mem: c.mem, [c.op]: fmtValue(loc, c.value) };
      return { expect: cond, pass: ok(actual.has(a) && conditionHolds(c, actual.get(a))) };
    }
    return { sameState: a.how, pass: ok(sameStates.get(a) === true) };
  });
  const waits = sc.steps
    .filter((s) => s.kind === 'until')
    .map((s) => ({ step: s.index, frames: run?.waits.get(s) ?? 0, pass: (run?.waits.get(s) ?? 0) > 0 }));
  const failed = assertions.filter((a) => !a.pass).length + waits.filter((w) => !w.pass).length;
  const pass = failed === 0 && !stopped;

  const named = new Map();
  sc.steps.forEach((s) => s.kind === 'until' && s.metric !== undefined && named.set(s.metric, run?.waits.get(s) ?? 0));
  sc.asserts.forEach((a, i) => a.metric !== undefined && named.set(a.metric, assertions[i].pass ? 1 : 0));
  const framesRun = run?.frames ?? 0;
  const builtin = {
    frames: framesRun,
    failed_assertions: failed,
    run_ms: Math.round(runMs),
    fps: runMs > 0 ? Math.min(Math.round((framesRun * 1e6) / runMs) / 1000, 999999) : 999999,
    boot_stage: stage,
    disc_error: discError,
    snapshot_frames: snapshotFrames,
    saved_ms: Math.round(savedMs),
  };

  const build = readBuildInfo();
  const core = build && { pcsx_rearmed_commit: build.pcsx_rearmed_commit, emsdk_version: build.emsdk_version, wasm_sha256: build.wasm_sha256 };
  const result = {
    runner: 'ff7-web/scenario',
    format: 2,
    scenario: sc.name,
    status: pass ? 'pass' : 'fail',
    core,
    ...(src.fixture ? { fixture: { name: src.fixture.name, sha256: src.fixture.sha256, licence: src.fixture.licence } } : { disc: { name: sc.disc } }),
    from: bp ? { boot_point: bp.name, frames: bp.frames, reached } : { boot_point: 'power-on' },
    frames: framesRun,
    boot_stage: stage,
    ...(stopped ? { stopped: true } : {}),
    ...(waits.length ? { waits } : {}),
    assertions,
  };
  if (sc.metrics.length) {
    result.metrics = Object.fromEntries(sc.metrics.map((k) => [k, sc.memory[k] ? finalMem.get(k) ?? 0 : named.has(k) ? named.get(k) : builtin[k]]));
  }
  return result;
}
