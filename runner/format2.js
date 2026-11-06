// Scenario format 2 (#37, #74): start from a boot point (a snapshot), a
// named snapshot an earlier scenario kept, or power-on; play an ordered
// script of presses and waits; then check memory conditions and state
// equality. Original project code, GPL-2.0-or-later.
//
// runner/scenario.js dispatches here on "format": 2; the format is
// described in harness/README.md and harness/schema/scenario.schema.json.
//
// What leaves a run: pass/fail per check, frame counts, and the listed
// metrics (numbers). States are compared by SHA-256 of main RAM and the
// picture inside the run; no RAM, picture or hash is reported. Snapshots are
// bytes in memory (backend.saveState); nothing here writes one to a file.
//
// Chains (#74): a scenario with "snapshot": NAME hands the state at the end
// of its script to the caller (opts.onSnapshot), which keeps it in memory for
// later scenarios in the same run with "boot": { "from": NAME }. Such a
// scenario gets the snapshot and its chain: the scenarios that led to it,
// root first, so that "boot" checks can replay the whole chain from
// power-on with no snapshot at all.

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
import { PARTS, partDigests } from './stateparts.js';
import { blankCard } from './synth/blank-card.js';
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
 *   snapshot_frames    frames from power-on to the start point: T of the boot point, or
 *                      for a named snapshot T plus the frames of the chain's scripts;
 *                      0 from power-on or when the boot point was not reached
 *   saved_ms           wall time a restore saves over getting to the start point
 *                      without it: boot_ms - restore_ms, whole milliseconds, at least 0;
 *                      0 from power-on
 *   same_PART          diagnostics (#88), for a scenario with a sameState "boot" check:
 *                      1 if PART of the emulator state (runner/stateparts.js PARTS:
 *                      ram, bios, io, cpu, gpu, spu, cdrom, timers, other) is the same at
 *                      the end of the main run and of the "boot" replay, else 0.
 *                      Compared by hash inside the run, like "boot" itself
 * run_ms, fps and saved_ms vary between runs; the others are deterministic.
 */
export const PART_METRICS = PARTS.map((p) => `same_${p}`);
export const BUILTIN_METRICS_2 = [
  'frames', 'failed_assertions', 'run_ms', 'fps', 'boot_stage', 'disc_error', 'snapshot_frames', 'saved_ms',
  ...PART_METRICS,
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

/** Normalise a wait's press; null if none. Throws ScenarioError. */
function loadPress(p, where) {
  if (!p) return null;
  const hold = p.hold ?? 1;
  if (hold >= p.every) throw new ScenarioError(`${where}: hold (${hold}) must be less than every (${p.every})`);
  return { mask: padMask(p.buttons), port: p.port ?? 0, every: p.every, hold };
}

/** Normalise script steps: [{ kind: 'press'|'wait'|'until'|'still', ... }]. Segments are already expanded. */
function loadScript(steps, memory, where, { allowUntil = true } = {}) {
  return steps.map((s, i) => {
    const w = `${where}[${i}]`;
    if (s.buttons) return { kind: 'press', mask: padMask(s.buttons), port: s.port ?? 0, frames: s.frames ?? 1 };
    if (s.segment !== undefined) throw new ScenarioError(`${w}: segment "${s.segment}" was not expanded`);
    if ('frames' in s.wait) return { kind: 'wait', frames: s.wait.frames };
    if (!allowUntil) throw new ScenarioError(`${w}: a boot point waits a fixed number of frames only`);
    const press = loadPress(s.wait.press, `${w}.wait.press`);
    if ('stillFrames' in s.wait) {
      return { kind: 'still', stillFrames: s.wait.stillFrames, timeout: s.wait.timeout, press, metric: s.metric, index: i };
    }
    return { kind: 'until', cond: loadCondition(s.wait.until, memory, `${w}.wait.until`), timeout: s.wait.timeout, press, metric: s.metric, index: i };
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
  if (bp.card !== undefined && bp.card !== 'blank') throw new ScenarioError(`boot point "${name}": card must be "blank"`);
  return {
    name,
    steps: loadScript(bp.script, {}, `bootpoints.${name}.script`, { allowUntil: false }),
    frames: scriptFrames(bp.script),
    verify: verify && { addr: verify.addr, len: verify.len, equals: verify.equals ?? null, equalsDiscFile: verify.equalsDiscFile ?? null },
    card: bp.card ?? null,
  };
}

/**
 * A new core instance for a start point: with a blank, formatted memory card
 * in slot 1 when the (root) boot point has card "blank". Save states do not
 * hold the card (notes/31-card-and-snapshots.md), so every instance that
 * restores such a snapshot gets the same blank card first.
 */
async function newBackend(bp, { verbose } = {}) {
  const card = bp?.card === 'blank';
  const b = await createBackend({ verbose, memoryCard: card });
  if (card) b.setCard(blankCard());
  return b;
}

/** Throw unless `name` can name a snapshot: not a boot point and not power-on. */
function checkSnapshotName(name, where, points) {
  if (name === POWER_ON) throw new ScenarioError(`${where}: "${POWER_ON}" can't name a snapshot`);
  if (Object.hasOwn(points, name)) {
    const src = points[name].source;
    throw new ScenarioError(`${where}: "${name}" is a boot point, not a snapshot; start from it with { ${src.disc !== undefined ? `disc: ${src.disc}` : `fixture: "${src.fixture}"`}, from: "${name}" }`);
  }
}

/**
 * Validate the parts of a format 2 scenario the schema can't express.
 * `doc` already matched the schema; `input` is its script with segments
 * expanded (default doc.input). Returns the normalised scenario.
 */
export function loadScenario2(doc, memory, { bootPoints, input } = {}) {
  const points = bootPoints ?? BOOT_POINTS;
  const fail = (msg) => {
    throw new ScenarioError(msg);
  };
  const named = doc.boot.disc === undefined && doc.boot.fixture === undefined;
  let source = null;
  let bootPoint = null;
  let fromSnapshot = null;
  if (named) {
    checkSnapshotName(doc.boot.from, 'boot.from', points);
    fromSnapshot = doc.boot.from;
  } else {
    source = doc.boot.disc !== undefined ? { disc: doc.boot.disc } : { fixture: doc.boot.fixture };
    bootPoint = loadBootPoint(doc.boot.from, source, points);
  }
  const snapshotName = doc.snapshot ?? null;
  if (snapshotName !== null) {
    checkSnapshotName(snapshotName, 'snapshot', points);
    if (snapshotName === fromSnapshot) fail(`snapshot: "${snapshotName}" is the snapshot this scenario starts from`);
  }

  const declared = new Map(); // metric -> where
  const name = (metric, where) => {
    if (metric === undefined) return;
    if (declared.has(metric)) fail(`${where}: metric "${metric}" is already named by ${declared.get(metric)}`);
    declared.set(metric, where);
  };
  const steps = loadScript(input ?? doc.input, memory, 'input');
  steps.forEach((s) => (s.kind === 'until' || s.kind === 'still') && name(s.metric, `input[${s.index}]`));
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
    const isNamed = declared.has(k);
    if (builtin && loc) fail(`${where}: "${k}" is both a built-in metric and a memory name`);
    if (isNamed && (builtin || loc)) fail(`${where}: "${k}" is named by ${declared.get(k)} and is also a ${builtin ? 'built-in metric' : 'memory name'}`);
    if (!builtin && !loc && !isNamed) {
      fail(`${where}: "${k}" is neither a built-in metric (${BUILTIN_METRICS_2.join(', ')}), a memory name, nor a wait's or check's metric`);
    }
    if (loc && !NUMERIC.has(loc.type)) fail(`${where}: memory "${k}" has type bytes; a metric must be a number (u8, u16 or u32)`);
  });
  for (const [k, where] of declared) {
    if (!metrics.includes(k)) fail(`${where}: metric "${k}" is not listed in metrics`);
  }
  const parts = metrics.filter((k) => PART_METRICS.includes(k)).map((k) => k.slice('same_'.length));
  if (parts.length && !asserts.some((a) => a.kind === 'sameState' && a.how === 'boot')) {
    fail(`metrics: ${parts.map((p) => `same_${p}`).join(', ')} compare with the "boot" replay; add a { "sameState": "boot" } check`);
  }

  return {
    format: 2,
    name: doc.name,
    fixture: source?.fixture ?? null,
    disc: source && source.disc !== undefined ? `disc-${source.disc}` : null,
    bootPoint,
    fromSnapshot,
    snapshotName,
    memory,
    steps,
    asserts,
    metrics,
    parts,
  };
}

/** Stops a run at its current stage. */
class StopRun extends Error {
  constructor(cause) {
    super('run stopped', { cause });
  }
}

/** The press a wait holds on its i-th frame (from 1): { mask, port }. */
const pressAt = (press, i) => (press && (i - 1) % press.every < press.hold ? press : null);

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
  const framePress = (press, i) => {
    const p = pressAt(press, i);
    frame(p ? p.mask : 0, p ? p.port : 0);
  };
  for (const s of steps) {
    if (s.kind === 'press') {
      for (let i = 0; i < s.frames; i++) frame(s.mask, s.port);
    } else if (s.kind === 'wait') {
      for (let i = 0; i < s.frames; i++) frame();
    } else if (s.kind === 'until') {
      const loc = memory[s.cond.mem];
      let waited = 0;
      for (let i = 1; i <= s.timeout; i++) {
        framePress(s.press, i);
        if (conditionHolds(s.cond, decode(loc, backend.readMem(loc.addr, loc.len)))) {
          waited = i;
          break;
        }
      }
      waits.set(s, waited);
      if (!waited) return { frames, waits, timedOut: true };
    } else {
      // still: the same picture, not one colour, for stillFrames frames in a row.
      let waited = 0;
      let last = null;
      let start = 0;
      let uniform = null; // whether `last` is one colour, once asked
      for (let i = 1; i <= s.timeout; i++) {
        framePress(s.press, i);
        const h = backend.frameHash();
        if (h !== last) {
          last = h;
          start = i;
          uniform = null;
        }
        if (i - start + 1 >= s.stillFrames) {
          if (uniform === null) uniform = backend.frameIsUniform();
          if (!uniform) {
            waited = i;
            break;
          }
        }
      }
      waits.set(s, waited);
      if (!waited) return { frames, waits, timedOut: true };
    }
  }
  return { frames, waits, timedOut: false };
}

/**
 * SHA-256 over main RAM and the last picture: compared inside the run, never
 * reported. With picture false, a fixed marker stands for the picture.
 */
export function stateDigest(backend, { picture = true } = {}) {
  const pic = picture ? Buffer.from(backend.frameHash(), 'hex') : Buffer.from('no new picture');
  return sha256(Buffer.concat([Buffer.from(backend.readMem(0x80000000, RAM_SIZE)), pic]));
}

/**
 * Whether the core delivered a new picture in the frames since `dupesBefore`
 * (backend.stats().duplicateFrames). The last picture is host-side and not
 * part of a snapshot: an instance that restored one has no picture until the
 * core sends a new frame, while an instance that ran on still holds an older
 * one. So a state comparison takes the picture into account only when one
 * was delivered during the script; both sides of the comparison play the
 * same frames, so they agree on that (#74).
 */
const newPicture = (backend, dupesBefore, frames) => backend.stats().duplicateFrames - dupesBefore < frames;

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
 * Power on, play a boot point's script and check its verify (bp null:
 * power-on, nothing to play). Returns { backend, reached, bootMs }. The
 * caller closes the backend.
 */
