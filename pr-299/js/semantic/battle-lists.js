// Battle sub-lists (#253): the Magic, Summon and Item lists a battle command
// opens. Where the list cursor is, what a list index means, and the pad plan
// that moves the cursor to an index. Pure functions over plain data;
// platform-neutral (no DOM, Worker, Node or timers).
//
// Layouts are from Xeeynamo/ff7-decomp@33ce78c (reference only, no code
// copied), src/battle/battle3.c:
//   - Magic: BattleMenuWidgetSubReset sets D_800F90B4[slot].table24 to 3
//     columns, 3 rows a page, 0x12 rows, no vertical wrap;
//   - Summon: BattleMenuWidgetSub2Reset sets table36 to 1 column, 3 rows a
//     page, 0x10 rows; BattleMenuInputState7 takes entry
//     column + row + rowOffset;
//   - Item: BattleMenuWidgetInit sets the widget at record +0x12 to 3 rows a
//     page; BattleInitItemList (batini.c) copies inventory slot i to
//     g_BattleItemList[i].
// What Tier 2 has shown is recorded in notes/253-battle-lists.md and on each
// address table entry.
// Original project code, GPL-2.0-or-later.

import { planCursorMove } from './planner.js';

/**
 * Per list: columns, visible rows a page, total rows. entries = columns × rows.
 */
export const BATTLE_LISTS = Object.freeze({
  magic: Object.freeze({ columns: 3, pageRows: 3, rows: 18, entries: 54 }),
  summon: Object.freeze({ columns: 1, pageRows: 3, rows: 16, entries: 16 }),
  item: Object.freeze({ columns: 1, pageRows: 3, rows: 320, entries: 320 }),
});

const isInt = (v) => Number.isInteger(v);

function listOf(name) {
  const list = BATTLE_LISTS[name];
  if (!list) throw new RangeError(`list must be one of ${Object.keys(BATTLE_LISTS).join(', ')}, got ${name}`);
  return list;
}

/**
 * The list index under the cursor { row, offset, column } (column 0 when
 * left out): (offset + row) × columns + column. null when the cursor is not a
 * valid position of that list.
 */
export function battleListIndex(name, pos) {
  const list = listOf(name);
  const row = pos?.row;
  const offset = pos?.offset;
  const column = pos?.column ?? 0;
  if (![row, offset, column].every(isInt)) return null;
  if (row < 0 || row >= list.pageRows || offset < 0 || column < 0 || column >= list.columns) return null;
  if (offset + row >= list.rows) return null;
  return (offset + row) * list.columns + column;
}

/**
 * Where one press leaves the cursor { row, offset, column }: Down moves the
 * row until the page's last row, then scrolls (offset + 1); Up moves the row
 * until row 0, then scrolls back (offset - 1); Left and Right move the column.
 * A press past an end is not modelled (plans never make one): it throws.
 */
export function battleListStep(name, pos, button) {
  const list = listOf(name);
  const { row, offset } = pos;
  const column = pos.column ?? 0;
  let next;
  if (button === 'down') next = row < list.pageRows - 1 ? { row: row + 1, offset, column } : { row, offset: offset + 1, column };
  else if (button === 'up') next = row > 0 ? { row: row - 1, offset, column } : { row, offset: offset - 1, column };
  else if (button === 'right') next = { row, offset, column: column + 1 };
  else if (button === 'left') next = { row, offset, column: column - 1 };
  else throw new RangeError(`button must be up, down, left or right, got ${button}`);
  if (battleListIndex(name, next) === null) throw new RangeError(`${button} from ${JSON.stringify(pos)} leaves the ${name} list`);
  return next;
}

/**
 * The plan from cursor `from` = { row, offset, column } to list index
 * `toIndex`: first Up or Down to the index's row, then Left or Right to its
 * column. It never wraps. The returned plan is a planCursorMove-shaped plan
 * over the list index (from, to, steps[].expect are indexes, so a plan
 * executor reads battleListIndex() as its cursor), and each step also
 * carries the { row, offset, column } it should leave. Bad input throws
 * RangeError.
 */
export function battleListPlan(name, from, toIndex, timing) {
  const list = listOf(name);
  const start = battleListIndex(name, from);
  if (start === null) throw new RangeError(`from is not a ${name} list position: ${JSON.stringify(from)}`);
  if (!isInt(toIndex) || toIndex < 0 || toIndex >= list.entries) throw new RangeError(`toIndex must be in 0..${list.entries - 1}, got ${toIndex}`);
  const vertical = planCursorMove({ from: from.offset + from.row, to: Math.floor(toIndex / list.columns), rows: list.rows, timing });
  const horizontal = planCursorMove({ from: from.column ?? 0, to: toIndex % list.columns, rows: list.columns, axis: 'horizontal', timing });
  let pos = { row: from.row, offset: from.offset, column: from.column ?? 0 };
  const steps = [...vertical.steps, ...horizontal.steps].map((s) => {
    pos = battleListStep(name, pos, s.button);
    return Object.freeze({ button: s.button, mask: s.mask, expect: battleListIndex(name, pos), ...pos });
  });
  return Object.freeze({ from: start, to: toIndex, rows: list.entries, wraps: false, skips: false, timing: vertical.timing, steps: Object.freeze(steps) });
}

/** enabledMagic id of an empty Magic list entry. */
export const MAGIC_ID_NONE = 0xff;

/**
 * The entries a list offers, from raw reads, in list order (#253 part 2):
 *   magic: raw.ids = the spell id at each list index (battleMagicId);
 *          gives [{ index, id }] for each index whose id is not 0xFF;
 *   item:  raw.counts = the battle count at each list index (battleItemCount;
 *          list index = inventory slot), raw.inventory = the inventory()
 *          value ([{ slot, index, kind, number, ... }]) or null; gives
 *          [{ index, count, item }] for each index whose count is above 0,
 *          item = { index, kind, number } of that inventory slot, or null.
 * IDs and counts only: names are game data. Anything not an array gives [].
 */
export function battleListEntries(name, raw) {
  listOf(name);
  if (name === 'magic') {
    if (!Array.isArray(raw?.ids)) return [];
    const out = [];
    raw.ids.forEach((id, index) => { if (isInt(id) && id !== MAGIC_ID_NONE) out.push(Object.freeze({ index, id })); });
    return out;
  }
  if (name === 'item') {
    if (!Array.isArray(raw?.counts)) return [];
    const bySlot = new Map((Array.isArray(raw.inventory) ? raw.inventory : []).map((it) => [it.slot, it]));
    const out = [];
    raw.counts.forEach((count, index) => {
      if (!isInt(count) || count <= 0) return;
      const it = bySlot.get(index);
      out.push(Object.freeze({ index, count, item: it ? Object.freeze({ index: it.index, kind: it.kind, number: it.number }) : null }));
    });
    return out;
  }
  return [];
}

/** A list entry's button text: generic, IDs and counts only. */
export function battleListLabel(name, entry) {
  if (name === 'magic') return `Spell #${entry.id}`;
  if (name === 'item') return `${entry.item ? `${entry.item.kind} #${entry.item.number}` : `Slot ${entry.index}`} ×${entry.count}`;
  return `#${entry.index}`;
}
