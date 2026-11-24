// #254: Equip v2 pure helpers (slot and list plans, tap rule, outcome).
// Original project code, GPL-2.0-or-later.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  EQUIP_LIST_PAGE, EQUIP_SETTLE_FRAMES, equipListIndex, equipListPlan, equipListRowLabel, equipListRows, equipListStep,
  equipSlotKind, equipSlotLabel, equipSlotPlan, equipV2Outcome, equipV2TapAllowed,
} from '../../../semantic/equip-screen.js';
import { createPlanExecutor } from '../../../semantic/planner.js';

describe('#254 Equip v2 plans', () => {
  test('slot kinds follow the slot cursor (#216 18a: 0, 1, 2)', () => {
    assert.deepEqual([0, 1, 2, 3, null].map(equipSlotKind), ['weapon', 'armor', 'accessory', null, null]);
  });

  test('equipSlotPlan: Up and Down, no wrap, 3 rows', () => {
    assert.deepEqual(equipSlotPlan(0, 2).steps.map((s) => [s.button, s.expect]), [['down', 1], ['down', 2]]);
    assert.deepEqual(equipSlotPlan(2, 0).steps.map((s) => s.button), ['up', 'up']);
    assert.equal(equipSlotPlan(1, 1).steps.length, 0);
    assert.throws(() => equipSlotPlan(0, 3), RangeError);
  });

  test('equipListPlan reproduces #216 18b: 9 Downs reach row 7, offset 2, index 9', () => {
    const p = equipListPlan({ row: 0, offset: 0 }, 9);
    assert.deepEqual(p.steps.map((s) => [s.row, s.offset]), [[1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [7, 1], [7, 2]]);
    assert.ok(p.steps.every((s) => s.button === 'down'));
    assert.equal(p.steps.at(-1).expect, 9);
    for (const s of p.steps) assert.equal(equipListIndex(s.row, s.offset), s.expect);
  });

  test('equipListStep and equipListIndex bounds', () => {
    assert.deepEqual(equipListStep({ row: 0, offset: 3 }, 'up'), { row: 0, offset: 2 });
    assert.deepEqual(equipListStep({ row: 4, offset: 3 }, 'up'), { row: 3, offset: 3 });
    assert.throws(() => equipListStep({ row: 0, offset: 0 }, 'left'), RangeError);
    assert.equal(equipListIndex(EQUIP_LIST_PAGE, 0), null);
    assert.equal(equipListIndex(0, -1), null);
    assert.equal(equipListIndex(null, 0), null);
    assert.throws(() => equipListPlan({ row: 8, offset: 0 }, 1), RangeError);
  });

  test('an executor reading equipListIndex follows the plan and stops on a mismatch', () => {
    const plan = equipListPlan({ row: 0, offset: 0 }, 2);
    let ex;
    let f;
    let cur;
    let out;
    // Drive with a model: move the cursor when the executor expects it.
    ex = createPlanExecutor(plan);
    cur = 0;
    let held = false;
    for (f = 0; f < 500; f++) {
      out = ex.step(f, cur);
      if (out.mask) held = true;
      else if (held) { cur += 1; held = false; }
      if (out.state !== 'running') break;
    }
    assert.equal(out.state, 'done');
    ex = createPlanExecutor(plan);
    for (f = 0; f < 500; f++) {
      out = ex.step(f, 0); // the cursor never moves
      if (out.state !== 'running') break;
    }
    assert.notEqual(out.state, 'done');
  });

  test('equipListRows: one row per spare of that kind', () => {
    const inv = [{ kind: 'weapon' }, { kind: 'armor' }, { kind: 'armor' }, { kind: 'accessory' }, { kind: 'item' }];
    assert.deepEqual(equipListRows(inv, 'armor'), [{ index: 0 }, { index: 1 }]);
    assert.deepEqual(equipListRows(inv, 'accessory'), [{ index: 0 }]);
    assert.deepEqual(equipListRows(inv, 'item'), []);
    assert.deepEqual(equipListRows(null, 'armor'), []);
    assert.equal(equipListRowLabel({ index: 0 }), 'List row 1');
  });

  const member = { weapon: 0, armor: 0, accessory: null };
  const ok = { open: true, framesOpen: EQUIP_SETTLE_FRAMES, memberSlot: 1, member, cursors: { slot: 0, listRow: 0, listOffset: 0 }, rows: [{ index: 0 }, { index: 1 }], slotPage: true };
  test('equipV2TapAllowed', () => {
    assert.deepEqual(equipV2TapAllowed(ok, 1, 1), { ok: true, reason: null });
    assert.equal(equipV2TapAllowed({ ...ok, open: false }, 1, 1).reason, 'closed');
    assert.equal(equipV2TapAllowed({ ...ok, memberSlot: null }, 1, 1).reason, 'party pick not read');
    assert.equal(equipV2TapAllowed(ok, 3, 1).reason, 'slot not planned');
    assert.equal(equipV2TapAllowed(ok, 1, 2).reason, 'no entry');
    assert.equal(equipV2TapAllowed({ ...ok, cursors: { slot: 0, listRow: 1, listOffset: 0 } }, 1, 1).reason, 'cursor not read');
    assert.equal(equipV2TapAllowed({ ...ok, cursors: { slot: null, listRow: 0, listOffset: 0 } }, 1, 1).reason, 'cursor not read');
    assert.equal(equipV2TapAllowed({ ...ok, slotPage: false }, 1, 1).reason, 'page not known');
    assert.equal(equipV2TapAllowed({ ...ok, framesOpen: 10 }, 1, 1).reason, 'settling');
  });

  test('equipV2Outcome', () => {
    const a = (armor, w = 0) => [{ weapon: 0, armor: 0, accessory: null }, { weapon: w, armor, accessory: null }, null];
    assert.equal(equipV2Outcome(a(0), a(3), 1, 'armor'), 'equipped');
    assert.equal(equipV2Outcome(a(0), a(0), 1, 'armor'), 'none');
    assert.equal(equipV2Outcome(a(0), a(3, 5), 1, 'armor'), 'other');
    assert.equal(equipV2Outcome(a(0), a(0, 5), 1, 'armor'), 'other');
    assert.equal(equipV2Outcome(a(0), a(3), 0, 'armor'), 'other');
    assert.equal(equipV2Outcome(null, a(3), 1, 'armor'), 'none');
    const acc = [null, null, { weapon: 16, armor: 0, accessory: null }];
    const acc2 = [null, null, { weapon: 16, armor: 0, accessory: 1 }];
    assert.equal(equipV2Outcome(acc, acc2, 2, 'accessory'), 'equipped');
  });

  test('labels: IDs only', () => {
    assert.equal(equipSlotLabel(0, member), 'Weapon: #0');
    assert.equal(equipSlotLabel(2, member), 'Accessory: none');
    assert.equal(equipSlotLabel(1, null), 'Armor: ?');
  });
});
