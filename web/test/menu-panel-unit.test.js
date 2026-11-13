// Unit (no browser): tap-to-select main menu panel lifecycle and policy (#115),
// with a fake semantic source and a simulated menu cursor (10 rows, wraps).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createMenuPanel, PANEL_FLAG, PRESS_MS } from '../js/menu-panel.js';
import { PAD, createInputMixer } from '../js/pad.js';
import { MENUS } from '../js/semantic/menus.js';
import { menuPanelPlan } from '../js/semantic/menu-panel.js';

const menu = { value: { mode: 'menu' }, confirmed: true };
const field = { value: { mode: 'field' }, confirmed: true };

/** A fake DOM root: enough for buildPanel, show() and the click handler. */
function fakeRoot() {
  const handlers = {};
  const doc = {
    documentElement: { attrs: new Set(), toggleAttribute(n, on) { on ? this.attrs.add(n) : this.attrs.delete(n); } },
    createElement() { return { dataset: {}, append() {}, className: '' }; },
  };
  return { hidden: true, ownerDocument: doc, querySelector: () => true, addEventListener(t, fn) { handlers[t] = fn; }, handlers, contains: () => true };
}

async function setup({ flag = true, gate = true, mode = menu, cursor = 0, wraps = true } = {}) {
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
    isOn: (n) => n === PANEL_FLAG && on,
    onChange: (cb) => listeners.push(cb),
    set(v) { on = v; for (const cb of listeners) cb(PANEL_FLAG, v); },
  };
  const masks = [];
  const mixer = createInputMixer((m) => masks.push(m));
  const root = fakeRoot();
  const sim = {
    frame: 100, mode, cursor, mask: 0, reads: 0, cursorSample: null, held: 0,
    async mode() { return this.mode; },
    async menuCursor() {
      this.reads++;
      return this.cursorSample ?? { value: this.cursor, confirmed: true };
    },
    /** One game frame: a fresh press of Up/Down moves the cursor (like the game does). */
    advance() {
      const m = mixer.mask;
      const rising = m & ~this.mask;
      this.mask = m;
      if (rising & PAD.down) this.cursor = (this.cursor + 1) % 10;
      if (rising & PAD.up) this.cursor = (this.cursor + 9) % 10;
      this.frame++;
    },
  };
  const panel = createMenuPanel({ root, mixer, labs, timers });
  panel.setSource(sim);
  if (gate) panel.setGate({ active: true });
  const releaseTimeouts = () => { for (const h of [...timeouts]) { timeouts.delete(h); h.fn(); } };
  /** Run the plan loop until it stops (or `max` frames pass). */
  async function drive(max = 400) {
    for (let i = 0; i < max && panel.planning; i++) { sim.advance(); await panel.turn(); }
  }
  await new Promise((r) => setImmediate(r)); // let the first poll finish
  return { panel, sim, masks, mixer, labs, root, timeouts, intervals, releaseTimeouts, drive };
}

const nonzero = (masks) => masks.filter((m) => m !== 0);

