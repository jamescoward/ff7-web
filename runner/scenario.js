#!/usr/bin/env node
// Scenario runner: execute a JSON test scenario (harness/schema/) on the
// Wasm core and print a deterministic JSON result.
//
//   node runner/scenario.js [options] <scenario.json>
//
// Options:
//   --record           also print the checkpoint hashes in baseline-file form
//                      (for a harness/baselines/ PR; this never writes files)
//   --baselines DIR    baseline directory (default harness/baselines)
//   --fixtures DIR     fixture directory (default harness/fixtures)
//   --disc PATH        disc image for scenarios that boot a disc ("boot":
//                      {"disc": ...}); see resolveDisc
//   --verbose          forward core info logs to stderr
//
// Exit status: 0 pass, 1 fail, 2 invalid scenario or usage error.
// stdout carries only deterministic data; logs go to stderr.

import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { createBackend } from './backend.js';
import { DiscError, openDisc } from './disc.js';
import { loadScenario2, runScenario2 } from './format2.js';
import { ramOffset } from './memmap.js';
import { padMask } from './pad.js';
import { validate } from './schema.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = path.resolve(HERE, '../harness');
export const SCHEMA_PATH = path.join(HARNESS, 'schema/scenario.schema.json');
export const DEFAULT_FIXTURES = path.join(HARNESS, 'fixtures');
export const DEFAULT_BASELINES = path.join(HARNESS, 'baselines');

const SIZES = { u8: 1, u16: 2, u32: 4 };

/**
 * Metric keys a scenario may list besides its numeric memory names. Only
 * numbers leave a Tier 2 run (#34), so a metric is a count, a timing, or a
 * u8/u16/u32 memory location read at the end of the last frame.
 *   frames             frames run (fewer than "frames" when the run stopped early)
 *   failed_assertions  assertions and checkpoints that failed
 *   run_ms             wall time of the frame loop, whole milliseconds
 *   fps                frames per second of the frame loop (unthrottled), 3 decimals
 *   boot_stage         how far the run got (BOOT_STAGES); 6 = every frame ran
 *   disc_error         why the disc could not be opened (disc.js DISC_ERRORS), 0 if it opened
 * run_ms and fps vary between runs; the other metrics are deterministic.
 */
export const BUILTIN_METRICS = ['frames', 'failed_assertions', 'run_ms', 'fps', 'boot_stage', 'disc_error'];

/**
 * Stages of a run, for boot_stage. A run that stops after stage 1 fails
 * (status "fail", every assertion failed) instead of erroring, so a Tier 2
 * result still says where it stopped: an error result carries no metrics.
 * Fixture boots go from 1 straight to 4.
 *   1  boot file found (fixture built, or disc image resolved)
 *   2  disc image opened
 *   3  ISO9660 file system found
 *   4  disc file checks done
 *   5  the core accepted the program or disc
 *   6  every frame ran
 */
export const BOOT_STAGES = { found: 1, image: 2, volume: 3, checks: 4, loaded: 5, done: 6 };

export class ScenarioError extends Error {}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');

/** Little-endian unsigned value, or the hex bytes for type "bytes". */
export function decode(loc, bytes) {
  if (loc.type === 'bytes') return Buffer.from(bytes).toString('hex');
  let v = 0;
  for (let i = bytes.length - 1; i >= 0; i--) v = v * 256 + bytes[i];
  return v;
}

/** Normalise an expected value for a location; throws ScenarioError if it can't fit. */
export function expectedFor(loc, value, where) {
  if (loc.type === 'bytes') {
    if (typeof value !== 'string' || value.startsWith('0x') || value.length !== loc.len * 2) {
      throw new ScenarioError(`${where}: a bytes value must be ${loc.len * 2} hex digits in memory order`);
    }
    return value.toLowerCase();
  }
  if (typeof value === 'string' && !value.startsWith('0x')) {
    throw new ScenarioError(`${where}: a ${loc.type} value must be an integer or a 0x hex string`);
  }
  const n = typeof value === 'string' ? Number(value) : value;
  const max = 2 ** (8 * SIZES[loc.type]) - 1;
  if (n > max) throw new ScenarioError(`${where}: ${value} does not fit in ${loc.type}`);
  return n;
}

