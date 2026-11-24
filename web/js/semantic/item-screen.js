// Native Item screen facts (#135): the rows to show for the game's visible
// item page, the cursor plans for a tap, and whether a use took effect.
// Pure functions over plain data; platform-neutral (no DOM, Worker, Node or
// timers). IDs and counts only: item names are game data. What a tap presses
// is ITEM_SCREEN_ACTIONS in semantic/controls.js.
// Original project code, GPL-2.0-or-later.

import { nameFor } from './game-text.js';
import { MENUS, menuPlanArgs } from './menus.js';
import { planCursorMove } from './planner.js';

/** Rows on one page of the game's item list (MENUS.itemList, a source claim). */
export const ITEM_PAGE_ROWS = MENUS.itemList.rows;
/** Party slots the item can be used on (MENUS.itemTarget). */
export const ITEM_TARGET_ROWS = MENUS.itemTarget.rows;

/**
 * The game's visible item page as rows: [{ row, slot, item }] for rows
 * 0 .. ITEM_PAGE_ROWS-1, where slot = listOffset + row (the game lists
 * Savemap inventory in slot order) and item is the inventory() entry for
 * that slot ({ index, quantity, kind, number }) or null when it is empty.
 * listOffset must be a confirmed integer; anything else gives no rows.
 */
export function itemPageRows(listOffset, inventory) {
  if (!Number.isInteger(listOffset) || listOffset < 0) return [];
  const bySlot = new Map((inventory ?? []).map((it) => [it.slot, it]));
  const rows = [];
  for (let row = 0; row < ITEM_PAGE_ROWS; row++) {
    const slot = listOffset + row;
    const it = bySlot.get(slot) ?? null;
    rows.push(Object.freeze({ row, slot, item: it && Object.freeze({ index: it.index, quantity: it.quantity, kind: it.kind, number: it.number }) }));
  }
  return rows;
}

/**
 * A row's text: the item's kind and number within it, and its count. IDs
 * only, unless `names` holds tables built on the device (#260); without them
 * the text is unchanged.
 */
export function itemRowLabel(item, names = null) {
  if (!item) return '—';
  return `${nameFor(item.kind, item.number, names, `${item.kind} #${item.number}`)} ×${item.quantity}`;
}

/** The list-cursor plan for a tap on page row `to` with the cursor at `from` (never wraps or scrolls). */
export function itemListPlan(from, to) {
  return planCursorMove({ from, to, ...menuPlanArgs('itemList') });
}

/** The party-cursor plan for a tap on party slot `to` with the cursor at `from` (never wraps). */
export function itemTargetPlan(from, to) {
  return planCursorMove({ from, to, ...menuPlanArgs('itemTarget') });
}

/**
 * Did a use take effect? `before` and `after` are { quantity, hp } read
 * before the final Circle and afterwards (quantity 0 once the slot is
 * empty; hp null when unread). used: the count fell by exactly one. hpRose:
 * the target's HP rose (null when either HP is unread).
 */
export function itemUseOutcome(before, after) {
  const used = Number.isInteger(before?.quantity) && Number.isInteger(after?.quantity) && after.quantity === before.quantity - 1;
  const hpRose = Number.isInteger(before?.hp) && Number.isInteger(after?.hp) ? after.hp > before.hp : null;
  return { used, hpRose };
}
