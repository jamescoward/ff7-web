// Save generator: (baseline savemap, save description) -> savemap -> FF7
// checksum -> save block -> 128 KiB memory card. Original project code,
// GPL-2.0-or-later. Pure functions, no I/O apart from reading the schema.
//
// The baseline is supplied by the caller. In Tier 1 it is a synthetic
// pattern; in Tier 2 (scenario format 2) it is read from the disc inside the
// sandbox. The generator itself never contains game bytes: everything it
// writes is a description value, the checksum, or a card-format constant
// (docs/SECURITY.md, "Generated save boot points").

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { blankCard, sealFrame } from '../synth/blank-card.js';
import { validate } from '../schema.js';
import { savemapChecksum } from './checksum.js';
import {
  BANK_BASE, BANK_SIZE, BLOCK_HEADER, CHARACTER, CHARACTER_BASE, CHARACTER_EQUIPMENT, CHARACTER_MATERIA, CHARACTER_MATERIA_SLOTS,
  CHARACTER_SIZE, ITEM_BASE, MATERIA_BASE, MATERIA_EMPTY, packItem, packMateria, BLOCK_SIZE, CARD_SIZE, DIR, DIR_IN_USE_FIRST, FF_TEXT_END, FRAME_SIZE,
  ICON_FLAG_STATIC_1, MODULE_AUX_FIELD, MODULE_FIELD, SAVEMAP, SAVEMAP_IN_BLOCK, SAVEMAP_SIZE,
  TYPE_SIZE, fileName,
} from './layout.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SAVE_SCHEMA_PATH = path.resolve(HERE, '../../harness/schema/save.schema.json');
let schemaCache;
const saveSchema = () => (schemaCache ??= JSON.parse(readFileSync(SAVE_SCHEMA_PATH, 'utf8')));

export class SaveDescriptionError extends Error {}

/** Schema errors plus the checks a schema can't express. Empty when valid. */
export function descriptionProblems(desc) {
  const errors = validate(saveSchema(), desc);
  if (errors.length) return errors;
  try {
    planWrites(desc);
  } catch (e) {
    if (e instanceof SaveDescriptionError) return [e.message];
    throw e;
  }
  return [];
}

/**
 * The savemap writes a description implies, in order: [{ name, offset,
 * type, value }]. Throws SaveDescriptionError if two writes overlap.
 */
