// Menu planner (#111): compile "put the cursor on row N" into pad input the
// unmodified game consumes, and replay it one frame at a time while checking
// the cursor read from memory after every press (docs/ARCHITECTURE_SURVEY.md
// §6: native UI actions compile to pad sequences, confirmed by reading memory).
//
// Platform-neutral (CLAUDE.md, Engineering standards): plain data and pure
// functions. No DOM, Worker, Node, timers or clocks; time is counted in game
// frames, given by the caller. A frontend calls the executor once per frame
// with the frame number and the cursor it read, and holds the mask it returns.
// Original project code, GPL-2.0-or-later.

/**
 * Pad bits for the buttons a plan uses, in the libretro JOYPAD bit order the
 * backend's setPad takes (the same values as runner/pad.js and web/js/pad.js;
 * a unit test keeps them equal). Repeated here so semantic/ imports nothing.
 */
export const PLAN_PAD = Object.freeze({
  up: 1 << 4,
  down: 1 << 5,
  left: 1 << 6,
  right: 1 << 7,
});

/**
 * Default timing, in game frames.
 *   hold    frames a direction is held for one press
 *   settle  frames after the release to wait for the cursor to read the
 *           expected row; past that, the executor stops and reports
 *   gap     frames with nothing held after the cursor moved, before the next
 *           press
 * hold 4 and a cursor change within one frame of the press are what #78's
 * reactor-mode-2d-cursor-sequence measured in the main menu (it then waited
 * 20 frames). gap 8 is the planner's choice; #111's Tier 2 scenarios check it.
 */
export const DEFAULT_TIMING = Object.freeze({ hold: 4, settle: 30, gap: 8 });

const isInt = (v) => Number.isInteger(v);

function checkTiming(t) {
  const out = { ...DEFAULT_TIMING, ...(t || {}) };
  for (const k of ['hold', 'settle', 'gap']) {
    if (!isInt(out[k]) || out[k] < (k === 'gap' ? 0 : 1)) throw new RangeError(`timing.${k} must be an integer >= ${k === 'gap' ? 0 : 1}, got ${out[k]}`);
  }
  return out;
}

/**
 * Plan the presses that move a list cursor from row `from` to row `to`.
 *
 *   rows    how many rows the list has (rows 0..rows-1)
 *   wraps   true if moving past either end continues at the other end; then
 *           the shorter way round is taken (ties go the way that does not
 *           wrap). false: the plan never crosses an end
 *   axis    'vertical' (Up/Down, the default) or 'horizontal' (Left/Right);
 *           the forward button (Down or Right) raises the row
 *   timing  { hold, settle, gap } overrides of DEFAULT_TIMING
 *
 * Returns { from, to, rows, wraps, timing, steps }, where each step is
 * { button, mask, expect }: press `button` (pad bits `mask`) for timing.hold
 * frames, then the cursor should read `expect`. Already there: no steps.
 * Bad input (rows < 1, a row out of range, non-integers) throws RangeError.
 */
export function planCursorMove({ from, to, rows, wraps = false, axis = 'vertical', timing } = {}) {
  if (!isInt(rows) || rows < 1) throw new RangeError(`rows must be an integer >= 1, got ${rows}`);
  for (const [k, v] of [['from', from], ['to', to]]) {
    if (!isInt(v) || v < 0 || v >= rows) throw new RangeError(`${k} must be a row in 0..${rows - 1}, got ${v}`);
  }
  if (axis !== 'vertical' && axis !== 'horizontal') throw new RangeError(`axis must be "vertical" or "horizontal", got ${axis}`);
  const t = checkTiming(timing);
  const [back, fwd] = axis === 'vertical' ? ['up', 'down'] : ['left', 'right'];

  let dir = 0;
  let count = 0;
  if (to !== from) {
    const direct = Math.abs(to - from);
    dir = to > from ? 1 : -1;
    count = direct;
    if (wraps && rows - direct < direct) {
      dir = -dir;
      count = rows - direct;
    }
  }
  const button = dir > 0 ? fwd : back;
  const steps = [];
  let row = from;
  for (let i = 0; i < count; i++) {
    row = (row + dir + rows) % rows;
    steps.push(Object.freeze({ button, mask: PLAN_PAD[button], expect: row }));
  }
  return Object.freeze({ from, to, rows, wraps: !!wraps, timing: Object.freeze(t), steps: Object.freeze(steps) });
}

