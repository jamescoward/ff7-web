// Tests for the Tier 2 trusted validator (issue #34). Tier 1, no game data.
//
//   node --test harness/private-eval/validate/test/

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validate } from '../../../../runner/schema.js';
import {
  checkResults, LIMIT_NAMES, loadExpect, MAX_DEPTH, MAX_FILE_BYTES, MAX_FLOAT, MAX_INT, MAX_METRICS, MAX_SCENARIOS,
  nestingDepth, REASONS, RESULTS_FILE, STATUSES, SUMMARY_MAX_BYTES, summarize as summarizeWith,
} from '../validate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '../validate.js');
const SCHEMA = JSON.parse(readFileSync(path.resolve(HERE, '../../../schema/tier2-result.schema.json'), 'utf8'));

const SCRATCH = mkdtempSync(path.join(os.tmpdir(), 'ff7-validate-test-'));
test.after(() => rmSync(SCRATCH, { recursive: true, force: true }));

let dirCount = 0;
/** A fresh output directory holding results.json with `content` (string, Buffer or object). */
function outDir(content) {
  const dir = path.join(SCRATCH, `out-${dirCount++}`);
  mkdirSync(dir);
  if (content !== undefined) {
    const data = typeof content === 'string' || Buffer.isBuffer(content) ? content : JSON.stringify(content);
    writeFileSync(path.join(dir, RESULTS_FILE), data);
  }
  return dir;
}

const VALID = {
  format: 1,
  scenarios: [
    { name: 'pad-echo-buttons', status: 'pass', metrics: { frames: 60, fps: 59.94, addr: 0x8009d000, x: -1234 } },
    { name: 'disc-boot', status: 'fail', metrics: {} },
    { name: 'title-screen', status: 'error' },
  ],
};

/** The expected names and keys for most tests. */
const EXPECT = {
  format: 1,
  scenarios: {
    'pad-echo-buttons': ['frames', 'fps', 'addr', 'x'],
    'disc-boot': [],
    'title-screen': [],
    a: ['x', 'n'],
    b: ['n'],
  },
};
/** An expect document that allows exactly what a (valid) doc contains. */
const expectFrom = (doc) => ({
  format: 1,
  scenarios: Object.fromEntries(doc.scenarios.map((sc) => [sc.name, Object.keys(sc.metrics ?? {})])),
});
const summarize = (dir, report = null, expect = EXPECT) => summarizeWith(dir, expect, report);

const rejected = (summary, reason) => {
  assert.equal(summary.output, 'rejected');
  assert.equal(summary.reason, reason);
  assert.equal(summary.ok, false);
  assert.deepEqual(summary.scenarios, []);
};
const reasonFor = (content, expect = EXPECT) => summarize(outDir(content), null, expect).reason;

// --- Valid output ----------------------------------------------------------------

test('valid output passes through unchanged', () => {
  const s = summarize(outDir(VALID));
  assert.equal(s.output, 'accepted');
  assert.equal(s.reason, null);
  // Unchanged except for order: scenarios sorted by name, keys sorted.
  const sorted = [VALID.scenarios[1], VALID.scenarios[0], VALID.scenarios[2]];
  assert.deepEqual(s.scenarios, sorted);
  assert.deepEqual(Object.keys(s.scenarios[1].metrics), ['addr', 'fps', 'frames', 'x']);
  assert.deepEqual(s.counts, { pass: 1, fail: 1, error: 1, missing: 2 });
  assert.equal(s.ok, false, 'not every scenario passed');
});

test('input order carries nothing: reordered scenarios and keys give the same summary', () => {
  const reordered = {
    format: 1,
    scenarios: [...VALID.scenarios].reverse().map((sc) => ({
      ...sc,
      ...(sc.metrics ? { metrics: Object.fromEntries(Object.entries(sc.metrics).reverse()) } : {}),
    })),
  };
  assert.equal(JSON.stringify(summarize(outDir(reordered))), JSON.stringify(summarize(outDir(VALID))));
});

