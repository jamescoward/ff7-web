// Unit: the menu planner and its frame-driven executor (#111). No emulator:
// the executor runs against a simulated cursor.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

import { PAD } from '../../pad.js';
import { MENUS, menuPlanArgs } from '../../../semantic/menus.js';
import { DEFAULT_TIMING, PLAN_PAD, createPlanExecutor, planCursorMove, planFrames } from '../../../semantic/planner.js';
import { ADDRESS_TABLE } from '../../../semantic/addresses.js';
import { SCENARIO_DIR, plannerScenarios, scriptFromPlan, serialise } from './planner-scenarios.js';

const buttons = (p) => p.steps.map((s) => s.button);
const expects = (p) => p.steps.map((s) => s.expect);

/**
 * Run an executor against a simulated list cursor. The cursor moves one row
 * `lag` frames after a press starts (edge-triggered, like the main menu);
 * `stuckAt` rows refuse to move, `jump` adds extra rows per press.
 */
function simulate(plan, { start = plan.from, rows = plan.rows, wraps = plan.wraps, lag = 1, stuckAt = [], jump = 0, unreadable = () => false, maxFrames = 5000 } = {}) {
  const run = createPlanExecutor(plan);
  let cursor = start;
  let mask = 0;
  let prevMask = 0;
  let pressFrame = null;
  const masks = [];
  for (let frame = 1; frame <= maxFrames; frame++) {
    // This frame runs with `mask` held.
    if (mask && !prevMask) pressFrame = frame;
    // The move happens on the press's lag-th frame (lag 1: its first frame),
    // even if the button was released by then (edge-triggered).
    if (pressFrame !== null && frame - pressFrame + 1 === lag && !stuckAt.includes(cursor)) {
      const d = (mask & (PLAN_PAD.down | PLAN_PAD.right) ? 1 : -1) * (1 + jump);
      let next = cursor + d;
      if (wraps) next = ((next % rows) + rows) % rows;
      else next = Math.max(0, Math.min(rows - 1, next));
      cursor = next;
    }
    if (!mask) pressFrame = null;
    prevMask = mask;
    masks.push(mask);
    const r = run.step(frame, unreadable(frame) ? null : cursor);
    if (r.state !== 'running') return { result: r, frames: frame, cursor, masks };
    mask = r.mask;
  }
  return { result: { state: 'timeout' }, frames: maxFrames, cursor, masks };
}

describe('planCursorMove', () => {
  test('down and up without wrapping', () => {
    const p = planCursorMove({ from: 0, to: 3, rows: 10 });
    assert.deepEqual(buttons(p), ['down', 'down', 'down']);
    assert.deepEqual(expects(p), [1, 2, 3]);
    assert.ok(p.steps.every((s) => s.mask === PAD.down));
    const q = planCursorMove({ from: 7, to: 2, rows: 10 });
    assert.deepEqual(buttons(q), Array(5).fill('up'));
    assert.deepEqual(expects(q), [6, 5, 4, 3, 2]);
  });

  test('no wrap: never crosses an end, even when the other way is shorter', () => {
    const p = planCursorMove({ from: 0, to: 9, rows: 10, wraps: false });
    assert.equal(p.steps.length, 9);
    assert.ok(buttons(p).every((b) => b === 'down'));
  });

  test('wrap: takes the shorter way round, and ties go the direct way', () => {
    const p = planCursorMove({ from: 0, to: 9, rows: 10, wraps: true });
    assert.deepEqual(buttons(p), ['up']);
    assert.deepEqual(expects(p), [9]);
    const q = planCursorMove({ from: 8, to: 1, rows: 10, wraps: true });
    assert.deepEqual(buttons(q), ['down', 'down', 'down']);
    assert.deepEqual(expects(q), [9, 0, 1]);
    const tie = planCursorMove({ from: 0, to: 5, rows: 10, wraps: true });
    assert.deepEqual(buttons(tie), Array(5).fill('down'));
    const near = planCursorMove({ from: 2, to: 4, rows: 10, wraps: true });
    assert.deepEqual(buttons(near), ['down', 'down']);
  });

  test('already there: no steps, and a one-row list', () => {
    assert.equal(planCursorMove({ from: 4, to: 4, rows: 10 }).steps.length, 0);
    assert.equal(planCursorMove({ from: 0, to: 0, rows: 1, wraps: true }).steps.length, 0);
    assert.equal(planFrames(planCursorMove({ from: 4, to: 4, rows: 10 })), 0);
  });

  test('horizontal lists use Left and Right', () => {
    const p = planCursorMove({ from: 2, to: 0, rows: 3, axis: 'horizontal' });
    assert.deepEqual(buttons(p), ['left', 'left']);
    assert.ok(p.steps.every((s) => s.mask === PAD.left));
    assert.deepEqual(buttons(planCursorMove({ from: 0, to: 1, rows: 3, axis: 'horizontal' })), ['right']);
  });

  test('bad input throws', () => {
    assert.throws(() => planCursorMove({ from: 0, to: 10, rows: 10 }), RangeError);
    assert.throws(() => planCursorMove({ from: -1, to: 0, rows: 10 }), RangeError);
    assert.throws(() => planCursorMove({ from: 0, to: 1.5, rows: 10 }), RangeError);
    assert.throws(() => planCursorMove({ from: 0, to: 0, rows: 0 }), RangeError);
    assert.throws(() => planCursorMove({ from: 0, to: 1, rows: 2, axis: 'diagonal' }), RangeError);
    assert.throws(() => planCursorMove({ from: 0, to: 1, rows: 2, timing: { hold: 0 } }), RangeError);
    assert.throws(() => planCursorMove({ from: 0, to: 1, rows: 2, timing: { gap: -1 } }), RangeError);
    assert.throws(() => planCursorMove(), RangeError);
  });

  test('timing defaults and overrides; plans are frozen', () => {
    const p = planCursorMove({ from: 0, to: 2, rows: 5 });
    assert.deepEqual({ ...p.timing }, { ...DEFAULT_TIMING });
    const q = planCursorMove({ from: 0, to: 2, rows: 5, timing: { gap: 0, hold: 2 } });
    assert.deepEqual({ ...q.timing }, { hold: 2, settle: DEFAULT_TIMING.settle, gap: 0 });
    assert.ok(Object.isFrozen(p) && Object.isFrozen(p.steps) && Object.isFrozen(p.steps[0]));
  });

  test('PLAN_PAD equals the backend pad bits', () => {
    for (const [k, v] of Object.entries(PLAN_PAD)) assert.equal(v, PAD[k], k);
  });
});

