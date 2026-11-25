// #256 part 1: the Item list plan past page 1 (itemListSlot, itemListStep,
// itemSlotPlan). Pure planner checks; Tier 2 proves them in save-boot-31x.
// Original project code, GPL-2.0-or-later.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { ITEM_INVENTORY_SLOTS, ITEM_PAGE_ROWS, itemListPlan, itemListSlot, itemListStep, itemSlotPlan } from '../../../semantic/item-screen.js';

describe('#256 itemListSlot', () => {
  test('slot = offset + row', () => {
    assert.equal(itemListSlot(0, 0), 0);
    assert.equal(itemListSlot(9, 0), 9);
    assert.equal(itemListSlot(9, 4), 13);
    assert.equal(itemListSlot(9, ITEM_INVENTORY_SLOTS - ITEM_PAGE_ROWS), ITEM_INVENTORY_SLOTS - 1);
  });
  test('null for unconfirmed or out-of-range cursors', () => {
    for (const [r, o] of [[null, 0], [0, null], [-1, 0], [10, 0], [0, -1], [0, 311], [1.5, 0], [0, 0.5]]) assert.equal(itemListSlot(r, o), null, `${r},${o}`);
  });
});

describe('#256 itemListStep', () => {
  test('Down moves the row, then scrolls at row 9', () => {
    assert.deepEqual(itemListStep({ row: 0, offset: 0 }, 'down'), { row: 1, offset: 0 });
    assert.deepEqual(itemListStep({ row: 9, offset: 0 }, 'down'), { row: 9, offset: 1 });
  });
  test('Up moves the row, then scrolls back at row 0', () => {
    assert.deepEqual(itemListStep({ row: 3, offset: 4 }, 'up'), { row: 2, offset: 4 });
    assert.deepEqual(itemListStep({ row: 0, offset: 4 }, 'up'), { row: 0, offset: 3 });
  });
  test('other buttons throw', () => {
    assert.throws(() => itemListStep({ row: 0, offset: 0 }, 'left'), RangeError);
  });
});

describe('#256 itemSlotPlan', () => {
  test('page 1 targets press the same buttons as itemListPlan', () => {
    for (const to of [0, 2, 9]) {
      assert.deepEqual(itemSlotPlan({ row: 0, offset: 0 }, to).steps.map((s) => s.button), itemListPlan(0, to).steps.map((s) => s.button));
    }
  });
  test('slot 13 from the top: 9 row moves, then 4 scrolls; every step carries row and offset', () => {
    const p = itemSlotPlan({ row: 0, offset: 0 }, 13);
    assert.equal(p.steps.length, 13);
    assert.ok(p.steps.every((s) => s.button === 'down'));
    assert.deepEqual(p.steps.map((s) => [s.row, s.offset]), [
      [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0], [9, 0],
      [9, 1], [9, 2], [9, 3], [9, 4],
    ]);
    assert.deepEqual(p.steps.map((s) => s.expect), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    assert.equal(itemListSlot(p.steps.at(-1).row, p.steps.at(-1).offset), 13);
  });
  test('back up after a scroll moves the row first, then scrolls back', () => {
    const p = itemSlotPlan({ row: 9, offset: 4 }, 2);
    assert.equal(p.steps.length, 11);
    assert.ok(p.steps.every((s) => s.button === 'up'));
    assert.deepEqual(p.steps.slice(7).map((s) => [s.row, s.offset]), [[1, 4], [0, 4], [0, 3], [0, 2]]);
    assert.equal(itemListSlot(p.steps.at(-1).row, p.steps.at(-1).offset), 2);
  });
  test('never wraps: the last slot from the top is all Downs', () => {
    const p = itemSlotPlan({ row: 0, offset: 0 }, ITEM_INVENTORY_SLOTS - 1);
    assert.equal(p.steps.length, ITEM_INVENTORY_SLOTS - 1);
    assert.ok(p.steps.every((s) => s.button === 'down'));
    assert.deepEqual([p.steps.at(-1).row, p.steps.at(-1).offset], [9, ITEM_INVENTORY_SLOTS - ITEM_PAGE_ROWS]);
  });
  test('same slot: no steps', () => {
    assert.equal(itemSlotPlan({ row: 5, offset: 2 }, 7).steps.length, 0);
  });
  test('bad input throws RangeError', () => {
    assert.throws(() => itemSlotPlan({ row: 10, offset: 0 }, 3), RangeError);
    assert.throws(() => itemSlotPlan(null, 3), RangeError);
    assert.throws(() => itemSlotPlan({ row: 0, offset: 0 }, ITEM_INVENTORY_SLOTS), RangeError);
    assert.throws(() => itemSlotPlan({ row: 0, offset: 0 }, -1), RangeError);
  });
});
