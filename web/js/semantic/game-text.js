// FF7 text (#260 part 1): decode the game's own text encoding and the name
// tables of the kernel archive, from bytes the caller already holds (the
// owner's disc, read on the device). Pure functions; no DOM, Worker, Node or
// timer dependencies (platform-neutral rule, CLAUDE.md). Original project
// code, GPL-2.0-or-later.
//
// No game text is in this file or its tests: it holds the encoding and the
// archive layout only. Names exist at runtime, in memory, on the device.
//
// Sources (facts only, no code copied; notes/260-game-names.md):
//   wiki   ff7-mods/ff7-flat-wiki @ 6389365: "FF7/FF_Text" (the character
//          table, 0x00-0x5E = ASCII - 0x20, FE {FUNC} colour codes, FF {END},
//          the F9 back-reference and which kernel sections use it),
//          "FF7/Kernel/Kernel.bin" (27 sections; 0-based 19-23 hold the item,
//          weapon, armor, accessory and materia names).
//   decomp Xeeynamo/ff7-decomp @ 33ce78c (reference only): src/main/14C70.c
//          SysGetKernTextPtr (entry k's u16 offset at section + 2k, relative
//          to the section's start) and SysAppendString (0xFF ends a string);
//          src/main/main_private.h KernelTextBlockID (block order).

export class Ff7TextError extends Error {}

/** FF {END}: ends every string (wiki; decomp SysAppendString). */
export const TEXT_END = 0xff;
/** FE {FUNC}: an opcode with an argument byte (wiki). */
export const TEXT_FUNC = 0xfe;
/** F9: a back-reference into the section's raw bytes, in description and battle-text sections only (wiki). */
export const TEXT_BACKREF = 0xf9;

/** 0x60-0xD3 (wiki table, row by row; null: no character). 0xAA is {NOTHING}, 0xD0 a second space. */
const HIGH = [
  'Ä', 'Á', 'Ç', 'É', 'Ñ', 'Ö', 'Ü', 'á', 'à', 'â', 'ä', 'ã', 'å', 'ç', 'é', 'è',
  'ê', 'ë', 'í', 'ì', 'î', 'ï', 'ñ', 'ó', 'ò', 'ô', 'ö', 'õ', 'ú', 'ù', 'û', 'ü',
  '⌘', '°', '¢', '£', 'Ù', 'Û', '¶', 'ß', '®', '©', '™', '´', '¨', '≠', 'Æ', 'Ø',
  '∞', '±', '≤', '≥', '¥', 'µ', '∂', 'Σ', 'Π', 'π', '⌡', 'ª', 'º', 'Ω', 'æ', 'ø',
  '¿', '¡', '¬', '√', 'ƒ', '≈', '∆', '«', '»', '…', '', 'À', 'Ã', 'Õ', 'Œ', 'œ',
  '–', '—', '“', '”', '‘', '’', '÷', '◊', 'ÿ', 'Ÿ', '⁄', '¤', '‹', '›', 'ﬁ', 'ﬂ',
  '■', '▪', '‚', '„', '‰', 'Â', 'Ê', 'Ë', 'Á', 'È', 'í', 'î', 'ï', 'ì', 'Ó', 'Ô',
  ' ', 'Ò', 'Ù', 'Û',
];
/** Single-byte specials that stand for text (wiki): tab, ", ", '."', '..."', end of line; F6-F9 are button glyphs outside back-reference sections. */
const SPECIAL = new Map([
  [0xe1, '\t'], [0xe2, ', '], [0xe3, '."'], [0xe4, '..."'], [0xe7, '\n'],
  [0xf6, '〇'], [0xf7, '△'], [0xf8, '☐'], [0xf9, '✕'],
]);
/** EA-F5: character-name and party variables (wiki). Shown as {name:N}, N = byte - 0xEA; the game fills them at runtime. */
const NAME_VAR_FIRST = 0xea;
const NAME_VAR_LAST = 0xf5;
/** FE D2-DB: colour codes (wiki); they change no text, so they decode to nothing. */
const COLOUR_FIRST = 0xd2;
const COLOUR_LAST = 0xdb;

const hex = (n) => `0x${n.toString(16).padStart(2, '0')}`;

/** The character for one plain byte, or null if the byte is not a character. */
function charFor(b) {
  if (b <= 0x5e) return String.fromCharCode(b + 0x20);
  if (b >= 0x60 && b < 0x60 + HIGH.length) return HIGH[b - 0x60];
  return null;
}

/**
 * Decode one FF7 string from bytes[start], up to and including its FF.
 * Returns { text, end } (end: the index after the FF). Unknown bytes are
 * refused, not guessed: throws Ff7TextError, as it does for a string with no
 * FF before the end of bytes.
 *
 * options.backrefs: treat F9 as the wiki's back-reference (YYXXXXXX: copy
 * YY * 2 + 4 raw bytes starting XXXXXX + 1 bytes before the F9, decoded as
 * plain text; an FF among them ends the string). Only description and
 * battle-text sections use it; in a name section F9 is a glyph.
 */
