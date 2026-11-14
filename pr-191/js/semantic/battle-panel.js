// Battle command panel facts (#116): which view to show for a battleInput()
// sample, the rows to draw, the cursor plan for a row tap, and how to read the
// cursor while a plan runs. Pure functions over plain data; platform-neutral
// (no DOM, Worker, Node or timers). What each button presses is
// BATTLE_PANEL_ACTIONS in semantic/controls.js.
// Original project code, GPL-2.0-or-later.

import { MENUS, menuPlanArgs } from './menus.js';
import { planCursorMove } from './planner.js';

const HIDDEN = Object.freeze({ view: 'hidden', actor: null, row: null });

/** The command rows, in cursor order: [{ row, label }] (generic labels). */
export function battlePanelRows() {
  return MENUS.battleCommand.labels.map((label, row) => Object.freeze({ row, label }));
}

/**
 * What the panel shows for a battleInput() sample:
 *   null                                  the read failed: keep what is shown
 *   { view: 'hidden' }                    not confirmed, or no menu open
 *   { view: 'targeting', actor }          target selection
 *   { view: 'command', actor, row }       the command menu of party slot
 *                                         `actor`; row is null when that slot's
 *                                         row is not a confirmed read (then
 *                                         row taps cannot be planned)
 */
export function battlePanelView(sample) {
  if (!sample?.value) return null;
  if (sample.confirmed !== true) return HIDDEN;
  const { actor, row, targeting } = sample.value;
  const slot = Number.isInteger(actor) ? actor : null;
  if (targeting) return Object.freeze({ view: 'targeting', actor: slot, row: null });
  if (slot === null) return HIDDEN;
  return Object.freeze({ view: 'command', actor: slot, row: Number.isInteger(row) ? row : null });
}

/**
 * The cursor plan for a tap on command row `to` with the cursor confirmed at
 * `from`. Throws RangeError for a row out of range (see planCursorMove).
 */
export function battlePanelPlan(from, to) {
  return planCursorMove({ from, to, ...menuPlanArgs('battleCommand') });
}

/**
 * The command cursor to give the plan executor for a battleInput() sample
 * taken while a plan for party slot `actor` runs:
 *   a row number   the command menu of that slot is open and its row read
 *   null           nothing usable was read (the executor counts it as unread)
 *   'left'         a confirmed read shows the menu is gone: target selection,
 *                  another slot's menu, or no menu. The plan must stop.
 */
export function battlePlanCursor(sample, actor) {
  if (!sample?.value || sample.confirmed !== true) return null;
  const v = sample.value;
  if (v.targeting || v.actor !== actor) return 'left';
  return Number.isInteger(v.row) ? v.row : null;
}
