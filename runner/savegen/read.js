// Read FF7 saves back out of a 128 KiB memory card image (#226): which slots
// hold a save, whether its savemap checksum is right, and the savemap's
// module and location. The inverse of index.js generateCard, using the same
// layout constants and checksum (layout.js, checksum.js). Original project
// code, GPL-2.0-or-later. Pure functions, no I/O.
//
// In Tier 2 this runs inside the sandbox on the card the game wrote; only
// the numbers a format 2 "card" check names leave the run, never card bytes.

import { savemapChecksum } from './checksum.js';
import {
  BLOCK_HEADER, BLOCK_SIZE, CARD_SIZE, DIR, DIR_IN_USE_FIRST, FRAME_SIZE, SAVEMAP, SAVEMAP_IN_BLOCK, SAVEMAP_SIZE,
} from './layout.js';

/** Save slots on a card: directory frames and blocks 1-15 (0 is the header). */
export const SLOTS = 15;

const checkCard = (card) => {
  if (!(card instanceof Uint8Array) || card.length !== CARD_SIZE) {
    throw new RangeError(`a memory card image is a Uint8Array of ${CARD_SIZE} bytes`);
  }
};

/**
 * What slot n (1-15) of a card holds:
 *   inUse     the directory frame's state is "in use, first block" (0x51)
 *   magic     the block starts with "SC"
 *   checksum  'right' or 'wrong': the low 16 bits of savemap 0x0000 against
 *             savemapChecksum (the wiki: the lower word is used); null when
 *             the slot is not in use or has no magic
 *   module, location  savemap 0x0B94 (u16) and 0x0B96 (u16); null as above
 */
export function readSlot(card, n) {
  checkCard(card);
  if (!Number.isInteger(n) || n < 1 || n > SLOTS) throw new RangeError(`slot must be 1-${SLOTS}, got ${n}`);
  const view = new DataView(card.buffer, card.byteOffset, card.byteLength);
  const inUse = view.getUint32(n * FRAME_SIZE + DIR.state, true) === DIR_IN_USE_FIRST;
  const b = n * BLOCK_SIZE;
  const magic = card[b + BLOCK_HEADER.magic] === 0x53 && card[b + BLOCK_HEADER.magic + 1] === 0x43;
  if (!inUse || !magic) return { slot: n, inUse, magic, checksum: null, module: null, location: null };
  const s = b + SAVEMAP_IN_BLOCK;
  const savemap = card.subarray(s, s + SAVEMAP_SIZE);
  const stored = view.getUint32(s + SAVEMAP.checksum.offset, true) & 0xffff;
  return {
    slot: n,
    inUse,
    magic,
    checksum: stored === savemapChecksum(savemap) ? 'right' : 'wrong',
    module: view.getUint16(s + SAVEMAP.module.offset, true),
    location: view.getUint16(s + SAVEMAP.fieldId.offset, true),
  };
}

/** Every slot, 1-15, as readSlot reports it. */
export const readSlots = (card) => Array.from({ length: SLOTS }, (_, i) => readSlot(card, i + 1));

/**
 * Slots (1-15, ascending) whose directory frame or block differs between two
 * card images: the slots a save between `before` and `after` wrote.
 */
export function changedSlots(before, after) {
  checkCard(before);
  checkCard(after);
  const differs = (from, len) => {
    for (let i = from; i < from + len; i++) if (before[i] !== after[i]) return true;
    return false;
  };
  const out = [];
  for (let n = 1; n <= SLOTS; n++) {
    if (differs(n * FRAME_SIZE, FRAME_SIZE) || differs(n * BLOCK_SIZE, BLOCK_SIZE)) out.push(n);
  }
  return out;
}

/**
 * The outcome of a format 2 "card" check (#226): which slots changed, and
 * whether the first changed slot holds a save with a right checksum (and,
 * if `module` is given, that module). Numbers only.
 *   changed   how many slots changed
 *   slot      the first changed slot, 0 if none
 *   checksum  1 if that slot holds a save with a right checksum, else 0
 *   module, location  that save's, 0 if none
 *   holds     changed >= 1, checksum 1, and module as asked
 */
export function cardOutcome(before, after, { module } = {}) {
  const changed = changedSlots(before, after);
  if (!changed.length) return { changed: 0, slot: 0, checksum: 0, module: 0, location: 0, holds: false };
  const s = readSlot(after, changed[0]);
  const ok = s.checksum === 'right';
  const out = {
    changed: changed.length,
    slot: s.slot,
    checksum: ok ? 1 : 0,
    module: s.module ?? 0,
    location: s.location ?? 0,
  };
  return { ...out, holds: ok && (module === undefined || s.module === module) };
}