export function planWrites(desc) {
  const w = [];
  const put = (name, value) => w.push({ name, ...SAVEMAP[name], value });
  const { field, party } = desc;
  // The preview's leader name and location are FF Text strings the
  // description can't hold (no free text): write empty strings, so the load
  // menu draws nothing there whatever the baseline holds (#38).
  put('previewNameEnd', FF_TEXT_END);
  put('previewPlaceEnd', FF_TEXT_END);
  // A description without 'module' is a field save, as before #80.
  put('module', desc.module?.state ?? MODULE_FIELD);
  put('moduleAux', desc.module?.exitAction ?? MODULE_AUX_FIELD);
  put('fieldId', field.id);
  put('fieldX', field.x);
  put('fieldY', field.y);
  put('fieldTriangle', field.triangle);
  put('fieldDirection', field.direction);
  party.forEach((c, i) => {
    put(`party${i + 1}`, c);
    put(`previewPortrait${i + 1}`, c);
  });
  put('progress', desc.progress);
  if (desc.gil !== undefined) {
    put('gil', desc.gil);
    put('previewGil', desc.gil);
  }
  if (desc.seconds !== undefined) {
    const s = desc.seconds;
    put('seconds', s);
    put('previewSeconds', s);
    put('timerHours', Math.floor(s / 3600));
    put('timerMinutes', Math.floor(s / 60) % 60);
    put('timerSeconds', s % 60);
  }
  for (const [i, c] of (desc.characters ?? []).entries()) {
    const at = CHARACTER_BASE + CHARACTER_SIZE * c.record;
    const name = `characters[${i}]`;
    if (c.hp > c.maxHp) throw new SaveDescriptionError(`${name}: hp ${c.hp} is above maxHp ${c.maxHp}`);
    if (c.mp > c.maxMp) throw new SaveDescriptionError(`${name}: mp ${c.mp} is above maxMp ${c.maxMp}`);
    const field = (key, value) => w.push({ name: `${name}.${key}`, offset: at + CHARACTER[key].offset, type: CHARACTER[key].type, value });
    field('limit', c.limit);
    field('hp', c.hp);
    field('hpBase', c.maxHp);
    field('mp', c.mp);
    field('mpBase', c.maxMp);
    field('hpMax', c.maxHp);
    field('mpMax', c.maxMp);
    // Empty every materia slot that `equipment` doesn't fill for this record (#117).
    const filled = new Set((desc.equipment ?? []).filter((e) => e.record === c.record).flatMap((e) => (e.materia ?? []).map((m) => m.slot)));
    for (let m = 0; m < CHARACTER_MATERIA_SLOTS; m++) {
      if (filled.has(m)) continue;
      w.push({ name: `${name}.materia[${m}]`, offset: at + CHARACTER_MATERIA + 4 * m, type: 'u32', value: MATERIA_EMPTY });
    }
  }
  // #117: equipment and equipped materia per record, then the item and materia inventories.
  for (const [i, e] of (desc.equipment ?? []).entries()) {
    const at = CHARACTER_BASE + CHARACTER_SIZE * e.record;
    const name = `equipment[${i}]`;
    for (const key of ['weapon', 'armor', 'accessory']) {
      w.push({ name: `${name}.${key}`, offset: at + CHARACTER_EQUIPMENT[key].offset, type: 'u8', value: e[key] });
    }
    for (const [j, m] of (e.materia ?? []).entries()) {
      w.push({ name: `${name}.materia[${j}]`, offset: at + CHARACTER_MATERIA + 4 * m.slot, type: 'u32', value: packMateria(m.id, m.ap) });
    }
  }
  for (const [i, it] of (desc.items ?? []).entries()) {
    w.push({ name: `items[${i}]`, offset: ITEM_BASE + 2 * it.slot, type: 'u16', value: packItem(it.index, it.quantity) });
  }
  for (const [i, m] of (desc.materia ?? []).entries()) {
    w.push({ name: `materia[${i}]`, offset: MATERIA_BASE + 4 * m.slot, type: 'u32', value: packMateria(m.id, m.ap) });
  }
  for (const [i, v] of (desc.vars ?? []).entries()) {
    w.push({
      name: `vars[${i}]`,
      offset: BANK_BASE + BANK_SIZE * (v.bank - 1) + v.offset,
      type: v.size === 1 ? 'u8' : 'u16',
      value: v.value,
    });
  }
  const owner = new Map();
  for (const x of w) {
    for (let o = x.offset; o < x.offset + TYPE_SIZE[x.type]; o++) {
      if (owner.has(o)) {
        throw new SaveDescriptionError(`${x.name} overlaps ${owner.get(o)} at savemap 0x${o.toString(16).padStart(4, '0')}`);
      }
      owner.set(o, x.name);
    }
  }
  return w;
}

function writeValue(view, { offset, type, value }) {
  if (type === 'u8') view.setUint8(offset, value);
  else if (type === 'u16') view.setUint16(offset, value, true);
  else if (type === 's16') view.setInt16(offset, value, true);
  else if (type === 'u32') view.setUint32(offset, value, true);
  else throw new Error(`unknown type ${type}`);
}

/** Apply a description to a copy of `baseline` and set the checksum. */
export function buildSavemap(baseline, desc) {
  if (!(baseline instanceof Uint8Array) || baseline.length !== SAVEMAP_SIZE) {
    throw new Error(`the baseline savemap must be a Uint8Array of ${SAVEMAP_SIZE} bytes`);
  }
  const problems = descriptionProblems(desc);
  if (problems.length) throw new SaveDescriptionError(`invalid save description: ${problems.join('; ')}`);
  const savemap = baseline.slice();
  const view = new DataView(savemap.buffer);
  const writes = planWrites(desc);
  for (const x of writes) writeValue(view, x);
  writeValue(view, { ...SAVEMAP.checksum, value: savemapChecksum(savemap) });
  return { savemap, writes };
}

