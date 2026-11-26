// Unit (no browser): "Use default name" on the naming screen (#289 part 2),
// with a fake semantic source and a simulated naming screen that closes after
// a set number of Start-then-Circle presses. Mocked mixer; no Wasm core.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buttonForNaming, createNamingConfirm, groupMask, NAMING_FLAG } from '../js/naming-confirm.js';
import { PAD, createInputMixer } from '../js/pad.js';
import { NAMING_ACTIONS, namingPressAt } from '../js/semantic/controls.js';

const ACTION = NAMING_ACTIONS.useDefault;
const on = { value: true, confirmed: true };
const off = { value: false, confirmed: true };

function fakeRoot() {
  const handlers = {};
  const btn = { disabled: false };
  const doc = {
    documentElement: { attrs: new Set(), toggleAttribute(n, v) { v ? this.attrs.add(n) : this.attrs.delete(n); } },
    createElement() { return { dataset: {}, className: '' }; },
  };
  return {
    hidden: true, ownerDocument: doc, btn, appended: [],
    querySelector: (sel) => (sel === '.nc-btn' ? btn : null),
    append(el) { this.appended.push(el); },
    addEventListener(t, fn) { handlers[t] = fn; }, handlers, contains: () => true,
  };
}

/**
 * `closeAfter`: the screen closes on the game frame after this many Circle
 * presses that follow a Start press (null: never closes).
 */
async function setup({ flag = true, gate = true, sample = on, closeAfter = 1 } = {}) {
  const intervals = new Set();
  const timers = {
    setInterval(fn) { const h = { fn }; intervals.add(h); return h; },
    clearInterval(h) { intervals.delete(h); },
    setTimeout() { throw new Error('no timeouts expected'); },
    clearTimeout() {},
  };
  let flagOn = flag;
  const listeners = [];
  const labs = {
    isOn: (n) => n === NAMING_FLAG && flagOn,
    onChange: (cb) => listeners.push(cb),
    set(v) { flagOn = v; for (const cb of listeners) cb(NAMING_FLAG, v); },
  };
  const masks = [];
  const mixer = createInputMixer((m) => masks.push(m));
  const root = fakeRoot();
  const sim = {
    frame: 500, open: sample.value === true, sample: null, mask: 0, sawStart: false, circles: 0, reads: 0,
    async naming() { this.reads++; return this.sample ?? { value: this.open, confirmed: true }; },
    /** One game frame: fresh presses act as on the screen (Start, then Circle, confirms). */
    advance() {
      const m = mixer.mask;
      const rising = m & ~this.mask;
      this.mask = m;
      if (rising & PAD.start) this.sawStart = true;
      if ((rising & PAD.circle) && this.sawStart) this.circles++;
      if (closeAfter !== null && this.circles >= closeAfter) this.open = false;
      this.frame++;
    },
  };
  if (sample !== on && sample !== off) sim.sample = sample;
  const nc = createNamingConfirm({ root, mixer, labs, timers });
  nc.setSource(sim);
  if (gate) nc.setGate({ active: true });
  await new Promise((r) => setImmediate(r));
  /** Run the loop one game frame at a time until it stops (or `max` frames pass). */
  async function drive(max = 4000) {
    let n = 0;
    for (; n < max && nc.playing; n++) { sim.advance(); await nc.turn(); }
    return n;
  }
  return { nc, sim, masks, mixer, labs, root, intervals, drive };
}

const nonzero = (masks) => masks.filter((m) => m !== 0);
/** Collapse runs of equal masks: the distinct presses in order. */
const runs = (masks) => masks.filter((m, i) => i === 0 || m !== masks[i - 1]);

describe('naming-confirm policy', () => {
  test('the button is for a confirmed naming screen only', () => {
    assert.equal(buttonForNaming(on), true);
    assert.equal(buttonForNaming(off), false);
    assert.equal(buttonForNaming({ value: true, confirmed: false }), false);
    assert.equal(buttonForNaming({ error: 'unread' }), false);
    assert.equal(buttonForNaming(null), false);
  });
  test('groupMask follows PAD', () => {
    assert.equal(groupMask(null), 0);
    assert.equal(groupMask(['start']), PAD.start);
    assert.equal(groupMask(['circle']), PAD.circle);
    assert.throws(() => groupMask(['nope']), RangeError);
  });
});

