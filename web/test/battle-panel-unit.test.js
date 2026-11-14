// Unit (no browser): battle command panel lifecycle and policy (#116), with a
// fake semantic source simulating battleInput(): the command cursor (4 rows),
// target selection and the acting slot.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createBattlePanel, BATTLE_PANEL_FLAG, PRESS_MS } from '../js/battle-panel.js';
import { PAD, createInputMixer } from '../js/pad.js';
import { battlePanelPlan } from '../js/semantic/battle-panel.js';

/** A fake DOM root: enough for buildPanel, show() and the click handler. */
function fakeRoot() {
  const handlers = {};
  const rowButtons = [0, 1, 2, 3].map(() => ({ disabled: false }));
  const doc = {
    documentElement: { attrs: new Set(), toggleAttribute(n, on) { on ? this.attrs.add(n) : this.attrs.delete(n); } },
    createElement() { return { dataset: {}, append() {}, className: '' }; },
  };
  return {
    hidden: true, dataset: {}, ownerDocument: doc, rowButtons,
    querySelector: () => true,
    querySelectorAll: () => rowButtons,
    addEventListener(t, fn) { handlers[t] = fn; },
    handlers,
    contains: () => true,
  };
}

async function setup({ flag = true, gate = true, actor = 0, row = 0, targeting = null, confirmed = true } = {}) {
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
    isOn: (n) => n === BATTLE_PANEL_FLAG && on,
    onChange: (cb) => listeners.push(cb),
    set(v) { on = v; for (const cb of listeners) cb(BATTLE_PANEL_FLAG, v); },
  };
  const masks = [];
  const mixer = createInputMixer((m) => masks.push(m));
  const root = fakeRoot();
  const sim = {
    frame: 100, actor, row, targeting, confirmed, mask: 0, reads: 0, override: null,
    async battleInput() {
      this.reads++;
      if (this.override) return this.override;
      return { value: { actor: this.actor, row: this.actor === 0 ? this.row : null, targeting: this.targeting }, confirmed: this.confirmed };
    },
    /** One game frame: a fresh press acts as the battle menu does (rows 0-3, wrapping as the source says). */
    advance() {
      const m = mixer.mask;
      const rising = m & ~this.mask;
      this.mask = m;
      if (this.actor !== null && !this.targeting) {
        if (rising & PAD.down) this.row = (this.row + 1) % 4;
        if (rising & PAD.up) this.row = (this.row + 3) % 4;
        if (rising & PAD.circle) this.targeting = { index: 4 };
      } else if (this.targeting) {
        if (rising & PAD.circle) { this.targeting = null; this.actor = null; }
        if (rising & PAD.cross) this.targeting = null;
      }
      this.frame++;
    },
  };
  const panel = createBattlePanel({ root, mixer, labs, timers });
  panel.setSource(sim);
  if (gate) panel.setGate({ active: true });
  const releaseTimeouts = () => { for (const h of [...timeouts]) { timeouts.delete(h); h.fn(); } };
  async function drive(max = 400) {
    for (let i = 0; i < max && panel.planning; i++) { sim.advance(); await panel.turn(); }
  }
  await new Promise((r) => setImmediate(r));
  return { panel, sim, masks, mixer, labs, root, timeouts, intervals, releaseTimeouts, drive };
}

const nonzero = (masks) => masks.filter((m) => m !== 0);