export const fmtValue = (loc, v) => (loc.type === 'bytes' ? v : `0x${v.toString(16).padStart(SIZES[loc.type] * 2, '0')}`);

/**
 * Validate a parsed scenario against the schema and the checks the schema
 * can't express. Returns the normalised scenario; throws ScenarioError.
 * Format 2 scenarios are checked by format2.js (`bootPoints` replaces the
 * boot point registry, for tests).
 */
export function loadScenario(doc, { allowTier2 = false, bootPoints } = {}) {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  const errors = validate(schema, doc);
  if (errors.length) throw new ScenarioError(`scenario does not match the schema:\n  ${errors.join('\n  ')}`);

  const fail = (msg) => {
    throw new ScenarioError(msg);
  };
  if (doc.tier !== 1 && !(doc.tier === 2 && allowTier2)) {
    fail('only tier 1 scenarios run here; tier 2 runs in the private eval job');
  }
  const frames = doc.frames;
  const inRun = (f, where) => {
    if (f > frames) fail(`${where}: frame ${f} is after the last frame (${frames})`);
  };

  const memory = {};
  for (const [name, loc] of Object.entries(doc.memory ?? {})) {
    const where = `memory.${name}`;
    if (loc.type === 'bytes' && loc.len === undefined) fail(`${where}: type bytes needs len`);
    if (loc.type !== 'bytes' && loc.len !== undefined) fail(`${where}: len is only for type bytes`);
    const addr = Number(loc.addr);
    const len = loc.len ?? SIZES[loc.type];
    try {
      ramOffset(addr, len);
    } catch (e) {
      fail(`${where}: ${e.message}`);
    }
    memory[name] = { ...loc, addr, len };
  }
  if (doc.format === 2) return loadScenario2(doc, memory, { bootPoints });

  const input = (doc.input ?? []).map((s, i) => {
    const to = s.to ?? s.from;
    if (to < s.from) fail(`input[${i}]: to (${to}) is before from (${s.from})`);
    inRun(to, `input[${i}]`);
    return { from: s.from, to, port: s.port ?? 0, mask: padMask(s.buttons) };
  });

  const disc = doc.boot.disc ?? null;
  const declared = new Map(); // metric name -> where
  const check = (a, where) => {
    const metric = a.metric;
    if (metric !== undefined) {
      if (declared.has(metric)) fail(`${where}: metric "${metric}" is already named by ${declared.get(metric)}`);
      declared.set(metric, where);
    }
    if ('discFile' in a) {
      if (!disc) fail(`${where}: discFile needs a disc boot`);
      return { kind: 'discFile', path: a.discFile, sha1: a.sha1, metric };
    }
    if ('stillFrames' in a) {
      inRun(a.within + a.stillFrames - 1, `${where} (within + stillFrames - 1)`);
      return { kind: 'still', within: a.within, stillFrames: a.stillFrames, metric };
    }
    if ('within' in a) {
      inRun(a.within, where);
      const loc = memory[a.mem];
      if (!loc) fail(`${where}: no memory location named "${a.mem}"`);
      if ('equalsDiscFile' in a) {
        if (!disc) fail(`${where}: equalsDiscFile needs a disc boot`);
        if (loc.type !== 'bytes') fail(`${where}: equalsDiscFile needs a bytes location`);
        const { path: file, offset } = a.equalsDiscFile;
        return { kind: 'withinDisc', within: a.within, mem: a.mem, path: file, offset, metric };
      }
      return { kind: 'within', within: a.within, mem: a.mem, expected: expectedFor(loc, a.equals, where), metric };
    }
    inRun(a.at, where);
    if ('mem' in a) {
      const loc = memory[a.mem];
      if (!loc) fail(`${where}: no memory location named "${a.mem}"`);
      return { kind: 'mem', at: a.at, mem: a.mem, expected: expectedFor(loc, a.equals, where) };
    }
    const [rel, other] = Object.entries(a.frameHash)[0];
    inRun(other, where);
    if (other === a.at) fail(`${where}: compares frame ${a.at} with itself`);
    return { kind: 'frameHash', at: a.at, rel, other };
  };
  const asserts = (doc.assert ?? []).map((a, i) => check(a, `assert[${i}]`));
  const probes = (doc.probes ?? []).map((p, i) => {
    if (p.metric === undefined) fail(`probes[${i}]: a probe must name its metric`);
    return check(p, `probes[${i}]`);
  });
  if (!asserts.length && !(doc.checkpoints ?? []).length) fail('scenario asserts nothing');

  const checkpoints = [...(doc.checkpoints ?? [])].sort((x, y) => x - y);
  checkpoints.forEach((f, i) => inRun(f, `checkpoints[${i}]`));

  const metrics = [...(doc.metrics ?? [])];
  metrics.forEach((k, i) => {
    const where = `metrics[${i}]`;
    const builtin = BUILTIN_METRICS.includes(k);
    const loc = memory[k];
    const named = declared.has(k);
    if (builtin && loc) fail(`${where}: "${k}" is both a built-in metric and a memory name`);
    if (named && (builtin || loc)) fail(`${where}: "${k}" is named by ${declared.get(k)} and is also a ${builtin ? 'built-in metric' : 'memory name'}`);
    if (!builtin && !loc && !named) {
      fail(`${where}: "${k}" is neither a built-in metric (${BUILTIN_METRICS.join(', ')}), a memory name, nor an assertion's or probe's metric`);
    }
    if (loc && loc.type === 'bytes') fail(`${where}: memory "${k}" has type bytes; a metric must be a number (u8, u16 or u32)`);
  });
  for (const [k, where] of declared) {
    if (!metrics.includes(k)) fail(`${where}: metric "${k}" is not listed in metrics`);
  }

  return {
    name: doc.name,
    fixture: doc.boot.fixture ?? null,
    disc,
    frames,
    coreOptions: doc.coreOptions ?? {},
    memory,
    input,
    asserts,
    probes,
    checkpoints,
    metrics,
  };
}

