// Tier 1 (node, no browser): automatic controls policy and polling (#113).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { AUTO_FLAG, controlsForMode, createAutoControls } from '../js/auto-controls.js';

const S = (mode, confirmed = true) => ({ value: { mode, raw: 0, previous: null }, confirmed });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function setup({ flag = true } = {}) {
  let on = flag;
  const listeners = [];
  const labs = { isOn: (n) => n === AUTO_FLAG && on, onChange: (cb) => listeners.push(cb) };
  const calls = [];
  // Fake controls: setAuto records the call and changes the shown mode.
  const controls = { mode: 'gamepad', setAuto(t) { calls.push(t); this.mode = t; } };
  const reads = { n: 0, inflight: 0, maxInflight: 0 };
  let next = S('field');
  let delay = 0;
  const source = async () => {
    reads.n++;
    reads.inflight++;
    reads.maxInflight = Math.max(reads.maxInflight, reads.inflight);
    if (delay) await wait(delay);
    reads.inflight--;
    return next;
  };
  const auto = createAutoControls({ controls, labs, hz: 100 });
  return {
    auto, controls, calls, reads, source,
    say: (s) => { next = s; },
    slow: (ms) => { delay = ms; },
    setFlag: (v) => { on = v; for (const cb of listeners) cb(AUTO_FLAG, v); },
  };
}

describe('controlsForMode', () => {
  test('only a confirmed field gives drag-to-walk', () => {
    assert.equal(controlsForMode(S('field')), 'field');
    for (const m of ['battle', 'menu', 'world', 'minigame', 'movie', 'unknown']) {
      assert.equal(controlsForMode(S(m)), 'gamepad', m);
      assert.equal(controlsForMode(S(m, false)), 'gamepad', `${m} unconfirmed`);
    }
    assert.equal(controlsForMode(S('field', false)), 'gamepad');
    assert.equal(controlsForMode({ value: null, reason: 'x' }), 'gamepad');
    assert.equal(controlsForMode(null), 'gamepad');
  });
});

describe('createAutoControls', () => {
  test('field then battle then menu switch the controls once per change', async () => {
    const h = setup();
    h.auto.setSource(h.source);
    h.auto.setGate({ active: true });
    await wait(40);
    assert.deepEqual(h.calls, ['field']);
    h.say(S('battle'));
    await wait(40);
    h.say(S('menu'));
    await wait(40);
    assert.deepEqual(h.calls, ['field', 'gamepad', 'gamepad']);
    h.auto.stop();
  });

  test('a failure and an unconfirmed field give the pad', async () => {
    const h = setup();
    h.auto.setSource(h.source);
    h.auto.setGate({ active: true });
    await wait(30);
    h.say({ value: null, reason: 'unreadable' });
    await wait(30);
    h.say(S('field', false));
    await wait(30);
    assert.deepEqual(h.calls, ['field', 'gamepad', 'gamepad']);
    assert.equal(h.controls.mode, 'gamepad');
    h.auto.stop();
  });

  test('flag off: no polling and no switching', async () => {
    const h = setup({ flag: false });
    h.auto.setSource(h.source);
    h.auto.setGate({ active: true });
    await wait(40);
    assert.equal(h.reads.n, 0);
    assert.equal(h.auto.running, false);
    assert.deepEqual(h.calls, []);
  });

  test('gate closed: no polling and no switching', async () => {
    const h = setup();
    h.auto.setSource(h.source);
    await wait(30);
    h.auto.setGate({ active: false, reason: 'not the USA disc' });
    await wait(30);
    assert.equal(h.reads.n, 0);
    assert.deepEqual(h.calls, []);
  });

  test('a manual override holds until the next mode change', async () => {
    const h = setup();
    h.say(S('battle'));
    h.auto.setSource(h.source);
    h.auto.setGate({ active: true });
    await wait(30);
    assert.deepEqual(h.calls, ['gamepad']);
    h.controls.mode = 'field'; // the owner taps the Controls button
    await wait(60); // battle keeps being reported
    assert.deepEqual(h.calls, ['gamepad']);
    assert.equal(h.controls.mode, 'field');
    h.say(S('menu'));
    await wait(30);
    assert.deepEqual(h.calls, ['gamepad', 'gamepad']);
    assert.equal(h.controls.mode, 'gamepad');
    h.auto.stop();
  });

  test('polls never overlap, even with a slow source', async () => {
    const h = setup();
    h.slow(25);
    h.auto.setSource(h.source);
    h.auto.setGate({ active: true });
    await wait(120);
    h.auto.stop();
    assert.ok(h.reads.n >= 2);
    assert.equal(h.reads.maxInflight, 1);
  });

  test('turning the flag off stops polling and leaves the controls alone', async () => {
    const h = setup();
    h.auto.setSource(h.source);
    h.auto.setGate({ active: true });
    await wait(30);
    assert.equal(h.auto.running, true);
    h.setFlag(false);
    assert.equal(h.auto.running, false);
    const n = h.reads.n;
    h.say(S('battle'));
    await wait(40);
    assert.equal(h.reads.n, n);
    assert.deepEqual(h.calls, ['field']);
    // Back on: the first sample counts as a change again.
    h.setFlag(true);
    await wait(30);
    assert.deepEqual(h.calls, ['field', 'gamepad']);
    h.auto.stop();
  });

  test('closing the gate while a read is in flight drops its result', async () => {
    const h = setup();
    h.slow(30);
    h.auto.setSource(h.source);
    h.auto.setGate({ active: true });
    await wait(10);
    h.auto.setGate({ active: false });
    await wait(60);
    assert.deepEqual(h.calls, []);
  });

  test('with the real layer: reads memory through the backend once the gate is active', async () => {
    const reads = [];
    const backend = { readMem: async (a, l) => { reads.push([a, l]); return new Uint8Array(l); } };
    const h = setup();
    h.auto.setBackend(backend);
    await wait(20);
    assert.equal(reads.length, 0); // gate not active yet
    h.auto.setGate({ active: true });
    await wait(40);
    assert.ok(reads.length > 0);
    assert.ok(h.calls.length >= 1);
    h.auto.stop();
  });
});
