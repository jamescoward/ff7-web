// Unit: the Materia screen pad plans (#248). Plain data only.
// Original project code, GPL-2.0-or-later.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MATERIA_CONFIRMED_COLUMNS, MATERIA_INVENTORY_SLOTS, MATERIA_PAGE_ROWS,
  materiaColumnPlan, materiaListPlan, materiaListSlot, materiaListStep,
} from '../../../semantic/materia-screen.js';
import { ADDRESS_TABLE } from '../../../semantic/addresses.js';
import { createPlanExecutor, PLAN_PAD } from '../../../semantic/planner.js';
import { LIST_DOWNS, LIST_PAGE } from './materia-cursor-scenarios.js';

describe('materia column plan (#248)', () => {
  test('one Right reaches column 1 and one Left comes back (#244 25a)', () => {
    assert.deepEqual(materiaColumnPlan(0, 1).steps.map((s) => [s.button, s.expect]), [['right', 1]]);
    assert.deepEqual(materiaColumnPlan(1, 0).steps.map((s) => [s.button, s.expect]), [['left', 0]]);
    assert.equal(materiaColumnPlan(1, 1).steps.length, 0);
  });

  test('columns past the confirmed ones throw', () => {
    assert.equal(MATERIA_CONFIRMED_COLUMNS, 2);
    assert.throws(() => materiaColumnPlan(0, 2), RangeError);
    assert.throws(() => materiaColumnPlan(-1, 0), RangeError);
  });
});

describe('materia list step (#248)', () => {
  test('Down moves the row, then scrolls at the last row (#244 25b)', () => {
    let pos = { row: 0, offset: 0 };
    for (let i = 0; i < LIST_DOWNS; i++) pos = materiaListStep(pos, 'down');
    assert.deepEqual(pos, { row: LIST_PAGE - 1, offset: LIST_DOWNS - (LIST_PAGE - 1) });
  });

  test('Up moves the row, then scrolls back at row 0', () => {
    assert.deepEqual(materiaListStep({ row: 3, offset: 4 }, 'up'), { row: 2, offset: 4 });
    assert.deepEqual(materiaListStep({ row: 0, offset: 4 }, 'up'), { row: 0, offset: 3 });
  });

  test('other buttons throw', () => {
    assert.throws(() => materiaListStep({ row: 0, offset: 0 }, 'left'), RangeError);
  });
});

describe('materia list plan (#248)', () => {
  test('from the opening cursor to slot 13: 13 Downs, ending on row 9, offset 4', () => {
    const p = materiaListPlan({ row: 0, offset: 0 }, 13);
    assert.equal(p.steps.length, 13);
    assert.ok(p.steps.every((s) => s.button === 'down' && s.mask === PLAN_PAD.down));
    assert.deepEqual(p.steps.map((s) => s.expect), [...Array(13).keys()].map((i) => i + 1));
    assert.deepEqual(p.steps.slice(8).map((s) => [s.row, s.offset]), [[9, 0], [9, 1], [9, 2], [9, 3], [9, 4]]);
  });

  test('every step expects index = offset + row', () => {
    for (const [from, to] of [[{ row: 0, offset: 0 }, 13], [{ row: 9, offset: 4 }, 7], [{ row: 2, offset: 5 }, 0], [{ row: 5, offset: 0 }, 199]]) {
      const p = materiaListPlan(from, to);
      assert.equal(p.steps.length, Math.abs(to - materiaListSlot(from.row, from.offset)));
      for (const s of p.steps) assert.equal(materiaListSlot(s.row, s.offset), s.expect);
      if (p.steps.length) assert.equal(p.steps.at(-1).expect, to);
    }
  });

  test('back up from row 9, offset 4 to slot 7: 6 Ups that never scroll; to slot 0 it scrolls at row 0', () => {
    const p = materiaListPlan({ row: 9, offset: 4 }, 7);
    assert.deepEqual(p.steps.map((s) => [s.button, s.row, s.offset]), [['up', 8, 4], ['up', 7, 4], ['up', 6, 4], ['up', 5, 4], ['up', 4, 4], ['up', 3, 4]]);
    const q = materiaListPlan({ row: 9, offset: 4 }, 0);
    assert.deepEqual(q.steps.at(-1), { ...q.steps.at(-1), row: 0, offset: 0, expect: 0 });
  });

  test('already there: no steps; bad input throws', () => {
    assert.equal(materiaListPlan({ row: 3, offset: 2 }, 5).steps.length, 0);
    assert.throws(() => materiaListPlan({ row: 10, offset: 0 }, 5), RangeError);
    assert.throws(() => materiaListPlan({ row: 0 }, 5), RangeError);
    assert.throws(() => materiaListPlan(null, 5), RangeError);
    assert.throws(() => materiaListPlan({ row: 0, offset: 0 }, MATERIA_INVENTORY_SLOTS), RangeError);
    assert.throws(() => materiaListPlan({ row: 0, offset: 0 }, -1), RangeError);
  });

  test('the plan executor runs it with materiaListSlot as the cursor', () => {
    const p = materiaListPlan({ row: 0, offset: 0 }, 12);
    const run = createPlanExecutor(p);
    let pos = { row: 0, offset: 0 };
    let r;
    let held = 0;
    for (let f = 0; f < 2000; f++) {
      r = run.step(f, materiaListSlot(pos.row, pos.offset));
      if (r.state !== 'running') break;
      if (r.mask) held++;
      else if (held) {
        pos = materiaListStep(pos, p.steps[0].button); // the game's move on release (one direction per plan)
        held = 0;
      }
    }
    assert.equal(r.state, 'done');
    assert.deepEqual(pos, { row: 9, offset: 3 });
  });

  test('the inventory length is the materiaSlot entry count', () => {
    assert.equal(ADDRESS_TABLE.entries.find((e) => e.name === 'materiaSlot').count, MATERIA_INVENTORY_SLOTS);
    assert.equal(MATERIA_PAGE_ROWS, LIST_PAGE);
  });
});
