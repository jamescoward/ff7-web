// #260 part 1: the FF7 text decoder and kernel name tables (semantic/game-text.js).
// Every fixture is bytes the author made: original strings, encoded here with
// the documented encoding (ASCII - 0x20). No game text.
// Original project code, GPL-2.0-or-later.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { Ff7TextError, KERNEL_NAME_SECTIONS, NAME_KIND_COUNTS, decodeFf7Text, nameFor, nameTable } from '../../../semantic/game-text.js';
import { ITEM_KINDS } from '../../../semantic/inventory.js';

/** Encode printable ASCII the documented way (byte = ASCII - 0x20), then FF. */
const enc = (s, end = true) => [...s].map((c) => {
  const b = c.charCodeAt(0) - 0x20;
  if (b < 0 || b > 0x5e) throw new RangeError(c);
  return b;
}).concat(end ? [0xff] : []);
const u8 = (a) => Uint8Array.from(a);

/** A synthetic text section: u16 LE offsets, then the strings. */
function section(strings) {
  const head = strings.length * 2;
  const bodies = strings.map((s) => (Array.isArray(s) ? s : enc(s)));
  const out = [];
  let at = head;
  for (const b of bodies) {
    out.push(at & 0xff, at >> 8);
    at += b.length;
  }
  return u8([...out, ...bodies.flat()]);
}

describe('decodeFf7Text', () => {
  test('ASCII range: byte + 0x20, ended by FF', () => {
    assert.deepEqual(decodeFf7Text(u8(enc('Tin Kettle 9'))), { text: 'Tin Kettle 9', end: 13 });
    assert.equal(decodeFf7Text(u8([0x00, 0x5e, 0xff])).text, ' ~');
  });

  test('start offset and end index', () => {
    const b = u8([...enc('ab'), ...enc('cde')]);
    assert.deepEqual(decodeFf7Text(b, 3), { text: 'cde', end: 7 });
  });

  test('the high table and the specials', () => {
    assert.equal(decodeFf7Text(u8([0x60, 0x7f, 0xaa, 0xd0, 0xd3, 0xff])).text, 'Äü Û');
    assert.equal(decodeFf7Text(u8([0x21, 0xe1, 0x22, 0xe2, 0x23, 0xe7, 0xff])).text, 'A\tB, C\n');
    assert.equal(decodeFf7Text(u8([0xf6, 0xf7, 0xf8, 0xf9, 0xff])).text, '〇△☐✕');
  });

  test('name variables become placeholders, never names', () => {
    assert.equal(decodeFf7Text(u8([0xea, 0x00, 0xf5, 0xff])).text, '{name:0} {name:11}');
  });

  test('FE colour codes decode to nothing; other FE arguments are refused', () => {
    assert.equal(decodeFf7Text(u8([0xfe, 0xd2, ...enc('Hi')])).text, 'Hi');
    assert.equal(decodeFf7Text(u8([0xfe, 0xdb, 0x21, 0xff])).text, 'A');
    assert.throws(() => decodeFf7Text(u8([0xfe, 0x00, 0xff])), Ff7TextError);
    assert.throws(() => decodeFf7Text(u8([0xfe])), Ff7TextError);
  });

  test('unknown bytes are refused, not guessed', () => {
    for (const b of [0x5f, 0xd4, 0xdf, 0xe0, 0xe5, 0xe6, 0xe8, 0xe9, 0xfa, 0xfd]) {
      assert.throws(() => decodeFf7Text(u8([0x21, b, 0xff])), Ff7TextError, `0x${b.toString(16)}`);
    }
  });

  test('a string with no FF is refused', () => {
    assert.throws(() => decodeFf7Text(u8(enc('open', false))), Ff7TextError);
    assert.throws(() => decodeFf7Text(u8([]), 0), Ff7TextError);
  });

  test('F9 back-reference (only with backrefs): YY * 2 + 4 raw bytes from XXXXXX + 1 back', () => {
    // "abcdefgh" then F9 with YY 00 (4 bytes), XXXXXX 7 (8 back from the F9): "abcd".
    const raw = u8([...enc('abcdefgh', false), 0xf9, 0x07, 0xff]);
    assert.deepEqual(decodeFf7Text(raw, 0, { backrefs: true }), { text: 'abcdefghabcd', end: 11 });
    // YY 01: 6 bytes from 8 back.
    assert.equal(decodeFf7Text(u8([...enc('abcdefgh', false), 0xf9, 0x47, 0xff]), 0, { backrefs: true }).text, 'abcdefghabcdef');
    // Without backrefs, F9 is a glyph and 0x07 a character.
    assert.equal(decodeFf7Text(raw).text, "abcdefgh✕'");
  });

  test('F9 copying an FF ends the string; pointing before the start is refused', () => {
    // "xy" FF "ab" F9 -> 4 bytes from 4 back: "y", FF -> ends after "y".
    const b = u8([...enc('xy'), ...enc('ab', false), 0xf9, 0x03]);
    assert.deepEqual(decodeFf7Text(b, 3, { backrefs: true }), { text: 'aby', end: 7 });
    assert.throws(() => decodeFf7Text(u8([0xf9, 0x00, 0xff]), 0, { backrefs: true }), Ff7TextError);
  });
});