test('ok only when every scenario passed and no limit was hit', () => {
  const allPass = { format: 1, scenarios: [{ name: 'a', status: 'pass' }, { name: 'b', status: 'pass', metrics: { n: 1 } }] };
  const just = expectFrom(allPass);
  assert.equal(summarize(outDir(allPass), null, just).ok, true);
  assert.equal(summarize(outDir(allPass), { limits_hit: [] }, just).ok, true);
  const hit = summarize(outDir(allPass), { limits_hit: ['time'] }, just);
  assert.equal(hit.ok, false);
  assert.deepEqual(hit.limits_hit, ['time']);
  // An expected scenario that never reported is "missing", and the run is not ok.
  const partial = summarize(outDir(allPass));
  assert.equal(partial.ok, false);
  assert.equal(partial.counts.missing, 3);
});

test('limits_hit from the sandbox report keeps only known names, in a fixed order', () => {
  const s = summarize(outDir(VALID), { limits_hit: ['time', 'evil payload', 'memory', 7], exit_code: 3, elapsed_s: 99 });
  assert.deepEqual(s.limits_hit, ['memory', 'time']);
  assert.ok(!JSON.stringify(s).includes('evil'));
  assert.ok(!JSON.stringify(s).includes('elapsed'));
  // A rejected output still reports the limits that explain it.
  assert.deepEqual(summarize(outDir(), { limits_hit: ['output'] }).limits_hit, ['output']);
});

test('boundary values are accepted', () => {
  const doc = {
    format: 1,
    scenarios: [{
      name: 'a'.repeat(64),
      status: 'pass',
      metrics: { a: MAX_INT, b: -MAX_INT, c: 999999.999, d: -0.001, e: 0, f: 1.5, [`g${'x'.repeat(31)}`]: 1, h: 2 },
    }],
  };
  const s = summarize(outDir(doc), null, expectFrom(doc));
  assert.equal(s.output, 'accepted', s.reason);
  assert.deepEqual(s.scenarios, doc.scenarios);
});

test('names and metric keys must be listed in --expect: no run-time text gets out', () => {
  // The reviewer's probe on the first version: free text in a name or key.
  const smuggle = (name, key) => ({ format: 1, scenarios: [{ name, status: 'pass', metrics: { [key]: 1 } }] });
  assert.equal(reasonFor(smuggle('thisisarbitrarytextsmuggled', 'x')), 'unexpected-name');
  assert.equal(reasonFor(smuggle('a', 'k0thisisarbitrarytextsmuggledthr')), 'unexpected-metric');
  // A key that's expected for another scenario is still unexpected here.
  assert.equal(reasonFor(smuggle('b', 'x')), 'unexpected-metric');
  assert.equal(reasonFor(smuggle('a', 'x')), null);
});

test('loadExpect checks the expect document', () => {
  assert.equal(loadExpect(EXPECT).size, 5);
  const bad = [
    null, [], { format: 1 }, { format: 2, scenarios: { a: [] } }, { format: 1, scenarios: {} },
    { format: 1, scenarios: { 'Bad Name': [] } }, { format: 1, scenarios: { a: 'x' } }, { format: 1, scenarios: { a: ['x', 'x'] } },
    { format: 1, scenarios: { a: ['Bad'] } }, { format: 1, scenarios: { a: Array.from({ length: MAX_METRICS + 1 }, (_, i) => `k${i}`) } },
    { format: 1, scenarios: Object.fromEntries(Array.from({ length: MAX_SCENARIOS + 1 }, (_, i) => [`s${i}`, []])) },
    { format: 1, scenarios: { a: [] }, extra: 1 },
  ];
  for (const b of bad) assert.throws(() => loadExpect(b), /--expect/, JSON.stringify(b)?.slice(0, 80));
});

test('a file of exactly MAX_FILE_BYTES is read', () => {
  const body = JSON.stringify(VALID);
  const padded = body + ' '.repeat(MAX_FILE_BYTES - Buffer.byteLength(body));
  assert.equal(Buffer.byteLength(padded), MAX_FILE_BYTES);
  assert.equal(summarize(outDir(padded)).output, 'accepted');
});

