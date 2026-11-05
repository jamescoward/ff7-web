// Chained snapshots and input segments (#74): schema, loader checks, segment
// expansion, still waits and presses during waits (on a fake backend), chain
// checks, and tier2.js's hand-over framing. No core build needed.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkChain, playScript, runScenario2 } from '../../format2.js';
import { padMask } from '../../pad.js';
import { validate } from '../../schema.js';
import { SCHEMA_PATH, ScenarioError, loadScenario } from '../../scenario.js';
import { MAX_EXPANDED_STEPS, expandSegments, segmentsDirFor } from '../../segments.js';
import { findTier2Scenarios, parseChild } from '../../tier2.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCENARIOS = path.resolve(HERE, '../../../harness/scenarios');
const SEGMENTS = path.join(SCENARIOS, 'segments');
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const segmentSchema = (() => {
  const { oneOf: _o, type: _t, ...rest } = schema;
  return { ...rest, $ref: '#/$defs/segment' };
})();

const tmp = [];
after(() => tmp.forEach((d) => rmSync(d, { recursive: true, force: true })));
/** A temp segments directory holding { name: steps | doc }. */
function segDir(segs) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ff7-seg-'));
  tmp.push(dir);
  for (const [name, v] of Object.entries(segs)) {
    const doc = Array.isArray(v) ? { name, steps: v } : v;
    writeFileSync(path.join(dir, `${name}.json`), typeof doc === 'string' ? doc : JSON.stringify(doc));
  }
  return dir;
}

const memory = {
  counter: { addr: '0x800f0000', type: 'u32' },
  buttons: { addr: '0x800f0008', type: 'u16' },
};
/** A keeps "pe-a"; B starts from it. */
const docA = () => ({
  format: 2,
  name: 'chain-a',
  tier: 1,
  boot: { fixture: 'pad-echo', from: 'pad-echo-ready' },
  memory,
  input: [
    { segment: 'sa' },
    { wait: { stillFrames: 5, timeout: 50, press: { buttons: ['cross'], every: 10, hold: 2 } }, metric: 'still' },
  ],
  assert: [{ sameState: 'rerun' }],
  snapshot: 'pe-a',
  metrics: ['still'],
});
const docB = () => ({
  format: 2,
  name: 'chain-b',
  tier: 1,
  boot: { from: 'pe-a' },
  memory,
  input: [{ wait: { until: { mem: 'buttons', equals: '0xbfff' }, timeout: 20, press: { buttons: ['cross'], every: 5 } }, metric: 'pressed' }],
  assert: [{ sameState: 'boot', metric: 'same' }],
  metrics: ['pressed', 'same', 'snapshot_frames'],
});
const SA = [{ wait: { frames: 3 } }, { buttons: ['circle'], frames: 2 }];

