// Track checks (#216): a bounded search for bytes that follow a known
// sequence of small values at mark steps. Schema, loader, the narrowing
// functions, and playScript's mark hook on a fake backend. No core needed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { playScript, trackMatches, trackNarrow } from '../../format2.js';
import { validate } from '../../schema.js';
import { SCHEMA_PATH, loadScenario } from '../../scenario.js';

const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));

const base = () => ({
  format: 2,
  name: 'trk',
  tier: 1,
  boot: { fixture: 'pad-echo', from: 'pad-echo-ready' },
  memory: { counter: { addr: '0x800f0000', type: 'u32' } },
  input: [
    { wait: { until: { mem: 'counter', equals: 40 }, timeout: 60 } },
    { mark: 'a' },
    { wait: { until: { mem: 'counter', equals: 50 }, timeout: 60 } },
    { mark: 'b' },
    { wait: { until: { mem: 'counter', equals: 60 }, timeout: 60 } },
    { mark: 'c' },
  ],
  assert: [{ track: { from: '0x800f0000', bytes: 16, marks: ['a', 'b', 'c'], values: [40, 50, 60], found: ['at1', 'at2'] }, metric: 'n' }],
  metrics: ['n', 'at1', 'at2'],
});
const clone = (o) => structuredClone(o);

describe('track checks: schema and loader (#216)', () => {
  test('a well-formed check loads', () => {
    const d = base();
    assert.deepEqual(validate(schema, d), []);
    const sc = loadScenario(d);
    assert.deepEqual(sc.asserts[0], { kind: 'track', from: 0x800f0000, bytes: 16, marks: ['a', 'b', 'c'], values: [40, 50, 60], found: ['at1', 'at2'], metric: 'n' });
  });

  test('found is optional; metric is required', () => {
    const d = base();
    delete d.assert[0].track.found;
    d.metrics = ['n'];
    assert.deepEqual(loadScenario(d).asserts[0].found, []);
    const noMetric = base();
    delete noMetric.assert[0].metric;
    assert.notDeepEqual(validate(schema, noMetric), []);
  });

  test('the schema bounds the search', () => {
    const cases = {
      'too many bytes': (t) => (t.bytes = 262145),
      'zero bytes': (t) => (t.bytes = 0),
      'two marks': (t) => ((t.marks = ['a', 'b']), (t.values = [1, 2])),
      'a value over 63': (t) => (t.values = [1, 2, 64]),
      'a negative value': (t) => (t.values = [1, 2, -1]),
      'five found': (t) => (t.found = ['a1', 'a2', 'a3', 'a4', 'a5']),
      'an extra key': (t) => (t.size = 'u16'),
    };
    for (const [what, edit] of Object.entries(cases)) {
      const d = base();
      edit(d.assert[0].track);
      assert.notDeepEqual(validate(schema, d), [], what);
    }
  });

  test('the loader refuses what the schema cannot express', () => {
    const cases = [
      [(t) => (t.values = [40, 50, 60, 1]), /one number per mark/],
      [(t) => (t.values = [7, 7, 7]), /at least two different numbers/],
      [(t) => (t.marks = ['a', 'b', 'z']), /no mark step named "z"/],
      [(t) => (t.marks = ['a', 'b', 'a']), /named twice/],
      [(t) => (t.from = '0x801ffff8'), /runs past the end of RAM/],
      [(t) => (t.from = '0x1f800000'), /not a main-RAM address/],
    ];
    for (const [edit, re] of cases) {
      const d = base();
      edit(d.assert[0].track);
      assert.throws(() => loadScenario(d), re);
    }
  });

  test('found names are metrics: listed, and not named twice', () => {
    const unlisted = base();
    unlisted.metrics = ['n', 'at1'];
    assert.throws(() => loadScenario(unlisted), /"at2" is not listed in metrics/);
    const twice = base();
    twice.assert[0].track.found = ['n', 'at1'];
    twice.metrics = ['n', 'at1'];
    assert.throws(() => loadScenario(twice), /already named/);
  });
});

describe('track checks: narrowing (#216)', () => {
  test('only offsets that read each mark\'s value stay', () => {
    let cand = trackNarrow(null, Uint8Array.of(0, 0, 5, 0, 1), 0);
    assert.deepEqual([...cand], [1, 1, 0, 1, 0]);
    cand = trackNarrow(cand, Uint8Array.of(1, 0, 1, 1, 1), 1);
    assert.deepEqual([...cand], [1, 0, 0, 1, 0]);
    cand = trackNarrow(cand, Uint8Array.of(2, 2, 2, 9, 2), 2);
    assert.deepEqual([...cand], [1, 0, 0, 0, 0]);
    assert.deepEqual(trackMatches(cand, 4), { count: 1, first: [0] });
  });

  test('matches: the count, and the first n offsets in order', () => {
    const cand = Uint8Array.of(0, 1, 1, 0, 1, 1, 1);
    assert.deepEqual(trackMatches(cand, 2), { count: 5, first: [1, 2] });
    assert.deepEqual(trackMatches(cand, 0), { count: 5, first: [] });
    assert.deepEqual(trackMatches(null, 3), { count: 0, first: [] });
  });

  test('playScript calls the mark hook at each mark, after the frames before it', () => {
    // A fake backend: one RAM byte at 0x80000010 counts frames, one at
    // 0x80000011 counts them down from 200; the rest stays 0.
    const ram = new Uint8Array(0x20);
    const b = {
      setPad() {},
      stepFrame() {
        ram[0x10] += 1;
        ram[0x11] = 200 - ram[0x10];
      },
      readMem: (a, n) => ram.slice((a & 0x1fffff), (a & 0x1fffff) + n),
    };
    const steps = [
      { kind: 'wait', frames: 2 },
      { kind: 'mark', name: 'a', index: 1 },
      { kind: 'wait', frames: 3 },
      { kind: 'mark', name: 'b', index: 3 },
      { kind: 'wait', frames: 1 },
      { kind: 'mark', name: 'c', index: 5 },
    ];
    const marks = ['a', 'b', 'c'];
    const values = [2, 5, 6];
    let cand = null;
    const seen = [];
    playScript(b, steps, {}, (mark, backend) => {
      seen.push(mark);
      cand = trackNarrow(cand, backend.readMem(0x80000000, 0x20), values[marks.indexOf(mark)]);
    });
    assert.deepEqual(seen, marks);
    assert.deepEqual(trackMatches(cand, 4), { count: 1, first: [0x10] });
  });
});