/** Build or read a registered fixture and check its pinned SHA-256. */
export async function resolveFixture(name, fixturesDir = DEFAULT_FIXTURES) {
  const regPath = path.join(fixturesDir, 'fixtures.json');
  const reg = JSON.parse(readFileSync(regPath, 'utf8'));
  const entry = reg.fixtures?.[name];
  if (!entry) throw new ScenarioError(`fixture "${name}" is not in ${regPath}`);
  if (!entry.licence || !entry.origin) throw new ScenarioError(`fixture "${name}" has no recorded licence and origin`);
  let bytes;
  if (entry.kind === 'generator') {
    const mod = await import(pathToFileURL(path.join(fixturesDir, entry.module)).href);
    bytes = mod[entry.export ?? 'build']();
  } else if (entry.kind === 'file') {
    bytes = readFileSync(path.join(fixturesDir, entry.file));
  } else {
    throw new ScenarioError(`fixture "${name}" has unsupported kind ${entry.kind}`);
  }
  const digest = sha256(bytes);
  if (digest !== entry.sha256) {
    throw new ScenarioError(`fixture "${name}" SHA-256 is ${digest}, registry pins ${entry.sha256}`);
  }
  return { name, bytes, sha256: digest, licence: entry.licence };
}

/**
 * Sidecar files the core (pcsx_rearmed libpcsxcore/cdriso.c) looks for next
 * to an image with the same base name, and parses instead of the bare image.
 */
