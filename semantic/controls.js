// What a touch means in each game state (#114, later #146): plain data and
// pure functions, platform-neutral (no DOM, Worker, Node or timers), so a
// native frontend can reuse them. Button names are the keys of PAD in
// runner/pad.js and web/js/pad.js.
//
// Source: Circle closes a message window that is waiting (#108,
// notes/108-dialogue-state.md). The choice panel is not here yet (needs #168).
// Original project code, GPL-2.0-or-later.

/** Dialogue actions: what a tap does, and in which dialogue() state. */
export const DIALOGUE_ACTIONS = Object.freeze({
  advance: Object.freeze({ id: 'advance', button: 'circle', when: 'waiting' }),
});

/**
 * The pad button a tap should press for a dialogue() sample, or null.
 * Only a confirmed read of a window that is waiting for Circle gives one:
 * typing, closed, unconfirmed and failed reads give null.
 */
export function dialogueTapButton(sample) {
  if (sample?.value?.waiting === true && sample.confirmed === true) return DIALOGUE_ACTIONS.advance.button;
  return null;
}
