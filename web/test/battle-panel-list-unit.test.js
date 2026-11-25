// Unit (no browser): the battle panel's list view (#253 part 2), with a fake
// semantic source simulating battleInput(), battleList() and
// battleListEntries(): a Magic list of 3 columns and an Item list of 1, 3 rows
// a page, scrolling as Tier 2 showed (save-boot-29a, 29d). A tap must send
// exactly the planner's presses, then Circle; a mismatch stops input.
// Original project code, GPL-2.0-or-later.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createBattlePanel, BATTLE_PANEL_FLAG } from '../js/battle-panel.js';
import { PAD, createInputMixer } from '../js/pad.js';
import { battleListIndex, battleListPlan, battleListStep } from '../js/semantic/battle-lists.js';

/** A small fake DOM: buildPanel's elements, renderList's buttons and the click handler. */
function fakeDoc() {
  const doc = {
    documentElement: { attrs: new Set(), toggleAttribute(n, on) { on ? this.attrs.add(n) : this.attrs.delete(n); } },
    createElement(tag) {
      const el = {
        tag, dataset: {}, className: '', children: [], hidden: false, disabled: false, textContent: '', ownerDocument: doc,
        append(...c) { this.children.push(...c); },
        replaceChildren(...c) { this.children = c; },
        all() { return this.children.flatMap((ch) => [ch, ...ch.all()]); },
        querySelector(sel) { return this.all().find((e) => match(e, sel)) ?? null; },
        querySelectorAll(sel) { return this.all().filter((e) => match(e, sel)); },
        contains: () => true,
        addEventListener(t, fn) { (this.handlers ??= {})[t] = fn; },
      };
      return el;
    },
  };
  return doc;
}
function match(el, sel) {
  if (sel.startsWith('.')) return el.className.split(' ').includes(sel.slice(1));
  const m = /^button\[data-(\w+)\]$/.exec(sel);
  return m ? el.tag === 'button' && el.dataset[m[1]] !== undefined : false;
}

async function setup({ list = 'magic', actor = 0, pos = { row: 0, offset: 0, column: 0 }, cursorConfirmed = true } = {}) {
  const intervals = new Set();
  const timeouts = new Set();
  const timers = {
    setInterval(fn) { const h = { fn }; intervals.add(h); return h; },
    clearInterval(h) { intervals.delete(h); },
    setTimeout(fn) { const h = { fn }; timeouts.add(h); return h; },
    clearTimeout(h) { timeouts.delete(h); },
  };
  const labs = { isOn: (n) => n === BATTLE_PANEL_FLAG, onChange() {} };
  const masks = [];
  const mixer = createInputMixer((m) => masks.push(m));
  const root = fakeDoc().createElement('div');
  const sim = {
    frame: 100, list, actor, pos: { ...pos }, targeting: null, mask: 0, presses: [], stuck: false,
    async battleInput() {
      return { value: { actor: this.list ? null : this.actor, row: null, targeting: this.targeting }, confirmed: true };
    },
    async battleList() {
      if (!this.list) return { value: { actor: null, list: null, index: null, row: null, offset: null, column: null }, confirmed: true };
      if (!cursorConfirmed) return { value: { actor: this.actor, list: this.list, index: null, row: null, offset: null, column: null }, confirmed: true };
      const index = battleListIndex(this.list, this.pos);
      return { value: { actor: this.actor, list: this.list, index, ...this.pos, column: this.list === 'magic' ? this.pos.column : null }, confirmed: true };
    },
    async battleListEntries(l) {
      return l === 'magic'
        ? { value: [0, 1, 2, 5, 9, 13].map((index) => ({ index, id: index })), confirmed: true }
        : { value: [0, 1, 2, 3, 4].map((index) => ({ index, count: 9 - index, item: { index, kind: 'item', number: index } })), confirmed: true };
    },
    /** One game frame: a fresh press acts as the battle list does; Circle opens target selection. */
    advance() {
      const m = mixer.mask;
      const rising = m & ~this.mask;
      this.mask = m;
      for (const b of ['up', 'down', 'left', 'right', 'circle', 'cross']) if (rising & PAD[b]) this.presses.push(b);
      if (this.list && !this.stuck) {
        for (const b of ['up', 'down', 'left', 'right']) if (rising & PAD[b]) this.pos = battleListStep(this.list, this.pos, b);
        if (rising & PAD.circle) { this.list = null; this.targeting = { index: 4 }; }
      }
      this.frame++;
    },
  };
  const panel = createBattlePanel({ root, mixer, labs, timers });
  panel.setSource(sim);
  panel.setGate({ active: true });
  const releaseTimeouts = () => { for (const h of [...timeouts]) { timeouts.delete(h); h.fn(); } };
  async function drive(max = 400) {
    for (let i = 0; i < max && panel.planning; i++) { sim.advance(); await panel.turn(); }
    sim.advance(); // the frame that sees the final press (Circle), if any
    releaseTimeouts();
    sim.advance();
  }
  await new Promise((r) => setImmediate(r));
  await panel.tick();
  return { panel, sim, masks, root, drive };
}
const entryButtons = (root) => root.querySelectorAll('button[data-index]');

