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
//   --verbose          forward core info logs to stderr
//
// Exit status: 0 pass, 1 fail, 2 invalid scenario or usage error.
// stdout carries only deterministic data; logs go to stderr.

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { createBackend } from './backend.js';
import { ramOffset } from './memmap.js';
import { padMask } from './pad.js';
import { validate } from './schema.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = path.resolve(HERE, '../harness');
export const SCHEMA_PATH = path.join(HARNESS, 'schema/scenario.schema.json');
export const DEFAULT_FIXTURES = path.join(HARNESS, 'fixtures');
export const DEFAULT_BASELINES = path.join(HARNESS, 'baselines');

const SIZES = { u8: 1, u16: 2, u32: 4 };

export class ScenarioError extends Error {}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Little-endian unsigned value, or the hex bytes for type "bytes". */
function decode(loc, bytes) {
  if (loc.type === 'bytes') return Buffer.from(bytes).toString('hex');
  let v = 0;
  for (let i = bytes.length - 1; i >= 0; i--) v = v * 256 + bytes[i];
  return v;
}

/** Normalise an expected value for a location; throws ScenarioError if it can't fit. */
function expectedFor(loc, value, where) {
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

const fmtValue = (loc, v) => (loc.type === 'bytes' ? v : `0x${v.toString(16).padStart(SIZES[loc.type] * 2, '0')}`);

/**
 * Validate a parsed scenario against the schema and the checks the schema
 * can't express. Returns the normalised scenario; throws ScenarioError.
 */
export function loadScenario(doc) {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  const errors = validate(schema, doc);
  if (errors.length) throw new ScenarioError(`scenario does not match the schema:\n  ${errors.join('\n  ')}`);

  const fail = (msg) => {
    throw new ScenarioError(msg);
  };
  if (doc.tier !== 1) fail('only tier 1 scenarios run here; tier 2 runs in the private eval job');
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

  const input = (doc.input ?? []).map((s, i) => {
    const to = s.to ?? s.from;
    if (to < s.from) fail(`input[${i}]: to (${to}) is before from (${s.from})`);
    inRun(to, `input[${i}]`);
    return { from: s.from, to, port: s.port ?? 0, mask: padMask(s.buttons) };
  });

  const asserts = (doc.assert ?? []).map((a, i) => {
    const where = `assert[${i}]`;
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
  });
  if (!asserts.length && !(doc.checkpoints ?? []).length) fail('scenario asserts nothing');

  const checkpoints = [...(doc.checkpoints ?? [])].sort((x, y) => x - y);
  checkpoints.forEach((f, i) => inRun(f, `checkpoints[${i}]`));

  return {
    name: doc.name,
    fixture: doc.boot.fixture,
    frames,
    coreOptions: doc.coreOptions ?? {},
    memory,
    input,
    asserts,
    checkpoints,
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

function readBaseline(dir, name) {
  const p = path.join(dir, `${name}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

/** Run a loaded scenario. Returns the result object (status pass or fail). */
export async function runScenario(sc, opts = {}) {
  const fixture = await resolveFixture(sc.fixture, opts.fixturesDir);
  const baseline = readBaseline(opts.baselinesDir ?? DEFAULT_BASELINES, sc.name);

  const memAt = new Map(); // frame -> [assert]
  const hashFrames = new Set(sc.checkpoints);
  for (const a of sc.asserts) {
    if (a.kind === 'mem') {
      if (!memAt.has(a.at)) memAt.set(a.at, []);
      memAt.get(a.at).push(a);
    } else {
      hashFrames.add(a.at);
      hashFrames.add(a.other);
    }
  }

  const dir = mkdtempSync(path.join(tmpdir(), 'ff7-scenario-'));
  const exe = path.join(dir, `${fixture.name}.exe`);
  writeFileSync(exe, fixture.bytes);
  const backend = await createBackend({ coreOptions: sc.coreOptions, verbose: opts.verbose });
  const hashes = new Map();
  const actual = new Map(); // assert -> value
  try {
    backend.loadProgram(exe);
    backend.onFrameEnd(({ frame }) => {
      if (hashFrames.has(frame)) hashes.set(frame, backend.frameHash());
      for (const a of memAt.get(frame) ?? []) {
        const loc = sc.memory[a.mem];
        actual.set(a, decode(loc, backend.readMem(loc.addr, loc.len)));
      }
    });
    for (let f = 1; f <= sc.frames; f++) {
      const masks = [0, 0];
      for (const s of sc.input) if (f >= s.from && f <= s.to) masks[s.port] |= s.mask;
      backend.setPad(masks[0], 0);
      backend.setPad(masks[1], 1);
      backend.stepFrame();
    }
  } finally {
    backend.close();
    rmSync(dir, { recursive: true, force: true });
  }
  const build = backend.buildInfo();
  const core = build && {
    pcsx_rearmed_commit: build.pcsx_rearmed_commit,
    emsdk_version: build.emsdk_version,
    wasm_sha256: build.wasm_sha256,
  };

  const assertions = sc.asserts.map((a) => {
    if (a.kind === 'mem') {
      const loc = sc.memory[a.mem];
      const got = actual.get(a);
      return {
        at: a.at,
        mem: a.mem,
        expected: fmtValue(loc, a.expected),
        actual: fmtValue(loc, got),
        pass: got === a.expected,
      };
    }
    const same = hashes.get(a.at) === hashes.get(a.other);
    return { at: a.at, frameHash: { [a.rel]: a.other }, pass: a.rel === 'sameAs' ? same : !same };
  });

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

  const pass = assertions.every((a) => a.pass) && checkpoints.every((c) => c.pass !== false);
  const result = {
    runner: 'ff7-web/scenario',
    format: 1,
    scenario: sc.name,
    status: pass ? 'pass' : 'fail',
    core,
    fixture: { name: fixture.name, sha256: fixture.sha256, licence: fixture.licence },
    frames: sc.frames,
    assertions,
    ...(checkpoints.length ? { checkpoints } : {}),
    ...(unverified.length ? { unverified } : {}),
  };
  if (opts.record) {
    result.record = {
      format: 1,
      scenario: sc.name,
      core,
      fixture: { name: fixture.name, sha256: fixture.sha256 },
      checkpoints: Object.fromEntries(checkpoints.map((c) => [String(c.frame), c.hash])),
    };
  }
  return result;
}

async function main() {
  const usage = 'usage: node runner/scenario.js [--record] [--baselines DIR] [--fixtures DIR] [--verbose] <scenario.json>';
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
