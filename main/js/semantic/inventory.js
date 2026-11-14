// Item and materia encodings of the FF7 savemap (#117): pure functions over
// the raw words, shared by the semantic layer and any frontend. Original
// project code, GPL-2.0-or-later. No DOM, Worker, Node or timer dependencies.
//
// Source (facts only, no code copied): ff7-flat-wiki @ 6389365 "Savemap",
// "Save Item List" and "Save Materia List" (notes/117-inventory-equipment.md).
// No item or materia names: names are game data.

/** Item word: QQQQQQQXXXXXXXXX, the index in the low 9 bits, the quantity in the high 7. */
export const ITEM_INDEX_BITS = 9;
export const ITEM_INDEX_MASK = (1 << ITEM_INDEX_BITS) - 1;
/** An empty inventory slot reads 0xFFFF: index 0x1FF, which names no item. */
export const ITEM_NONE = ITEM_INDEX_MASK;

/** Item index ranges (wiki "Save Item List"): kind, first index, count. */
export const ITEM_KINDS = Object.freeze([
  Object.freeze({ kind: 'item', first: 0, count: 128 }),
  Object.freeze({ kind: 'weapon', first: 128, count: 128 }),
  Object.freeze({ kind: 'armor', first: 256, count: 32 }),
  Object.freeze({ kind: 'accessory', first: 288, count: 32 }),
]);

/** A materia ID of 0xFF is an empty slot; bytes 1-3 hold the AP. */
export const MATERIA_NONE = 0xff;
/** A character with no accessory holds 0xFF (wiki, record + 0x1E). */
export const ACCESSORY_NONE = 0xff;

/**
 * Decode an inventory word: null for an empty slot (or an index past the
 * last kind), else { index, quantity, kind, number } where number counts
 * from the start of its kind (a weapon's number is what a character record
 * holds as its equipped weapon).
 */
export function decodeItem(word) {
  const index = word & ITEM_INDEX_MASK;
  const k = ITEM_KINDS.find((x) => index >= x.first && index < x.first + x.count);
  if (!k) return null;
  return { index, quantity: (word >>> ITEM_INDEX_BITS) & 0x7f, kind: k.kind, number: index - k.first };
}

/** Decode a materia word: null for an empty slot, else { id, ap } (AP: 24 bits). */
export function decodeMateria(word) {
  const id = word & 0xff;
  if (id === MATERIA_NONE) return null;
  return { id, ap: word >>> 8 };
}
