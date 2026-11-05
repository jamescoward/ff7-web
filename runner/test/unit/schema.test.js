// The schema validator, the scenario schema and the scenario loader's extra
// checks. No core build needed.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkSchemaKeywords, validate } from '../../schema.js';
import { SCHEMA_PATH, ScenarioError, loadScenario } from '../../scenario.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCENARIOS = path.resolve(HERE, '../../../harness/scenarios');
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const example = JSON.parse(readFileSync(path.join(SCENARIOS, 'pad-echo-buttons.json'), 'utf8'));
const clone = (o) => structuredClone(o);

describe('validator', () => {
  test('rejects schemas that use unsupported keywords', () => {
    assert.throws(() => checkSchemaKeywords({ type: 'object', if: {} }), /unsupported schema keyword "if"/);
    assert.throws(() => checkSchemaKeywords({ properties: { a: { format: 'email' } } }), /"format"/);
    assert.throws(() => checkSchemaKeywords({ $ref: 'other.json#/x' }), /unsupported \$ref/);
  });

  test('implements the core keywords with standard semantics', () => {
    const s = {
      type: 'object',
      required: ['n'],
      additionalProperties: false,
      properties: {
        n: { type: 'integer', minimum: 1, maximum: 3 },
        s: { type: ['integer', 'string'], pattern: '^a', minimum: 0 },
        l: { type: 'array', items: { enum: ['x', 'y'] }, minItems: 1, uniqueItems: true },
        o: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
        c: { const: 1 },
      },
    };
    assert.deepEqual(validate(s, { n: 2, s: 'abc', l: ['x', 'y'], o: 3, c: 1 }), []);
    assert.deepEqual(validate(s, { n: 2, s: 5 }), [], 'pattern applies to strings only');
    assert.equal(validate(s, {}).length, 1);
    assert.match(validate(s, { n: 1.5 })[0], /expected integer/);
    assert.match(validate(s, { n: 4 })[0], /<= 3/);
    assert.match(validate(s, { n: 1, x: 0 })[0], /unknown property "x"/);
    assert.match(validate(s, { n: 1, s: 'b' })[0], /does not match/);
    assert.match(validate(s, { n: 1, s: -1 })[0], />= 0/);
    assert.match(validate(s, { n: 1, l: ['x', 'x'] })[0], /unique/);
    assert.match(validate(s, { n: 1, l: ['z'] })[0], /one of/);
    assert.match(validate(s, { n: 1, l: [] })[0], /at least 1/);
    assert.match(validate(s, { n: 1, o: true })[0], /none of the 2/);
    assert.match(validate(s, { n: 1, c: 2 })[0], /must be 1/);
  });
});