test('other files in the directory are never read', () => {
  const dir = outDir(VALID);
  writeFileSync(path.join(dir, 'secret.txt'), 'SECRETMARKER');
  writeFileSync(path.join(dir, 'results.json.bak'), 'SECRETMARKER');
  assert.ok(!JSON.stringify(summarize(dir)).includes('SECRETMARKER'));
});

// --- Hostile output, one rule each -----------------------------------------------------

test('missing directory or results file', () => {
  rejected(summarize(path.join(SCRATCH, 'does-not-exist')), 'bad-directory');
  rejected(summarize(outDir()), 'missing');
});

test('huge files are rejected without reading them whole', () => {
  assert.equal(reasonFor(JSON.stringify(VALID) + ' '.repeat(MAX_FILE_BYTES)), 'too-large');
  const dir = outDir('');
  truncateSync(path.join(dir, RESULTS_FILE), 4 * 1024 ** 3); // a sparse 4 GiB file
  const t0 = Date.now();
  rejected(summarize(dir), 'too-large');
  assert.ok(Date.now() - t0 < 2000, 'read too much');
});

test('deep nesting is rejected', () => {
  const nest = (n) => '['.repeat(n) + ']'.repeat(n);
  assert.equal(reasonFor(`{"format":1,"scenarios":[{"name":"a","status":"pass","metrics":{"x":${nest(MAX_DEPTH)}}}]}`), 'too-deep');
  assert.equal(reasonFor(nest(30000)), 'too-deep');
  assert.equal(reasonFor('{"a":'.repeat(10000)), 'too-deep');
  // Brackets inside strings don't count, and escaped quotes don't end a string.
  assert.equal(nestingDepth('{"a":"[[[[[[[[\\"[[[["}'), 1);
  assert.equal(nestingDepth('[[["\\\\"]]]'), 3);
});

test('long strings are rejected', () => {
  const s = (name) => ({ format: 1, scenarios: [{ name, status: 'pass' }] });
  assert.equal(reasonFor(s('a'.repeat(65))), 'schema');
  assert.equal(reasonFor(s('a'.repeat(60000))), 'schema');
  assert.equal(reasonFor({ format: 1, scenarios: [{ name: 'a', status: 'pass', metrics: { [`k${'x'.repeat(32)}`]: 1 } }] }), 'schema');
  assert.equal(reasonFor({ format: 1, scenarios: [{ name: 'a', status: 'pass', metrics: { x: 'y'.repeat(60000) } }] }), 'schema');
});

test('text hidden in numbers is rejected', () => {
  const m = (v) => `{"format":1,"scenarios":[{"name":"a","status":"pass","metrics":{"x":${v}}}]}`;
  for (const v of [
    '0.1234', // a fourth decimal place
    '3.14159265358979', // payload digits
    '1000000.5', // a float out of range
    '4294967297', // an integer out of range
    '-4294967297',
    '12345678901234567890', // loses precision; out of range anyway
    '1e400', // Infinity
    '-1e400',
    '1e-400', // underflows to 0 ... which is accepted: no payload survives
    '"12"', // a string
    'true',
    'null',
    '[1]',
    '{"y":1}',
  ]) {
    const reason = reasonFor(m(v));
    if (v === '1e-400') assert.equal(reason, null, v);
    else assert.equal(reason, 'schema', v);
  }
});

