// Native Equip screen facts (#121): what the native screen shows while the
// game's Equip screen is open, when a weapon tap is allowed, the presses it
// makes, and whether the change took effect. Pure functions over plain
// data; platform-neutral (no DOM, Worker, Node or timers). IDs and counts
// only: equipment names are game data. What a tap presses is
// EQUIP_SCREEN_ACTIONS in semantic/controls.js.
//
// What is known (Tier 2, #121 part 1, save-boot-15b and 15c): the Equip
// screen opens on the Weapon slot; for a one-member party, Circle 120
// frames after the overlay is asked for, then Circle 60 frames later,
// equips the first weapon in the list, which was the first spare weapon in
// inventory slot order. The main-menu party pick names the member for a
// party of two or three (#215, save-boot-16a to 16d), shown by
// equipChosenSlot. No Equip-screen cursor or list order beyond that entry
// is read, so only that opening-state move is offered, and only for a
// one-member party.
//
// v2 (#254, after #216 confirmed the Equip screen's slot and list cursors):
// pad plans for the slot cursor (Weapon, Armor, Accessory) and the list
// cursor (8 rows a page, index = offset + row), a tap rule for any party
// member and slot, and an outcome over the member's whole equipment. The
// game's list holds only what that member can equip (kernel data, not
// read), so v2 offers list rows by index and reads the savemap afterwards
// to say what was equipped (#254 option (a)).
// Original project code, GPL-2.0-or-later.

import { planCursorMove } from './planner.js';

/** Frames the Equip screen must have been open before the first press (save-boot-15c: 120). */
export const EQUIP_SETTLE_FRAMES = 120;
/** Frames between the two presses (save-boot-15c: Circle on the Weapon slot, 60 frames, Circle on the list). */
export const EQUIP_STEP_FRAMES = 60;
/** Party slots the menu shows. */
export const EQUIP_PARTY_SLOTS = 3;

/** The presses of a first-weapon tap, as { at, action } in frames after the tap starts. */
export const EQUIP_FIRST_WEAPON_PRESSES = Object.freeze([
  Object.freeze({ at: 0, action: 'select' }),
  Object.freeze({ at: EQUIP_STEP_FRAMES, action: 'select' }),
]);

/**
 * The spare weapons in the inventory() value, in slot order:
 * [{ slot, number, quantity }]. Whether the member can equip them, and the
 * game's list order, are not read (kernel data).
 */
export function spareWeapons(inventory) {
  if (!Array.isArray(inventory)) return [];
  return inventory
    .filter((it) => it && it.kind === 'weapon' && Number.isInteger(it.slot) && Number.isInteger(it.number))
    .sort((a, b) => a.slot - b.slot)
    .map((it) => Object.freeze({ slot: it.slot, number: it.number, quantity: it.quantity }));
}

/**
 * The party slot whose Equip screen this is, when it is known: the only
 * occupied slot. `members` holds one equipment() value (or null for an
 * empty or unread slot) per party slot. With more than one member it gives
 * null: the tap rule can't tell the game's list order then (see
 * equipChosenSlot).
 */
export function equipMemberSlot(members) {
  if (!Array.isArray(members)) return null;
  const occupied = [];
  members.forEach((m, slot) => { if (m) occupied.push(slot); });
  return occupied.length === 1 ? occupied[0] : null;
}

/**
 * The party slot whose Equip screen is open, for display (#215): the
 * confirmed party pick when it names an occupied slot, else the
 * one-member rule (equipMemberSlot). `pick` is the partyPick() value
 * (0-2, or null when unread). The tap rule still uses equipMemberSlot:
 * the game's list holds only the weapons the member can equip, which is
 * kernel data and not read, so for a larger party the first spare weapon
 * in inventory order need not be the first list entry (save-boot-16c:
 * Barret took weapon 33 from inventory slot 2).
 */
export function equipChosenSlot(members, pick) {
  if (Array.isArray(members) && Number.isInteger(pick) && pick >= 0 && pick < members.length && members[pick]) return pick;
  return equipMemberSlot(members);
}

/**
 * May a tap on spare-weapon row `row` run now? { ok, reason }.
 * state: { open, framesOpen, pristine, memberSlot, weapons }. Only row 0
 * (the first spare weapon) is offered, only for a known member, only once
 * the screen has settled, and only while it is still in its opening state
 * (pristine: no other input and no earlier tap since it opened).
 */
export function equipTapAllowed(state, row) {
  if (!state?.open) return { ok: false, reason: 'closed' };
  if (!Array.isArray(state.weapons) || !state.weapons[row]) return { ok: false, reason: 'no weapon' };
  if (row !== 0) return { ok: false, reason: 'list order not read' };
  if (state.memberSlot === null || state.memberSlot === undefined) return { ok: false, reason: 'party pick not read' };
  if (!state.pristine) return { ok: false, reason: 'not the opening state' };
  if (!(Number.isInteger(state.framesOpen) && state.framesOpen >= EQUIP_SETTLE_FRAMES)) return { ok: false, reason: 'settling' };
  return { ok: true, reason: null };
}

