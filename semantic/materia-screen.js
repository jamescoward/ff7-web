// Native Materia screen facts (#246): which inventory slot each row of the
// game's visible materia list shows. Pure functions over plain data;
// platform-neutral (no DOM, Worker, Node or timers). IDs and AP only:
// materia names are game data.
// Original project code, GPL-2.0-or-later.

/** Rows on one page of the materia list (#244 save-boot-24c: only the 10-row offset hypothesis matched). */
export const MATERIA_PAGE_ROWS = 10;

/**
 * The inventory slot under the list cursor: listOffset + listRow. The list
 * keeps empty inventory slots in place, in slot order (#244 for a full
 * list; with empty slots between entries a hypothesis until #246
 * save-boot-26a passes in Tier 2). null unless
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
 * slot ({ id, ap }) or null when the slot is empty (hypothesis until #246
 * save-boot-26b passes: Circle on an empty row moves no materia). listOffset must be a confirmed
 * integer; anything else gives no rows.
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