const SIDECARS = ['.cue', '.toc', '.ccd', '.mds'];
const hasSidecar = (p) => SIDECARS.some((ext) => existsSync(p.slice(0, -path.extname(p).length) + ext));

/**
 * The image a disc scenario boots, given the --disc image. No cue is used:
 * PS1 discs like FF7's are a single MODE2/2352 data track, which the reader
 * and the core both detect from the bin (owner decision on #36, 2026-11-05).
 * The core would still parse a same-named cue next to the image, so the
 * first candidate without one wins: <name>.bin next to --disc, then the
 * --disc image itself (the private eval mounts /disc/disc-1.bin with its cue,
 * and the same image as /disc/disc.bin without one). If every candidate has
 * a sidecar, the first that exists is used. Throws ScenarioError "no disc"
 * when there is no image; the message never holds a path.
 */
export function resolveDisc(name, discOpt) {
  if (!discOpt) throw new ScenarioError('no disc: this scenario boots a disc; pass --disc');
  const dir = path.dirname(path.resolve(discOpt));
  const found = [path.join(dir, `${name}.bin`), path.resolve(discOpt)].filter((p) => existsSync(p));
  if (!found.length) throw new ScenarioError('no disc: the disc image does not exist');
  return { file: found.find((p) => !hasSidecar(p)) ?? found[0] };
}

/**
 * Evaluate the disc file checks before boot, inside the run: returns
 * Map(check -> pass) for discFile, Map(check -> bytes | null) for withinDisc.
 * A file that is missing or unreadable fails its check; nothing about the
 * file leaves except pass/fail.
 */
function discChecks(file, checks, memory, setStage) {
  const passes = new Map();
  const bytes = new Map();
  const needed = checks.filter((c) => c.kind === 'discFile' || c.kind === 'withinDisc');
  if (!needed.length) return { passes, bytes };
  let disc;
  try {
    disc = openDisc(file);
  } catch (e) {
    if (e instanceof DiscError && e.step === 'volume') setStage(BOOT_STAGES.image);
    throw e;
  }
  setStage(BOOT_STAGES.volume);
  try {
    const cache = new Map();
    const read = (p) => {
      const real = p.endsWith(':BOOT') ? disc.bootPath() : p;
      if (!cache.has(real)) cache.set(real, disc.read(real));
      return cache.get(real);
    };
    for (const c of needed) {
      try {
        if (c.kind === 'discFile') {
          passes.set(c, sha1(read(c.path)) === c.sha1);
        } else {
          const len = memory[c.mem].len;
          const data = read(c.path);
          bytes.set(c, c.offset + len <= data.length ? Buffer.from(data.subarray(c.offset, c.offset + len)) : null);
        }
      } catch (e) {
        if (!(e instanceof DiscError)) throw e;
        if (c.kind === 'discFile') passes.set(c, false);
        else bytes.set(c, null);
      }
    }
  } finally {
    disc.close();
  }
  return { passes, bytes };
}

