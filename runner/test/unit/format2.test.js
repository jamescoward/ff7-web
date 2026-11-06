// Scenario format 2 (#37): schema, loader checks, boot points, conditions,
// and tier2.js's snapshot hand-over. No core build needed.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { BOOT_POINTS, scriptFrames } from '../../bootpoints.js';
import { BUILTIN_METRICS_2, conditionHolds, loadBootPoint } from '../../format2.js';
import { validate } from '../../schema.js';
import { SCHEMA_PATH, ScenarioError, loadScenario } from '../../scenario.js';
import { findTier2Scenarios, MAX_METRICS, parseSnapshot } from '../../tier2.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCENARIOS = path.resolve(HERE, '../../../harness/scenarios');
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const read = (f) => JSON.parse(readFileSync(path.join(SCENARIOS, f), 'utf8'));

const base = () => ({
  format: 2,
  name: 'f2',
  tier: 1,
  boot: { fixture: 'pad-echo', from: 'pad-echo-ready' },
  memory: {
    counter: { addr: '0x800f0000', type: 'u32' },
    buttons: { addr: '0x800f0008', type: 'u16' },
    marker: { addr: '0x800f0004', type: 'bytes', len: 4 },
  },
  input: [
    { wait: { frames: 3 } },
    { buttons: ['cross', 'up'], frames: 2, port: 0 },
    { wait: { until: { mem: 'buttons', equals: '0xffff' }, timeout: 5 }, metric: 'release' },
    { wait: { until: { mem: 'counter', differs: 0 }, timeout: 5 } },
    { wait: { until: { mem: 'counter', in: [1, '0x100'] }, timeout: 5 } },
  ],
  assert: [
    { expect: { mem: 'counter', in: [30, 100] }, metric: 'counter_ok' },
    { sameState: 'rerun', metric: 'same' },
    { sameState: 'boot' },
  ],
  metrics: ['release', 'counter_ok', 'same', 'snapshot_frames', 'saved_ms', 'counter'],
});
const clone = (o) => structuredClone(o);

