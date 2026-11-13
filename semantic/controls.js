// What a touch means in each game state (#114, later #146): plain data and
// pure functions, platform-neutral (no DOM, Worker, Node or timers), so a
// native frontend can reuse them. Button names are the keys of PAD in
// runner/pad.js and web/js/pad.js.
//
// Sources: Circle closes a message window that is waiting (#108,
// notes/108-dialogue-state.md). The choice panel is not here yet (needs #168).
// The field buttons are the ones #23 put on the touch layout (Circle talks
// and examines, Triangle opens the menu, Cross cancels); #146 moved them here.
// Original project code, GPL-2.0-or-later.

/**
 * Field actions (#23, #146), in screen order: what each field button is
 * called and which pad button it holds. `kind` is 'action' for the main
 * buttons and 'back' for the smaller cancel button. The labels carry the
 * PlayStation symbol of the button they press.
 */
export const FIELD_ACTIONS = Object.freeze([
  Object.freeze({ id: 'interact', label: 'Interact ○', button: 'circle', kind: 'action' }),
  Object.freeze({ id: 'menu', label: 'Menu △', button: 'triangle', kind: 'action' }),
  Object.freeze({ id: 'back', label: 'Back ✕', button: 'cross', kind: 'back' }),
]);

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

/**
 * Main-menu panel actions (#115): what a tap on the touch panel presses.
 * A row tap moves the cursor there with the menu planner, then presses
 * `select`; Back and Close both press Triangle (the game's cancel button in
 * the menu: it backs out of a sub-screen, and closes the main menu).
 * Rows the game greys out (PHS, Save) are not special-cased: the input is
 * still sent and the game ignores it, as it would a pad press.
 */
export const MENU_PANEL_ACTIONS = Object.freeze({
  select: Object.freeze({ id: 'select', button: 'circle' }),
  back: Object.freeze({ id: 'back', label: 'Back', button: 'triangle' }),
  close: Object.freeze({ id: 'close', label: 'Close', button: 'triangle' }),
});