function readBaseline(dir, name) {
  const p = path.join(dir, `${name}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

/** The scenario's listed metrics, as numbers the Tier 2 validator accepts. */
export function metricValues(sc, { frames, failed, runMs, finalMem, named = new Map(), stage = BOOT_STAGES.done, discError = 0 }) {
  const builtin = {
    disc_error: discError,
    boot_stage: stage,
    frames,
    failed_assertions: failed,
    run_ms: Math.round(runMs),
    // At most 3 decimals and below 1e6, as the validator (#34) requires.
    fps: runMs > 0 ? Math.min(Math.round((frames * 1e6) / runMs) / 1000, 999999) : 999999,
  };
  return Object.fromEntries(sc.metrics.map((k) => [k, sc.memory[k] ? finalMem.get(k) : named.has(k) ? named.get(k) : builtin[k]]));
}

/** Stops a run at its current stage (see BOOT_STAGES). */
class StopRun extends Error {
  constructor(cause) {
    super('run stopped', { cause });
  }
}

export function readBuildInfo() {
  const p = path.join(HERE, 'dist', 'BUILD_INFO.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

/** Run a loaded scenario. Returns the result object (status pass or fail). */
export async function runScenario(sc, opts = {}) {
  if (sc.format === 2) return runScenario2(sc, opts);
  const fixture = sc.fixture ? await resolveFixture(sc.fixture, opts.fixturesDir) : null;
  const disc = sc.disc ? resolveDisc(sc.disc, opts.disc) : null;
  const baseline = readBaseline(opts.baselinesDir ?? DEFAULT_BASELINES, sc.name);
  const checks = [...sc.asserts, ...sc.probes];

  const memAt = new Map(); // frame -> [assert]
  const hashFrames = new Set(sc.checkpoints);
  for (const a of sc.asserts) {
    if (a.kind === 'mem') {
      if (!memAt.has(a.at)) memAt.set(a.at, []);
      memAt.get(a.at).push(a);
    } else if (a.kind === 'frameHash') {
      hashFrames.add(a.at);
      hashFrames.add(a.other);
    }
  }
  // within checks: watched every frame until they hold or their frame passes.
  const watches = checks.filter((c) => c.kind === 'within' || c.kind === 'withinDisc');
  const stills = checks.filter((c) => c.kind === 'still');
  const stillEnd = Math.max(0, ...stills.map((c) => c.within + c.stillFrames - 1));
  const first = new Map(); // within/still check -> first frame (absent: never)

  // From here on a failure stops the run at its stage and the scenario
  // fails (see BOOT_STAGES); "no disc" above is the only setup error.
  let stage = BOOT_STAGES.found;
  let stopped = false;
  let framesRun = 0;
  let discError = 0;
  const setStage = (n) => {
    stage = n;
  };
  let discPass = new Map();
  let discBytes = new Map();
  if (disc) {
    try {
      ({ passes: discPass, bytes: discBytes } = discChecks(disc.file, checks, sc.memory, setStage));
      stage = BOOT_STAGES.checks;
    } catch (e) {
      if (!(e instanceof DiscError)) throw e;
      discError = e.reason;
      stopped = true;
    }
  } else {
    stage = BOOT_STAGES.checks;
  }

  let dir = null;
  let program;
  if (fixture) {
    dir = mkdtempSync(path.join(tmpdir(), 'ff7-scenario-'));
    program = path.join(dir, `${fixture.name}.exe`);
    writeFileSync(program, fixture.bytes);
  } else {
    program = disc.file;
  }
  const backend = stopped ? null : await createBackend({ coreOptions: sc.coreOptions, verbose: opts.verbose });
  const hashes = new Map();
  const actual = new Map(); // assert -> value
  const metricMem = sc.metrics.filter((k) => sc.memory[k]);
  const finalMem = new Map(); // metric key -> value at the end of the last frame
  let runMs = 0;
  try {
    if (stopped) throw new StopRun();
    try {
      backend.loadProgram(program);
    } catch (e) {
      // The core refused the program, or crashed loading it.
      throw new StopRun(e);
    }
    stage = BOOT_STAGES.loaded;
    let runHash = null;
    let runStart = 0;
    const uniform = new Map(); // frame hash -> picture is one colour
    backend.onFrameEnd(({ frame }) => {
      const needHash = hashFrames.has(frame) || frame <= stillEnd;
      const h = needHash ? backend.frameHash() : null;
      if (hashFrames.has(frame)) hashes.set(frame, h);
      for (const a of memAt.get(frame) ?? []) {
        const loc = sc.memory[a.mem];
        actual.set(a, decode(loc, backend.readMem(loc.addr, loc.len)));
      }
      for (const c of watches) {
        if (first.has(c) || frame > c.within) continue;
        const loc = sc.memory[c.mem];
        const got = backend.readMem(loc.addr, loc.len);
        let ok;
        if (c.kind === 'within') {
          ok = decode(loc, got) === c.expected;
        } else {
          const want = discBytes.get(c);
          ok = want !== null && want !== undefined && Buffer.from(got).equals(want);
        }
        if (ok) first.set(c, frame);
      }
      if (frame <= stillEnd) {
        if (h !== runHash) {
          runHash = h;
          runStart = frame;
        }
        const len = frame - runStart + 1;
        for (const c of stills) {
          if (first.has(c) || len !== c.stillFrames || runStart > c.within) continue;
          if (!uniform.has(h)) uniform.set(h, backend.frameIsUniform());
          if (!uniform.get(h)) first.set(c, runStart);
        }
      }
      if (frame === sc.frames) {
        for (const k of metricMem) finalMem.set(k, decode(sc.memory[k], backend.readMem(sc.memory[k].addr, sc.memory[k].len)));
      }
    });
    const t0 = performance.now();
    try {
      for (let f = 1; f <= sc.frames; f++) {
        const masks = [0, 0];
        for (const s of sc.input) if (f >= s.from && f <= s.to) masks[s.port] |= s.mask;
        backend.setPad(masks[0], 0);
        backend.setPad(masks[1], 1);
        backend.stepFrame();
        framesRun = f;
      }
    } catch (e) {
      // A core crash (a Wasm trap) part-way: stop with what ran.
      throw new StopRun(e);
    } finally {
      runMs = performance.now() - t0;
    }
    stage = BOOT_STAGES.done;
  } catch (e) {
    if (!(e instanceof StopRun)) throw e;
    stopped = true;
  } finally {
    if (backend) {
      try {
        backend.close();
      } catch {
        // a crashed core may not close cleanly
      }
    }
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
  const build = stopped && !backend ? readBuildInfo() : backend.buildInfo();
  const core = build && {
    pcsx_rearmed_commit: build.pcsx_rearmed_commit,
    emsdk_version: build.emsdk_version,
    wasm_sha256: build.wasm_sha256,
  };

  // What a check reports. Disc checks report pass/fail and frame numbers
  // only, never disc bytes or hashes.
  const report = (a) => {
    switch (a.kind) {
      case 'mem': {
        const loc = sc.memory[a.mem];
        const got = actual.get(a);
        return {
          at: a.at,
          mem: a.mem,
          expected: fmtValue(loc, a.expected),
          actual: got === undefined ? null : fmtValue(loc, got),
          pass: got === a.expected,
        };
      }
      case 'frameHash': {
        const x = hashes.get(a.at);
        const y = hashes.get(a.other);
        const same = x === y;
        return { at: a.at, frameHash: { [a.rel]: a.other }, pass: x !== undefined && y !== undefined && (a.rel === 'sameAs' ? same : !same) };
      }
      case 'discFile':
        return { discFile: a.path, pass: discPass.get(a) === true };
      case 'within':
        return { within: a.within, mem: a.mem, expected: fmtValue(sc.memory[a.mem], a.expected), firstFrame: first.get(a) ?? 0, pass: first.has(a) };
      case 'withinDisc':
        return { within: a.within, mem: a.mem, equalsDiscFile: { path: a.path, offset: a.offset }, firstFrame: first.get(a) ?? 0, pass: first.has(a) };
      case 'still':
        return { within: a.within, stillFrames: a.stillFrames, firstFrame: first.get(a) ?? 0, pass: first.has(a) };
      default:
        throw new Error(`unknown check ${a.kind}`);
    }
  };
  // A stopped run fails every assertion: nothing it did can be trusted.
  const assertions = sc.asserts.map((a) => (stopped ? { ...report(a), pass: false } : report(a)));
  const probes = sc.probes.map((p) => ({ ...report(p), metric: p.metric }));
  const named = new Map();
  for (const c of checks) {
    if (c.metric === undefined) continue;
    named.set(c.metric, c.kind === 'discFile' ? (discPass.get(c) ? 1 : 0) : first.get(c) ?? 0);
  }

  const unverified = [];
  let checkpoints = sc.checkpoints.map((frame) => ({ frame, hash: hashes.get(frame) }));
  if (sc.checkpoints.length) {
    if (!baseline) {
      unverified.push(`no baseline file for "${sc.name}": checkpoint hashes recorded, not compared`);
      checkpoints = checkpoints.map((c) => ({ ...c, baseline: 'absent' }));
    } else {
      const coreMatches = baseline.core?.wasm_sha256 === core?.wasm_sha256;
      checkpoints = checkpoints.map((c) => {
        const want = baseline.checkpoints?.[String(c.frame)];
        if (want === undefined) return { ...c, baseline: 'absent', pass: false };
        return { ...c, baseline: want, pass: want === c.hash };
      });
      if (!coreMatches) unverified.push('baseline was recorded with a different core build');
    }
  }

  if (stopped) checkpoints = checkpoints.map((c) => ({ ...c, pass: false }));
  const failed = assertions.filter((a) => !a.pass).length + checkpoints.filter((c) => c.pass === false).length;
  const pass = failed === 0 && !stopped;
  const source = fixture
    ? { fixture: { name: fixture.name, sha256: fixture.sha256, licence: fixture.licence } }
    : { disc: { name: sc.disc } };
  const result = {
    runner: 'ff7-web/scenario',
    format: 1,
    scenario: sc.name,
    status: pass ? 'pass' : 'fail',
    core,
    ...source,
    frames: sc.frames,
    boot_stage: stage,
    ...(stopped ? { stopped: true, frames_run: framesRun } : {}),
    assertions,
    ...(probes.length ? { probes } : {}),
    ...(checkpoints.length ? { checkpoints } : {}),
    ...(unverified.length ? { unverified } : {}),
  };
  if (sc.metrics.length) {
    result.metrics = metricValues(sc, { frames: framesRun, failed, runMs, finalMem, named, stage, discError });
  }
  if (opts.record) {
    result.record = {
      format: 1,
      scenario: sc.name,
      core,
      ...(fixture ? { fixture: { name: fixture.name, sha256: fixture.sha256 } } : { disc: { name: sc.disc } }),
      checkpoints: Object.fromEntries(checkpoints.map((c) => [String(c.frame), c.hash])),
    };
  }
  return result;
}

async function main() {
  const usage = 'usage: node runner/scenario.js [--record] [--baselines DIR] [--fixtures DIR] [--disc PATH] [--verbose] <scenario.json>';
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: {
        record: { type: 'boolean', default: false },
        baselines: { type: 'string' },
        fixtures: { type: 'string' },
        disc: { type: 'string' },
        verbose: { type: 'boolean', default: false },
      },
    }));
    if (positionals.length !== 1) throw new Error('expected exactly one scenario path');
  } catch (e) {
    console.error(`error: ${e.message}\n${usage}`);
    process.exit(2);
  }

  let sc;
  try {
    sc = loadScenario(JSON.parse(readFileSync(positionals[0], 'utf8')));
  } catch (e) {
    console.error(`error: ${positionals[0]}: ${e.message}`);
    process.exit(2);
  }
  try {
    const result = await runScenario(sc, {
      record: values.record,
      baselinesDir: values.baselines,
      fixturesDir: values.fixtures,
      disc: values.disc,
      verbose: values.verbose,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    for (const u of result.unverified ?? []) console.error(`note: ${u}`);
    console.error(`${sc.name}: ${result.status}`);
    process.exit(result.status === 'pass' ? 0 : 1);
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(e instanceof ScenarioError ? 2 : 1);
  }
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  await main();
}