describe('createMenuPanel', () => {
  test('the panel shows only in a confirmed menu mode', async () => {
    const s = await setup();
    await s.panel.tick();
    assert.equal(s.root.hidden, false);
    assert.ok(s.root.ownerDocument.documentElement.attrs.has('data-menu-panel-on'));
    for (const m of [field, { ...menu, confirmed: false }]) {
      s.sim.mode = m;
      await s.panel.tick();
      assert.equal(s.root.hidden, true, JSON.stringify(m));
    }
    s.sim.mode = menu;
    await s.panel.tick();
    assert.equal(s.root.hidden, false);
    // A failed read leaves it as it is.
    s.sim.mode = { value: null, confirmed: false };
    await s.panel.tick();
    assert.equal(s.root.hidden, false);
  });

  test('flag off: no panel, no polling, taps send nothing', async () => {
    const s = await setup({ flag: false });
    assert.equal(s.panel.running, false);
    assert.equal(s.root.hidden, true);
    await s.panel.tapRow(3);
    s.panel.tapAction('back');
    assert.deepEqual(s.masks, []);
    assert.equal(s.sim.reads, 0);
  });

  test('gate closed: no panel and taps send nothing', async () => {
    const s = await setup({ gate: false });
    assert.equal(s.root.hidden, true);
    await s.panel.tapRow(3);
    assert.deepEqual(s.masks, []);
  });

  test('tapping each row presses the planner steps for that row, then Circle', async () => {
    for (let to = 0; to < MENUS.main.rows; to++) {
      for (const from of [0, 4, 9]) {
        const s = await setup({ cursor: from });
        await s.panel.tick();
        await s.panel.tapRow(to);
        await s.drive();
        const want = menuPanelPlan(from, to).steps.map((st) => st.mask);
        assert.deepEqual(nonzero(s.masks), [...want, PAD.circle], `from ${from} to ${to}`);
        assert.equal(s.sim.cursor, to);
        assert.equal(s.panel.last.ok, true);
        assert.equal(s.panel.planning, false);
        s.releaseTimeouts();
        assert.equal(s.masks.at(-1), 0, 'Circle is released');
        assert.equal(s.mixer.mask, 0);
      }
    }
  });

  test('a row the cursor is already on presses only Circle', async () => {
    const s = await setup({ cursor: 8 }); // PHS
    await s.panel.tick();
    await s.panel.tapRow(8);
    await s.drive();
    assert.deepEqual(nonzero(s.masks), [PAD.circle]);
  });

  test('Back and Close press Triangle once and release', async () => {
    for (const id of ['back', 'close']) {
      const s = await setup();
      await s.panel.tick();
      s.panel.tapAction(id);
      assert.deepEqual(s.masks, [PAD.triangle]);
      assert.equal(s.timeouts.size, 1);
      assert.ok(PRESS_MS > 0);
      s.panel.tapAction(id); // ignored while held
      assert.deepEqual(s.masks, [PAD.triangle]);
      s.releaseTimeouts();
      assert.deepEqual(s.masks, [PAD.triangle, 0]);
    }
  });

  test('taps outside a confirmed menu send nothing', async () => {
    const s = await setup({ mode: field });
    await s.panel.tick();
    await s.panel.tapRow(2);
    s.panel.tapAction('close');
    assert.deepEqual(s.masks, []);
  });

  test('a tap while a plan runs is ignored', async () => {
    const s = await setup({ cursor: 0 });
    await s.panel.tick();
    await s.panel.tapRow(3);
    assert.equal(s.panel.planning, true);
    await s.panel.tapRow(6);
    s.panel.tapAction('back');
    await s.drive();
    assert.equal(s.sim.cursor, 3);
    assert.deepEqual(nonzero(s.masks), [PAD.down, PAD.down, PAD.down, PAD.circle]);
  });

  test('an unread or unconfirmed cursor at tap time sends nothing', async () => {
    for (const sample of [{ value: null, confirmed: false }, { value: 2, confirmed: false }, null]) {
      const s = await setup();
      await s.panel.tick();
      s.sim.cursorSample = sample;
      await s.panel.tapRow(2);
      assert.deepEqual(s.masks, []);
      assert.equal(s.panel.planning, false);
      assert.equal(s.panel.last.ok, false);
    }
  });

  test('a stuck cursor stops the plan: everything released, no Circle', async () => {
    const s = await setup({ cursor: 0 });
    await s.panel.tick();
    await s.panel.tapRow(4);
    s.sim.advance = function () { this.frame++; this.mask = mixerMask(s); }; // the game ignores input
    await s.drive();
    assert.equal(s.panel.last.ok, false);
    assert.equal(s.panel.last.error.reason, 'stuck');
    assert.equal(s.mixer.mask, 0);
    assert.ok(!s.masks.includes(PAD.circle));
    assert.equal(s.panel.planning, false);
  });

  test('a cursor that jumps to the wrong row stops the plan', async () => {
    const s = await setup({ cursor: 0 });
    await s.panel.tick();
    await s.panel.tapRow(4);
    const orig = s.sim.advance.bind(s.sim);
    s.sim.advance = function () { orig(); if (this.cursor === 1) this.cursor = 5; };
    await s.drive();
    assert.equal(s.panel.last.error.reason, 'moved');
    assert.ok(!s.masks.includes(PAD.circle));
    assert.equal(s.mixer.mask, 0);
  });

  test('leaving menu mode cancels the plan and releases', async () => {
    const s = await setup({ cursor: 0 });
    await s.panel.tick();
    await s.panel.tapRow(5);
    s.sim.advance(); await s.panel.turn();
    s.sim.mode = field;
    await s.panel.tick();
    assert.equal(s.panel.planning, false);
    assert.equal(s.mixer.mask, 0);
    assert.equal(s.root.hidden, true);
    assert.ok(!s.masks.includes(PAD.circle));
  });

  test('turning the flag off cancels the plan, the poll and the press', async () => {
    const s = await setup({ cursor: 0 });
    await s.panel.tick();
    await s.panel.tapRow(5);
    s.sim.advance(); await s.panel.turn();
    s.labs.set(false);
    assert.equal(s.panel.planning, false);
    assert.equal(s.panel.running, false);
    assert.equal(s.mixer.mask, 0);
    assert.equal(s.root.hidden, true);
    assert.equal(s.intervals.size, 0);
  });

  test('the same game frame is not stepped twice', async () => {
    const s = await setup({ cursor: 0 });
    await s.panel.tick();
    await s.panel.tapRow(2);
    const reads = s.sim.reads;
    await s.panel.turn();
    await s.panel.turn();
    assert.equal(s.sim.reads, reads, 'no new reads without a new frame');
  });

  test('the click handler routes row and action buttons', async () => {
    const s = await setup({ cursor: 0 });
    await s.panel.tick();
    const btn = (dataset) => ({ closest: () => ({ dataset }) });
    s.root.handlers.click({ target: btn({ action: 'close' }) });
    assert.deepEqual(s.masks, [PAD.triangle]);
    s.releaseTimeouts();
    s.root.handlers.click({ target: btn({ row: '1' }) });
    await new Promise((r) => setImmediate(r));
    assert.equal(s.panel.planning, true);
  });
});

function mixerMask(s) { return s.sim.mask; }
