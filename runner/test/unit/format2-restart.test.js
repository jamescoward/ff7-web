// Restart steps (#228): the schema and loader rules for the format 2
// "restart" step. No core needed; the run on the real core is in
// runner/test/tier1/format2.test.js "restart steps".
// Original project code, GPL-2.0-or-later.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { BOOT_POINTS } from '../../bootpoints.js';
import { loadBootPoint } from '../../format2.js';
import { validate } from '../../schema.js';
import { SCHEMA_PATH, ScenarioError, loadScenario } from '../../scenario.js';

const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));

const base = () => ({
  format: 2,
  name: 'rst',
  tier: 1,
  boot: { fixture: 'pad-echo', from: 'pad-echo-ready-card' },
  memory: { counter: { addr: '0x800f0000', type: 'u32' } },
  input: [{ wait: { frames: 10 } }, { restart: 'keep-card' }, { wait: { frames: 5 } }],
  assert: [{ expect: { mem: 'counter', differs: 0 } }],
  metrics: ['frames'],
});

describe('restart steps: schema and loader (#228)', () => {
  test('a restart from a boot point with a card loads', () => {
    const d = base();
    assert.deepEqual(validate(schema, d), []);
    const sc = loadScenario(d);
    assert.deepEqual(sc.steps[1], { kind: 'restart', index: 1 });
    assert.equal(sc.steps.filter((s) => s.kind === 'restart').length, 1);
  });

  test('a note is allowed; any other value or key is not', () => {
    const d = base();
    d.input[1].note = 'why';
    assert.deepEqual(validate(schema, d), []);
    for (const bad of [{ restart: true }, { restart: 'blank-card' }, { restart: 'keep-card', frames: 2 }]) {
      const e = base();
      e.input[1] = bad;
      assert.notDeepEqual(validate(schema, e), [], JSON.stringify(bad));
    }
  });

  test('a scenario whose boot point has no memory card is refused', () => {
    const d = base();
    d.boot.from = 'pad-echo-ready';
    assert.throws(() => loadScenario(d), (e) => e instanceof ScenarioError && /input\[1\]\.restart.*card "blank".*"pad-echo-ready"/.test(e.message));
  });

  test('a scenario from power-on is refused', () => {
    const d = base();
    d.boot.from = 'power-on';
    assert.throws(() => loadScenario(d), (e) => e instanceof ScenarioError && /restart.*card "blank"/.test(e.message));
  });

  test('a scenario that keeps a snapshot is refused (#230)', () => {
    const d = base();
    d.snapshot = 'kept-after-restart';
    assert.deepEqual(validate(schema, d), []);
    assert.throws(() => loadScenario(d), (e) => e instanceof ScenarioError && /input\[1\]\.restart.*snapshot "kept-after-restart"/.test(e.message));
  });

  test('a scenario that keeps a snapshot and has no restart still loads (#230)', () => {
    const d = base();
    d.snapshot = 'kept-no-restart';
    d.input.splice(1, 1);
    assert.equal(loadScenario(d).snapshotName, 'kept-no-restart');
  });

  test('a scenario from a named snapshot is refused', () => {
    const d = base();
    d.boot = { from: 'some-snapshot' };
    assert.throws(() => loadScenario(d), (e) => e instanceof ScenarioError && /restart.*snapshot "some-snapshot"/.test(e.message));
  });

  test('a boot point script cannot restart', () => {
    const points = { ...BOOT_POINTS, 'bad-point': { ...BOOT_POINTS['pad-echo-ready-card'], script: [{ wait: { frames: 9 } }, { restart: 'keep-card' }] } };
    assert.throws(() => loadBootPoint('bad-point', { fixture: 'pad-echo' }, points), (e) => e instanceof ScenarioError && /boot point script has no restart/.test(e.message));
  });
});