describe('scenario schema', () => {
  test('uses only keywords the validator implements', () => {
    assert.doesNotThrow(() => checkSchemaKeywords(schema));
  });

  test('every committed scenario is valid', () => {
    const files = readdirSync(SCENARIOS).filter((f) => f.endsWith('.json'));
    assert.ok(files.length >= 1);
    for (const f of files) {
      const doc = JSON.parse(readFileSync(path.join(SCENARIOS, f), 'utf8'));
      assert.deepEqual(validate(schema, doc), [], f);
      assert.equal(`${doc.name}.json`, f, 'file name matches scenario name');
      // Tier 2 scenarios load through runner/tier2.js, which opts in; the
      // CLI's refusal of tier 2 is tested below and in tier1/tier2.test.js.
      assert.doesNotThrow(() => loadScenario(doc, { allowTier2: doc.tier === 2 }), f);
    }
  });

  const invalid = {
    'missing frames': (d) => delete d.frames,
    'unknown top-level property': (d) => { d.extra = 1; },
    'wrong format': (d) => { d.format = 2; },
    'bad name': (d) => { d.name = 'Pad Echo'; },
    'bad address': (d) => { d.memory.buttons.addr = '800f0008'; },
    'unknown memory type': (d) => { d.memory.buttons.type = 'i16'; },
    'unknown button': (d) => { d.input[0].buttons = ['x']; },
    'empty button list': (d) => { d.input[0].buttons = []; },
    'frame 0': (d) => { d.input[0].from = 0; },
    'assertion of no known form': (d) => { d.assert[0] = { at: 5, mem: 'marker' }; },
    'assertion mixing forms': (d) => { d.assert[0] = { at: 5, mem: 'marker', equals: 1, frameHash: { sameAs: 4 } }; },
    'frameHash with two relations': (d) => { d.assert.at(-1).frameHash = { sameAs: 1, differsFrom: 2 }; },
    'negative value': (d) => { d.assert[1].equals = -1; },
    'non-hex value': (d) => { d.assert[3].equals = '0xgg'; },
    'string core option': (d) => { d.coreOptions = { a: 1 }; },
    'more than 8 metrics': (d) => { d.metrics = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']; },
    'metric key not in the pattern': (d) => { d.metrics = ['Run_ms']; },
    'duplicate metric key': (d) => { d.metrics = ['fps', 'fps']; },
    'metrics not an array': (d) => { d.metrics = 'fps'; },
  };
  for (const [name, mutate] of Object.entries(invalid)) {
    test(`rejects: ${name}`, () => {
      const d = clone(example);
      mutate(d);
      assert.notDeepEqual(validate(schema, d), []);
      assert.throws(() => loadScenario(d), ScenarioError);
    });
  }
});

describe('scenario loader checks beyond the schema', () => {
  const rejects = {
    'tier 2 outside the private job': [(d) => { d.tier = 2; }, /only tier 1/],
    'undefined memory name': [(d) => { d.assert[0].mem = 'nope'; }, /no memory location named "nope"/],
    'assertion after the last frame': [(d) => { d.assert[0].at = 61; }, /after the last frame/],
    'input after the last frame': [(d) => { d.input[0].to = 99; }, /after the last frame/],
    'input step that ends before it starts': [(d) => { d.input[0].to = 5; }, /before from/],
    'checkpoint after the last frame': [(d) => { d.checkpoints = [61]; }, /after the last frame/],
    'hash compared with itself': [(d) => { d.assert.at(-1).frameHash = { differsFrom: 30 }; }, /with itself/],
    'bytes without len': [(d) => { delete d.memory.marker.len; }, /needs len/],
    'len on a fixed-size type': [(d) => { d.memory.buttons.len = 2; }, /only for type bytes/],
    'address outside main RAM': [(d) => { d.memory.buttons.addr = '0x1f801040'; }, /not a main-RAM address/],
    'range past the end of RAM': [(d) => { d.memory.marker.addr = '0x801ffffe'; }, /past the end/],
    'value too big for its type': [(d) => { d.assert[3].equals = 65536; }, /does not fit in u16/],
    'bytes value of the wrong length': [(d) => { d.assert[0].equals = 'ff'; }, /8 hex digits/],
    'decimal string for an integer type': [(d) => { d.assert[1].equals = '05'; }, /0x hex string/],
    'nothing to check': [(d) => { delete d.assert; delete d.checkpoints; }, /asserts nothing/],
    'tier 2 even with metrics': [(d) => { d.tier = 2; d.metrics = ['fps']; }, /only tier 1/],
    'metric that is neither built in nor a memory name': [(d) => { d.metrics = ['speed']; }, /neither a built-in metric/],
    'metric naming a bytes location': [(d) => { d.metrics = ['marker']; }, /type bytes/],
    'metric that is both built in and a memory name': [(d) => { d.metrics = ['frames']; }, /both a built-in metric and a memory name/],
  };
  for (const [name, [mutate, re]] of Object.entries(rejects)) {
    test(`rejects: ${name}`, () => {
      const d = clone(example);
      mutate(d);
      assert.throws(() => loadScenario(d), (e) => e instanceof ScenarioError && re.test(e.message));
    });
  }

  test('tier 2 loads only when the caller allows it (runner/tier2.js)', () => {
    const d = clone(example);
    d.tier = 2;
    d.metrics = ['fps', 'buttons'];
    assert.throws(() => loadScenario(d), /only tier 1/);
    assert.deepEqual(loadScenario(d, { allowTier2: true }).metrics, ['fps', 'buttons']);
  });

  test('a scenario without metrics lists none', () => {
    assert.deepEqual(loadScenario(clone(example)).metrics, []);
  });

  test('normalises values and input', () => {
    const sc = loadScenario(clone(example));
    assert.equal(sc.memory.buttons.addr, 0x800f0008);
    assert.equal(sc.memory.buttons.len, 2);
    assert.deepEqual(sc.input[0], { from: 10, to: 20, port: 0, mask: 1 });
    assert.equal(sc.asserts.find((a) => a.at === 10 && a.kind === 'mem').expected, 0xbfff);
    assert.deepEqual(sc.checkpoints, [10, 15, 30, 60]);
  });
});