/** Full-width Shift-JIS for the label's characters (the schema limits them). */
export function shiftJisTitle(label) {
  const out = new Uint8Array(BLOCK_HEADER.titleBytes);
  [...label].forEach((ch, i) => {
    const c = ch.charCodeAt(0);
    let code;
    if (c >= 0x41 && c <= 0x5a) code = 0x8260 + (c - 0x41);
    else if (c >= 0x61 && c <= 0x7a) code = 0x8281 + (c - 0x61);
    else if (c >= 0x30 && c <= 0x39) code = 0x824f + (c - 0x30);
    else if (ch === ' ') code = 0x8140;
    else if (ch === '.') code = 0x8144;
    else if (ch === '-') code = 0x817c;
    else throw new SaveDescriptionError(`label character ${JSON.stringify(ch)} is not allowed`);
    out[i * 2] = code >> 8;
    out[i * 2 + 1] = code & 0xff;
  });
  return out;
}

/** One 8 KiB save block: header, blank icon, savemap, zero padding. */
export function buildBlock(savemap, label) {
  const block = new Uint8Array(BLOCK_SIZE);
  block[BLOCK_HEADER.magic] = 0x53; // 'S'
  block[BLOCK_HEADER.magic + 1] = 0x43; // 'C'
  block[BLOCK_HEADER.iconFlag] = ICON_FLAG_STATIC_1;
  block[BLOCK_HEADER.blockCount] = 1;
  block.set(shiftJisTitle(label), BLOCK_HEADER.title);
  // Palette and icon stay zero: a blank, original icon.
  block.set(savemap, SAVEMAP_IN_BLOCK);
  return block;
}

/** Write a directory entry for a one-block save in `slot` and seal it. */
function writeDirectory(card, slot) {
  const o = slot * FRAME_SIZE;
  card.fill(0, o, o + FRAME_SIZE);
  const view = new DataView(card.buffer, card.byteOffset);
  view.setUint32(o + DIR.state, DIR_IN_USE_FIRST, true);
  view.setUint32(o + DIR.size, BLOCK_SIZE, true);
  view.setUint16(o + DIR.next, 0xffff, true);
  const name = fileName(slot);
  for (let i = 0; i < name.length; i++) card[o + DIR.name + i] = name.charCodeAt(i);
  sealFrame(card, slot);
}

/**
 * Generate a card from a baseline savemap and a save description. Returns
 * { card, block, savemap, writes }; nothing is written to disk.
 * opts.checksum "wrong" stores the checksum inverted (low word XOR 0xFFFF,
 * so it always differs from the right one), for the Tier 2 check that the
 * game rejects a bad checksum (#38).
 */
export function generateCard(baseline, desc, opts = {}) {
  if (opts.checksum !== undefined && opts.checksum !== 'right' && opts.checksum !== 'wrong') {
    throw new Error(`checksum must be "right" or "wrong", not ${JSON.stringify(opts.checksum)}`);
  }
  const { savemap, writes } = buildSavemap(baseline, desc);
  if (opts.checksum === 'wrong') {
    const view = new DataView(savemap.buffer);
    writeValue(view, { ...SAVEMAP.checksum, value: view.getUint32(SAVEMAP.checksum.offset, true) ^ 0xffff });
  }
  const block = buildBlock(savemap, desc.label);
  const card = blankCard();
  if (card.length !== CARD_SIZE) throw new Error('blank card has the wrong size');
  card.set(block, desc.slot * BLOCK_SIZE);
  writeDirectory(card, desc.slot);
  return { card, block, savemap, writes };
}