test('extra or wrong fields are rejected', () => {
  const base = () => structuredClone(VALID);
  const cases = [
    (d) => { d.extra = 1; },
    (d) => { d.format = 2; },
    (d) => { delete d.format; },
    (d) => { d.scenarios = []; },
    (d) => { d.scenarios = {}; },
    (d) => { d.scenarios[0].log = 'hello'; },
    (d) => { d.scenarios[0].status = 'PASS'; },
    (d) => { d.scenarios[0].status = 'passed'; },
    (d) => { d.scenarios[0].name = 'Bad Name'; },
    (d) => { d.scenarios[0].name = '-x'; },
    (d) => { d.scenarios[0].name = 7; },
    (d) => { d.scenarios[0].metrics = []; },
    (d) => { d.scenarios[0].metrics = null; },
    (d) => { d.scenarios[0].metrics = Object.fromEntries(Array.from({ length: MAX_METRICS + 1 }, (_, i) => [`m${i}`, i])); },
    (d) => { d.scenarios[0].metrics.Bad = 1; },
    (d) => { d.scenarios[1] = 'pass'; },
    (d) => { d.scenarios[1] = null; },
  ];
  cases.forEach((mutate, i) => {
    const d = base();
    mutate(d);
    assert.equal(reasonFor(d), 'schema', `case ${i}`);
  });
  // __proto__ arrives from JSON.parse as an own key; it fails the key pattern.
  assert.equal(reasonFor('{"format":1,"scenarios":[{"name":"a","status":"pass","metrics":{"__proto__":{"x":1}}}]}'), 'schema');
  assert.equal(reasonFor('{"format":1,"scenarios":[{"name":"a","status":"pass","__proto__":{"y":1}}]}'), 'schema');
  assert.equal(reasonFor('[]'), 'schema');
  assert.equal(reasonFor('"text"'), 'schema');
  assert.equal(reasonFor('not json'), 'not-json');
  assert.equal(reasonFor(''), 'not-json');
});

test('duplicate scenario names are rejected', () => {
  assert.equal(reasonFor({ format: 1, scenarios: [{ name: 'a', status: 'pass' }, { name: 'a', status: 'fail' }] }), 'duplicate-name');
});

test('non-UTF-8 bytes are rejected', () => {
  const ok = Buffer.from(JSON.stringify(VALID));
  for (const bad of [
    Buffer.from([0xff]),
    Buffer.from([0xc0, 0xaf]), // overlong "/"
    Buffer.from([0xed, 0xa0, 0x80]), // an encoded surrogate
    Buffer.from([0xe2, 0x82]), // truncated sequence
  ]) {
    const at = ok.indexOf('pad-echo');
    assert.equal(reasonFor(Buffer.concat([ok.subarray(0, at), bad, ok.subarray(at)])), 'not-utf8');
  }
});

test('symlinks are never followed', () => {
  // results.json pointing at a valid file elsewhere: rejected, not read.
  const elsewhere = path.join(SCRATCH, 'elsewhere.json');
  writeFileSync(elsewhere, JSON.stringify(VALID));
  const dir = outDir();
  symlinkSync(elsewhere, path.join(dir, RESULTS_FILE));
  rejected(summarize(dir), 'not-regular-file');
  // A dangling link, and a link to /etc/passwd.
  const d2 = outDir();
  symlinkSync('/nonexistent', path.join(d2, RESULTS_FILE));
  rejected(summarize(d2), 'not-regular-file');
  const d3 = outDir();
  symlinkSync('/etc/passwd', path.join(d3, RESULTS_FILE));
  rejected(summarize(d3), 'not-regular-file');
  // The output directory itself as a symlink to a directory with a valid file.
  const real = outDir(VALID);
  const link = path.join(SCRATCH, `out-link-${dirCount++}`);
  symlinkSync(real, link);
  rejected(summarize(link), 'bad-directory');
});

test('FIFOs, directories and devices are rejected without blocking', () => {
  const d1 = outDir();
  const mk = spawnSync('mkfifo', [path.join(d1, RESULTS_FILE)]);
  assert.equal(mk.status, 0, 'mkfifo is needed for this test');
  rejected(summarize(d1), 'not-regular-file');
  const d2 = outDir();
  mkdirSync(path.join(d2, RESULTS_FILE));
  rejected(summarize(d2), 'not-regular-file');
  const d3 = outDir();
  symlinkSync('/dev/zero', path.join(d3, RESULTS_FILE));
  rejected(summarize(d3), 'not-regular-file');
});

