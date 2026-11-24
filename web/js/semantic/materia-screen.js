// Native Materia screen facts (#246, #248): which inventory slot each row of
// the game's visible materia list shows, and the pad plans that move the
// slot and list cursors. Pure functions over plain data;
// platform-neutral (no DOM, Worker, Node or timers). IDs and AP only:
// materia names are game data.
// Original project code, GPL-2.0-or-later.

import { nameFor } from './game-text.js';
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

// --- Native Materia screen (#250, Labs flag `native-materia`) ---
// What a tap may do and how its result is read. The sequence is the one
// Tier 2 ran in save-boot-27a (#248): with the screen open 120 frames,
// materiaColumnPlan along the weapon row, Circle and 60 frames (the list
// opens), materiaListPlan to the inventory slot, then Circle.

/** Frames the Materia screen must have been open before a tap (save-boot-27a: 120 after menuOverlay reads 3). */
export const MATERIA_SETTLE_FRAMES = 120;
/** Frames after the Circle that opens the list before the list plan starts (save-boot-27a: 60). */
export const MATERIA_LIST_OPEN_FRAMES = 60;
/** The slot row a tap fills: 0, the weapon row (#244); the armor row is not planned (#255). */
export const MATERIA_TAP_ROW = 0;

/**
 * May a tap put inventory slot `slot` into weapon materia column `column`
 * now? { ok, reason }. state: { open, framesOpen, memberSlot, cursors,
 * weaponMateria, materia }:
 * - memberSlot: the party slot whose screen this is, or null when not known
 *   (a party of one only; the party pick is not confirmed on this screen);
 * - cursors: a materiaCursors() value; the slot cursor must read the weapon
 *   row and a column, so the plans start from confirmed values;
 * - weaponMateria: that member's weapon materia slots ({ id, ap } or null);
 * - materia: the materia() value.
 * Only empty, confirmed columns are offered: Tier 2 filled empty slots only,
 * and a swap is not run.
 */
export function materiaTapAllowed(state, column, slot) {
  if (!state?.open) return { ok: false, reason: 'closed' };
  if (state.memberSlot === null || state.memberSlot === undefined) return { ok: false, reason: 'party pick not read' };
  if (!(Number.isInteger(column) && column >= 0 && column < MATERIA_CONFIRMED_COLUMNS)) return { ok: false, reason: 'column not planned' };
  if (!(Number.isInteger(slot) && slot >= 0 && slot < MATERIA_INVENTORY_SLOTS)) return { ok: false, reason: 'no materia' };
  if (!Array.isArray(state.materia) || !state.materia.some((m) => m.slot === slot)) return { ok: false, reason: 'no materia' };
  if (!Array.isArray(state.weaponMateria) || state.weaponMateria.length <= column) return { ok: false, reason: 'unread' };
  if (state.weaponMateria[column] !== null) return { ok: false, reason: 'slot not empty' };
  const c = state.cursors;
  if (!(c && c.row === MATERIA_TAP_ROW && Number.isInteger(c.column))) return { ok: false, reason: 'cursor not read' };
  if (!(Number.isInteger(state.framesOpen) && state.framesOpen >= MATERIA_SETTLE_FRAMES)) return { ok: false, reason: 'settling' };
  return { ok: true, reason: null };
}

/**
 * Did the tap move the materia? before and after: { inventory, weapon },
 * the { id, ap } (or null) in the tapped inventory slot and in the weapon
 * column. 'equipped': the inventory slot is now empty and the column holds
 * what it held. 'other': either changed some other way. 'none': no change
 * (or unread: pass undefined for an unread value).
 */
export function materiaEquipOutcome(before, after) {
  const same = (a, b) => (a === null && b === null) || (a && b && a.id === b.id && a.ap === b.ap);
  if (!before || !after || before.inventory === undefined || after.inventory === undefined || after.weapon === undefined) return 'none';
  if (before.inventory && after.inventory === null && same(after.weapon, before.inventory)) return 'equipped';
  if (same(before.inventory, after.inventory) && same(before.weapon, after.weapon)) return 'none';
  return 'other';
}

/** A materia's text: ID and AP only (names are game data), unless `names` holds tables built on the device (#260). */
export function materiaLabel(m, names = null) {
  if (!m) return '—';
  return `${nameFor('materia', m.id, names, `materia #${m.id}`)}  AP ${m.ap}`;
}

/** A weapon materia column's text. IDs only, unless `names` is given (#260). */
export function materiaColumnLabel(column, m, names = null) {
  return `Wpn ${column + 1}: ${m ? nameFor('materia', m.id, names, `#${m.id}`) : 'empty'}`;
}
