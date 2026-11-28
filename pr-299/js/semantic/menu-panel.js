// Main-menu panel facts (#115): the rows to show and the cursor plan for a tap.
// Pure functions over plain data; platform-neutral (no DOM, Worker, Node or
// timers). What a tap presses (Circle to select, Triangle for Back and Close)
// is MENU_PANEL_ACTIONS in semantic/controls.js.
// Original project code, GPL-2.0-or-later.

import { MENUS, menuPlanArgs } from './menus.js';
import { planCursorMove } from './planner.js';

/**
 * The panel's rows, in cursor order: [{ row, label }]. Labels come from
 * MENUS.main.labels (labelsStatus 'hypothesis': the order is a source claim).
 */
export function menuPanelRows() {
  return MENUS.main.labels.map((label, row) => Object.freeze({ row, label }));
}

/**
 * The cursor plan for a tap on panel row `to` with the cursor confirmed at
 * `from`, using the main menu's confirmed facts (10 rows, wraps). Throws
 * RangeError for a row out of range (see planCursorMove).
 */
export function menuPanelPlan(from, to) {
  return planCursorMove({ from, to, ...menuPlanArgs('main') });
}
