// Unit: the planner's `skips` mode (#189). The battle command menu skips rows
// with no command (#171: with no materia, one Down goes from row 0 to row 3).
// No emulator: the executor runs against a simulated list whose cursor moves
// to the next row that exists, like that menu.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { MENUS, menuPlanArgs } from '../../../semantic/menus.js';
import { battlePanelPlan } from '../../../semantic/battle-panel.js';
import { PLAN_PAD, createPlanExecutor, planCursorMove } from '../../../semantic/planner.js';

/**
 * Run an executor against a list with only the rows in `present` (no wrap).
 * A press (rising edge) moves the cursor on its first frame to the nearest
 * present row in its direction; with none, the cursor stays.
 */
function simulate(plan, { present = [...Array(plan.rows).keys()], start = plan.from, maxFrames = 2000 } = {}) {
  const run = createPlanExecutor(plan);
  let cursor = start;
  let mask = 0;
  let prevMask = 0;
  let presses = 0;
  for (let frame = 1; frame <= maxFrames; frame++) {
    if (mask && !prevMask) {
      presses++;
      const d = mask & (PLAN_PAD.down | PLAN_PAD.right) ? 1 : -1;
      const next = present.filter((r) => (d > 0 ? r > cursor : r < cursor)).sort((a, b) => d * (a - b))[0];
      if (next !== undefined) cursor = next;
    }
    prevMask = mask;
    const r = run.step(frame, cursor);
    if (r.state !== 'running') return { result: r, cursor, presses };
    mask = r.mask;
  }
  return { result: { state: 'timeout' }, cursor, presses };
}

const NO_MATERIA = [0, 3]; // #171: rows a member with no materia has (Attack, Item)

describe('planCursorMove skips', () => {
  test('stored on the plan; the steps are the same as without it', () => {
    const p = planCursorMove({ from: 0, to: 3, rows: 4, skips: true });
    const q = planCursorMove({ from: 0, to: 3, rows: 4 });
    assert.equal(p.skips, true);
    assert.equal(q.skips, false);
    assert.deepEqual(p.steps, q.steps);
  });

  test('skips with wraps is refused', () => {
    assert.throws(() => planCursorMove({ from: 0, to: 3, rows: 4, skips: true, wraps: true }), RangeError);
  });
});

describe('createPlanExecutor with plan.skips', () => {
  test('a 0 → 3 jump in one Down press is done, with no further press', () => {
    const p = planCursorMove({ from: 0, to: 3, rows: 4, skips: true });
    const { result, cursor, presses } = simulate(p, { present: NO_MATERIA });
    assert.equal(result.state, 'done');
    assert.equal(result.mask, 0);
    assert.equal(cursor, 3);
    assert.equal(presses, 1);
  });

  test('a 3 → 0 jump in one Up press is done', () => {
    const p = planCursorMove({ from: 3, to: 0, rows: 4, skips: true });
    const { result, cursor, presses } = simulate(p, { present: NO_MATERIA });
    assert.equal(result.state, 'done');
    assert.equal(cursor, 0);
    assert.equal(presses, 1);
  });

  test('one skipped row: the jump counts, the remaining presses still run', () => {
    const p = planCursorMove({ from: 0, to: 3, rows: 4, skips: true });
    const { result, cursor, presses } = simulate(p, { present: [0, 2, 3] });
    assert.equal(result.state, 'done');
    assert.equal(cursor, 3);
    assert.equal(presses, 2);
  });

  test('gap 0: the next press follows a jump at once', () => {
    const p = planCursorMove({ from: 0, to: 3, rows: 4, skips: true, timing: { gap: 0 } });
    const { result, cursor } = simulate(p, { present: [0, 2, 3] });
    assert.equal(result.state, 'done');
    assert.equal(cursor, 3);
  });

  test('no rows skipped: every planned press runs, as without skips', () => {
    const p = planCursorMove({ from: 0, to: 3, rows: 4, skips: true });
    const { result, presses } = simulate(p);
    assert.equal(result.state, 'done');
    assert.equal(presses, 3);
  });

  test('a target the game skips: the landing past it stops the plan (moved)', () => {
    for (const to of [1, 2]) {
      const p = planCursorMove({ from: 0, to, rows: 4, skips: true });
      const { result, cursor } = simulate(p, { present: NO_MATERIA });
      assert.equal(result.state, 'failed', `to ${to}`);
      assert.equal(result.mask, 0);
      assert.deepEqual({ ...result.error, frame: undefined }, { reason: 'moved', step: 0, expected: 1, actual: 3, frame: undefined });
      assert.equal(cursor, 3);
    }
  });

  test('a landing behind the cursor is not progress (moved)', () => {
    const p = planCursorMove({ from: 1, to: 3, rows: 4, skips: true });
    const run = createPlanExecutor(p);
    let r = run.step(1, 1);
    for (let f = 2; r.mask; f++) r = run.step(f, 1); // hold the press
    r = run.step(100, 0);
    assert.equal(r.state, 'failed');
    assert.equal(r.error.reason, 'moved');
  });

  test('without skips the same jump stops the plan (moved), as before #189', () => {
    const p = planCursorMove({ from: 0, to: 3, rows: 4 });
    const { result } = simulate(p, { present: NO_MATERIA });
    assert.equal(result.state, 'failed');
    assert.equal(result.error.reason, 'moved');
    assert.equal(result.error.actual, 3);
  });
});

describe('menu data', () => {
  test('battleCommand skips (confirmed, #171); the main menu does not', () => {
    assert.equal(MENUS.battleCommand.skipsStatus, 'confirmed');
    assert.match(MENUS.battleCommand.skipsScenario, /^harness\/scenarios\/save-boot-11d-/);
    assert.equal(menuPlanArgs('battleCommand').skips, true);
    assert.equal(menuPlanArgs('battleCommand').wraps, false);
    assert.equal(menuPlanArgs('main').skips, false);
    assert.equal(battlePanelPlan(0, 3).skips, true);
  });
});
