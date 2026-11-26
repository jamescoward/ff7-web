// Unit: the Materia screen plans #255 adds: the slot row, columns past the
// confirmed ones when the caller knows an item's slot count, and scrolling
// back at list row 0. Plain data only.
// Original project code, GPL-2.0-or-later.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MATERIA_CONFIRMED_COLUMNS, MATERIA_INVENTORY_SLOTS, MATERIA_MAX_COLUMNS, MATERIA_ROW_ARMOR, MATERIA_ROW_WEAPON,
  materiaColumnPlan, materiaListPlan, materiaRowPlan,
} from '../../../semantic/materia-screen.js';

describe('materia slot row plan (#255)', () => {
  test('one Down reaches the armor row and one Up comes back (#244 25a); no wrap', () => {
    assert.deepEqual(materiaRowPlan(MATERIA_ROW_WEAPON, MATERIA_ROW_ARMOR).steps.map((s) => [s.button, s.expect]), [['down', 1]]);
    assert.deepEqual(materiaRowPlan(MATERIA_ROW_ARMOR, MATERIA_ROW_WEAPON).steps.map((s) => [s.button, s.expect]), [['up', 0]]);
    assert.throws(() => materiaRowPlan(0, 2), RangeError);
  });
});

describe('materia column plan with a known slot count (#255)', () => {
  test('the default stays the confirmed columns', () => {
    assert.throws(() => materiaColumnPlan(0, MATERIA_CONFIRMED_COLUMNS), RangeError);
  });

  test('with 8 columns, 0 to 7 is seven Rights, and back is seven Lefts', () => {
    const p = materiaColumnPlan(0, 7, undefined, 8);
    assert.deepEqual(p.steps.map((s) => s.button), new Array(7).fill('right'));
    assert.deepEqual(p.steps.map((s) => s.expect), [1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual(materiaColumnPlan(7, 0, undefined, 8).steps.map((s) => s.button), new Array(7).fill('left'));
    assert.throws(() => materiaColumnPlan(0, 8, undefined, 8), RangeError);
  });

  test('a slot count outside 1..8 throws', () => {
    assert.equal(MATERIA_MAX_COLUMNS, 8);
    for (const c of [0, 9, 2.5, null]) assert.throws(() => materiaColumnPlan(0, 0, undefined, c), RangeError, String(c));
  });
});

describe('materia list plan scrolling back (#255)', () => {
  test('from row 9 offset 4 to slot 2: nine row moves, then two scrolls back at row 0', () => {
    const p = materiaListPlan({ row: 9, offset: 4 }, 2);
    assert.equal(p.steps.length, 11);
    assert.ok(p.steps.every((s) => s.button === 'up'));
    assert.deepEqual(p.steps.slice(0, 9).map((s) => [s.row, s.offset]), [8, 7, 6, 5, 4, 3, 2, 1, 0].map((r) => [r, 4]));
    assert.deepEqual(p.steps.slice(9).map((s) => [s.row, s.offset, s.expect]), [[0, 3, 3], [0, 2, 2]]);
  });

  test('to the last slot: the plan ends on row 9 at the last page, and never wraps', () => {
    const p = materiaListPlan({ row: 0, offset: 0 }, MATERIA_INVENTORY_SLOTS - 1);
    assert.deepEqual([p.steps.at(-1).row, p.steps.at(-1).offset], [9, MATERIA_INVENTORY_SLOTS - 10]);
    assert.ok(p.steps.every((s) => s.button === 'down'));
    assert.throws(() => materiaListPlan({ row: 0, offset: 0 }, MATERIA_INVENTORY_SLOTS), RangeError);
  });
});