describe('createBattlePanel', () => {
  test('shows the command view, the targeting view, or nothing', async () => {
    const s = await setup();
    await s.panel.tick();
    assert.equal(s.root.hidden, false);
    assert.equal(s.root.dataset.view, 'command');
    assert.ok(s.root.ownerDocument.documentElement.attrs.has('data-battle-panel-on'));
    assert.ok(s.root.rowButtons.every((b) => !b.disabled));
    s.sim.targeting = { index: 5 };
    await s.panel.tick();
    assert.equal(s.root.dataset.view, 'targeting');
    s.sim.targeting = null;
    s.sim.actor = null;
    await s.panel.tick();
    assert.equal(s.root.hidden, true);
    assert.ok(!s.root.ownerDocument.documentElement.attrs.has('data-battle-panel-on'));
    s.sim.actor = 0;
    s.sim.confirmed = false;
    await s.panel.tick();
    assert.equal(s.root.hidden, true, 'unconfirmed: hidden');
    s.sim.confirmed = true;
    await s.panel.tick();
    s.sim.override = { value: null, confirmed: false, reason: 'read failed' };
    await s.panel.tick();
    assert.equal(s.root.hidden, false, 'a failed read leaves it as it is');
  });

  test('an unconfirmed row (slots 1 and 2) disables the rows', async () => {
    const s = await setup({ actor: 2 });
    await s.panel.tick();
    assert.equal(s.root.dataset.view, 'command');
    assert.ok(s.root.rowButtons.every((b) => b.disabled));
    await s.panel.tapRow(1);
    assert.deepEqual(s.masks, []);
    assert.equal(s.panel.last.error.reason, 'unread');
  });

  test('flag off or gate closed: no panel, no reads, taps send nothing', async () => {
    for (const opts of [{ flag: false }, { gate: false }]) {
      const s = await setup(opts);
      assert.equal(s.panel.running, false);
      assert.equal(s.root.hidden, true);
      await s.panel.tapRow(2);
      await s.panel.tapAction('confirm');
      assert.deepEqual(s.masks, []);
      assert.equal(s.sim.reads, 0);
    }
  });

  test('tapping each row presses the planner steps for that row, then Circle', async () => {
    for (let to = 0; to < 4; to++) {
      for (let from = 0; from < 4; from++) {
        const s = await setup({ row: from });
        await s.panel.tick();
        await s.panel.tapRow(to);
        await s.drive();
        const want = battlePanelPlan(from, to).steps.map((st) => st.mask);
        assert.deepEqual(nonzero(s.masks), [...want, PAD.circle], `from ${from} to ${to}`);
        assert.equal(s.sim.row, to);
        assert.equal(s.panel.last.ok, true);
        s.releaseTimeouts();
        assert.equal(s.mixer.mask, 0, 'Circle is released');
      }
    }
  });

  test('plans never wrap (wrapping is a hypothesis): row 3 to row 0 is three Ups', async () => {
    const s = await setup({ row: 3 });
    await s.panel.tick();
    await s.panel.tapRow(0);
    await s.drive();
    assert.deepEqual(nonzero(s.masks), [PAD.up, PAD.up, PAD.up, PAD.circle]);
  });

  test('targeting buttons press Left, Right, Circle and Cross once each', async () => {
    const want = { prev: PAD.left, next: PAD.right, confirm: PAD.circle, back: PAD.cross };
    for (const [id, mask] of Object.entries(want)) {
      const s = await setup({ targeting: { index: 4 } });
      await s.panel.tick();
      await s.panel.tapAction(id);
      assert.deepEqual(s.masks, [mask], id);
      assert.ok(PRESS_MS > 0);
      await s.panel.tapAction(id); // ignored while held
      assert.deepEqual(s.masks, [mask]);
      s.releaseTimeouts();
      assert.deepEqual(s.masks, [mask, 0]);
    }
  });

  test('targeting buttons do nothing in the command view, row taps nothing in targeting', async () => {
    const s = await setup();
    await s.panel.tick();
    await s.panel.tapAction('confirm');
    assert.deepEqual(s.masks, []);
    s.sim.targeting = { index: 4 };
    await s.panel.tick();
    await s.panel.tapRow(2);
    assert.deepEqual(s.masks, []);
    assert.equal(s.panel.planning, false);
  });

  test('the view is read again at tap time: a stale view sends nothing', async () => {
    const s = await setup();
    await s.panel.tick(); // command view shown
    s.sim.targeting = { index: 4 }; // the game moved on before the next poll
    await s.panel.tapRow(2);
    assert.deepEqual(s.masks, []);
    s.sim.targeting = null;
    s.sim.actor = null;
    await s.panel.tapAction('confirm');
    assert.deepEqual(s.masks, []);
  });

  test('a tap while a plan runs is ignored', async () => {
    const s = await setup();
    await s.panel.tick();
    await s.panel.tapRow(3);
    assert.equal(s.panel.planning, true);
    await s.panel.tapRow(1);
    await s.drive();
    assert.equal(s.sim.row, 3);
    assert.deepEqual(nonzero(s.masks), [PAD.down, PAD.down, PAD.down, PAD.circle]);
  });

  test('a stuck cursor stops the plan: everything released, no Circle', async () => {
    const s = await setup();
    await s.panel.tick();
    await s.panel.tapRow(2);
    s.sim.advance = function () { this.frame++; };
    await s.drive();
    assert.equal(s.panel.last.error.reason, 'stuck');
    assert.equal(s.mixer.mask, 0);
    assert.ok(!s.masks.includes(PAD.circle));
  });

  test('a skipped target row stops the plan as moved; a skip towards the target is progress (#189)', async () => {
    const skipRow2 = (s) => {
      const orig = s.sim.advance.bind(s.sim);
      s.sim.advance = function () { orig(); if (this.row === 2) this.row = 3; }; // row 2 is blank and skipped
    };
    // Row 2 itself: the cursor lands past it, nothing is selected.
    const s = await setup();
    await s.panel.tick();
    await s.panel.tapRow(2);
    skipRow2(s);
    await s.drive();
    assert.equal(s.panel.last.error.reason, 'moved');
    assert.ok(!s.masks.includes(PAD.circle));
    assert.equal(s.mixer.mask, 0);
    // Row 3 past the skipped row 2: reached (#171 showed the game skips rows
    // with no command), then Circle. Before #189 this stopped as moved.
    const t = await setup();
    await t.panel.tick();
    await t.panel.tapRow(3);
    skipRow2(t);
    await t.drive();
    assert.deepEqual(t.panel.last, { ok: true, row: 3 });
    assert.equal(t.sim.row, 3);
    assert.ok(t.masks.includes(PAD.circle));
  });

  test('the menu leaving mid-plan (another slot, targeting) stops it at once', async () => {
    for (const change of [(sim) => { sim.actor = 1; }, (sim) => { sim.targeting = { index: 4 }; }, (sim) => { sim.actor = null; }]) {
      const s = await setup();
      await s.panel.tick();
      await s.panel.tapRow(3);
      s.sim.advance(); await s.panel.turn();
      change(s.sim);
      s.sim.advance(); await s.panel.turn();
      assert.equal(s.panel.planning, false);
      assert.equal(s.panel.last.error.reason, 'left');
      assert.equal(s.mixer.mask, 0);
      assert.ok(!s.masks.includes(PAD.circle));
    }
  });

  test('the panel hiding cancels the plan; the flag turning off stops everything', async () => {
    const s = await setup();
    await s.panel.tick();
    await s.panel.tapRow(3);
    s.sim.advance(); await s.panel.turn();
    s.sim.confirmed = false;
    await s.panel.tick();
    assert.equal(s.panel.planning, false);
    assert.equal(s.mixer.mask, 0);
    assert.equal(s.root.hidden, true);

    const t = await setup();
    await t.panel.tick();
    await t.panel.tapRow(3);
    t.labs.set(false);
    assert.equal(t.panel.planning, false);
    assert.equal(t.panel.running, false);
    assert.equal(t.mixer.mask, 0);
    assert.equal(t.intervals.size, 0);
  });

  test('the same game frame is not stepped twice', async () => {
    const s = await setup();
    await s.panel.tick();
    await s.panel.tapRow(2);
    const reads = s.sim.reads;
    await s.panel.turn();
    await s.panel.turn();
    assert.equal(s.sim.reads, reads);
  });

  test('the click handler routes rows and actions, and ignores disabled buttons', async () => {
    const s = await setup({ targeting: { index: 4 } });
    await s.panel.tick();
    const btn = (dataset, disabled = false) => ({ closest: () => ({ dataset, disabled }) });
    s.root.handlers.click({ target: btn({ action: 'back' }, true) });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(s.masks, []);
    s.root.handlers.click({ target: btn({ action: 'back' }) });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(s.masks, [PAD.cross]);
  });
});