describe('createNamingConfirm', () => {
  test('shown only while the naming screen is open and confirmed', async () => {
    const s = await setup();
    await s.nc.tick();
    assert.equal(s.root.hidden, false);
    assert.ok(s.root.ownerDocument.documentElement.attrs.has('data-naming-confirm-on'));
    s.sim.open = false;
    await s.nc.tick();
    assert.equal(s.root.hidden, true);
    s.sim.open = true;
    s.sim.sample = { value: true, confirmed: false };
    await s.nc.tick();
    assert.equal(s.root.hidden, true);
  });

  test('a failed poll keeps the last verdict', async () => {
    const s = await setup();
    await s.nc.tick();
    assert.equal(s.root.hidden, false);
    s.sim.sample = { error: 'unread' };
    await s.nc.tick();
    assert.equal(s.root.hidden, false);
  });

  test('a tap sends exactly the semantic sequence, frame by frame, and stops when the screen closes', async () => {
    const s = await setup({ closeAfter: 1 });
    await s.nc.tick();
    await s.nc.tap();
    assert.equal(s.nc.playing, true);
    assert.equal(s.root.btn.disabled, true);
    const start = s.sim.frame;
    const held = [s.mixer.mask];
    // Record the mask held on each game frame of the run.
    while (s.nc.playing) { s.sim.advance(); await s.nc.turn(); if (s.nc.playing) held.push(s.mixer.mask); }
    const want = held.map((_, f) => groupMask(namingPressAt(f, ACTION)));
    assert.deepEqual(held, want);
    assert.deepEqual(runs(nonzero(s.masks)), [PAD.start, PAD.circle]);
    assert.deepEqual(s.nc.last, { ok: true, frames: s.sim.frame - start });
    assert.equal(s.mixer.mask, 0);
    assert.equal(s.root.btn.disabled, false);
    assert.equal(s.intervals.size, 1, 'only the poll is left');
  });

  test('the sequence cycles Start, Circle, Start, ... while the screen stays open', async () => {
    const s = await setup({ closeAfter: 3 });
    await s.nc.tick();
    await s.nc.tap();
    await s.drive();
    assert.equal(s.nc.last.ok, true);
    const presses = runs(nonzero(s.masks));
    assert.deepEqual(presses.slice(0, 6), [PAD.start, PAD.circle, PAD.start, PAD.circle, PAD.start, PAD.circle]);
    assert.equal(s.mixer.mask, 0);
  });

  test('a screen that never closes stops at the timeout, with nothing held', async () => {
    const s = await setup({ closeAfter: null });
    await s.nc.tick();
    await s.nc.tap();
    const n = await s.drive(ACTION.timeout + 50);
    assert.equal(s.nc.playing, false);
    assert.equal(s.nc.last.ok, false);
    assert.equal(s.nc.last.reason, 'timeout');
    assert.equal(s.nc.last.frames, ACTION.timeout);
    assert.ok(n <= ACTION.timeout + 1);
    assert.equal(s.mixer.mask, 0);
    const before = s.masks.length;
    s.sim.advance();
    await s.nc.turn();
    assert.equal(s.masks.length, before, 'no input after the stop');
  });

  test('an unread or unconfirmed read during a run stops it', async () => {
    for (const bad of [{ error: 'unread' }, { value: true, confirmed: false }]) {
      const s = await setup({ closeAfter: null });
      await s.nc.tick();
      await s.nc.tap();
      s.sim.advance(); await s.nc.turn();
      assert.equal(s.nc.playing, true);
      s.sim.sample = bad;
      s.sim.advance(); await s.nc.turn();
      assert.equal(s.nc.playing, false);
      assert.equal(s.nc.last.reason, 'unread');
      assert.equal(s.mixer.mask, 0);
    }
  });

  test('a tap off the naming screen, or with an unconfirmed read, sends nothing', async () => {
    const s = await setup({ sample: off });
    await s.nc.tick();
    await s.nc.tap();
    assert.equal(s.nc.playing, false);
    assert.deepEqual(nonzero(s.masks), []);
    const u = await setup();
    await u.nc.tick();
    u.sim.sample = { value: true, confirmed: false };
    await u.nc.tap();
    assert.equal(u.nc.playing, false);
    assert.deepEqual(nonzero(u.masks), []);
  });

  test('taps during a run are ignored', async () => {
    const s = await setup({ closeAfter: null });
    await s.nc.tick();
    await s.nc.tap();
    s.sim.advance(); await s.nc.turn();
    const start = s.nc.playing;
    await s.nc.tap();
    assert.equal(start, true);
    assert.equal(s.intervals.size, 2, 'one poll and one run loop');
  });

  test('flag off or gate closed mid-run releases everything', async () => {
    const s = await setup({ closeAfter: null });
    await s.nc.tick();
    await s.nc.tap();
    assert.notEqual(s.mixer.mask, 0);
    s.labs.set(false);
    assert.equal(s.nc.playing, false);
    assert.equal(s.nc.running, false);
    assert.equal(s.mixer.mask, 0);
    assert.equal(s.root.hidden, true);
    assert.equal(s.nc.last.reason, 'stopped');
    assert.equal(s.intervals.size, 0);

    const g = await setup({ closeAfter: null });
    await g.nc.tick();
    await g.nc.tap();
    g.nc.setGate({ active: false });
    assert.equal(g.nc.playing, false);
    assert.equal(g.mixer.mask, 0);
    assert.equal(g.intervals.size, 0);
  });

  test('flag off: no polling, no button, a tap sends nothing', async () => {
    const s = await setup({ flag: false });
    assert.equal(s.nc.running, false);
    await s.nc.tap();
    assert.equal(s.sim.reads, 0);
    assert.equal(s.root.hidden, true);
    assert.deepEqual(nonzero(s.masks), []);
  });

  test('the pad keeps working alongside: its own source is untouched', async () => {
    const s = await setup({ closeAfter: null });
    await s.nc.tick();
    s.mixer.set('pad', PAD.left);
    await s.nc.tap();
    assert.equal(s.mixer.mask, PAD.left | PAD.start);
    s.labs.set(false);
    assert.equal(s.mixer.mask, PAD.left);
  });

  test('the button is built once with the semantic label', () => {
    const root = fakeRoot();
    const made = [];
    root.ownerDocument.createElement = () => { const el = { dataset: {}, className: '' }; made.push(el); return el; };
    root.querySelector = () => null;
    createNamingConfirm({ root, mixer: createInputMixer(() => {}), labs: { isOn: () => false, onChange() {} }, timers: { setInterval() {}, clearInterval() {} } });
    assert.equal(made.length, 1);
    assert.equal(made[0].textContent, ACTION.label);
    assert.equal(made[0].dataset.action, ACTION.id);
  });
});
