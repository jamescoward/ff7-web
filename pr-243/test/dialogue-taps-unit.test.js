// Unit (no browser): tap-to-advance dialogue lifecycle and policy (#114).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createDialogueTaps, PRESS_MS, TAPS_FLAG } from '../js/dialogue-taps.js';
import { PAD, createInputMixer } from '../js/pad.js';

const waiting = { value: { open: true, waiting: true, choice: null }, confirmed: true };
const typing = { value: { open: true, waiting: false, choice: null }, confirmed: true };
const closed = { value: { open: false, waiting: false, choice: null }, confirmed: true };

function setup({ flag = true, gate = true, sample = waiting, now = () => 0 } = {}) {
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
  const handlers = {};
  const target = { addEventListener(type, fn) { handlers[type] = fn; } };
  const state = { sample, reads: 0 };
  const taps = createDialogueTaps({ target, mixer, labs, timers, now });
  taps.setSource({
    async dialogue() {
      state.reads++;
      if (state.sample instanceof Error) throw state.sample;
      return state.sample;
    },
  });
  if (gate) taps.setGate({ active: true });
  const release = () => { for (const h of [...timeouts]) { timeouts.delete(h); h.fn(); } };
  return { taps, masks, mixer, handlers, labs, state, timeouts, intervals, release };
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
    s.mixer.set('pad', PAD.up); // another source holds Up
    await s.taps.tap();
    s.release();
    assert.deepEqual(s.masks, [PAD.up, PAD.up | PAD.circle, PAD.up]);
  });
});

// The tap filter (pointer events on the target), with a fake clock.
describe('createDialogueTaps: tap filter', () => {
  const settle = () => new Promise((r) => setImmediate(r));
  function pointer() {
    let t = 0;
    const s = setup({ now: () => t });
    const ev = (id, x, y) => ({ pointerId: id, clientX: x, clientY: y });
    return {
      s,
      at(ms) { t = ms; },
      down: (id, x, y) => s.handlers.pointerdown(ev(id, x, y)),
      up: (id, x, y) => s.handlers.pointerup(ev(id, x, y)),
      cancel: () => s.handlers.pointercancel(),
    };
  }

  test('listens for pointerdown, pointerup and pointercancel on the target', () => {
    const { s } = pointer();
    assert.deepEqual(Object.keys(s.handlers).sort(), ['pointercancel', 'pointerdown', 'pointerup']);
  });

  test('a short, still tap presses Circle', async () => {
    const p = pointer();
    p.at(0); p.down(1, 100, 100);
    p.at(499); p.up(1, 100 + 8, 100 + 8); // 11.3 px, under the slop
    await settle();
    assert.deepEqual(p.s.masks, [PAD.circle]);
  });

  test('moving too far is not a tap', async () => {
    const p = pointer();
    p.down(1, 100, 100);
    p.up(1, 113, 100); // 13 px
    await settle();
    assert.deepEqual(p.s.masks, []);
    assert.equal(p.s.state.reads, 1); // the poll at start only; no tap read
  });

  test('holding too long is not a tap', async () => {
    const p = pointer();
    p.at(0); p.down(1, 100, 100);
    p.at(501); p.up(1, 100, 100);
    await settle();
    assert.deepEqual(p.s.masks, []);
  });

  test('a cancelled pointer is not a tap', async () => {
    const p = pointer();
    p.down(1, 100, 100);
    p.cancel();
    p.up(1, 100, 100);
    await settle();
    assert.deepEqual(p.s.masks, []);
  });

  test('an up from another pointer is not a tap', async () => {
    const p = pointer();
    p.down(1, 100, 100);
    p.up(2, 100, 100);
    await settle();
    assert.deepEqual(p.s.masks, []);
  });

  test('an up with no down is not a tap', async () => {
    const p = pointer();
    p.up(1, 100, 100);
    await settle();
    assert.deepEqual(p.s.masks, []);
  });
});