describe('createPlanExecutor', () => {
  test('reaches the row; holds each press for hold frames with gap frames between', () => {
    const p = planCursorMove({ from: 0, to: 3, rows: 10 });
    const { result, cursor, masks } = simulate(p);
    assert.equal(result.state, 'done');
    assert.equal(result.mask, 0);
    assert.equal(cursor, 3);
    // Mask runs: three presses of exactly `hold` frames, separated by free frames.
    const runs = [];
    let i = 0;
    while (i < masks.length) {
      let j = i;
      while (j < masks.length && masks[j] === masks[i]) j++;
      runs.push([masks[i], j - i]);
      i = j;
    }
    const presses = runs.filter(([m]) => m);
    assert.deepEqual(presses, Array(3).fill([PAD.down, DEFAULT_TIMING.hold]));
    // Between presses: one settle frame (the cursor already moved) plus the gap.
    const between = runs.slice(runs.findIndex(([m]) => m)).filter(([m]) => !m).slice(0, 2);
    assert.deepEqual(between, Array(2).fill([0, 1 + DEFAULT_TIMING.gap]));
  });

  test('timing: the run takes planFrames(plan) frames after the first call when the cursor answers at once', () => {
    for (const [to, timing] of [[3, undefined], [7, { gap: 0 }], [1, { hold: 2, gap: 3 }]]) {
      const p = planCursorMove({ from: 0, to, rows: 10, timing });
      const { result, frames } = simulate(p);
      assert.equal(result.state, 'done');
      assert.equal(frames - 1, planFrames(p), `to ${to}`);
    }
  });

  test('a slow cursor is waited for, up to settle frames after the release', () => {
    const p = planCursorMove({ from: 0, to: 2, rows: 10 });
    // lag beyond the hold: the move lands only after the release; the
    // simulated menu still counts it as the press (edge-triggered).
    const slow = simulate(p, { lag: DEFAULT_TIMING.hold });
    assert.equal(slow.result.state, 'done');
  });

  test('already there: done at the first call, nothing pressed', () => {
    const p = planCursorMove({ from: 5, to: 5, rows: 10 });
    const { result, frames, masks } = simulate(p);
    assert.equal(result.state, 'done');
    assert.equal(frames, 1);
    assert.ok(masks.every((m) => m === 0));
  });

  test('wrapping plans run against a wrapping menu', () => {
    const p = planCursorMove({ from: 1, to: 8, rows: 10, wraps: true });
    assert.deepEqual(expects(p), [0, 9, 8]);
    const { result, cursor } = simulate(p);
    assert.equal(result.state, 'done');
    assert.equal(cursor, 8);
  });

  test('the cursor not moving: stops after settle frames and reports stuck', () => {
    const p = planCursorMove({ from: 0, to: 3, rows: 10 });
    const { result, cursor } = simulate(p, { stuckAt: [2] });
    assert.equal(result.state, 'failed');
    assert.equal(result.mask, 0);
    assert.deepEqual({ ...result.error, frame: undefined }, { reason: 'stuck', step: 2, expected: 3, actual: 2, frame: undefined });
    assert.equal(cursor, 2);
  });

  test('a no-wrap plan past the real end of a list stops (stuck)', () => {
    const p = planCursorMove({ from: 0, to: 9, rows: 10 });
    const { result } = simulate(p, { rows: 8 });
    assert.equal(result.state, 'failed');
    assert.equal(result.error.reason, 'stuck');
    assert.equal(result.error.actual, 7);
  });

  test('the cursor moving somewhere else: stops at once and reports moved', () => {
    const p = planCursorMove({ from: 0, to: 4, rows: 10 });
    const { result } = simulate(p, { jump: 1 });
    assert.equal(result.state, 'failed');
    assert.equal(result.error.reason, 'moved');
    assert.equal(result.error.expected, 1);
    assert.equal(result.error.actual, 2);
  });

  test('a cursor that does not start on plan.from: nothing is pressed', () => {
    const p = planCursorMove({ from: 0, to: 4, rows: 10 });
    const { result, masks } = simulate(p, { start: 2 });
    assert.equal(result.state, 'failed');
    assert.deepEqual({ ...result.error }, { reason: 'start', step: 0, expected: 0, actual: 2, frame: 1 });
    assert.ok(masks.every((m) => m === 0));
  });

  test('failed reads: a short gap is waited out, settle frames in a row stop it', () => {
    const p = planCursorMove({ from: 0, to: 2, rows: 10 });
    const brief = simulate(p, { unreadable: (f) => f >= 6 && f <= 8 });
    assert.equal(brief.result.state, 'done');
    const gone = simulate(p, { unreadable: (f) => f >= 6 });
    assert.equal(gone.result.state, 'failed');
    assert.equal(gone.result.error.reason, 'unread');
  });

  test('frames going backwards stop it; results stay after the end', () => {
    const p = planCursorMove({ from: 0, to: 2, rows: 10 });
    const run = createPlanExecutor(p);
    assert.equal(run.step(10, 0).state, 'running');
    const r = run.step(9, 0);
    assert.equal(r.state, 'failed');
    assert.equal(r.error.reason, 'frame');
    assert.equal(run.step(11, 0), r);
    assert.equal(run.state, 'failed');
  });
});