describe('schema: snapshot, boot.from a snapshot, segments, still waits, presses', () => {
  test('valid forms', () => {
    assert.deepEqual(validate(schema, docA()), []);
    assert.deepEqual(validate(schema, docB()), []);
    assert.deepEqual(validate(segmentSchema, { name: 'x', steps: [{ segment: 'y' }, ...SA] }), []);
  });

  const invalid = {
    'snapshot name with capitals': (d) => { d.snapshot = 'PE'; },
    'snapshot as an object': (d) => { d.snapshot = { name: 'pe' }; },
    'boot from a snapshot with another key': (d) => { d.boot = { from: 'pe-a', frames: 3 }; },
    'boot with only a source': (d) => { d.boot = { fixture: 'pad-echo' }; },
    'empty boot': (d) => { d.boot = {}; },
    'segment name with a slash': (d) => { d.input[0].segment = '../x'; },
    'segment with another key': (d) => { d.input[0].frames = 3; },
    'still wait without timeout': (d) => { delete d.input[1].wait.timeout; },
    'stillFrames of 1': (d) => { d.input[1].wait.stillFrames = 1; },
    'still wait with until too': (d) => { d.input[1].wait.until = { mem: 'counter', equals: 1 }; },
    'still wait with frames too': (d) => { d.input[1].wait.frames = 3; },
    'press without every': (d) => { delete d.input[1].wait.press.every; },
    'press every 1 frame': (d) => { d.input[1].wait.press.every = 1; },
    'press with no buttons': (d) => { d.input[1].wait.press.buttons = []; },
    'press on a fixed wait': (d) => { d.input.push({ wait: { frames: 3, press: { buttons: ['cross'], every: 4 } } }); },
    'press with an unknown key': (d) => { d.input[1].wait.press.frames = 2; },
  };
  for (const [name, mutate] of Object.entries(invalid)) {
    test(`rejects: ${name}`, () => {
      const d = docA();
      mutate(d);
      assert.notDeepEqual(validate(schema, d), []);
      assert.throws(() => loadScenario(d, { segmentsDir: segDir({ sa: SA }) }), ScenarioError);
    });
  }

  const badSegments = {
    'no steps': { name: 'x', steps: [] },
    'no name': { steps: SA },
    'a format 1 step': { name: 'x', steps: [{ from: 1, buttons: ['cross'] }] },
    'an unknown key': { name: 'x', steps: SA, tier: 2 },
  };
  for (const [name, doc] of Object.entries(badSegments)) {
    test(`segment schema rejects: ${name}`, () => assert.notDeepEqual(validate(segmentSchema, doc), []));
  }
});