describe('battle panel list view (#253 part 2)', () => {
  test('an open Magic list shows its entries (ids only), enabled', async () => {
    const { panel, root } = await setup();
    assert.equal(panel.view.view, 'list');
    assert.equal(root.dataset.view, 'list');
    assert.equal(root.hidden, false);
    const b = entryButtons(root);
    assert.deepEqual(b.map((x) => x.textContent), ['Spell #0', 'Spell #1', 'Spell #2', 'Spell #5', 'Spell #9', 'Spell #13']);
    assert.ok(b.every((x) => !x.disabled));
    assert.equal(root.querySelector('.bp-note').hidden, true);
  });

  test('a Magic tap sends exactly the plan, then Circle; target selection follows', async () => {
    const { panel, sim, drive } = await setup({ pos: { row: 1, offset: 0, column: 2 } });
    const plan = battleListPlan('magic', { row: 1, offset: 0, column: 2 }, 13);
    await panel.tapEntry(13);
    await drive();
    assert.deepEqual(sim.presses, [...plan.steps.map((s) => s.button), 'circle']);
    assert.deepEqual(plan.steps.map((s) => s.button), ['down', 'down', 'down', 'left']);
    assert.deepEqual(panel.last, { ok: true, list: 'magic', index: 13 });
    assert.deepEqual(sim.targeting, { index: 4 });
    await panel.tick();
    assert.equal(panel.view.view, 'targeting');
  });

  test('an Item tap through a scroll sends the plan, then Circle', async () => {
    const { panel, sim, root, drive } = await setup({ list: 'item' });
    assert.deepEqual(entryButtons(root).map((x) => x.textContent).slice(0, 2), ['item #0 ×9', 'item #1 ×8']);
    await panel.tapEntry(4);
    await drive();
    assert.deepEqual(sim.presses, ['down', 'down', 'down', 'down', 'circle']);
    assert.equal(panel.last.ok, true);
  });

  test('a mismatch (the cursor does not move) stops input: no Circle', async () => {
    const { panel, sim, drive, masks } = await setup();
    sim.stuck = true;
    await panel.tapEntry(5);
    await drive();
    assert.equal(panel.last.ok, false);
    assert.ok(!sim.presses.includes('circle'));
    assert.equal(masks.at(-1), 0);
  });

  test('the list closing mid-plan stops with left', async () => {
    const { panel, sim, masks } = await setup();
    await panel.tapEntry(13);
    await new Promise((r) => setImmediate(r)); // the tap's first turn
    sim.list = null;
    sim.advance();
    await panel.turn();
    assert.equal(panel.planning, false);
    assert.deepEqual(panel.last, { ok: false, list: 'magic', index: 13, error: { reason: 'left' } });
    assert.equal(masks.at(-1), 0);
  });

  test('a cursor that is not a confirmed read: entries greyed, a tap sends nothing', async () => {
    const { panel, sim, root, masks } = await setup({ actor: 1, cursorConfirmed: false });
    assert.equal(panel.view.view, 'list');
    assert.ok(entryButtons(root).every((x) => x.disabled));
    assert.match(root.querySelector('.bp-note').textContent, /not confirmed/);
    await panel.tapEntry(0);
    assert.equal(panel.planning, false);
    assert.equal(panel.last.error.reason, 'unread');
    sim.advance();
    assert.ok(masks.every((m) => m === 0));
  });

  test('an index past the list is refused', async () => {
    const { panel } = await setup();
    await panel.tapEntry(99);
    assert.equal(panel.planning, false);
    assert.equal(panel.last.error.reason, 'range');
  });
});
