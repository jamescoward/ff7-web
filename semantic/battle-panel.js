// Battle command panel facts (#116, list view #253): which view to show for a
// battleInput() or battleList() sample, the rows to draw, the cursor plan for a row tap, and how to read the
// cursor while a plan runs. Pure functions over plain data; platform-neutral
// (no DOM, Worker, Node or timers). What each button presses is
// BATTLE_PANEL_ACTIONS in semantic/controls.js.
// Original project code, GPL-2.0-or-later.

import { MENUS, menuPlanArgs } from './menus.js';
import { planCursorMove } from './planner.js';
import { battleListPlan } from './battle-lists.js';

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

/**
 * What the panel shows for a battleList() sample (#253 part 2):
 *   null                         the read failed: keep what is shown
 *   { view: 'hidden' }           not confirmed, or no list open
 *   { view: 'list', list, actor, index, pos }
 *                                the Magic or Item list of party slot `actor`
 *                                is open; index is the entry under the
 *                                cursor and pos its { row, offset, column },
 *                                both null when the cursor is not a confirmed
 *                                read (then entry taps cannot be planned)
 */
export function battleListView(sample) {
  if (!sample?.value) return null;
  if (sample.confirmed !== true) return HIDDEN;
  const { actor, list, index, row, offset, column } = sample.value;
  if (!list) return HIDDEN;
  const slot = Number.isInteger(actor) ? actor : null;
  const known = Number.isInteger(index);
  return Object.freeze({
    view: 'list',
    list,
    actor: slot,
    row: null,
    index: known ? index : null,
    pos: known ? Object.freeze({ row, offset, column: list === 'magic' ? column : 0 }) : null,
  });
}

/**
 * The plan for a tap on list entry `toIndex` with the list view `view`
 * (battleListView, with a known cursor). Throws RangeError when it cannot be
 * planned.
 */
export function battleListTapPlan(view, toIndex) {
  if (view?.view !== 'list' || !view.pos) throw new RangeError('no confirmed list cursor');
  return battleListPlan(view.list, view.pos, toIndex);
}

/**
 * The list cursor to give the plan executor for a battleList() sample taken
 * while a list plan for party slot `actor` and list `list` runs: the list
 * index, null when nothing usable was read, or 'left' when a confirmed read
 * shows that list is no longer open for that slot.
 */
export function battleListPlanCursor(sample, actor, list) {
  if (!sample?.value || sample.confirmed !== true) return null;
  const v = sample.value;
  if (v.list !== list || v.actor !== actor) return 'left';
  return Number.isInteger(v.index) ? v.index : null;
}