/**
 * Did the tap change the weapon? before and after are the member's weapon
 * numbers (null when unread); wanted is the tapped weapon's number.
 * 'equipped': it now holds `wanted`. 'other': it changed to something
 * else. 'none': no change (or unread).
 */
export function equipOutcome(before, after, wanted) {
  if (!Number.isInteger(before) || !Number.isInteger(after) || after === before) return 'none';
  return after === wanted ? 'equipped' : 'other';
}

/** A member row's text: slot, weapon, armor and accessory numbers. IDs only. */
export function equipMemberLabel(slot, eq) {
  if (!eq) return `Slot ${slot + 1}: —`;
  const n = (v) => (Number.isInteger(v) ? `#${v}` : '?');
  return `Slot ${slot + 1}  Wpn ${n(eq.weapon)}  Arm ${n(eq.armor)}  Acc ${eq.accessory === null ? 'none' : n(eq.accessory)}`;
}

/** A spare weapon row's text. IDs only. */
export function spareWeaponLabel(w) {
  if (!w) return '—';
  return `weapon #${w.number} ×${w.quantity}`;
}

// --- Native Equip v2 (#254, Labs flag `native-equip`) ---

/**
 * The Equip screen's slot rows, by slot cursor value (#216 save-boot-18a:
 * the cursor reads 0, 1, 2 after Down, Down). That 1 opens the Armor list
 * and 2 the Accessory list is run in Tier 2 by save-boot-28a/28b.
 */
export const EQUIP_SLOT_KINDS = Object.freeze(['weapon', 'armor', 'accessory']);
/** Rows on one page of the Equip list (#216 save-boot-17c: only the 8-row offset hypothesis matched). */
export const EQUIP_LIST_PAGE = 8;
/** Frames after the Circle that opens the list before the list plan starts (#216 save-boot-18b: 60). */
export const EQUIP_LIST_OPEN_FRAMES = 60;
/**
 * Most list entries a plan may aim for: one kind's item numbers (32 armor,
 * 32 accessories; weapons have 128 numbers, but one member's list is far
 * shorter). Plans past the real end of the list stop at the first press
 * that does not move the cursor (the executor's check).
 */
export const EQUIP_LIST_MAX = 128;

/** The inventory kind (semantic/inventory.js) of slot cursor value `slot`, or null. */
export function equipSlotKind(slot) {
  return Number.isInteger(slot) ? EQUIP_SLOT_KINDS[slot] ?? null : null;
}

/**
 * The slot-cursor plan, slot row `from` to `to` (0 Weapon, 1 Armor,
 * 2 Accessory; Up and Down, never wraps: #216 18a ran 0-1-2-1-0 only).
 * Out-of-range rows throw RangeError.
 */
export function equipSlotPlan(from, to, timing) {
  return planCursorMove({ from, to, rows: EQUIP_SLOT_KINDS.length, wraps: false, timing });
}

/** The list index under the cursor: offset + row. null unless both read and the row is on the page. */
export function equipListIndex(listRow, listOffset) {
  if (!Number.isInteger(listRow) || !Number.isInteger(listOffset)) return null;
  if (listRow < 0 || listRow >= EQUIP_LIST_PAGE || listOffset < 0) return null;
  return listOffset + listRow;
}

/**
 * Where one press leaves the list cursor { row, offset }: Down moves the
 * row until the last page row, then scrolls (#216 save-boot-18b: rows 1-7,
 * then offsets 1 and 2 with the row at 7). Up moves the row until row 0,
 * then scrolls back. Up is the Materia list's rule (#248 27b), not yet run
 * on this list; plans from the screen's opening state only press Down.
 */
export function equipListStep({ row, offset }, button) {
  if (button === 'down') return row < EQUIP_LIST_PAGE - 1 ? { row: row + 1, offset } : { row, offset: offset + 1 };
  if (button === 'up') return row > 0 ? { row: row - 1, offset } : { row, offset: offset - 1 };
  throw new RangeError(`button must be "up" or "down", got ${button}`);
}

/**
 * The list-cursor plan from `from` = { row, offset } (equipCursors()
 * listRow and listOffset) to list index `to`. A planCursorMove plan over
 * the index (rows = EQUIP_LIST_MAX, never wraps; an executor reads
 * equipListIndex(row, offset) as its cursor), and each step also carries
 * the { row, offset } it should leave. Bad input throws RangeError.
 */