describe('loader: named snapshots', () => {
  const dir = () => segDir({ sa: SA });
  test('normalises a chain link', () => {
    const a = loadScenario(docA(), { segmentsDir: dir() });
    assert.equal(a.snapshotName, 'pe-a');
    assert.equal(a.fromSnapshot, null);
    assert.equal(a.bootPoint.name, 'pad-echo-ready');
    assert.deepEqual(a.steps.map((s) => s.kind), ['wait', 'press', 'still']);
    assert.deepEqual(a.steps[2].press, { mask: padMask(['cross']), port: 0, every: 10, hold: 2 });
    const b = loadScenario(docB());
    assert.equal(b.fromSnapshot, 'pe-a');
    assert.equal(b.bootPoint, null);
    assert.equal(b.fixture, null);
    assert.equal(b.disc, null);
    assert.equal(b.steps[0].press.hold, 1, 'hold defaults to 1');
  });

  const rejects = {
    'from a boot point with no source': [(d) => { d.boot = { from: 'title' }; }, /"title" is a boot point.*disc: 1, from: "title"/],
    'from power-on with no source': [(d) => { d.boot = { from: 'power-on' }; }, /"power-on" can't name a snapshot/],
    'a snapshot named like a boot point': [(d) => { d.snapshot = 'pad-echo-ready'; }, /is a boot point, not a snapshot/],
    'a snapshot named power-on': [(d) => { d.snapshot = 'power-on'; }, /can't name a snapshot/],
    'press hold not less than every': [(d) => { d.input[1].wait.press.hold = 10; }, /hold \(10\) must be less than every \(10\)/],
    'still metric not listed': [(d) => { d.metrics = []; }, /not listed in metrics/],
  };
  for (const [name, [mutate, re]] of Object.entries(rejects)) {
    test(`rejects: ${name}`, () => {
      const d = docA();
      mutate(d);
      assert.throws(() => loadScenario(d, { segmentsDir: dir() }), (e) => e instanceof ScenarioError && re.test(e.message), name);
    });
  }

  test('a snapshot that is the one the scenario starts from', () => {
    const d = docB();
    d.snapshot = 'pe-a';
    assert.throws(() => loadScenario(d), /is the snapshot this scenario starts from/);
  });

  test('"from" naming an unknown snapshot loads, and fails before running with "no snapshot"', async () => {
    const d = docB();
    d.boot.from = 'nowhere';
    const sc = loadScenario(d);
    await assert.rejects(runScenario2(sc), (e) => e instanceof ScenarioError && /^no snapshot: "nowhere"/.test(e.message));
  });

  test('checkChain: the chain must lead to the snapshot', () => {
    const segs = dir();
    const a = loadScenario(docA(), { segmentsDir: segs });
    const b = loadScenario(docB());
    assert.doesNotThrow(() => checkChain(b, [a]));
    assert.throws(() => checkChain(b, []), /no chain/);
    assert.throws(() => checkChain(b, [b]), /starts from another snapshot/);
    const other = loadScenario({ ...docA(), snapshot: 'other' }, { segmentsDir: segs });
    assert.throws(() => checkChain(b, [other]), /does not keep it/);
    const c = loadScenario({ ...docB(), name: 'chain-c', boot: { from: 'other' }, snapshot: 'pe-a' });
    assert.throws(() => checkChain(b, [a, c]), /does not start from what "chain-a" kept/);
  });
});

describe('segments', () => {
  const opts = (dir) => ({ dir, schema });
  test('expanded in place, recursively, and the same segment may appear twice', () => {
    const dir = segDir({ outer: [{ segment: 'inner' }, { wait: { frames: 9 } }, { segment: 'inner' }], inner: SA });
    const steps = expandSegments([{ buttons: ['up'] }, { segment: 'outer' }], opts(dir));
    assert.deepEqual(steps, [{ buttons: ['up'] }, ...SA, { wait: { frames: 9 } }, ...SA]);
  });

  test('a scenario with segments loads like the same scenario written out', () => {
    const dir = segDir({ sa: SA });
    const a = loadScenario(docA(), { segmentsDir: dir });
    const flat = docA();
    flat.input = [...SA, flat.input[1]];
    assert.deepEqual(a, loadScenario(flat));
  });

  const errors = {
    'a missing segment': [{}, [{ segment: 'nope' }], /no segment named "nope"/],
    'a missing nested segment': [{ a: [{ segment: 'nope' }] }, [{ segment: 'a' }], /no segment named "nope"/],
    'direct recursion': [{ a: [{ segment: 'a' }] }, [{ segment: 'a' }], /segment recursion: a -> a/],
    'indirect recursion': [{ a: [{ segment: 'b' }], b: [{ wait: { frames: 1 } }, { segment: 'a' }] }, [{ segment: 'a' }], /segment recursion: a -> b -> a/],
    'a segment that fails the schema': [{ a: { name: 'a', steps: [{ wait: {} }] } }, [{ segment: 'a' }], /segment "a" does not match the schema/],
    'a segment whose name is not its file name': [{ a: { name: 'b', steps: SA } }, [{ segment: 'a' }], /its name is "b"/],
    'a segment that is not JSON': [{ a: '{ nope' }, [{ segment: 'a' }], /segment "a":/],
  };
  for (const [name, [segs, steps, re]] of Object.entries(errors)) {
    test(`load error: ${name}`, () => {
      assert.throws(() => expandSegments(steps, opts(segDir(segs))), (e) => e instanceof ScenarioError && re.test(e.message), name);
    });
  }

  test('load error: a missing segment, through loadScenario', () => {
    assert.throws(() => loadScenario(docA(), { segmentsDir: segDir({}) }), /no segment named "sa"/);
  });

  test('load error: a segment directory entry that is not a file', () => {
    const dir = segDir({});
    mkdirSync(path.join(dir, 'a.json'));
    assert.throws(() => expandSegments([{ segment: 'a' }], opts(dir)), /segment "a": not a regular file/);
  });

  test(`load error: more than ${MAX_EXPANDED_STEPS} steps once expanded`, () => {
    const times = (n, step) => Array.from({ length: n }, () => step);
    const dir = segDir({
      s16: times(16, { wait: { frames: 1 } }),
      s256: times(16, { segment: 's16' }),
      big: times(16, { segment: 's256' }),
      four: times(4, { segment: 'big' }),
    });
    assert.equal(expandSegments([{ segment: 'four' }], opts(dir)).length, MAX_EXPANDED_STEPS);
    assert.throws(() => expandSegments([{ segment: 'four' }, { wait: { frames: 1 } }], opts(dir)), /more than 16384 steps/);
  });

  test('segments/ beside the scenario file', () => {
    assert.equal(segmentsDirFor(path.join(SCENARIOS, 'x.json')), SEGMENTS);
  });

  test('every committed segment matches the schema and its file name', () => {
    const files = readdirSync(SEGMENTS).filter((f) => f.endsWith('.json'));
    assert.ok(files.length >= 2);
    for (const f of files) {
      const doc = JSON.parse(readFileSync(path.join(SEGMENTS, f), 'utf8'));
      assert.deepEqual(validate(segmentSchema, doc), [], f);
      assert.equal(`${doc.name}.json`, f);
      assert.doesNotThrow(() => expandSegments([{ segment: doc.name }], opts(SEGMENTS)), f);
    }
  });

  test('the committed chain: the scenario that keeps reactor-entrance comes first in the run, and both load', () => {
    const found = findTier2Scenarios(SCENARIOS);
    const keep = found.findIndex((s) => s.snapshot === 'reactor-entrance');
    const use = found.findIndex((s) => s.after === 'reactor-entrance');
    assert.ok(keep >= 0 && use > keep, JSON.stringify(found.map((s) => [s.name, s.after, s.snapshot])));
    for (const s of [found[keep], found[use]]) {
      assert.doesNotThrow(() => loadScenario(JSON.parse(readFileSync(s.file, 'utf8')), { allowTier2: true }), s.name);
    }
    assert.equal(found[keep].from, 'title');
  });
});

/** A fake backend: pictures[i] is the hash after frame i+1 ('u…' is a one-colour picture). */
function fakeBackend(pictures) {
  const pads = [];
  let n = 0;
  let pad = [0, 0];
  return {
    pads,
    setPad(mask, port) {
      pad[port] = mask;
    },
    stepFrame() {
      pads.push([...pad]);
      pad = [0, 0];
      n += 1;
    },
    frameHash: () => pictures[Math.min(n, pictures.length) - 1],
    frameIsUniform: () => pictures[Math.min(n, pictures.length) - 1].startsWith('u'),
    readMem: () => new Uint8Array(4),
  };
}
const still = (stillFrames, timeout, press = null) => ({ kind: 'still', stillFrames, timeout, press, index: 0 });

describe('still waits and presses during waits (fake backend)', () => {
  test('waits until the picture has stayed the same for stillFrames frames; metric is the frames waited', () => {
    const b = fakeBackend(['a', 'b', 'c', 'c', 'c', 'c']);
    const s = still(3, 10);
    const r = playScript(b, [s], {});
    assert.equal(r.timedOut, false);
    assert.equal(r.waits.get(s), 5, 'c from frame 3, three in a row at frame 5');
    assert.equal(r.frames, 5);
  });

  test('a one-colour picture never counts, however long it lasts', () => {
    const b = fakeBackend(['u0', 'u0', 'u0', 'u0', 'u0', 'x', 'x', 'x']);
    const s = still(3, 20);
    const r = playScript(b, [s], {});
    assert.equal(r.waits.get(s), 8);
  });

  test('a timeout returns 0 and stops the script', () => {
    const b = fakeBackend(['a', 'b', 'a', 'b', 'a', 'b']);
    const s = still(2, 6);
    const r = playScript(b, [s, { kind: 'wait', frames: 100 }], {});
    assert.equal(r.timedOut, true);
    assert.equal(r.waits.get(s), 0);
    assert.equal(r.frames, 6);
  });

  test('a press holds its buttons for `hold` frames at the start of every `every` frames, on its port', () => {
    const mask = padMask(['circle']);
    const b = fakeBackend(Array.from({ length: 12 }, (_, i) => `p${i}`));
    playScript(b, [still(2, 12, { mask, port: 1, every: 5, hold: 2 })], {});
    const held = b.pads.map(([p0, p1]) => (p0 ? 'x' : p1 === mask ? '1' : '.')).join('');
    assert.equal(held, '11...11...11');
  });

  test('an until wait presses too, and stops pressing when its condition holds', () => {
    const mask = padMask(['cross']);
    const b = fakeBackend(['a']);
    let reads = 0;
    b.readMem = () => Uint8Array.of(++reads >= 4 ? 1 : 0, 0, 0, 0);
    const loc = { addr: 0, len: 1, type: 'u8' };
    const s = { kind: 'until', cond: { mem: 'm', op: 'equals', value: 1 }, timeout: 10, press: { mask, port: 0, every: 3, hold: 1 }, index: 0 };
    const r = playScript(b, [s], { m: loc });
    assert.equal(r.waits.get(s), 4);
    assert.deepEqual(b.pads.map(([p]) => (p ? 1 : 0)), [1, 0, 0, 1]);
  });
});

describe('tier2.js: a child\'s result line and kept snapshot', () => {
  const out = (head, body = Buffer.alloc(0)) => Buffer.concat([Buffer.from(`${JSON.stringify(head)}\n`), body]);
  test('a result line alone', () => {
    assert.deepEqual(parseChild(out({ status: 'pass', metrics: { a: 1 } })), { line: { status: 'pass', metrics: { a: 1 } }, snapshot: null });
  });
  test('a result line and its snapshot', () => {
    const r = parseChild(out({ status: 'pass', snapshot: { frames: 40, boot_ms: 3.5, bytes: 3 } }, Buffer.from([7, 8, 9])));
    assert.deepEqual(r.line, { status: 'pass' });
    assert.deepEqual([...r.snapshot.bytes], [7, 8, 9]);
    assert.equal(r.snapshot.frames, 40);
    assert.equal(r.snapshot.bootMs, 3.5);
  });
  const bad = {
    'bytes after a line with no snapshot': out({ status: 'pass' }, Buffer.from([1])),
    'a short snapshot': out({ status: 'pass', snapshot: { frames: 1, boot_ms: 1, bytes: 4 } }, Buffer.alloc(3)),
    'a long snapshot': out({ status: 'pass', snapshot: { frames: 1, boot_ms: 1, bytes: 2 } }, Buffer.alloc(3)),
    'snapshot frames 0': out({ status: 'pass', snapshot: { frames: 0, boot_ms: 1, bytes: 1 } }, Buffer.alloc(1)),
    'negative boot_ms': out({ status: 'pass', snapshot: { frames: 1, boot_ms: -1, bytes: 1 } }, Buffer.alloc(1)),
    'not JSON': Buffer.from('nope\n'),
    'no newline': Buffer.from('{"status":"pass"}'),
    'an array': Buffer.from('[]\n'),
    'a string': 'x',
  };
  for (const [name, buf] of Object.entries(bad)) {
    test(`refuses: ${name}`, () => assert.deepEqual(parseChild(buf), { line: null, snapshot: null }));
  }

  test('findTier2Scenarios: the snapshot a scenario keeps and the one it starts from', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ff7-chain-find-'));
    tmp.push(dir);
    writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ ...docA(), name: 'a', tier: 2 }));
    writeFileSync(path.join(dir, 'b.json'), JSON.stringify({ ...docB(), name: 'b', tier: 2 }));
    writeFileSync(path.join(dir, 'c.json'), JSON.stringify({ ...docB(), name: 'c', tier: 2, boot: { fixture: 'pad-echo', from: 'power-on' }, snapshot: 'Bad' }));
    mkdirSync(path.join(dir, 'segments'));
    writeFileSync(path.join(dir, 'segments', 'sa.json'), JSON.stringify({ name: 'sa', steps: SA }));
    assert.deepEqual(findTier2Scenarios(dir).map((s) => [s.name, s.from, s.after, s.snapshot]), [
      ['a', 'pad-echo-ready', null, 'pe-a'],
      ['b', null, 'pe-a', null],
      ['c', null, null, null],
    ]);
  });
});
