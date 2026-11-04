#!/usr/bin/env node
// Tier 2 trusted validator: turn whatever the sandbox left in its output
// directory into a small, bounded summary. This summary is the only thing
// from a Tier 2 run that is ever printed or posted; Actions logs are public
// (docs/SECURITY.md, trust boundary point 3).
//
//   node harness/private-eval/validate/validate.js --out DIR --expect FILE [--sandbox-report FILE]
//
// --expect names, before the run, every scenario and metric key the summary
// may contain: { "format": 1, "scenarios": { "<name>": ["<key>", ...] } }.
// The trusted job builds it from the PR's scenario files, which are public
// and were written before the disc was read. So no text in the summary can
// be chosen by the program at run time: the channel out of the sandbox is
// limited to which expected scenarios report, their statuses and their
// numbers (see notes/34-validator.md for the bound).
//
// Prints the summary (one JSON line) and exits 0 when it could produce one,
// whatever the run did; exit 2 is a usage error.
//
// Trusted code, run from `main`. It depends on nothing outside this
// directory: runner/schema.js and harness/schema/ are not protected paths,
// so the rules are written out here, and a test checks that they agree with
// harness/schema/tier2-result.schema.json (the documentation of the input).
//
// Input: one file, DIR/results.json, written by the untrusted program:
//   { "format": 1,
//     "scenarios": [ { "name": "pad-echo-buttons", "status": "pass",
//                      "metrics": { "frames": 60, "fps": 59.94 } } ] }
// Nothing else in DIR is read.
//
// Rules (each one is tested; "reject" means the whole output is replaced by
// a fixed reason code and no scenario data):
//   - DIR must be a real directory; results.json must be a regular file
//     (no symlink, FIFO or device; opened with O_NOFOLLOW) -> reject
//   - at most MAX_FILE_BYTES -> reject "too-large"
//   - valid UTF-8 -> reject "not-utf8"
//   - nesting depth at most MAX_DEPTH -> reject "too-deep"
//   - JSON -> reject "not-json"
//   - exactly the documented fields, types and patterns -> reject "schema"
//   - more than MAX_SCENARIOS scenarios -> reject "too-many-scenarios"
//   - every name in --expect -> reject "unexpected-name"
//   - every metric key listed for its scenario -> reject "unexpected-metric"
//   - scenario names unique -> reject "duplicate-name"
//   - metric values: finite; integers within +-MAX_INT; other numbers with
//     at most 3 decimal places and within +-MAX_FLOAT -> reject "schema"
// The summary contains no text from the input: names and keys are checked
// against --expect, and scenarios and keys are sorted, so input order
// carries nothing either.

import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const RESULTS_FILE = 'results.json';
export const MAX_FILE_BYTES = 64 * 1024;
export const MAX_DEPTH = 6;
export const MAX_SCENARIOS = 32;
export const MAX_METRICS = 8;
export const MAX_INT = 2 ** 32;
export const MAX_FLOAT = 1e6;
export const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const METRIC_RE = /^[a-z][a-z0-9_]{0,31}$/;
export const STATUSES = ['pass', 'fail', 'error'];
export const LIMIT_NAMES = ['memory', 'output', 'pids', 'time'];
export const REASONS = [
  'bad-directory', 'missing', 'not-regular-file', 'unreadable', 'too-large', 'not-utf8', 'too-deep',
  'not-json', 'schema', 'too-many-scenarios', 'unexpected-name', 'unexpected-metric', 'duplicate-name',
];
/** The summary can never be larger than this (checked at run time and by a test). */
export const SUMMARY_MAX_BYTES = 16 * 1024;

class Reject extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

