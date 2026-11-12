// Unit (no browser): tap-to-advance dialogue lifecycle and policy (#114).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createDialogueTaps, PRESS_MS, TAPS_FLAG } from '../js/dialogue-taps.js';
import { PAD, createInputMixer } from '../js/pad.js';

const waiting = { value: { open: true, waiting: true, choice: null }, confirmed: true };
const typing = { value: { open: true, waiting: false, choice: null }, confirmed: true };
const closed = { value: { open: false, waiting: false, choice: null }, confirmed: true };

function setup({ flag = true, gate = true, sample = waiting } = {}) {
  const intervals = new Set();
  const timeouts = new Set();
  const timers = {
    setInterval(fn) { const h = { fn }; intervals.add(h); return h; },
    clearInterval(h) { intervals.delete(h); },
    setTimeout(fn) { const h = { fn }; timeouts.add(h); return h; },
    clearTimeout(h) { timeouts.delete(h); },
  };
  let on = flag;
  const listeners = [];
  const labs = {
    isOn: (n) => n === TAPS_FLAG && on,
    onChange: (cb) => listeners.push(cb),
    set(v) { on = v; for (const cb of listeners) cb(TAPS_FLAG, v); },
  };
  const masks = [];
  const mixer = createInputMixer((m) => masks.push(m));
  const target = { addEventListener() {} };
  const state = { sample, reads: 0 };
  const taps = createDialogueTaps({ target, mixer, labs, timers });
  taps.setSource({
    async dialogue() {
      state.reads++;
      if (state.sample instanceof Error) throw state.sample;
      return state.sample;
    },
  });
  if (gate) taps.setGate({ active: true });
  const release = () => { for (const h of [...timeouts]) { timeouts.delete(h); h.fn(); } };
  return { taps, masks, labs, state, timeouts, intervals, release };
}

describe('createDialogueTaps', () => {
  test('a tap while waiting sends one Circle press, then release', async () => {
    const s = setup();
    await s.taps.tap();
    assert.deepEqual(s.masks, [PAD.circle]);
    assert.equal(s.timeouts.size, 1);
    assert.ok(PRESS_MS > 0);
    s.release();
    assert.deepEqual(s.masks, [PAD.circle, 0]);
  });

  test('typing, closed, unconfirmed, failed and throwing reads send nothing', async () => {
    for (const sample of [
      typing, closed,
      { ...waiting, confirmed: false },
      { value: null, confirmed: false, reason: 'read failed' },
      null,
      new Error('boom'),
    ]) {
      const s = setup({ sample });
      await s.taps.tap();
      assert.deepEqual(s.masks, [], String(sample?.reason ?? sample));
      assert.equal(s.timeouts.size, 0);
    }
  });

  test('the read is fresh at tap time', async () => {
    const s = setup({ sample: typing });
    await s.taps.tick();
    assert.equal(s.taps.latest, typing);
    s.state.sample = waiting; // text finished since the last poll
    await s.taps.tap();
    assert.deepEqual(s.masks, [PAD.circle]);
  });

  test('flag off: nothing and no polling', async () => {
    const s = setup({ flag: false });
    assert.equal(s.taps.running, false);
    await s.taps.tap();
    assert.deepEqual(s.masks, []);
    assert.equal(s.state.reads, 0);
  });

  test('gate closed: nothing and no polling', async () => {
    const s = setup({ gate: false });
    assert.equal(s.taps.running, false);
    await s.taps.tap();
    assert.deepEqual(s.masks, []);
    assert.equal(s.state.reads, 0);
  });

  test('two quick taps send one press', async () => {
    const s = setup();
    await Promise.all([s.taps.tap(), s.taps.tap()]);
    await s.taps.tap();
    assert.deepEqual(s.masks, [PAD.circle]);
    s.release();
    await s.taps.tap(); // after release a new tap presses again
    assert.deepEqual(s.masks, [PAD.circle, 0, PAD.circle]);
  });

  test('stop() releases a held press; switching the flag off stops polling', async () => {
    const s = setup();
    assert.equal(s.taps.running, true);
    await s.taps.tap();
    s.taps.stop();
    assert.deepEqual(s.masks, [PAD.circle, 0]);
    assert.equal(s.timeouts.size, 0);
    assert.equal(s.taps.running, false);
    s.labs.set(true);
    assert.equal(s.taps.running, true);
    s.labs.set(false);
    assert.equal(s.taps.running, false);
    assert.equal(s.intervals.size, 0);
  });

  test('the press does not disturb other sources', async () => {
    const s = setup();
    s.masks.length = 0;
    // pad held elsewhere keeps its bit after the release
    const mixer = createInputMixer((m) => s.masks.push(m));
    mixer.set('pad', PAD.up);
    assert.deepEqual(s.masks, [PAD.up]);
  });
});
