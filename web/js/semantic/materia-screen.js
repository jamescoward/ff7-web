// Native Materia screen facts (#246, #248): which inventory slot each row of
// the game's visible materia list shows, and the pad plans that move the
// slot and list cursors. Pure functions over plain data;
// platform-neutral (no DOM, Worker, Node or timers). IDs and AP only:
// materia names are game data.
// Original project code, GPL-2.0-or-later.

import { planCursorMove } from './planner.js';

/** Rows on one page of the materia list (#244 save-boot-24c: only the 10-row offset hypothesis matched). */
export const MATERIA_PAGE_ROWS = 10;

/**
 * The inventory slot under the list cursor: listOffset + listRow. The list
 * keeps empty inventory slots in place, in slot order (#244 for a full
 * list; #246 save-boot-26a with empty slots between entries). null unless
 * both are non-negative integers and the row is on the page.
 */
export function materiaListSlot(listRow, listOffset) {
  if (!Number.isInteger(listRow) || !Number.isInteger(listOffset)) return null;
  if (listRow < 0 || listRow >= MATERIA_PAGE_ROWS || listOffset < 0) return null;
  return listOffset + listRow;
}

/**
 * The game's visible materia page as rows: [{ row, slot, materia }] for rows
 * 0 .. MATERIA_PAGE_ROWS-1, where materia is the materia() entry for that
 * slot ({ id, ap }) or null when the slot is empty (#246 save-boot-26b:
 * Circle on an empty row moves no materia, and the cursor stays).
 * listOffset must be a confirmed integer; anything else gives no rows.
 */
export function materiaPageRows(listOffset, materia) {
  if (!Number.isInteger(listOffset) || listOffset < 0) return [];
  const bySlot = new Map((materia ?? []).map((m) => [m.slot, m]));
  const rows = [];
  for (let row = 0; row < MATERIA_PAGE_ROWS; row++) {
    const slot = listOffset + row;
    const m = bySlot.get(slot) ?? null;
    rows.push(Object.freeze({ row, slot, materia: m && Object.freeze({ id: m.id, ap: m.ap }) }));
  }
  return rows;
}

/** Materia inventory slots (Savemap materia[0..199], #117): the list's length. */
export const MATERIA_INVENTORY_SLOTS = 200;

/**
 * Slot columns confirmed on a row: Right from column 0 reads 1 and Left
 * comes back (#244 save-boot-25a, Cloud's starting weapon). How many slots a
 * given weapon or armor has is not read, so plans go no further.
 */
export const MATERIA_CONFIRMED_COLUMNS = 2;

/**
 * The slot-cursor plan along a row, column `from` to column `to` (Left and
 * Right; never wraps). Columns beyond MATERIA_CONFIRMED_COLUMNS throw
 * RangeError, as planCursorMove does for any row out of range.
 */
export function materiaColumnPlan(from, to, timing) {
  return planCursorMove({ from, to, rows: MATERIA_CONFIRMED_COLUMNS, axis: 'horizontal', wraps: false, timing });
}

/**
 * Where one press leaves the list cursor { row, offset }: Down moves the row
 * until the last page row, then scrolls (offset + 1, row stays; #244
 * save-boot-25b; past empty slots, #248 save-boot-27a). Up moves the row
 * until row 0 with the offset unchanged (#248 save-boot-27b: six Ups from
 * row 9, offset 4 read rows 8-3, offset 4), then scrolls back (offset - 1;
 * Up at row 0 with offset > 0 is not yet run in Tier 2).
 */
export function materiaListStep({ row, offset }, button) {
  if (button === 'down') return row < MATERIA_PAGE_ROWS - 1 ? { row: row + 1, offset } : { row, offset: offset + 1 };
  if (button === 'up') return row > 0 ? { row: row - 1, offset } : { row, offset: offset - 1 };
  throw new RangeError(`button must be "up" or "down", got ${button}`);
}

/**
 * The list-cursor plan from `from` = { row, offset } (the confirmed
 * materiaListRow and materiaListOffset) to inventory slot `toSlot`. The list
 * keeps empty slots in place (#246), so the cursor moves over list index =
 * offset + row, one entry a press, and never wraps. The returned plan is a
 * planCursorMove plan over the index (rows = MATERIA_INVENTORY_SLOTS; a plan
 * executor reads materiaListSlot(row, offset) as its cursor), and each step
 * also carries the { row, offset } it should leave, for checks that read the
 * two cursors. Bad input throws RangeError.
 */
export function materiaListPlan(from, toSlot, timing) {
  const index = materiaListSlot(from?.row, from?.offset);
  if (index === null) throw new RangeError(`from must be { row: 0..${MATERIA_PAGE_ROWS - 1}, offset >= 0 }, got ${JSON.stringify(from)}`);
  const plan = planCursorMove({ from: index, to: toSlot, rows: MATERIA_INVENTORY_SLOTS, wraps: false, timing });
  let pos = { row: from.row, offset: from.offset };
  const steps = plan.steps.map((s) => {
    pos = materiaListStep(pos, s.button);
    return Object.freeze({ ...s, row: pos.row, offset: pos.offset });
  });
  return Object.freeze({ ...plan, steps: Object.freeze(steps) });
}