export function equipListPlan(from, to, timing) {
  const index = equipListIndex(from?.row, from?.offset);
  if (index === null) throw new RangeError(`from must be { row: 0..${EQUIP_LIST_PAGE - 1}, offset >= 0 }, got ${JSON.stringify(from)}`);
  const plan = planCursorMove({ from: index, to, rows: EQUIP_LIST_MAX, wraps: false, timing });
  let pos = { row: from.row, offset: from.offset };
  const steps = plan.steps.map((s) => {
    pos = equipListStep(pos, s.button);
    return Object.freeze({ ...s, row: pos.row, offset: pos.offset });
  });
  return Object.freeze({ ...plan, steps: Object.freeze(steps) });
}

/**
 * The list rows a v2 panel offers for slot kind `kind`: one per spare item
 * of that kind in the inventory (an upper bound on the game's list, which
 * holds only what the member can equip). [{ index }] for index 0..n-1.
 */
export function equipListRows(inventory, kind) {
  if (!EQUIP_SLOT_KINDS.includes(kind) || !Array.isArray(inventory)) return [];
  const n = Math.min(EQUIP_LIST_MAX, inventory.filter((it) => it && it.kind === kind).length);
  return Array.from({ length: n }, (_, index) => Object.freeze({ index }));
}

/**
 * May a v2 tap equip list index `index` into slot row `slot` now?
 * { ok, reason }. state: { open, framesOpen, memberSlot, member, cursors,
 * rows }:
 * - memberSlot: the party slot whose screen this is (equipChosenSlot), or
 *   null when not known;
 * - member: that slot's equipment() value;
 * - cursors: an equipCursors() value; the slot cursor must read and the
 *   list cursor must read row 0, offset 0, the state the list shows on the
 *   slot page (#216 18a), so the plans start from confirmed values;
 * - rows: equipListRows() for that slot's kind;
 * - slotPage: true while the screen is known to show the slot page, not a
 *   list. No page variable is read (#216), so a caller knows it only from
 *   the screen's opening state (#121: it opens on the slots) and its own
 *   completed taps, with no other input since.
 */
export function equipV2TapAllowed(state, slot, index) {
  if (!state?.open) return { ok: false, reason: 'closed' };
  if (state.memberSlot === null || state.memberSlot === undefined || !state.member) return { ok: false, reason: 'party pick not read' };
  if (equipSlotKind(slot) === null) return { ok: false, reason: 'slot not planned' };
  if (!(Number.isInteger(index) && Array.isArray(state.rows) && state.rows.some((r) => r.index === index))) return { ok: false, reason: 'no entry' };
  if (state.slotPage !== true) return { ok: false, reason: 'page not known' };
  const c = state.cursors;
  if (!(c && Number.isInteger(c.slot) && c.listRow === 0 && c.listOffset === 0)) return { ok: false, reason: 'cursor not read' };
  if (!(Number.isInteger(state.framesOpen) && state.framesOpen >= EQUIP_SETTLE_FRAMES)) return { ok: false, reason: 'settling' };
  return { ok: true, reason: null };
}

/**
 * Did the tap equip something in slot kind `kind`? before and after are the
 * party's equipment() values (arrays by party slot), memberSlot the member.
 * 'equipped': that member's `kind` changed and nothing else in the party
 * did. 'other': something else changed. 'none': no change, or unread.
 * The new item is after[memberSlot][kind] (a number within its kind).
 */
export function equipV2Outcome(before, after, memberSlot, kind) {
  if (!Array.isArray(before) || !Array.isArray(after) || !EQUIP_SLOT_KINDS.includes(kind)) return 'none';
  const b = before[memberSlot];
  const a = after[memberSlot];
  if (!b || !a) return 'none';
  let target = false;
  let other = false;
  for (let s = 0; s < Math.max(before.length, after.length); s++) {
    const x = before[s];
    const y = after[s];
    if (!x || !y) { if (x !== y) other = true; continue; }
    for (const k of EQUIP_SLOT_KINDS) {
      if (x[k] === y[k]) continue;
      if (s === memberSlot && k === kind) target = true;
      else other = true;
    }
  }
  if (other) return 'other';
  return target ? 'equipped' : 'none';
}

/** A slot row button's text: kind and the member's current item number. IDs only. */
export function equipSlotLabel(slot, member) {
  const kind = equipSlotKind(slot);
  const name = { weapon: 'Weapon', armor: 'Armor', accessory: 'Accessory' }[kind] ?? '?';
  const v = member?.[kind];
  return `${name}: ${v === null && kind === 'accessory' ? 'none' : Number.isInteger(v) ? `#${v}` : '?'}`;
}

/** A list row's text: its position in the game's list (names and contents are not read). */
export function equipListRowLabel(row) {
  return `List row ${row.index + 1}`;
}
