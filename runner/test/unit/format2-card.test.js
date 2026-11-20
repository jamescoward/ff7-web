// Card checks (#226): the schema and loader for the format 2 "card" check.
// No core needed; cardOutcome itself is tested in savegen-read.test.js and
// the run on the real core in runner/test/tier1/format2.test.js.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { CARD_REPORT } from '../../format2.js';
import { validate } from '../../schema.js';
import { SCHEMA_PATH, ScenarioError, loadScenario } from '../../scenario.js';

const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));

const base = () => ({
  format: 2,
  name: 'crd',
  tier: 1,
  boot: { fixture: 'pad-echo', from: 'pad-echo-ready-card' },
  memory: { counter: { addr: '0x800f0000', type: 'u32' } },
  input: [{ wait: { frames: 10 } }],
  assert: [{ card: { module: 3, report: { changed: 'c_n', slot: 'c_slot', checksum: 'c_sum', module: 'c_mod', location: 'c_loc' } }, metric: 'card_ok' }],
  metrics: ['card_ok', 'c_n', 'c_slot', 'c_sum', 'c_mod', 'c_loc'],
});
const clone = (o) => structuredClone(o);

describe('card checks: schema and loader (#226)', () => {
  test('a well-formed check loads', () => {
    const d = base();
    assert.deepEqual(validate(schema, d), []);
    const sc = loadScenario(d);
    assert.deepEqual(sc.asserts[0], {
      kind: 'card', module: 3, report: { changed: 'c_n', slot: 'c_slot', checksum: 'c_sum', module: 'c_mod', location: 'c_loc' }, metric: 'card_ok',
    });
  });

  test('module and report are optional; metric is required', () => {
    const d = base();
    d.assert[0].card = {};
    d.metrics = ['card_ok'];
    assert.deepEqual(validate(schema, d), []);
    assert.deepEqual(loadScenario(d).asserts[0], { kind: 'card', report: {}, metric: 'card_ok' });
    const noMetric = base();
    delete noMetric.assert[0].metric;
    assert.notDeepEqual(validate(schema, noMetric), []);
  });

  test('the report keys are exactly CARD_REPORT', () => {
    assert.deepEqual(Object.keys(base().assert[0].card.report), CARD_REPORT);
    const d = base();
    d.assert[0].card.report.bytes = 'c_bytes';
    assert.notDeepEqual(validate(schema, d), []);
    const e = base();
    e.assert[0].card.slots = [1];
    assert.notDeepEqual(validate(schema, e), []);
  });

  test('every report metric must be listed, and named once', () => {
    const d = base();
    d.metrics = d.metrics.filter((k) => k !== 'c_loc');
    assert.throws(() => loadScenario(d), /c_loc.*not listed/);
    const twice = base();
    twice.assert[0].card.report.slot = 'card_ok';
    assert.throws(() => loadScenario(twice), /already named/);
  });

  test('the boot point needs a memory card', () => {
    const d = base();
    d.boot.from = 'pad-echo-ready';
    assert.throws(() => loadScenario(d), (e) => e instanceof ScenarioError && /card "blank"/.test(e.message));
  });

  test('a scenario from a named snapshot cannot have a card check', () => {
    const d = base();
    d.boot = { from: 'some-snapshot' };
    assert.throws(() => loadScenario(d), /snapshot "some-snapshot"/);
  });
});
