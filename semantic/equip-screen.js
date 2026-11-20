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
// Original project code, GPL-2.0-or-later.

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