describe('format 2 schema', () => {
  test('the base example and every committed format 2 scenario are valid and load', () => {
    assert.deepEqual(validate(schema, base()), []);
    assert.doesNotThrow(() => loadScenario(base()));
    for (const f of ['pad-echo-script.json', 'title-determinism.json', 'title-snapshot-equals-boot.json']) {
      const d = read(f);
      assert.equal(d.format, 2, f);
      assert.deepEqual(validate(schema, d), [], f);
      assert.doesNotThrow(() => loadScenario(d, { allowTier2: d.tier === 2 }), f);
    }
  });

  test('format 1 scenarios still validate (unchanged files)', () => {
    for (const f of ['pad-echo-buttons.json', 'disc-boot-smoke.json']) {
      const d = read(f);
      assert.equal(d.format, 1);
      assert.deepEqual(validate(schema, d), [], f);
    }
  });

  const invalid = {
    'format 1 field frames': (d) => { d.frames = 60; },
    'format 1 input step (from/to)': (d) => { d.input[0] = { from: 1, to: 2, buttons: ['cross'] }; },
    'format 1 checkpoints': (d) => { d.checkpoints = [1]; },
    'coreOptions (a boot point owns them)': (d) => { d.coreOptions = {}; },
    'no boot point': (d) => { delete d.boot.from; },
    'disc as a name': (d) => { d.boot = { disc: 'disc-1', from: 'title' }; },
    'disc 4': (d) => { d.boot = { disc: 4, from: 'title' }; },
    'disc and fixture': (d) => { d.boot.disc = 1; },
    'boot point name with capitals': (d) => { d.boot.from = 'Title'; },
    'empty script': (d) => { d.input = []; },
    'press with no buttons': (d) => { d.input[1].buttons = []; },
    'press of 0 frames': (d) => { d.input[1].frames = 0; },
    'press on port 2': (d) => { d.input[1].port = 2; },
    'wait of 0 frames': (d) => { d.input[0].wait.frames = 0; },
    'wait with frames and until': (d) => { d.input[0].wait.until = { mem: 'counter', equals: 1 }; d.input[0].wait.timeout = 5; },
    'until without timeout': (d) => { delete d.input[2].wait.timeout; },
    'timeout of 0': (d) => { d.input[2].wait.timeout = 0; },
    'metric on a fixed wait': (d) => { d.input[0].metric = 'w'; },
    'condition with two relations': (d) => { d.input[2].wait.until.differs = 1; },
    'condition with no relation': (d) => { delete d.input[2].wait.until.equals; },
    'range with one value': (d) => { d.input[4].wait.until.in = [1]; },
    'range with three values': (d) => { d.input[4].wait.until.in = [1, 2, 3]; },
    'condition at a raw address': (d) => { d.input[2].wait.until = { addr: '0x800f0008', equals: 1 }; },
    'no assert': (d) => { delete d.assert; },
    'empty assert': (d) => { d.assert = []; },
    'sameState of another kind': (d) => { d.assert[1].sameState = 'snapshot'; },
    'format 1 assertion': (d) => { d.assert[0] = { at: 5, mem: 'counter', equals: 1 }; },
    'more than 8 metrics': (d) => { d.metrics = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']; },
    'unknown property': (d) => { d.snapshots = 'x'; },
  };
  for (const [name, mutate] of Object.entries(invalid)) {
    test(`rejects: ${name}`, () => {
      const d = base();
      mutate(d);
      assert.notDeepEqual(validate(schema, d), []);
      assert.throws(() => loadScenario(d), ScenarioError);
    });
  }
});

describe('format 2 loader checks beyond the schema', () => {
  const rejects = {
    'unknown boot point': [(d) => { d.boot.from = 'nowhere'; }, /no boot point named "nowhere"/],
    'boot point of another source': [(d) => { d.boot.from = 'title'; }, /boots \{"disc":1\}/],
    'disc boot from a fixture boot point': [(d) => { d.boot = { disc: 1, from: 'pad-echo-ready' }; }, /boots \{"fixture":"pad-echo"\}/],
    'condition on a bytes location': [(d) => { d.input[2].wait.until.mem = 'marker'; }, /needs a u8, u16 or u32 location/],
    'condition on an unknown name': [(d) => { d.assert[0].expect.mem = 'nope'; }, /no memory location named "nope"/],
    'empty range': [(d) => { d.input[4].wait.until.in = [5, 4]; }, /is empty/],
    'value too big for its type': [(d) => { d.input[2].wait.until.equals = 65536; }, /does not fit in u16/],
    'decimal string': [(d) => { d.input[2].wait.until.equals = '12'; }, /0x hex string/],
    'tier 2 outside the private job': [(d) => { d.tier = 2; }, /only tier 1/],
    'named metric not listed': [(d) => { d.metrics = d.metrics.filter((k) => k !== 'release'); }, /not listed in metrics/],
    'metric named twice': [(d) => { d.assert[2].metric = 'same'; }, /already named/],
    'unknown metric': [(d) => { d.metrics.push('speed'); }, /neither a built-in metric/],
    'metric naming a bytes location': [(d) => { d.metrics.push('marker'); }, /type bytes/],
    'named metric that is also a built-in': [(d) => { d.assert[2].metric = 'frames'; d.metrics.push('frames'); }, /also a built-in metric/],
  };
  for (const [name, [mutate, re]] of Object.entries(rejects)) {
    test(`rejects: ${name}`, () => {
      const d = base();
      mutate(d);
      assert.throws(() => loadScenario(d), (e) => e instanceof ScenarioError && re.test(e.message), name);
    });
  }

  test('normalises the script, checks and boot point', () => {
    const sc = loadScenario(base());
    assert.equal(sc.format, 2);
    assert.equal(sc.fixture, 'pad-echo');
    assert.equal(sc.disc, null);
    assert.equal(sc.bootPoint.name, 'pad-echo-ready');
    assert.equal(sc.bootPoint.frames, 30);
    assert.deepEqual(sc.steps.map((s) => s.kind), ['wait', 'press', 'until', 'until', 'until']);
    assert.deepEqual(sc.steps[1], { kind: 'press', mask: (1 << 0) | (1 << 4), port: 0, frames: 2 });
    assert.deepEqual(sc.steps[2].cond, { mem: 'buttons', op: 'equals', value: 0xffff });
    assert.deepEqual(sc.steps[4].cond, { mem: 'counter', op: 'in', lo: 1, hi: 0x100 });
    assert.deepEqual(sc.asserts.map((a) => a.kind), ['expect', 'sameState', 'sameState']);
  });

  test('power-on needs no boot point; a disc boot names disc-N', () => {
    const d = base();
    d.boot = { disc: 2, from: 'power-on' };
    const sc = loadScenario(d);
    assert.equal(sc.bootPoint, null);
    assert.equal(sc.disc, 'disc-2');
  });

  test('every built-in metric is a valid metric key', () => {
    for (const k of BUILTIN_METRICS_2) assert.match(k, /^[a-z][a-z0-9_]{0,31}$/);
    assert.ok(BUILTIN_METRICS_2.includes('snapshot_frames') && BUILTIN_METRICS_2.includes('saved_ms'));
  });
});

describe('conditions', () => {
  test('equals, differs and inclusive ranges', () => {
    assert.equal(conditionHolds({ op: 'equals', value: 5 }, 5), true);
    assert.equal(conditionHolds({ op: 'equals', value: 5 }, 6), false);
    assert.equal(conditionHolds({ op: 'differs', value: 5 }, 6), true);
    assert.equal(conditionHolds({ op: 'differs', value: 5 }, 5), false);
    for (const [v, want] of [[1, false], [2, true], [3, true], [4, true], [5, false]]) {
      assert.equal(conditionHolds({ op: 'in', lo: 2, hi: 4 }, v), want, String(v));
    }
  });
});

describe('boot points', () => {
  test('every boot point script is valid format 2 steps with fixed waits, and the source is a disc or a fixture', () => {
    const stepSchema = { ...schema, oneOf: undefined, $ref: '#/$defs/scriptStep' };
    delete stepSchema.oneOf;
    delete stepSchema.type;
    for (const [name, bp] of Object.entries(BOOT_POINTS)) {
      for (const s of bp.script) assert.deepEqual(validate(stepSchema, s), [], `${name}: ${JSON.stringify(s)}`);
      assert.ok(bp.script.every((s) => !s.wait || 'frames' in s.wait), name);
      assert.ok((bp.source.disc !== undefined) !== (bp.source.fixture !== undefined), name);
      assert.doesNotThrow(() => loadBootPoint(name, bp.source), name);
    }
  });

  test('title: T = 1250, with exactly #36\'s Start presses up to the title (frames 300-1143)', () => {
    const bp = loadBootPoint('title', { disc: 1 });
    assert.equal(bp.frames, 1250);
    assert.equal(scriptFrames(BOOT_POINTS.title.script), 1250);
    // Expand the script into held frames and compare with the smoke scenario's input.
    const held = [];
    let f = 0;
    for (const s of BOOT_POINTS.title.script) {
      const n = s.wait ? s.wait.frames : s.frames ?? 1;
      for (let i = 0; i < n; i++) {
        f += 1;
        if (!s.wait) held.push(f);
      }
    }
    const smoke = read('disc-boot-smoke.json');
    const want = [];
    for (const step of smoke.input) for (let g = step.from; g <= step.to; g++) if (g <= 1250) want.push(g);
    assert.deepEqual(held, want);
    assert.ok(smoke.input.every((s) => s.buttons.length === 1 && s.buttons[0] === 'start'));
    assert.ok(BOOT_POINTS.title.script.every((s) => s.wait || (s.buttons.length === 1 && s.buttons[0] === 'start')));
  });

  test('a boot point refuses waits on conditions', () => {
    const points = { odd: { source: { fixture: 'pad-echo' }, script: [{ wait: { until: { mem: 'x', equals: 1 }, timeout: 2 } }] } };
    assert.throws(() => loadBootPoint('odd', { fixture: 'pad-echo' }, points), /fixed number of frames/);
  });
});

describe('tier2.js snapshot hand-over', () => {
  const frame = (head, body) => Buffer.concat([Buffer.from(`${JSON.stringify(head)}\n`), body]);

  test('parseSnapshot accepts exactly a header line and its bytes', () => {
    const body = Buffer.from([1, 2, 3, 4]);
    const s = parseSnapshot(frame({ ok: true, frames: 30, boot_ms: 12.5, bytes: 4 }, body));
    assert.deepEqual([...s.bytes], [1, 2, 3, 4]);
    assert.equal(s.frames, 30);
    assert.equal(s.bootMs, 12.5);
  });

  const bad = {
    'not ok': frame({ ok: false }, Buffer.alloc(0)),
    'short body': frame({ ok: true, frames: 30, boot_ms: 1, bytes: 5 }, Buffer.alloc(4)),
    'long body': frame({ ok: true, frames: 30, boot_ms: 1, bytes: 3 }, Buffer.alloc(4)),
    'no frames': frame({ ok: true, boot_ms: 1, bytes: 4 }, Buffer.alloc(4)),
    'negative boot_ms': frame({ ok: true, frames: 1, boot_ms: -1, bytes: 4 }, Buffer.alloc(4)),
    'no newline': Buffer.from('{"ok":true}'),
    'garbage': Buffer.from('xx\nyy'),
    'empty': Buffer.alloc(0),
  };
  for (const [name, buf] of Object.entries(bad)) {
    test(`parseSnapshot refuses: ${name}`, () => assert.equal(parseSnapshot(buf), null));
  }

  test('findTier2Scenarios names the boot point of format 2 scenarios only', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ff7-f2-'));
    try {
      const d = base();
      d.tier = 2;
      writeFileSync(path.join(dir, 'f2.json'), JSON.stringify(d));
      writeFileSync(path.join(dir, 'p.json'), JSON.stringify({ ...base(), name: 'p', tier: 2, boot: { fixture: 'pad-echo', from: 'power-on' } }));
      writeFileSync(path.join(dir, 'f1.json'), JSON.stringify({ ...read('pad-echo-buttons.json'), name: 'f1', tier: 2 }));
      const found = findTier2Scenarios(dir);
      assert.deepEqual(found.map((s) => [s.name, s.from]), [['f1', null], ['f2', 'pad-echo-ready'], ['p', null]]);
      assert.ok(found.every((s) => s.metrics.length <= MAX_METRICS));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