describe('nameTable', () => {
  test('a synthetic section: count from the first offset, one name per entry', () => {
    const t = nameTable(section(['Copper Spoon', '', 'Wool Cap']));
    assert.deepEqual(t, { names: ['Copper Spoon', '', 'Wool Cap'], count: 3, empty: 1, failed: 0 });
  });

  test('a bad entry is null and counted, the rest still decode', () => {
    const s = section(['Good', [0x21, 0xe5, 0xff], 'Also']);
    assert.deepEqual(nameTable(s), { names: ['Good', null, 'Also'], count: 3, empty: 0, failed: 1 });
    // An offset inside the table or past the end fails that entry.
    const bad = section(['One', 'Two']);
    bad[2] = 0x01;
    bad[3] = 0x00;
    assert.deepEqual(nameTable(bad).names, ['One', null]);
  });

  test('no readable table at all is refused', () => {
    assert.throws(() => nameTable(u8([0x01])), Ff7TextError);
    assert.throws(() => nameTable(u8([0x03, 0x00, 0xff])), Ff7TextError);
    assert.throws(() => nameTable(u8([0x40, 0x00, 0xff])), Ff7TextError);
    assert.throws(() => nameTable([0x02, 0x00]), Ff7TextError);
  });
});

describe('nameFor', () => {
  const tables = { weapon: ['Pine Stick', '', null], materia: ['Glow'] };
  test('a name when the table has one', () => {
    assert.equal(nameFor('weapon', 0, tables), 'Pine Stick');
    assert.equal(nameFor('materia', 0, tables, 'materia #0'), 'Glow');
  });
  test('falls back to the ID label otherwise', () => {
    assert.equal(nameFor('weapon', 1, tables), '#1');
    assert.equal(nameFor('weapon', 2, tables, 'weapon #2'), 'weapon #2');
    assert.equal(nameFor('weapon', 9, tables), '#9');
    assert.equal(nameFor('armor', 0, tables), '#0');
    assert.equal(nameFor('weapon', 0, null), '#0');
    assert.equal(nameFor('weapon', -1, tables), '#-1');
  });
});

describe('kernel layout facts', () => {
  test('name sections 19-23 in kind order (wiki Kernel.bin)', () => {
    assert.deepEqual(Object.values(KERNEL_NAME_SECTIONS), [19, 20, 21, 22, 23]);
  });
  test('ID counts agree with the inventory kinds', () => {
    for (const k of ITEM_KINDS) assert.equal(NAME_KIND_COUNTS[k.kind], k.count, k.kind);
  });
});
