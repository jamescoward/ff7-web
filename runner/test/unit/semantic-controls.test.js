// Unit: semantic/controls.js (#114): tap meaning as plain data, no platform deps.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { DIALOGUE_ACTIONS, dialogueTapButton } from '../../../semantic/controls.js';
import { PAD } from '../../pad.js';

const sample = (open, waiting, confirmed = true) => ({ value: { open, waiting, choice: null }, confirmed });

describe('DIALOGUE_ACTIONS', () => {
  test('is frozen data naming real pad buttons', () => {
    assert.ok(Object.isFrozen(DIALOGUE_ACTIONS) && Object.isFrozen(DIALOGUE_ACTIONS.advance));
    assert.deepEqual(DIALOGUE_ACTIONS.advance, { id: 'advance', button: 'circle', when: 'waiting' });
    for (const a of Object.values(DIALOGUE_ACTIONS)) assert.ok(a.button in PAD, a.button);
  });
});

describe('dialogueTapButton', () => {
  test('waiting and confirmed gives circle', () => {
    assert.equal(dialogueTapButton(sample(true, true)), 'circle');
  });
  test('everything else gives null', () => {
    assert.equal(dialogueTapButton(sample(true, false)), null, 'typing');
    assert.equal(dialogueTapButton(sample(false, false)), null, 'closed');
    assert.equal(dialogueTapButton(sample(true, true, false)), null, 'unconfirmed');
    assert.equal(dialogueTapButton({ value: null, confirmed: false, reason: 'read failed' }), null);
    assert.equal(dialogueTapButton(null), null);
    assert.equal(dialogueTapButton(undefined), null);
    assert.equal(dialogueTapButton({ value: { waiting: 'yes' }, confirmed: true }), null);
  });
});

test('controls.js has no DOM, Worker, Node or timer references', () => {
  const src = readFileSync(new URL('../../../semantic/controls.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  for (const word of ['document', 'window', 'Worker', 'require(', 'process', 'setTimeout', 'setInterval', 'import']) {
    assert.ok(!new RegExp(`\\b${word.replace('(', '\\(')}`).test(src), `references ${word}`);
  }
});

describe('main-menu panel (#115): controls.js and menu-panel.js', () => {
  test('actions are frozen data naming real pad buttons', async () => {
    const { MENU_PANEL_ACTIONS } = await import('../../../semantic/controls.js');
    assert.ok(Object.isFrozen(MENU_PANEL_ACTIONS));
    assert.equal(MENU_PANEL_ACTIONS.select.button, 'circle');
    assert.equal(MENU_PANEL_ACTIONS.back.button, 'triangle');
    assert.equal(MENU_PANEL_ACTIONS.close.button, 'triangle');
    for (const a of Object.values(MENU_PANEL_ACTIONS)) assert.ok(a.button in PAD, a.button);
  });

  test('rows: 10 labels in screen order, matching the planner row count', async () => {
    const { menuPanelRows } = await import('../../../semantic/menu-panel.js');
    const { MENUS } = await import('../../../semantic/menus.js');
    const rows = menuPanelRows();
    assert.deepEqual(rows.map((r) => r.label), ['Item', 'Magic', 'Materia', 'Equip', 'Status', 'Order', 'Limit', 'Config', 'PHS', 'Save']);
    assert.deepEqual(rows.map((r) => r.row), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.equal(rows.length, MENUS.main.rows);
    assert.equal(MENUS.main.labelsStatus, 'hypothesis');
  });

  test('menuPanelPlan uses the confirmed main-menu facts (wrapping)', async () => {
    const { menuPanelPlan } = await import('../../../semantic/menu-panel.js');
    assert.deepEqual(menuPanelPlan(0, 0).steps, []);
    assert.deepEqual(menuPanelPlan(0, 3).steps.map((s) => s.button), ['down', 'down', 'down']);
    const wrap = menuPanelPlan(0, 9); // one Up round the end
    assert.deepEqual(wrap.steps.map((s) => [s.button, s.expect]), [['up', 9]]);
    assert.throws(() => menuPanelPlan(0, 10), RangeError);
  });
});

test('menu-panel.js has no DOM, Worker, Node or timer references', () => {
  const src = readFileSync(new URL('../../../semantic/menu-panel.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  for (const word of ['document', 'window', 'Worker', 'require(', 'process', 'setTimeout', 'setInterval']) {
    assert.ok(!new RegExp(`\\b${word.replace('(', '\\(')}`).test(src), `references ${word}`);
  }
});