async function bootThrough(bp, program, want, { verbose } = {}) {
  const t0 = performance.now();
  const backend = await newBackend(bp, { verbose });
  try {
    backend.loadProgram(program);
    if (bp === null) return { backend, reached: true, bootMs: performance.now() - t0 };
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
 * Check that `chain` (loaded scenarios, root first) leads to the snapshot
 * `sc` starts from: the root starts from a boot point or power-on, each
 * later one from the snapshot the one before kept, and the last keeps
 * sc.fromSnapshot. Throws ScenarioError.
 */
export function checkChain(sc, chain) {
  const bad = (why) => {
    throw new ScenarioError(`snapshot "${sc.fromSnapshot}": ${why}`);
  };
  if (!Array.isArray(chain) || !chain.length) bad('no chain of scenarios that kept it');
  if (chain[0].fromSnapshot !== null) bad(`the chain's first scenario "${chain[0].name}" starts from another snapshot`);
  chain.forEach((c, i) => {
    if (i > 0 && c.fromSnapshot !== chain[i - 1].snapshotName) bad(`"${c.name}" does not start from what "${chain[i - 1].name}" kept`);
  });
  if (chain.at(-1).snapshotName !== sc.fromSnapshot) bad(`the chain's last scenario "${chain.at(-1).name}" does not keep it`);
}

/**
 * Run a loaded format 2 scenario. Options:
 *   disc, fixturesDir, verbose  as for format 1
 *   snapshot   for a boot point: { bytes, frames, bootMs } from makeSnapshot,
 *              restored instead of booting (runner/tier2.js). For a named
 *              snapshot (boot: { from: NAME }): { bytes, frames, bootMs,
 *              chain }, where chain is the loaded scenarios that led to it,
 *              root first (checkChain); required
 *   fresh      boot through the boot point (and the chain's scripts) and
 *              play the script on, with no snapshot at all (for tests)
 *   onSnapshot called with { bytes, frames, bootMs } when the scenario keeps
 *              a snapshot ("snapshot": NAME) and passes
 * Returns the result object (status pass or fail). Throws ScenarioError
 * ("no disc", or "no snapshot" for a named snapshot it was not given)
 * before anything runs.
 */
export async function runScenario2(sc, opts = {}) {
  let chain = [];
  if (sc.fromSnapshot !== null) {
    if (!opts.snapshot) throw new ScenarioError(`no snapshot: "${sc.fromSnapshot}" was not kept by an earlier scenario in this run`);
    chain = opts.snapshot.chain;
    checkChain(sc, chain);
  }
  // Where the chain starts: its root's source and boot point.
  const root = chain.length ? chain[0] : sc;
  const src = await resolveSource({ fixture: root.fixture, disc: root.disc }, opts);
  const bp = root.bootPoint;
  const named = sc.fromSnapshot !== null;
  let stage = BOOT_STAGES.found;
  let discError = 0;
  let stopped = false;
  let reached = bp === null;
  let snapshotFrames = 0;
  let savedMs = 0;
  let run = null; // playScript result of the main run
  let runMs = 0;
  let digest = null;
  let kept = null; // { bytes, frames, bootMs } at the end of the main run, for "snapshot"
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
  const wantParts = (sc.parts ?? []).length > 0;
  let mainParts = null; // part -> hash at the end of the main run, for same_PART
  const partsSame = new Map(); // part -> boolean, against the "boot" replay

  /**
   * Play the script from a started backend; returns { run, ms, digest,
   * parts }. parts (with same_PART metrics) hashes each part of a state
   * saved at the end, after the digest.
   */
  const play = (backend) => {
    const dupes = needDigest ? backend.stats().duplicateFrames : 0;
    const t0 = performance.now();
    const r = playScript(backend, sc.steps, sc.memory);
    const ms = performance.now() - t0;
    const digest = needDigest ? stateDigest(backend, { picture: newPicture(backend, dupes, r.frames) }) : null;
    return { run: r, ms, digest, parts: wantParts ? partDigests(backend.saveState()) : null };
  };
  /** A backend at the start point (power-on or boot point), plus the snapshot used. */
  const restoreInto = async (bytes) => {
    const t0 = performance.now();
    const b = track(await newBackend(bp, { verbose: opts.verbose }));
    b.loadProgram(src.program);
    if (bytes) b.loadState(bytes);
    return { backend: b, ms: performance.now() - t0 };
  };
  /**
   * Get to the start point with no snapshot: boot through the boot point,
   * then play the chain's scripts. Returns { backend, reached, ms, frames }.
   */
  const fromScratch = async (want) => {
    const r = await bootThrough(bp, src.program, want, opts);
    track(r.backend);
    let reachedHere = r.reached;
    let frames = bp ? bp.frames : 0;
    const t0 = performance.now();
    for (const c of chain) {
      if (!reachedHere) break;
      const p = playScript(r.backend, c.steps, c.memory);
      frames += p.frames;
      if (p.timedOut) reachedHere = false;
    }
    return { backend: r.backend, reached: reachedHere, ms: r.bootMs + (performance.now() - t0), frames };
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

    let snapshot = null; // what "rerun" restores
    let main;
    let startMs = 0; // wall time to get to the start point without the snapshot used
    try {
      if (opts.fresh) {
        const r = await fromScratch(want);
        main = { backend: r.backend };
        reached = r.reached;
        snapshotFrames = r.frames;
        startMs = r.ms;
      } else if (named || (bp !== null && opts.snapshot)) {
        snapshot = opts.snapshot;
        main = await restoreInto(snapshot.bytes);
        reached = true;
        snapshotFrames = snapshot.frames;
        startMs = snapshot.bootMs;
        savedMs = Math.max(0, snapshot.bootMs - main.ms);
      } else if (bp === null) {
        main = await restoreInto(null);
        startMs = main.ms;
      } else {
        const r = await bootThrough(bp, src.program, want, opts);
        track(r.backend);
        reached = r.reached;
        if (reached) {
          snapshot = { bytes: r.backend.saveState(), frames: bp.frames, bootMs: r.bootMs };
          release(r.backend);
          main = await restoreInto(snapshot.bytes);
          snapshotFrames = bp.frames;
          startMs = snapshot.bootMs;
          savedMs = Math.max(0, snapshot.bootMs - main.ms);
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
    if (!reached) {
      snapshotFrames = 0;
      throw new StopRun();
    }

    try {
      const p = play(main.backend);
      ({ run, digest } = p);
      mainParts = p.parts;
      runMs = p.ms;
      if (sc.snapshotName !== null && !run.timedOut) {
        kept = { bytes: main.backend.saveState(), frames: snapshotFrames + run.frames, bootMs: startMs + p.ms };
      }
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
        let ok = true;
        if (a.how === 'rerun' && snapshot) {
          again = (await restoreInto(snapshot.bytes)).backend;
        } else if (bp === null && !named) {
          again = (await restoreInto(null)).backend;
        } else {
          const r = await fromScratch(want);
          again = r.backend;
          ok = r.reached;
        }
        const p = play(again);
        sameStates.set(a, ok && p.digest === digest);
        if (a.how === 'boot' && mainParts && !partsSame.size) {
          for (const part of sc.parts) partsSame.set(part, ok && p.parts[part] === mainParts[part]);
        }
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
  const isWait = (s) => s.kind === 'until' || s.kind === 'still';
  const waits = sc.steps
    .filter(isWait)
    .map((s) => ({ step: s.index, frames: run?.waits.get(s) ?? 0, pass: (run?.waits.get(s) ?? 0) > 0 }));
  const failed = assertions.filter((a) => !a.pass).length + waits.filter((w) => !w.pass).length;
  const pass = failed === 0 && !stopped;
  if (pass && kept && opts.onSnapshot) opts.onSnapshot(kept);

  const namedMetrics = new Map();
  sc.steps.forEach((s) => isWait(s) && s.metric !== undefined && namedMetrics.set(s.metric, run?.waits.get(s) ?? 0));
  sc.asserts.forEach((a, i) => a.metric !== undefined && namedMetrics.set(a.metric, assertions[i].pass ? 1 : 0));
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
    ...Object.fromEntries(PARTS.map((part) => [`same_${part}`, ok(partsSame.get(part) === true) ? 1 : 0])),
  };

  const build = readBuildInfo();
  const core = build && { pcsx_rearmed_commit: build.pcsx_rearmed_commit, emsdk_version: build.emsdk_version, wasm_sha256: build.wasm_sha256 };
  const from = named
    ? { snapshot: sc.fromSnapshot, chain: chain.map((c) => c.name), frames: snapshotFrames }
    : bp ? { boot_point: bp.name, frames: bp.frames, reached } : { boot_point: 'power-on' };
  const result = {
    runner: 'ff7-web/scenario',
    format: 2,
    scenario: sc.name,
    status: pass ? 'pass' : 'fail',
    core,
    ...(src.fixture ? { fixture: { name: src.fixture.name, sha256: src.fixture.sha256, licence: src.fixture.licence } } : { disc: { name: root.disc } }),
    from,
    frames: framesRun,
    boot_stage: stage,
    ...(stopped ? { stopped: true } : {}),
    ...(waits.length ? { waits } : {}),
    assertions,
    ...(sc.snapshotName !== null ? { snapshot: { name: sc.snapshotName, kept: Boolean(pass && kept) } } : {}),
  };
  if (sc.metrics.length) {
    result.metrics = Object.fromEntries(sc.metrics.map((k) => [k, sc.memory[k] ? finalMem.get(k) ?? 0 : namedMetrics.has(k) ? namedMetrics.get(k) : builtin[k]]));
  }
  return result;
}

/**
 * Run loaded scenarios in order in this process, keeping named snapshots in
 * memory between them (as runner/tier2.js does across processes). A
 * scenario from a snapshot that does not exist (yet) is not run: its entry
 * is { scenario, status: 'error', error: 'no snapshot' }. Returns the
 * results, in order. Snapshots are dropped when this returns.
 */
export async function runSequence(scenarios, opts = {}) {
  const kept = new Map(); // name -> { bytes, frames, bootMs, chain }
  const results = [];
  for (const sc of scenarios) {
    // Boot point scenarios boot their own boot point here.
    const snapshot = sc.fromSnapshot !== null ? kept.get(sc.fromSnapshot) : undefined;
    if (sc.fromSnapshot !== null && !snapshot) {
      results.push({ scenario: sc.name, status: 'error', error: 'no snapshot' });
      continue;
    }
    const chain = snapshot?.chain ?? [];
    const onSnapshot = (s) => kept.set(sc.snapshotName, { ...s, chain: [...chain, sc] });
    results.push(await runScenario2(sc, { ...opts, snapshot, onSnapshot }));
  }
  return results;
}