export function decodeFf7Text(bytes, start = 0, options = {}) {
  if (!(bytes instanceof Uint8Array)) throw new Ff7TextError('text must be a Uint8Array');
  const backrefs = options.backrefs === true;
  let text = '';
  let i = start;
  const plain = (b, at) => {
    if (b === TEXT_END) return null;
    const c = charFor(b) ?? SPECIAL.get(b);
    if (c !== undefined && c !== null) return c;
    if (b >= NAME_VAR_FIRST && b <= NAME_VAR_LAST) return `{name:${b - NAME_VAR_FIRST}}`;
    throw new Ff7TextError(`unknown byte ${hex(b)} at ${at}`);
  };
  for (;;) {
    if (i >= bytes.length) throw new Ff7TextError(`no end byte after ${start}`);
    const b = bytes[i];
    if (b === TEXT_END) return { text, end: i + 1 };
    if (b === TEXT_FUNC) {
      if (i + 1 >= bytes.length) throw new Ff7TextError(`FE without an argument at ${i}`);
      const arg = bytes[i + 1];
      if (arg < COLOUR_FIRST || arg > COLOUR_LAST) throw new Ff7TextError(`unknown FE argument ${hex(arg)} at ${i}`);
      i += 2;
      continue;
    }
    if (backrefs && b === TEXT_BACKREF) {
      if (i + 1 >= bytes.length) throw new Ff7TextError(`F9 without an argument at ${i}`);
      const arg = bytes[i + 1];
      const count = (arg >> 6) * 2 + 4;
      const from = i - ((arg & 0x3f) + 1);
      if (from < 0) throw new Ff7TextError(`F9 at ${i} points before the section`);
      for (let k = 0; k < count; k++) {
        const c = plain(bytes[from + k], from + k);
        if (c === null) return { text, end: i + 2 };
        text += c;
      }
      i += 2;
      continue;
    }
    text += plain(b, i);
    i += 1;
  }
}

/**
 * Decode a kernel text section (already unpacked): entry k's u16 offset
 * (little-endian) is at 2k, relative to the section's start, and points at
 * a string ending in FF (decomp SysGetKernTextPtr). The entry count is taken
 * as the first offset / 2: the table runs up to the first string (a
 * hypothesis the Tier 2 check tests: every offset must land past the table
 * and inside the section).
 *
 * Returns { names, count, empty, failed }: names[k] is the decoded string,
 * '' for an empty entry, or null when the entry fails to decode (bad offset
 * or unknown byte); empty and failed count those. Throws Ff7TextError only
 * when the section has no readable table at all.
 */
export function nameTable(section, options = {}) {
  if (!(section instanceof Uint8Array)) throw new Ff7TextError('the section must be a Uint8Array');
  if (section.length < 2) throw new Ff7TextError('the section is too short for a table');
  const view = new DataView(section.buffer, section.byteOffset, section.byteLength);
  const first = view.getUint16(0, true);
  if (first < 2 || first % 2 !== 0 || first > section.length) throw new Ff7TextError(`bad first offset ${first}`);
  const count = first / 2;
  const names = [];
  let empty = 0;
  let failed = 0;
  for (let k = 0; k < count; k++) {
    const at = view.getUint16(2 * k, true);
    let name = null;
    if (at >= first && at < section.length) {
      try {
        name = decodeFf7Text(section, at, options).text;
      } catch (e) {
        if (!(e instanceof Ff7TextError)) throw e;
      }
    }
    if (name === null) failed += 1;
    else if (name === '') empty += 1;
    names.push(name);
  }
  return { names, count, empty, failed };
}

/** 0-based KERNEL.BIN sections that hold names (wiki "Kernel.bin", rows 20-24). */
export const KERNEL_NAME_SECTIONS = Object.freeze({
  item: 19,
  weapon: 20,
  armor: 21,
  accessory: 22,
  materia: 23,
});
/** IDs each kind uses (inventory.js ITEM_KINDS; materia IDs are a byte, 0xFF empty). */
export const NAME_KIND_COUNTS = Object.freeze({ item: 128, weapon: 128, armor: 32, accessory: 32, materia: 255 });

/**
 * The name for an ID of a kind ('item', 'weapon', 'armor', 'accessory',
 * 'materia'), from tables { kind: names[] } as nameTable builds them. Falls
 * back to `fallback` (the panel's own ID label; default `#<id>`) when there
 * is no table, no entry, or an empty or failed entry.
 */
export function nameFor(kind, id, tables, fallback = `#${id}`) {
  const names = tables?.[kind];
  if (!Array.isArray(names) || !Number.isInteger(id) || id < 0 || id >= names.length) return fallback;
  const n = names[id];
  return typeof n === 'string' && n !== '' ? n : fallback;
}