/** Read results.json without following links or blocking; at most MAX_FILE_BYTES + 1 bytes. */
export function readResults(dir) {
  let st;
  try {
    st = lstatSync(dir);
  } catch {
    throw new Reject('bad-directory');
  }
  if (!st.isDirectory()) throw new Reject('bad-directory');

  const file = path.join(dir, RESULTS_FILE);
  // Check the type before opening, so a device node is never opened; the
  // directory is frozen read-only by the sandbox, and the type is checked
  // again on the open descriptor.
  try {
    if (!lstatSync(file).isFile()) throw new Reject('not-regular-file');
  } catch (e) {
    if (e instanceof Reject) throw e;
    if (e.code === 'ENOENT') throw new Reject('missing');
    throw new Reject('unreadable');
  }
  let fd;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (e) {
    if (e.code === 'ENOENT') throw new Reject('missing');
    if (e.code === 'ELOOP') throw new Reject('not-regular-file');
    throw new Reject('unreadable');
  }
  try {
    if (!fstatSync(fd).isFile()) throw new Reject('not-regular-file');
    const buf = Buffer.alloc(MAX_FILE_BYTES + 1);
    let n = 0;
    for (;;) {
      let got;
      try {
        got = readSync(fd, buf, n, buf.length - n, null);
      } catch {
        throw new Reject('unreadable');
      }
      if (got === 0) break;
      n += got;
      if (n > MAX_FILE_BYTES) throw new Reject('too-large');
    }
    return buf.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}

/** Depth of [ and { nesting, ignoring brackets inside strings. */
export function nestingDepth(text) {
  let depth = 0;
  let max = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '[' || c === '{') max = Math.max(max, ++depth);
    else if (c === ']' || c === '}') depth--;
  }
  return max;
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasExactly = (obj, required, optional = []) =>
  required.every((k) => Object.hasOwn(obj, k)) && Object.keys(obj).every((k) => required.includes(k) || optional.includes(k));

export function validMetricValue(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  if (Number.isInteger(v)) return Math.abs(v) <= MAX_INT;
  return Math.abs(v) <= MAX_FLOAT && Math.round(v * 1000) / 1000 === v;
}

function checkScenario(s) {
  if (!isPlainObject(s) || !hasExactly(s, ['name', 'status'], ['metrics'])) return false;
  if (typeof s.name !== 'string' || !NAME_RE.test(s.name)) return false;
  if (!STATUSES.includes(s.status)) return false;
  if (s.metrics !== undefined) {
    if (!isPlainObject(s.metrics)) return false;
    const keys = Object.keys(s.metrics);
    if (keys.length > MAX_METRICS) return false;
    if (!keys.every((k) => METRIC_RE.test(k) && validMetricValue(s.metrics[k]))) return false;
  }
  return true;
}

/**
 * Check the --expect document (trusted, but checked anyway). Returns a Map
 * from scenario name to a Set of allowed metric keys; throws Error.
 */
export function loadExpect(doc) {
  const bad = (msg) => {
    throw new Error(`--expect: ${msg}`);
  };
  if (!isPlainObject(doc) || !hasExactly(doc, ['format', 'scenarios']) || doc.format !== 1) bad('needs exactly format 1 and scenarios');
  if (!isPlainObject(doc.scenarios)) bad('scenarios must be an object');
  const names = Object.keys(doc.scenarios);
  if (names.length === 0 || names.length > MAX_SCENARIOS) bad(`1 to ${MAX_SCENARIOS} scenarios`);
  const map = new Map();
  for (const name of names) {
    if (!NAME_RE.test(name)) bad('a scenario name does not match the name pattern');
    const keys = doc.scenarios[name];
    if (!Array.isArray(keys) || keys.length > MAX_METRICS) bad(`each scenario lists at most ${MAX_METRICS} metric keys`);
    if (!keys.every((k) => typeof k === 'string' && METRIC_RE.test(k))) bad('a metric key does not match the key pattern');
    if (new Set(keys).size !== keys.length) bad('duplicate metric key');
    map.set(name, new Set(keys));
  }
  return map;
}

/**
 * Parse and check the raw bytes of results.json against the expected
 * names. Returns the scenarios, sorted by name, with sorted metric keys;
 * throws Reject.
 */
