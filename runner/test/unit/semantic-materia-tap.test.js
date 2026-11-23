// Tier 1: the native Materia screen's pure rules (#250) in
// semantic/materia-screen.js: when a tap may run, how its result is read,
// and the labels (IDs and AP only).
// Original project code, GPL-2.0-or-later.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  MATERIA_SETTLE_FRAMES, materiaColumnLabel, materiaEquipOutcome, materiaLabel, materiaTapAllowed,
} from '../../../semantic/materia-screen.js';
import { MATERIA_SCREEN_ACTIONS } from '../../../semantic/controls.js';

const m49 = (ap) => ({ id: 49, ap });
const ready = (over = {}) => ({
  open: true,
  framesOpen: MATERIA_SETTLE_FRAMES,
  memberSlot: 0,
  cursors: { row: 0, column: 0, listRow: 0, listOffset: 0 },
  weaponMateria: [null, null],
  materia: [{ slot: 2, ...m49(2) }, { slot: 13, ...m49(13) }],
  ...over,
});

describe('#250 materiaTapAllowed', () => {
  test('ok from a settled weapon row, for an empty confirmed column and a filled inventory slot', () => {
    assert.deepEqual(materiaTapAllowed(ready(), 0, 13), { ok: true, reason: null });
    assert.deepEqual(materiaTapAllowed(ready(), 1, 2), { ok: true, reason: null });
  });
  test('refusals, each with its reason', () => {
    const cases = [
      [ready({ open: false }), 0, 2, 'closed'],
      [ready(), 2, 2, 'column not planned'],
      [ready(), null, 2, 'column not planned'],
      [ready(), 0, 3, 'no materia'],
      [ready(), 0, 200, 'no materia'],
      [ready({ memberSlot: null }), 0, 2, 'party pick not read'],
      [ready({ weaponMateria: null }), 0, 2, 'unread'],
      [ready({ weaponMateria: [m49(1), null] }), 0, 2, 'slot not empty'],
      [ready({ cursors: { row: 1, column: 0 } }), 0, 2, 'cursor not read'],
      [ready({ cursors: { row: 0, column: null } }), 0, 2, 'cursor not read'],
      [ready({ cursors: null }), 0, 2, 'cursor not read'],
      [ready({ framesOpen: MATERIA_SETTLE_FRAMES - 1 }), 0, 2, 'settling'],
      [ready({ framesOpen: null }), 0, 2, 'settling'],
    ];
    for (const [state, column, slot, reason] of cases) {
      assert.deepEqual(materiaTapAllowed(state, column, slot), { ok: false, reason }, `${reason}: ${JSON.stringify({ column, slot })}`);
    }
  });
});

describe('#250 materiaEquipOutcome', () => {
  const before = { inventory: m49(13), weapon: null };
  test('equipped: the slot emptied into the column', () => {
    assert.equal(materiaEquipOutcome(before, { inventory: null, weapon: m49(13) }), 'equipped');
  });
  test('none: nothing changed, or a value is unread', () => {
    assert.equal(materiaEquipOutcome(before, { inventory: m49(13), weapon: null }), 'none');
    assert.equal(materiaEquipOutcome(before, { inventory: undefined, weapon: null }), 'none');
    assert.equal(materiaEquipOutcome(before, { inventory: null, weapon: undefined }), 'none');
    assert.equal(materiaEquipOutcome(null, { inventory: null, weapon: m49(13) }), 'none');
  });
  test('other: something else moved', () => {
    assert.equal(materiaEquipOutcome(before, { inventory: null, weapon: m49(7) }), 'other');
    assert.equal(materiaEquipOutcome(before, { inventory: null, weapon: null }), 'other');
    assert.equal(materiaEquipOutcome(before, { inventory: m49(13), weapon: m49(2) }), 'other');
  });
});

describe('#250 labels and actions', () => {
  test('IDs and AP only', () => {
    assert.equal(materiaLabel(m49(13)), 'materia #49  AP 13');
    assert.equal(materiaLabel(null), '—');
    assert.equal(materiaColumnLabel(0, null), 'Wpn 1: empty');
    assert.equal(materiaColumnLabel(1, m49(2)), 'Wpn 2: #49');
  });
  test('Circle selects, Cross goes back', () => {
    assert.equal(MATERIA_SCREEN_ACTIONS.select.button, 'circle');
    assert.equal(MATERIA_SCREEN_ACTIONS.back.button, 'cross');
  });
});
