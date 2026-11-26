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

/**
 * Inventory slots the item list walks over (Savemap.inventory, 320 entries;
 * MenuTable [1] row count, a source claim: Xeeynamo/ff7-decomp@33ce78c,
 * reference only).
 */
export const ITEM_INVENTORY_SLOTS = 320;

/**
 * The inventory slot under the list cursor: listOffset + listRow (#135: the
 * list indexes Savemap.inventory[row + offset] directly, so empty slots keep
 * their place). null unless both are confirmed integers in range.
 */
export function itemListSlot(listRow, listOffset) {
  if (!Number.isInteger(listRow) || listRow < 0 || listRow >= ITEM_PAGE_ROWS) return null;
  if (!Number.isInteger(listOffset) || listOffset < 0 || listOffset > ITEM_INVENTORY_SLOTS - ITEM_PAGE_ROWS) return null;
  return listOffset + listRow;
}

/**
 * Where one press leaves the list cursors { row, offset }: Down moves the
 * row until row 9, then scrolls one entry (offset + 1); Up moves the row
 * until row 0, then scrolls back. Tier 2 (#256, save-boot-31a/31b): 13
 * Downs from the top read row 9 offset 4, and the plan's 13 steps reach
 * inventory slot 13 across empty slots, so index = offset + row holds.
 * Up at row 0 (scroll back) is not run on this list. Callers never step
 * past the list ends.
 */
export function itemListStep({ row, offset }, button) {
  if (button === 'down') return row < ITEM_PAGE_ROWS - 1 ? { row: row + 1, offset } : { row, offset: offset + 1 };
  if (button === 'up') return row > 0 ? { row: row - 1, offset } : { row, offset: offset - 1 };
  throw new RangeError(`button must be "up" or "down", got ${button}`);
}

/**
 * The list-cursor plan from `from` = { row, offset } (the confirmed
 * itemListRow and itemListOffset) to inventory slot `toSlot`, scrolling past
 * page 1 when needed and never wrapping. A planCursorMove plan over the list
 * index (rows = ITEM_INVENTORY_SLOTS; an executor reads itemListSlot(row,
 * offset) as its cursor), where each step also carries the { row, offset }
 * it should leave, so checks can read both cursors. Bad input throws
 * RangeError. itemListPlan (one page, no scroll) is unchanged.
 */
export function itemSlotPlan(from, toSlot, timing) {
  const index = itemListSlot(from?.row, from?.offset);
  if (index === null) throw new RangeError(`from must be { row: 0..${ITEM_PAGE_ROWS - 1}, offset: 0..${ITEM_INVENTORY_SLOTS - ITEM_PAGE_ROWS} }, got ${JSON.stringify(from)}`);
  const plan = planCursorMove({ from: index, to: toSlot, rows: ITEM_INVENTORY_SLOTS, wraps: false, timing });
  let pos = { row: from.row, offset: from.offset };
  const steps = plan.steps.map((s) => {
    pos = itemListStep(pos, s.button);
    return Object.freeze({ ...s, row: pos.row, offset: pos.offset });
  });
  return Object.freeze({ ...plan, steps: Object.freeze(steps) });
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
