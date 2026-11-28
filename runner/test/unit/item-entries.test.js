// Unit (#256 part 2): the native Item list's pages over every non-empty
// inventory slot, and the cursor check for an itemSlotPlan() that reads
// both the row and the offset.
// Original project code, GPL-2.0-or-later.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  ITEM_PAGE_ROWS, itemEntryPage, itemEntryPageOf, itemEntryPages, itemListEntries, itemListStep, itemSlotCursor, itemSlotPlan,
} from '../../../semantic/item-screen.js';
import { createPlanExecutor } from '../../../semantic/planner.js';

const inv = (slots) => slots.map((slot, i) => ({ slot, index: 10 + i, quantity: i + 1, kind: 'item', number: 10 + i }));

describe('itemListEntries / itemEntryPage', () => {
  test('keeps non-empty slots in slot order, drops empty and bad entries', () => {
    const e = itemListEntries([
      { slot: 14, index: 2, quantity: 1, kind: 'item', number: 2 },
      { slot: 3, index: 1, quantity: 0, kind: 'item', number: 1 },
      { slot: 0, index: 0, quantity: 5, kind: 'item', number: 0 },
      { slot: 320, index: 9, quantity: 1, kind: 'item', number: 9 },
      { slot: null, index: 9, quantity: 1, kind: 'item', number: 9 },
      null,
    ]);
    assert.deepEqual(e.map((x) => x.slot), [0, 14]);
    assert.deepEqual(e[1].item, { index: 2, quantity: 1, kind: 'item', number: 2 });
    assert.deepEqual(itemListEntries(null), []);
  });

  test('pages of ten, padded with empty rows, clamped', () => {
    const e = itemListEntries(inv([0, 1, 2, 5, 9, 11, 12, 14, 20, 33, 40, 300]));
    assert.equal(itemEntryPages(e), 2);
    assert.equal(itemEntryPages([]), 1);
    const p0 = itemEntryPage(e, 0);
    assert.equal(p0.length, ITEM_PAGE_ROWS);
    assert.deepEqual(p0.map((r) => r.slot), [0, 1, 2, 5, 9, 11, 12, 14, 20, 33]);
    const p1 = itemEntryPage(e, 1);
    assert.deepEqual(p1.map((r) => r.slot), [40, 300, null, null, null, null, null, null, null, null]);
    assert.equal(p1[2].item, null);
    assert.deepEqual(itemEntryPage(e, 7), p1, 'past the end clamps to the last page');
    assert.deepEqual(itemEntryPage(e, -1), p0);
    assert.deepEqual(itemEntryPage([], 0).map((r) => r.slot), Array(ITEM_PAGE_ROWS).fill(null));
  });

  test('itemEntryPageOf: the page with that slot, or the next entry after it', () => {
    const e = itemListEntries(inv([0, 1, 2, 5, 9, 11, 12, 14, 20, 33, 40, 300]));
    assert.equal(itemEntryPageOf(e, 0), 0);
    assert.equal(itemEntryPageOf(e, 33), 0);
    assert.equal(itemEntryPageOf(e, 34), 1, 'empty slot 34: the next entry is 40, on page 2');
    assert.equal(itemEntryPageOf(e, 319), 1, 'past the last entry: the last page');
    assert.equal(itemEntryPageOf(e, null), 0);
  });
});

describe('itemSlotCursor', () => {
  test('the index while the pair matches the plan, -1 when only the sum does', () => {
    const plan = itemSlotPlan({ row: 8, offset: 0 }, 12);
    assert.deepEqual(plan.start, { row: 8, offset: 0 });
    assert.equal(itemSlotCursor(plan, { row: 8, offset: 0 }), 8);
    assert.equal(itemSlotCursor(plan, { row: 9, offset: 1 }), 10, 'step 2 leaves row 9 offset 1');
    assert.equal(itemSlotCursor(plan, { row: 8, offset: 2 }), -1, 'index 10, but the game scrolled early');
    assert.equal(itemSlotCursor(plan, { row: 9, offset: 5 }), 14, 'off the path: the index, which the executor rejects');
    assert.equal(itemSlotCursor(plan, { row: null, offset: 0 }), null);
    assert.equal(itemSlotCursor(plan, { row: 0, offset: null }), null);
  });

  test('an executor fed itemSlotCursor finishes on a game that scrolls as planned', () => {
    const plan = itemSlotPlan({ row: 0, offset: 0 }, 13);
    const exec = createPlanExecutor(plan);
    let pos = { row: 0, offset: 0 };
    let prev = 0;
    let out;
    for (let f = 1; f < 2000; f++) {
      out = exec.step(f, itemSlotCursor(plan, pos));
      const rising = out.mask & ~prev;
      prev = out.mask;
      if (rising) pos = itemListStep(pos, rising === plan.steps[0].mask ? 'down' : 'up');
      if (out.state !== 'running') break;
    }
    assert.equal(out.state, 'done');
    assert.deepEqual(pos, { row: 9, offset: 4 });
  });

  test('an executor fed itemSlotCursor stops when the game scrolls before row 9', () => {
    const plan = itemSlotPlan({ row: 7, offset: 0 }, 11);
    const exec = createPlanExecutor(plan);
    let pos = { row: 7, offset: 0 };
    let prev = 0;
    let out;
    for (let f = 1; f < 2000; f++) {
      out = exec.step(f, itemSlotCursor(plan, pos));
      const rising = out.mask & ~prev;
      prev = out.mask;
      // A game that scrolls from row 8 on: index = offset + row still rises by one.
      if (rising) pos = pos.row < 8 ? { row: pos.row + 1, offset: pos.offset } : { row: pos.row, offset: pos.offset + 1 };
      if (out.state !== 'running') break;
    }
    assert.equal(out.state, 'failed');
    assert.equal(out.error.step, 1, 'the second Down: index 9 read as row 8 offset 1');
  });
});
