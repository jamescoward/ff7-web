// Unit: the battle command panel's platform-neutral facts (#116):
// semantic/controls.js BATTLE_PANEL_ACTIONS, semantic/menus.js battleCommand
// and semantic/battle-panel.js.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { battlePanelPlan, battlePanelRows, battlePanelView, battlePlanCursor } from '../../../semantic/battle-panel.js';
import { BATTLE_PANEL_ACTIONS, BATTLE_TARGET_ACTIONS } from '../../../semantic/controls.js';
import { MENUS, menuPlanArgs } from '../../../semantic/menus.js';
import { ADDRESS_TABLE } from '../../../semantic/addresses.js';
import { PAD } from '../../pad.js';

const sample = (actor, row, targeting = null, confirmed = true) => ({ value: { actor, row, targeting }, confirmed });

describe('BATTLE_PANEL_ACTIONS', () => {
  test('frozen data naming real pad buttons; targeting is Left, Right, Circle, Cross', () => {
    assert.ok(Object.isFrozen(BATTLE_PANEL_ACTIONS) && Object.isFrozen(BATTLE_TARGET_ACTIONS));
    for (const a of Object.values(BATTLE_PANEL_ACTIONS)) {
      assert.ok(Object.isFrozen(a));
      assert.ok(a.button in PAD, a.button);
    }
    assert.equal(BATTLE_PANEL_ACTIONS.select.button, 'circle');
    assert.deepEqual(BATTLE_TARGET_ACTIONS.map((id) => BATTLE_PANEL_ACTIONS[id].button), ['left', 'right', 'circle', 'cross']);
    for (const id of BATTLE_TARGET_ACTIONS) {
      assert.equal(BATTLE_PANEL_ACTIONS[id].when, 'targeting');
      assert.ok(BATTLE_PANEL_ACTIONS[id].label);
    }
  });
});

describe('MENUS.battleCommand', () => {
  test('4 generic rows; row count and wrapping are hypotheses, so plans never wrap', () => {
    const m = MENUS.battleCommand;
    assert.equal(m.rows, 4);
    assert.equal(m.rowsStatus, 'hypothesis');
    assert.equal(m.wrapsStatus, 'hypothesis');
    assert.deepEqual(m.labels, ['Command 1', 'Command 2', 'Command 3', 'Command 4']);
    assert.equal(menuPlanArgs('battleCommand').wraps, false);
    assert.ok(ADDRESS_TABLE.entries.some((e) => e.name === m.cursor && e.status === 'confirmed'), 'slot 0 row is a confirmed entry');
  });
});

describe('battle-panel.js', () => {
  test('battlePanelRows follows the labels', () => {
    assert.deepEqual(battlePanelRows(), [0, 1, 2, 3].map((row) => ({ row, label: `Command ${row + 1}` })));
  });

  test('battlePanelView', () => {
    assert.deepEqual(battlePanelView(sample(0, 2)), { view: 'command', actor: 0, row: 2 });
    assert.deepEqual(battlePanelView(sample(1, null)), { view: 'command', actor: 1, row: null });
    assert.deepEqual(battlePanelView(sample(0, 1, { index: 4 })), { view: 'targeting', actor: 0, row: null });
    assert.deepEqual(battlePanelView(sample(null, null, { index: 4 })), { view: 'targeting', actor: null, row: null });
    assert.equal(battlePanelView(sample(null, null)).view, 'hidden');
    assert.equal(battlePanelView(sample(0, 0, null, false)).view, 'hidden');
    assert.equal(battlePanelView({ value: { actor: null, row: null, targeting: null }, confirmed: false, reason: 'not in battle' }).view, 'hidden');
    assert.equal(battlePanelView({ value: null, confirmed: false, reason: 'read failed' }), null);
    assert.equal(battlePanelView(null), null);
    assert.equal(battlePanelView(sample(0, 1.5)).row, null);
  });

  test('battlePanelPlan uses the planner without wrapping', () => {
    const p = battlePanelPlan(3, 0);
    assert.equal(p.wraps, false);
    assert.deepEqual(p.steps.map((s) => s.button), ['up', 'up', 'up']);
    assert.deepEqual(battlePanelPlan(1, 1).steps, []);
    assert.throws(() => battlePanelPlan(0, 4), RangeError);
  });

  test('battlePlanCursor', () => {
    assert.equal(battlePlanCursor(sample(0, 2), 0), 2);
    assert.equal(battlePlanCursor(sample(0, null), 0), null);
    assert.equal(battlePlanCursor(sample(0, 2, null, false), 0), null);
    assert.equal(battlePlanCursor({ value: null, confirmed: false }, 0), null);
    assert.equal(battlePlanCursor(null, 0), null);
    assert.equal(battlePlanCursor(sample(1, 2), 0), 'left');
    assert.equal(battlePlanCursor(sample(null, null), 0), 'left');
    assert.equal(battlePlanCursor(sample(0, 2, { index: 4 }), 0), 'left');
  });

  test('has no DOM, Worker, Node or timer references', () => {
    const src = readFileSync(new URL('../../../semantic/battle-panel.js', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    for (const word of ['document', 'window', 'Worker', 'require', 'process', 'setTimeout', 'setInterval']) {
      assert.ok(!new RegExp(`\\b${word}\\b`).test(src), `references ${word}`);
    }
  });
});