describe('menu data', () => {
  test('the main menu names a confirmed cursor entry; wrapping is not used until confirmed', () => {
    const entry = ADDRESS_TABLE.entries.find((e) => e.name === MENUS.main.cursor);
    assert.ok(entry);
    assert.equal(entry.status, 'confirmed');
    const args = menuPlanArgs('main');
    assert.equal(args.rows, MENUS.main.rows);
    assert.equal(args.wraps, MENUS.main.wrapsStatus === 'confirmed' && MENUS.main.wraps);
    assert.throws(() => menuPlanArgs('nope'), RangeError);
  });
});

describe('the Tier 2 scenarios are the planner output', () => {
  test('committed files equal planner-scenarios.js (run node runner/test/unit/planner-scenarios.js to fix)', () => {
    for (const s of plannerScenarios()) {
      const file = path.join(SCENARIO_DIR, `${s.name}.json`);
      assert.equal(readFileSync(file, 'utf8'), serialise(s), file);
    }
  });

  test('the acceptance script presses exactly the plans to rows 3, 0 and 7', () => {
    const [accept] = plannerScenarios();
    const presses = accept.input.filter((s) => s.buttons).map((s) => s.buttons[0]);
    assert.deepEqual(presses, [...Array(3).fill('down'), ...Array(3).fill('up'), ...Array(7).fill('down')]);
    const waits = accept.input.filter((s) => s.wait && s.wait.until).map((s) => s.wait.until.equals);
    assert.deepEqual(waits, [1, 2, 3, 2, 1, 0, 1, 2, 3, 4, 5, 6, 7]);
  });

  test('scriptFromPlan mirrors the executor: press hold, wait settle, gap between', () => {
    const p = planCursorMove({ from: 0, to: 2, rows: 10 });
    assert.deepEqual(scriptFromPlan(p, 'row0', 'm'), [
      { buttons: ['down'], frames: 4 },
      { wait: { until: { mem: 'row0', equals: 1 }, timeout: 30 } },
      { wait: { frames: 8 } },
      { buttons: ['down'], frames: 4 },
      { wait: { until: { mem: 'row0', equals: 2 }, timeout: 30 }, metric: 'm' },
    ]);
  });
});

describe('platform neutrality', () => {
  test('planner.js and menus.js import nothing and use no DOM, Worker, Node or timer API', () => {
    for (const f of ['planner.js', 'menus.js']) {
      const src = readFileSync(path.resolve(SCENARIO_DIR, '../../semantic', f), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      assert.doesNotMatch(src, /\bimport\b|\brequire\(/, f);
      assert.doesNotMatch(src, /\b(setTimeout|setInterval|requestAnimationFrame|performance|Date|window|document|self|postMessage|Worker|process|Buffer)\b/, f);
    }
  });
});