test('an unreadable results file or directory is rejected', () => {
  if (process.getuid() !== 0) {
    const dir = outDir(VALID);
    spawnSync('chmod', ['000', path.join(dir, RESULTS_FILE)]);
    rejected(summarize(dir), 'unreadable');
    return;
  }
  // Root can read anything, so run the CLI as uid 65534 (the sandbox's user)
  // from a world-readable copy in a fresh 0755 directory.
  const base = mkdtempSync(path.join(os.tmpdir(), 'ff7-validate-uid-'));
  try {
    chmodSync(base, 0o755);
    const cli = path.join(base, 'validate.js');
    copyFileSync(CLI, cli);
    writeFileSync(path.join(base, 'package.json'), '{"type":"module"}');
    writeFileSync(path.join(base, 'expect.json'), JSON.stringify(EXPECT));
    const fileDir = path.join(base, 'a');
    mkdirSync(fileDir, { mode: 0o755 });
    writeFileSync(path.join(fileDir, RESULTS_FILE), JSON.stringify(VALID), { mode: 0o000 });
    chmodSync(path.join(fileDir, RESULTS_FILE), 0o000);
    const lockedDir = path.join(base, 'b');
    mkdirSync(lockedDir, { mode: 0o700 });
    writeFileSync(path.join(lockedDir, RESULTS_FILE), JSON.stringify(VALID));
    for (const dir of [fileDir, lockedDir]) {
      const r = spawnSync(process.execPath, [cli, '--out', dir, '--expect', path.join(base, 'expect.json')], {
        encoding: 'utf8', uid: 65534, gid: 65534,
      });
      assert.equal(r.status, 0, r.stderr);
      rejected(JSON.parse(r.stdout), 'unreadable');
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('more scenarios than the cap are rejected', () => {
  const scenarios = Array.from({ length: MAX_SCENARIOS + 1 }, (_, i) => ({ name: `s${i}`, status: 'pass' }));
  assert.equal(reasonFor({ format: 1, scenarios }), 'too-many-scenarios');
  // Exactly the cap is fine when all are expected.
  const full = { format: 1, scenarios: scenarios.slice(0, MAX_SCENARIOS) };
  const s = summarize(outDir(full), null, expectFrom(full));
  assert.equal(s.output, 'accepted');
  assert.equal(s.ok, true);
});

// --- Size bound --------------------------------------------------------------

test(`the largest possible summary is under SUMMARY_MAX_BYTES (${SUMMARY_MAX_BYTES})`, () => {
  const metrics = {};
  for (let i = 0; i < MAX_METRICS; i++) metrics[`m${String(i).repeat(31)}`.slice(0, 32)] = -MAX_INT;
  const scenarios = Array.from({ length: MAX_SCENARIOS }, (_, i) => ({
    name: `${String(i).padStart(2, '0')}${'x'.repeat(62)}`,
    status: 'error',
    metrics,
  }));
  const doc = { format: 1, scenarios };
  const text = JSON.stringify(doc);
  assert.ok(Buffer.byteLength(text) <= MAX_FILE_BYTES, 'the worst case fits in the input cap');
  const s = summarize(outDir(text), { limits_hit: LIMIT_NAMES }, expectFrom(doc));
  assert.equal(s.output, 'accepted', s.reason);
  const size = Buffer.byteLength(JSON.stringify(s));
  assert.ok(size <= SUMMARY_MAX_BYTES, `summary is ${size} bytes`);
  // Floats: the longest one is no longer than -4294967296.
  assert.ok(String(-999999.999).length <= String(-MAX_INT).length);
});

test('the information bound: at most about 18 kbit per run, all of it numbers and statuses', () => {
  // 18 kbit since #109 (owner decision, 2026-11-06): MAX_SCENARIOS went from 32 to 64,
  // which doubles the bound (it was about 9 kbit). docs/SECURITY.md states the accepted risk.
  // What a hostile program controls, given --expect: for each expected
  // scenario, whether it reports and its status (4 outcomes); for each
  // expected key, whether it's present and its value. Integers within
  // +-MAX_INT and floats with 3 decimals within +-MAX_FLOAT. Plus the
  // rejection reasons as alternative outcomes. Names, keys and order are
  // fixed in advance, so they carry nothing.
  const values = 2 * MAX_INT + 1 + 2 * MAX_FLOAT * 1000 + 1;
  const perMetric = Math.log2(values + 1); // +1: absent
  const perScenario = Math.log2(1 + STATUSES.length) + MAX_METRICS * perMetric;
  const bits = MAX_SCENARIOS * perScenario + Math.log2(REASONS.length + 1);
  assert.ok(bits < 18000, `bound is ${Math.round(bits)} bits`);
});

// --- Fuzz ----------------------------------------------------------------------

/** Deterministic PRNG (mulberry32), so a failure can be reproduced from its seed. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOSTILE_VALUES = [
  'x'.repeat(70000), 'PAYLOAD', '', null, true, [], {}, [[[[[[[[1]]]]]]]], 0.123456789, 1e308, -1e308, 2 ** 53 + 1,
  4294967297, 999999.9999, '\u0000', '\ud800', 'pass', 'fail', 'a', 'Z', 1, -1, 0, 59.94,
];
const FUZZ_BYTES = ['{', '}', '[', ']', '"', '\\', ':', ',', '0', '9', '.', 'e', '-', 'n', ' '];

const FUZZ_EXPECT = {
  format: 1,
  scenarios: {
    ...EXPECT.scenarios,
    ...Object.fromEntries(Array.from({ length: MAX_SCENARIOS - Object.keys(EXPECT.scenarios).length }, (_, i) => [`s${i}`, ['x', 'frames']])),
  },
};

function mutate(r) {
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  if (r() < 0.5) {
    // Structural: set a random field to a hostile value.
    const d = structuredClone(VALID);
    const n = 1 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const first = Array.isArray(d.scenarios) ? d.scenarios[0] : undefined;
      const target = pick([d, d.scenarios, (Array.isArray(d.scenarios) && pick(d.scenarios)) || d, first?.metrics]);
      const key = pick(['format', 'scenarios', 'name', 'status', 'metrics', 'x', 'frames', '__proto__', 0, 1, 40]);
      if (target && typeof target === 'object') target[key] = pick(HOSTILE_VALUES);
    }
    if (r() < 0.2) d.scenarios = Array.from({ length: Math.floor(r() * 80) }, (_, i) => ({ name: `s${i % 40}`, status: pick(STATUSES) }));
    return Buffer.from(JSON.stringify(d) ?? '');
  }
  // Textual: corrupt the bytes of a valid document.
  const buf = [...Buffer.from(JSON.stringify(VALID))];
  const n = 1 + Math.floor(r() * 6);
  for (let i = 0; i < n; i++) {
    const at = Math.floor(r() * buf.length);
    const op = r();
    if (op < 0.3) buf.splice(at, 1);
    else if (op < 0.6) buf.splice(at, 0, pick(FUZZ_BYTES).charCodeAt(0));
    else if (op < 0.8) buf[at] = Math.floor(r() * 256);
    else buf.splice(at, 0, ...buf.slice(at, at + Math.floor(r() * 40)));
  }
  return Buffer.from(buf);
}

/** Every string in a summary is fixed vocabulary, or a name or key listed in `expect`; order is sorted. */
function assertSummaryShape(s, expect) {
  assert.deepEqual(Object.keys(s), ['format', 'ok', 'output', 'reason', 'limits_hit', 'counts', 'scenarios']);
  assert.equal(s.format, 1);
  assert.equal(typeof s.ok, 'boolean');
  assert.ok(['accepted', 'rejected'].includes(s.output));
  assert.ok(s.reason === null || REASONS.includes(s.reason));
  assert.ok(s.limits_hit.every((l) => LIMIT_NAMES.includes(l)));
  assert.deepEqual(Object.keys(s.counts), [...STATUSES, 'missing']);
  assert.ok(s.scenarios.length <= MAX_SCENARIOS);
  const names = s.scenarios.map((sc) => sc.name);
  assert.deepEqual(names, [...names].sort());
  for (const sc of s.scenarios) {
    assert.ok(Object.hasOwn(expect.scenarios, sc.name) && STATUSES.includes(sc.status));
    const keys = Object.keys(sc.metrics ?? {});
    assert.deepEqual(keys, [...keys].sort());
    for (const k of keys) assert.ok(expect.scenarios[sc.name].includes(k) && Number.isFinite(sc.metrics[k]));
  }
  assert.ok(Buffer.byteLength(JSON.stringify(s)) <= SUMMARY_MAX_BYTES);
}

test('fuzz: hostile variations never throw, emit only expected text, and agree with the schema', () => {
  const seed = 0x34;
  const r = rng(seed);
  const tally = { accepted: 0 };
  for (let i = 0; i < 3000; i++) {
    const bytes = mutate(r);
    const dir = outDir(bytes);
    let s;
    try {
      s = summarize(dir, null, FUZZ_EXPECT);
      assertSummaryShape(s, FUZZ_EXPECT);
    } catch (e) {
      throw new Error(`seed ${seed}, iteration ${i}: ${e.message}\ninput: ${bytes.toString('latin1').slice(0, 300)}`);
    }
    tally[s.output === 'accepted' ? 'accepted' : s.reason] = (tally[s.output === 'accepted' ? 'accepted' : s.reason] ?? 0) + 1;
    assert.ok(!JSON.stringify(s).includes('PAYLOAD'));
    // Agreement with the documented schema: whatever the validator accepts
    // is schema-valid, and whatever the schema rejects the validator rejects.
    let doc;
    try {
      doc = JSON.parse(bytes.toString('utf8'));
    } catch {
      continue;
    }
    const schemaErrors = validate(SCHEMA, doc);
    if (s.output === 'accepted') assert.deepEqual(schemaErrors, [], `iteration ${i}`);
    if (schemaErrors.length) assert.equal(s.output, 'rejected', `iteration ${i}: schema errors ${schemaErrors[0]}`);
    rmSync(dir, { recursive: true });
  }
  // The fuzzer must exercise both sides.
  assert.ok(tally.accepted > 50, JSON.stringify(tally));
  assert.ok(tally.schema > 50 && tally['not-json'] > 50, JSON.stringify(tally));
});

test('checkResults agrees with the schema on the hand-written cases', () => {
  assert.deepEqual(validate(SCHEMA, VALID), []);
  assert.equal(checkResults(Buffer.from(JSON.stringify(VALID)), loadExpect(EXPECT)).length, 3);
});

// --- CLI -----------------------------------------------------------------------

test('CLI: prints exactly one summary line', () => {
  const dir = outDir(VALID);
  const report = path.join(SCRATCH, 'report.json');
  writeFileSync(report, JSON.stringify({ format: 1, exit_code: 0, limits_hit: ['pids'] }));
  const expect = path.join(SCRATCH, 'expect.json');
  writeFileSync(expect, JSON.stringify(EXPECT));
  const r = spawnSync(process.execPath, [CLI, '--out', dir, '--expect', expect, '--sandbox-report', report], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim().split('\n').length, 1);
  const s = JSON.parse(r.stdout);
  assertSummaryShape(s, EXPECT);
  assert.deepEqual(s.limits_hit, ['pids']);
  // Usage errors: no --expect, or no --out.
  assert.equal(spawnSync(process.execPath, [CLI, '--out', dir], { encoding: 'utf8' }).status, 2);
  assert.equal(spawnSync(process.execPath, [CLI], { encoding: 'utf8' }).status, 2);
  // A malformed report or expect file is never quoted back.
  const bad = path.join(SCRATCH, 'bad.json');
  writeFileSync(bad, '{"limits_hit": SECRETQUOTE');
  for (const flag of ['--sandbox-report', '--expect']) {
    const args = flag === '--expect' ? ['--expect', bad] : ['--expect', expect, '--sandbox-report', bad];
    const e = spawnSync(process.execPath, [CLI, '--out', dir, ...args], { encoding: 'utf8' });
    assert.equal(e.status, 2);
    assert.ok(!e.stderr.includes('SECRETQUOTE') && !e.stdout.includes('SECRETQUOTE'), `${flag} error quoted the file`);
  }
});