/**
 * Frames a plan takes when every press moves the cursor on the first frame
 * after the release: the shortest run of the executor. Settling longer adds
 * up to timing.settle - 1 frames per step.
 */
export function planFrames(plan) {
  const n = plan.steps.length;
  if (n === 0) return 0;
  const { hold, gap } = plan.timing;
  return n * (hold + 1) + (n - 1) * gap;
}

/**
 * A step function that replays a plan, driven by frame numbers.
 *
 *   const run = createPlanExecutor(plan);
 *   each frame: const r = run.step(frame, cursor); setPad(r.mask);
 *
 * `frame` is the number of the frame that just ended (any integer clock that
 * rises by one per game frame), `cursor` the row read from memory at its end
 * (null or a non-number when the read failed). The returned mask is what to
 * hold from the next frame on. r.state is:
 *   'running'  keep calling
 *   'done'     the cursor reads plan.to; the mask is 0 from now on
 *   'failed'   stopped; the mask is 0 and r.error says why:
 *              { reason, step, expected, actual, frame }
 *              reason: 'start'    the cursor did not read plan.from at the
 *                                 first call
 *                      'moved'    the cursor changed to a row that is not the
 *                                 expected one
 *                      'stuck'    the cursor still read the previous row
 *                                 timing.settle frames after the release
 *                      'unread'   the cursor could not be read for
 *                                 timing.settle frames in a row
 *                      'frame'    frame numbers went backwards
 * After 'done' or 'failed' the result stays the same.
 */
export function createPlanExecutor(plan) {
  const { hold, settle, gap } = plan.timing;
  const steps = plan.steps;
  let state = 'start'; // start | press | settle | gap | done | failed
  let index = 0; // the step being run
  let since = 0; // the frame the current phase started on (its first frame is since + 1)
  let lastFrame = null;
  let unread = 0;
  let prev = plan.from; // the row before the current step
  let result = null;

  const finish = (s, error) => {
    result = Object.freeze(error ? { mask: 0, state: s, error: Object.freeze(error) } : { mask: 0, state: s });
    state = s;
    return result;
  };
  const running = (mask) => ({ mask, state: 'running' });

  return {
    step(frame, cursor) {
      if (result) return result;
      if (!isInt(frame) || (lastFrame !== null && frame < lastFrame)) {
        return finish('failed', { reason: 'frame', step: index, expected: null, actual: null, frame });
      }
      lastFrame = frame;
      const read = typeof cursor === 'number' && Number.isFinite(cursor);

      if (state === 'start') {
        if (!read) {
          if (++unread >= settle) return finish('failed', { reason: 'unread', step: 0, expected: plan.from, actual: null, frame });
          return running(0);
        }
        unread = 0;
        if (cursor !== plan.from) return finish('failed', { reason: 'start', step: 0, expected: plan.from, actual: cursor, frame });
        if (steps.length === 0) return finish('done');
        state = 'press';
        since = frame;
        return running(steps[0].mask);
      }

      if (state === 'press') {
        // The mask is held for frames since+1 .. since+hold.
        if (frame - since < hold) return running(steps[index].mask);
        // Released from the next frame on; the cursor is checked at the end
        // of each of the next `settle` frames (like a format 2 wait.until
        // with timeout = settle). Reads while the button is held are ignored.
        state = 'settle';
        since = frame;
        return running(0);
      }

      const { expect } = steps[index];
      if (state === 'settle') {
        if (!read) {
          if (++unread >= settle) return finish('failed', { reason: 'unread', step: index, expected: expect, actual: null, frame });
        } else {
          unread = 0;
          if (cursor === expect) {
            prev = expect;
            index++;
            if (index === steps.length) return finish('done');
            if (gap === 0) {
              state = 'press';
              since = frame;
              return running(steps[index].mask);
            }
            state = 'gap';
            since = frame;
            return running(0);
          }
          if (cursor !== prev) return finish('failed', { reason: 'moved', step: index, expected: expect, actual: cursor, frame });
        }
        if (frame - since >= settle) return finish('failed', { reason: read ? 'stuck' : 'unread', step: index, expected: expect, actual: read ? cursor : null, frame });
        return running(0);
      }

      // gap: nothing held for frames since+1 .. since+gap; the cursor must stay put.
      if (read && cursor !== prev) return finish('failed', { reason: 'moved', step: index, expected: prev, actual: cursor, frame });
      if (frame - since < gap) return running(0);
      state = 'press';
      since = frame;
      return running(steps[index].mask);
    },
    get state() {
      return result ? result.state : 'running';
    },
  };
}
