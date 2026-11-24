// Unit: battle sub-list positions and plans (#253). Plain data only.
// Original project code, GPL-2.0-or-later.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { BATTLE_LISTS, battleListIndex, battleListPlan, battleListStep } from '../../../semantic/battle-lists.js';
import { createPlanExecutor } from '../../../semantic/planner.js';

const at = (row, offset = 0, column = 0) => ({ row, offset, column });
const moves = (plan) => plan.steps.map((s) => [s.button, s.expect]);

describe('battle list index (#253)', () => {
  test('magic: (offset + row) x 3 + column', () => {
    assert.equal(battleListIndex('magic', at(0)), 0);
    assert.equal(battleListIndex('magic', at(1)), 3);
    assert.equal(battleListIndex('magic', at(2, 1, 2)), 11);
    assert.equal(battleListIndex('magic', at(2, 15, 2)), 53);
  });

  test('one-column lists: offset + row; column defaults to 0', () => {
    assert.equal(battleListIndex('item', { row: 2, offset: 4 }), 6);
    assert.equal(battleListIndex('summon', at(1, 2)), 3);
  });

  test('positions outside the list are null', () => {
    assert.equal(battleListIndex('magic', at(3)), null);
    assert.equal(battleListIndex('magic', at(0, 0, 3)), null);
    assert.equal(battleListIndex('magic', at(2, 16)), null);
    assert.equal(battleListIndex('item', at(0, -1)), null);
    assert.equal(battleListIndex('item', { row: 0 }), null);
    assert.equal(battleListIndex('item', null), null);
    assert.throws(() => battleListIndex('limit', at(0)), RangeError);
  });
});

describe('battle list step (#253)', () => {
  test('Down moves the row, then scrolls; Up moves back, then scrolls back (29a)', () => {
    let pos = at(0);
    for (const [b, want] of [['down', at(1)], ['down', at(2)], ['down', at(2, 1)], ['up', at(1, 1)], ['up', at(0, 1)], ['up', at(0, 0)]]) {
      pos = battleListStep('magic', pos, b);
      assert.deepEqual(pos, want, b);
    }
  });

  test('Left and Right move the column; past an end throws', () => {
    assert.deepEqual(battleListStep('magic', at(0, 0, 1), 'right'), at(0, 0, 2));
    assert.throws(() => battleListStep('magic', at(0, 0, 2), 'right'), RangeError);
    assert.throws(() => battleListStep('item', at(0), 'right'), RangeError);
    assert.throws(() => battleListStep('item', at(0), 'up'), RangeError);
    assert.throws(() => battleListStep('item', at(0), 'circle'), RangeError);
  });
});

describe('battle list plan (#253)', () => {
  test('magic index 3 from the start: one Down (29b)', () => {
    assert.deepEqual(moves(battleListPlan('magic', at(0), 3)), [['down', 3]]);
  });

  test('magic index 0 from index 3: one Up (29b attempt 2)', () => {
    assert.deepEqual(moves(battleListPlan('magic', at(1), 0)), [['up', 0]]);
  });

  test('item index 2 from the start: Down, Down (29d)', () => {
    assert.deepEqual(moves(battleListPlan('item', at(0), 2)), [['down', 1], ['down', 2]]);
  });

  test('item index 3 from the start: Down, Down, then a scroll (29d attempt 3)', () => {
    const plan = battleListPlan('item', at(0), 3);
    assert.deepEqual(moves(plan), [['down', 1], ['down', 2], ['down', 3]]);
    assert.deepEqual([plan.steps[2].row, plan.steps[2].offset], [2, 1]);
  });

  test('rows first, then columns; each step carries its position', () => {
    const plan = battleListPlan('magic', at(0), 11);
    assert.deepEqual(moves(plan), [['down', 3], ['down', 6], ['down', 9], ['right', 10], ['right', 11]]);
    const last = plan.steps.at(-1);
    assert.deepEqual([last.row, last.offset, last.column], [2, 1, 2]);
    assert.equal(plan.from, 0);
    assert.equal(plan.to, 11);
    assert.equal(plan.rows, BATTLE_LISTS.magic.entries);
  });

  test('back up and left, scrolling back', () => {
    assert.deepEqual(moves(battleListPlan('magic', at(0, 2, 2), 1)), [['up', 3 + 2], ['up', 2], ['left', 1]]);
  });

  test('already there: no steps; bad input throws', () => {
    assert.equal(battleListPlan('item', at(1, 3), 4).steps.length, 0);
    assert.throws(() => battleListPlan('item', at(0), 320), RangeError);
    assert.throws(() => battleListPlan('magic', at(5), 0), RangeError);
  });

  test('the plan executor runs it over battleListIndex reads', () => {
    const plan = battleListPlan('magic', at(0), 4);
    const run = createPlanExecutor(plan);
    const byMask = new Map(plan.steps.map((st) => [st.mask, st.button]));
    let pos = at(0);
    let prevMask = 0;
    let r;
    for (let frame = 1; frame < 400; frame++) {
      r = run.step(frame, battleListIndex('magic', pos));
      if (r.state !== 'running') break;
      // A simulated list: a press moves the cursor when it is released.
      if (prevMask && r.mask === 0) pos = battleListStep('magic', pos, byMask.get(prevMask));
      prevMask = r.mask;
    }
    assert.equal(r.state, 'done');
    assert.equal(battleListIndex('magic', pos), 4);
  });
});
