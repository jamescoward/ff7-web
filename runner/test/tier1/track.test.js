// Tier 1: track checks (#216) on the real core with homebrew only.
// pad-echo counts VBLANKs in the u32 at 0x800f0000, so its low byte reads
// the counter's value at each mark; nothing else in the first 16 bytes
// follows the same sequence. Needs core/build.sh and runner/build.sh.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { loadScenario, runScenario } from '../../scenario.js';

const doc = () => ({
  format: 2,
  name: 'track-pad-echo',
  tier: 1,
  boot: { fixture: 'pad-echo', from: 'pad-echo-ready' },
  memory: { counter: { addr: '0x800f0000', type: 'u32' } },
  input: [
    { wait: { until: { mem: 'counter', equals: 40 }, timeout: 60 } },
    { mark: 'a' },
    { buttons: ['cross'], frames: 2 },
    { wait: { until: { mem: 'counter', equals: 50 }, timeout: 60 } },
    { mark: 'b' },
    { wait: { until: { mem: 'counter', equals: 60 }, timeout: 60 } },
    { mark: 'c' },
  ],
  assert: [{ track: { from: '0x800f0000', bytes: 16, marks: ['a', 'b', 'c'], values: [40, 50, 60], found: ['at1', 'at2'] }, metric: 'n' }],
  metrics: ['n', 'at1', 'at2'],
});

describe('track checks on pad-echo (#216)', () => {
  test('finds the counter byte and nothing else', async () => {
    const r = await runScenario(loadScenario(doc()));
    assert.equal(r.status, 'pass', JSON.stringify(r));
    assert.deepEqual(r.metrics, { n: 1, at1: 0x800f0000, at2: 0 });
  });

  test('a sequence the counter never follows matches nothing and fails', async () => {
    const d = doc();
    d.assert[0].track.values = [40, 51, 60];
    const r = await runScenario(loadScenario(d));
    assert.equal(r.status, 'fail');
    assert.deepEqual(r.metrics, { n: 0, at1: 0, at2: 0 });
  });

  test('mayMiss (#221): no match passes as a record, with n 0', async () => {
    const d = doc();
    d.assert[0].track.values = [40, 51, 60];
    d.assert[0].track.mayMiss = true;
    const r = await runScenario(loadScenario(d));
    assert.equal(r.status, 'pass', JSON.stringify(r));
    assert.deepEqual(r.metrics, { n: 0, at1: 0, at2: 0 });
  });

  test('mayMiss (#221) does not excuse a missed mark', async () => {
    const d = doc();
    d.assert[0].track.mayMiss = true;
    d.input.splice(5, 0, { wait: { until: { mem: 'counter', equals: 0 }, timeout: 3 } });
    const r = await runScenario(loadScenario(d));
    assert.equal(r.status, 'fail');
    assert.equal(r.metrics.n, 0);
  });

  test('a mark after a timed-out wait is not reached: no matches, fail', async () => {
    const d = doc();
    d.input.splice(5, 0, { wait: { until: { mem: 'counter', equals: 0 }, timeout: 3 } });
    const r = await runScenario(loadScenario(d));
    assert.equal(r.status, 'fail');
    assert.equal(r.metrics.n, 0);
  });
});
