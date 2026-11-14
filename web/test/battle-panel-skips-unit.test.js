// Unit (no browser): the battle command panel over rows the game skips (#189).
// The fake battleInput() reports the row for every slot (confirmed since
// #171), and the simulated menu has only the rows in `present`: a press moves
// the cursor to the next row that exists, as the game does with no materia
// (one Down from row 0 reaches row 3).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createBattlePanel, BATTLE_PANEL_FLAG } from '../js/battle-panel.js';
import { PAD, createInputMixer } from '../js/pad.js';

function fakeRoot() {
  const rowButtons = [0, 1, 2, 3].map(() => ({ disabled: false }));
  const doc = {
    documentElement: { toggleAttribute() {} },
    createElement() { return { dataset: {}, append() {}, className: '' }; },
  };
  return {
    hidden: true, dataset: {}, ownerDocument: doc, rowButtons,
    querySelector: () => true,
    querySelectorAll: () => rowButtons,
    addEventListener() {},
    contains: () => true,
  };
}

async function setup({ actor = 0, row = 0, present = [0, 3] } = {}) {
  const timers = {
    setInterval: (fn) => ({ fn }), clearInterval() {},
    setTimeout: (fn) => ({ fn }), clearTimeout() {},
  };
  const labs = { isOn: (n) => n === BATTLE_PANEL_FLAG, onChange() {} };
  const masks = [];
  const mixer = createInputMixer((m) => masks.push(m));
  const root = fakeRoot();
  const sim = {
    frame: 100, actor, row, targeting: null, mask: 0, presses: 0,
    async battleInput() {
      return { value: { actor: this.actor, row: this.row, targeting: this.targeting }, confirmed: true };
    },
    advance() {
      const m = mixer.mask;
      const rising = m & ~this.mask;
      this.mask = m;
      if (!this.targeting) {
        const d = rising & PAD.down ? 1 : rising & PAD.up ? -1 : 0;
        if (d) {
          this.presses++;
          const next = present.filter((r) => (d > 0 ? r > this.row : r < this.row)).sort((a, b) => d * (a - b))[0];
          if (next !== undefined) this.row = next;
        }
        if (rising & PAD.circle) this.targeting = { index: 4 };
      }
      this.frame++;
    },
  };
  const panel = createBattlePanel({ root, mixer, labs, timers });
  panel.setSource(sim);
  panel.setGate({ active: true });
  await new Promise((r) => setImmediate(r));
  async function drive(max = 400) {
    for (let i = 0; i < max && panel.planning; i++) { sim.advance(); await panel.turn(); }
  }
  return { panel, sim, masks, root, drive };
}

describe('battle panel over skipped rows (#189)', () => {
  for (const actor of [0, 1, 2]) {
    test(`slot ${actor}: rows are enabled, and a tap on row 3 reaches it in one Down, then Circle`, async () => {
      const s = await setup({ actor });
      await s.panel.tick();
      assert.equal(s.root.dataset.view, 'command');
      assert.ok(s.root.rowButtons.every((b) => !b.disabled));
      await s.panel.tapRow(3);
      await s.drive();
      assert.equal(s.panel.planning, false);
      assert.deepEqual(s.panel.last, { ok: true, row: 3 });
      assert.equal(s.sim.row, 3);
      assert.equal(s.sim.presses, 1);
      assert.ok(s.masks.includes(PAD.circle), 'Circle pressed after the plan');
    });
  }

  test('a tap on row 0 from row 3 comes back in one Up', async () => {
    const s = await setup({ actor: 1, row: 3 });
    await s.panel.tick();
    await s.panel.tapRow(0);
    await s.drive();
    assert.deepEqual(s.panel.last, { ok: true, row: 0 });
    assert.equal(s.sim.row, 0);
    assert.equal(s.sim.presses, 1);
  });

  test('a tap on a skipped row stops (moved) and never presses Circle', async () => {
    for (const to of [1, 2]) {
      const s = await setup({ actor: 2 });
      await s.panel.tick();
      await s.panel.tapRow(to);
      await s.drive();
      assert.equal(s.panel.planning, false);
      assert.equal(s.panel.last.ok, false);
      assert.equal(s.panel.last.error.reason, 'moved');
      assert.equal(s.sim.row, 3);
      assert.ok(!s.masks.some((m) => m & PAD.circle), 'no Circle');
      assert.equal(s.masks.at(-1), 0, 'everything released');
      assert.equal(s.sim.targeting, null);
    }
  });

  test('every row present: the plan presses once per row, as before', async () => {
    const s = await setup({ present: [0, 1, 2, 3] });
    await s.panel.tick();
    await s.panel.tapRow(3);
    await s.drive();
    assert.deepEqual(s.panel.last, { ok: true, row: 3 });
    assert.equal(s.sim.presses, 3);
  });
});