export function checkResults(bytes, expect) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new Reject('not-utf8');
  }
  if (nestingDepth(text) > MAX_DEPTH) throw new Reject('too-deep');
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Reject('not-json');
  }
  if (!isPlainObject(doc) || !hasExactly(doc, ['format', 'scenarios']) || doc.format !== 1) throw new Reject('schema');
  if (!Array.isArray(doc.scenarios) || doc.scenarios.length === 0) throw new Reject('schema');

  if (doc.scenarios.length > MAX_SCENARIOS) throw new Reject('too-many-scenarios');
  if (!doc.scenarios.every(checkScenario)) throw new Reject('schema');
  if (!doc.scenarios.every((s) => expect.has(s.name))) throw new Reject('unexpected-name');
  if (!doc.scenarios.every((s) => Object.keys(s.metrics ?? {}).every((k) => expect.get(s.name).has(k)))) {
    throw new Reject('unexpected-metric');
  }
  if (new Set(doc.scenarios.map((s) => s.name)).size !== doc.scenarios.length) throw new Reject('duplicate-name');

  // Rebuild every value from scratch, sorted: nothing from the input
  // survives except expected names and keys, statuses and checked numbers.
  return doc.scenarios
    .map((s) => {
      const out = { name: s.name, status: s.status };
      if (s.metrics !== undefined) {
        out.metrics = {};
        for (const k of Object.keys(s.metrics).sort()) out.metrics[k] = s.metrics[k];
      }
      return out;
    })
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** The sandbox's own report (#33) is trusted, but only limits_hit is kept, and only known names. */
export function limitsFromReport(report) {
  const hit = Array.isArray(report?.limits_hit) ? report.limits_hit : [];
  return LIMIT_NAMES.filter((l) => hit.includes(l));
}

/**
 * Build the summary. `expect` is the --expect document (or the Map from
 * loadExpect). `ok` is true only when the output was accepted, no limit was
 * hit, and every expected scenario reported and passed.
 */
export function summarize(dir, expect, sandboxReport = null) {
  const expected = expect instanceof Map ? expect : loadExpect(expect);
  const limits_hit = limitsFromReport(sandboxReport);
  let summary;
  try {
    const scenarios = checkResults(readResults(dir), expected);
    const counts = Object.fromEntries(STATUSES.map((st) => [st, scenarios.filter((s) => s.status === st).length]));
    counts.missing = expected.size - scenarios.length;
    summary = {
      format: 1,
      ok: limits_hit.length === 0 && counts.pass === expected.size,
      output: 'accepted',
      reason: null,
      limits_hit,
      counts,
      scenarios,
    };
  } catch (e) {
    if (!(e instanceof Reject)) throw e;
    summary = {
      format: 1,
      ok: false,
      output: 'rejected',
      reason: e.reason,
      limits_hit,
      counts: { pass: 0, fail: 0, error: 0, missing: expected.size },
      scenarios: [],
    };
  }
  if (Buffer.byteLength(JSON.stringify(summary)) > SUMMARY_MAX_BYTES) {
    throw new Error('summary over SUMMARY_MAX_BYTES; the rules above should make this impossible');
  }
  return summary;
}

function main(argv) {
  const usage = 'usage: validate.js --out DIR --expect FILE [--sandbox-report FILE]';
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { out: { type: 'string' }, expect: { type: 'string' }, 'sandbox-report': { type: 'string' } },
    }));
  } catch (e) {
    console.error(`error: ${e.message}\n${usage}`);
    return 2;
  }
  if (!values.out || !values.expect) {
    console.error(usage);
    return 2;
  }
  let expect;
  try {
    expect = loadExpect(JSON.parse(readFileSync(values.expect, 'utf8')));
  } catch (e) {
    // loadExpect's own messages never quote the file; JSON.parse's might.
    console.error(e.message.startsWith('--expect:') ? `error: ${e.message}` : 'error: cannot read --expect as JSON');
    return 2;
  }
  let report = null;
  if (values['sandbox-report']) {
    try {
      report = JSON.parse(readFileSync(values['sandbox-report'], 'utf8'));
    } catch {
      // Never echo the file: a parse error message can quote its contents.
      console.error('error: cannot read the sandbox report as JSON');
      return 2;
    }
  }
  process.stdout.write(`${JSON.stringify(summarize(values.out, expect, report))}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
