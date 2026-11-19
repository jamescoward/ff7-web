// What a touch means in each game state (#114, later #146): plain data and
// pure functions, platform-neutral (no DOM, Worker, Node or timers), so a
// native frontend can reuse them. Button names are the keys of PAD in
// runner/pad.js and web/js/pad.js.
//
// Sources: Circle closes a message window that is waiting (#108,
// notes/108-dialogue-state.md). The choice panel is not here yet (needs #168).
// The field buttons are the ones #23 put on the touch layout (Circle talks
// and examines, Triangle opens the menu, Cross cancels); #146 moved them here.
// #25 adds the context-aware Interact label (interactLabel), over #112 nearby().
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

/**
 * Battle command panel actions (#116). A command-row tap moves the command
 * cursor there with the menu planner, then presses `select`. In target
 * selection, Prev and Next move the target cursor (Left, Right), Confirm
 * takes it (Circle) and Back cancels it (Cross).
 *
 * Back is Cross, not Triangle as the #116 contract says: in the reference
 * decomp (Xeeynamo/ff7-decomp@2c9239a, src/battle/battle3.c) the targeting
 * code cancels on PAD_CROSS ("pressed Cancel/Back"), and PAD_TRIANGLE in
 * battle closes the command menu altogether (it sets the widget to -1, the
 * switch to the next ready character). A source claim, not checked in Tier 2.
 */
export const BATTLE_PANEL_ACTIONS = Object.freeze({
  select: Object.freeze({ id: 'select', button: 'circle' }),
  prev: Object.freeze({ id: 'prev', label: '◀ Prev', button: 'left', when: 'targeting' }),
  next: Object.freeze({ id: 'next', label: 'Next ▶', button: 'right', when: 'targeting' }),
  confirm: Object.freeze({ id: 'confirm', label: 'Confirm ○', button: 'circle', when: 'targeting' }),
  back: Object.freeze({ id: 'back', label: 'Back ✕', button: 'cross', when: 'targeting' }),
});

/** The targeting buttons, in screen order. */
export const BATTLE_TARGET_ACTIONS = Object.freeze(['prev', 'next', 'confirm', 'back']);

/**
 * Native Item screen actions (#135, Labs flag `native-item`). An item tap
 * moves the list cursor there with the menu planner, then presses `select`;
 * a party tap does the same with the party cursor. Back presses Cross, the
 * menus' cancel button (as the field Back, FIELD_ACTIONS). On the list,
 * Cross goes to the Item screen's tab row (itemMenuScreen 0, save-boot-14d),
 * and a second Cross returns to the main menu (menuOverlay 0, 14e). On the
 * target page it returns to the list (a source claim).
 */
export const ITEM_SCREEN_ACTIONS = Object.freeze({
  select: Object.freeze({ id: 'select', button: 'circle' }),
  back: Object.freeze({ id: 'back', label: 'Back ✕', button: 'cross' }),
});

/**
 * Native Equip screen actions (#121, Labs flag `native-equip`). A tap on
 * the first spare weapon presses `select` twice (the Weapon slot, then the
 * list's first entry; save-boot-15c, semantic/equip-screen.js). Back
 * presses Cross, the menus' cancel button; where it goes from the Equip
 * screen is not measured.
 */
export const EQUIP_SCREEN_ACTIONS = Object.freeze({
  select: Object.freeze({ id: 'select', button: 'circle' }),
  back: Object.freeze({ id: 'back', label: 'Back ✕', button: 'cross' }),
});

/**
 * Context-aware Interact labels (#25, Labs flag `interact-label`). The
 * Interact button still presses Circle; only its label changes, from a
 * nearby() result (semantic/layer.js, #112).
 */
export const INTERACT_LABELS = Object.freeze({
  talk: Object.freeze({ id: 'talk', label: 'Talk ○' }),
  exit: Object.freeze({ id: 'exit', label: 'Exit ○' }),
});

/**
 * What the Interact button should say for a nearby() result:
 * { id, label, dim }. id is 'talk', 'exit' or 'interact' (the plain label,
 * FIELD_ACTIONS). Pure: no DOM.
 *
 * - A failed read, a result with a reason (not in a settled field) or an
 *   unconfirmed result says nothing either way: the plain label, not dimmed.
 *   nearby() is unconfirmed while fieldZ, fieldTalkOff and fieldTalkRange are
 *   hypotheses (notes/112-field-interactables.md), so until #112's talk rule
 *   is confirmed in Tier 2 the label never changes in a real game.
 * - Confirmed, an NPC in range: Talk. Circle talks to an NPC in range, so
 *   Talk wins over an exit in range (agent default, #25).
 * - Confirmed, an exit in range and no NPC: Exit.
 * - Confirmed, nothing in range: the plain label, dimmed (agent default,
 *   #25: dimmed, not hidden, so the layout never shifts).
 */
export function interactLabel(sample) {
  const plain = FIELD_ACTIONS.find((a) => a.id === 'interact');
  const list = sample?.value;
  if (!Array.isArray(list) || sample.reason || sample.confirmed !== true) {
    return { id: plain.id, label: plain.label, dim: false };
  }
  const inRange = (kind) => list.some((e) => e?.kind === kind && e.inRange === true);
  if (inRange('npc')) return { ...INTERACT_LABELS.talk, dim: false };
  if (inRange('exit')) return { ...INTERACT_LABELS.exit, dim: false };
  return { id: plain.id, label: plain.label, dim: true };
}
