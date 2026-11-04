// Save descriptions and the memory card generator (issue #32). Tier 1: the
// baseline savemap is a synthetic pattern, never game data.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { cardProblem } from '../../../web/js/memcard.js';
import { blankCard } from '../../synth/blank-card.js';
import { checkSchemaKeywords } from '../../schema.js';
import { crc16Genibus, savemapChecksum } from '../../savegen/checksum.js';
import {
  SAVE_SCHEMA_PATH, SaveDescriptionError, buildSavemap, descriptionProblems, generateCard, shiftJisTitle,
} from '../../savegen/index.js';
import { BLOCK_SIZE, CARD_SIZE, FRAME_SIZE, SAVEMAP_IN_BLOCK, SAVEMAP_SIZE } from '../../savegen/layout.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAVES = path.resolve(HERE, '../../../harness/saves');
const clone = (o) => structuredClone(o);

/** A fixed synthetic pattern: no game bytes. */
const pattern = (seed) => {
  const b = new Uint8Array(SAVEMAP_SIZE);
  for (let i = 0; i < b.length; i++) b[i] = (i * 151 + seed) & 0xff;
  return b;
};

const base = {
  format: 1,
  label: 'Test save 1',
  slot: 3,
  field: { id: 0x0123, x: -1234, y: 0x4567, triangle: 0xbeef, direction: 0xc8 },
  party: [8, 2, 255],
  progress: 0xa1b2,
  gil: 0x89abcdef,
  seconds: 3 * 3600 + 25 * 60 + 47,
  vars: [
    { bank: 2, offset: 0x10, size: 1, value: 0x7e },
    { bank: 5, offset: 0xfe, size: 2, value: 0xfedc },
  ],
};

// Expected placements, written out by hand from notes/32-save-format.md
// (independent of runner/savegen/layout.js): [offset, little-endian bytes].
const expectedWrites = [
  [0x0005, [8]], [0x0006, [2]], [0x0007, [255]],
  [0x0020, [0xef, 0xcd, 0xab, 0x89]],
  [0x0024, [0x3b, 0x30, 0x00, 0x00]], // 12347 s = 0x303B
  [0x04f8, [8]], [0x04f9, [2]], [0x04fa, [255]],
  [0x0b7c, [0xef, 0xcd, 0xab, 0x89]],
  [0x0b80, [0x3b, 0x30, 0x00, 0x00]],
  [0x0b90, [2]],
  [0x0b94, [1, 0]],
  [0x0b96, [0x23, 0x01]],
  [0x0b9a, [0x2e, 0xfb]], // -1234 as s16
  [0x0b9c, [0x67, 0x45]],
  [0x0b9e, [0xef, 0xbe]],
  [0x0ba0, [0xc8]],
  [0x0ba4, [0xb2, 0xa1]],
  [0x0bb4, [3]], [0x0bb5, [25]], [0x0bb6, [47]],
  [0x0ca4 + 0x10, [0x7e]], // bank 2
  [0x0fa4 + 0xfe, [0xdc, 0xfe]], // bank 5
];
const CHECKSUM_BYTES = [0, 1, 2, 3];

describe('save description schema', () => {
  const schema = JSON.parse(readFileSync(SAVE_SCHEMA_PATH, 'utf8'));

  test('uses only keywords the validator implements', () => {
    checkSchemaKeywords(schema);
  });

  test('accepts the full example and every committed description', () => {
    assert.deepEqual(descriptionProblems(base), []);
    const files = readdirSync(SAVES).filter((f) => f.endsWith('.json'));
    assert.ok(files.length > 0);
    for (const f of files) {
      const d = JSON.parse(readFileSync(path.join(SAVES, f), 'utf8'));
      assert.deepEqual(descriptionProblems(d), [], f);
    }
  });

  test('optional fields may be left out', () => {
    const d = clone(base);
    delete d.gil;
    delete d.seconds;
    delete d.vars;
    assert.deepEqual(descriptionProblems(d), []);
  });

  const bad = {
    'unknown top-level field': (d) => { d.notes = 'x'; },
    'unknown field member': (d) => { d.field.z = 1; },
    'unknown var member': (d) => { d.vars[0].name = 'x'; },
    'missing field': (d) => { delete d.field; },
    'missing progress': (d) => { delete d.progress; },
    'wrong format': (d) => { d.format = 2; },
    'text where a number goes': (d) => { d.progress = '1'; },
    'free text in a number slot': (d) => { d.field.id = 'md1stin'; },
    'non-integer': (d) => { d.gil = 1.5; },
    'u16 out of range': (d) => { d.field.id = 65536; },
    's16 out of range': (d) => { d.field.x = -32769; },
    'u8 out of range': (d) => { d.field.direction = 256; },
    'slot 0': (d) => { d.slot = 0; },
    'slot 16': (d) => { d.slot = 16; },
    'unknown character id': (d) => { d.party[1] = 12; },
    'party of two': (d) => { d.party.pop(); },
    'label with non-ASCII': (d) => { d.label = 'Clöud'; },
    'label with punctuation': (d) => { d.label = 'a<b>'; },
    'label too long': (d) => { d.label = 'x'.repeat(25); },
    'empty label': (d) => { d.label = ''; },
    'seconds beyond 255:59:59': (d) => { d.seconds = 921600; },
    'var bank 6': (d) => { d.vars[0].bank = 6; },
    'var size 4': (d) => { d.vars[0].size = 4; },
    'byte var value 256': (d) => { d.vars[0].value = 256; },
    'word var at offset 255': (d) => { d.vars[1].offset = 255; },
    'too many vars': (d) => { d.vars = Array.from({ length: 33 }, (_, i) => ({ bank: 3, offset: i, size: 1, value: 0 })); },
    'other $schema': (d) => { d.$schema = 'https://example.com/x.json'; },
    'var overlapping progress': (d) => { d.vars.push({ bank: 1, offset: 1, size: 1, value: 0 }); },
    'var overlapping the timer': (d) => { d.vars.push({ bank: 1, offset: 0x11, size: 2, value: 0 }); },
    'two vars on one byte': (d) => { d.vars.push({ bank: 2, offset: 0x0f, size: 2, value: 0 }); },
  };
  for (const [name, mutate] of Object.entries(bad)) {
    test(`rejects: ${name}`, () => {
      const d = clone(base);
      mutate(d);
      assert.notDeepEqual(descriptionProblems(d), [], name);
      assert.throws(() => generateCard(pattern(1), d), SaveDescriptionError);
    });
  }
});

describe('placement', () => {
  const baseline = pattern(0x5a);
  const { savemap } = buildSavemap(baseline, base);

  test('each description value lands at its documented offset, size, sign and byte order', () => {
    for (const [off, bytes] of expectedWrites) {
      assert.deepEqual([...savemap.subarray(off, off + bytes.length)], bytes, `0x${off.toString(16)}`);
    }
  });

  test('every other savemap byte is the baseline or the checksum', () => {
    const touched = new Set(CHECKSUM_BYTES);
    for (const [off, bytes] of expectedWrites) bytes.forEach((_, i) => touched.add(off + i));
    for (let i = 0; i < SAVEMAP_SIZE; i++) {
      if (!touched.has(i)) assert.equal(savemap[i], baseline[i], `0x${i.toString(16)}`);
    }
  });

  test('the baseline is not modified', () => {
    assert.deepEqual(baseline, pattern(0x5a));
  });

  test('rejects a baseline of the wrong size', () => {
    assert.throws(() => buildSavemap(new Uint8Array(100), base), /4340 bytes/);
  });
});

describe('checksum', () => {
  test('matches the CRC-16/GENIBUS catalogue check value', () => {
    // Published check value for the ASCII string "123456789".
    assert.equal(crc16Genibus(new TextEncoder().encode('123456789')), 0xd64e);
  });

  test('derived vectors: empty input and a single zero byte', () => {
    // init 0xFFFF, xorout 0xFFFF: empty -> 0x0000.
    assert.equal(crc16Genibus(new Uint8Array(0)), 0x0000);
    // CRC-16/CCITT-FALSE of [0x00] is 0xE1F0; GENIBUS inverts it.
    assert.equal(crc16Genibus(new Uint8Array([0])), 0xe1f0 ^ 0xffff);
  });

  test('is stored as a little-endian u32 at savemap 0x0000 over bytes 0x0004..end', () => {
    const { savemap } = buildSavemap(pattern(7), base);
    const stored = new DataView(savemap.buffer).getUint32(0, true);
    assert.equal(stored, savemapChecksum(savemap));
    assert.ok(stored <= 0xffff);
    // The checksum bytes themselves are not covered.
    const copy = savemap.slice();
    copy[0] ^= 0xff;
    copy[2] ^= 0xff;
    assert.equal(savemapChecksum(copy), stored);
    copy[4] ^= 1;
    assert.notEqual(savemapChecksum(copy), stored);
  });
});

describe('card format', () => {
  const { card } = generateCard(pattern(3), base);
  const frame = (n) => card.subarray(n * FRAME_SIZE, (n + 1) * FRAME_SIZE);
  const xor = (f) => f.subarray(0, 127).reduce((a, b) => a ^ b, 0);

  test('passes web/js/memcard.js validation', () => {
    assert.equal(cardProblem(card), null);
    assert.equal(card.length, CARD_SIZE);
  });

  test('header frame and all 15 directory frames carry valid XOR checksums', () => {
    for (let n = 0; n <= 15; n++) assert.equal(frame(n)[127], xor(frame(n)), `frame ${n}`);
  });

  test('directory entry for the slot: in use, one block, end of chain, FF7 file name', () => {
    const d = frame(base.slot);
    const v = new DataView(d.buffer, d.byteOffset, FRAME_SIZE);
    assert.equal(v.getUint32(0, true), 0x51);
    assert.equal(v.getUint32(4, true), 0x2000);
    assert.equal(v.getUint16(8, true), 0xffff);
    const name = 'BASCUS-94163FF7-S03';
    assert.equal(String.fromCharCode(...d.subarray(0x0a, 0x0a + name.length)), name);
    assert.ok(d.subarray(0x0a + name.length, 127).every((b) => b === 0));
  });

  test('other directory entries stay free', () => {
    for (let n = 1; n <= 15; n++) if (n !== base.slot) assert.equal(frame(n)[0], 0xa0, `frame ${n}`);
  });

  test('block header: SC, static one-frame icon, one block, ASCII title as Shift-JIS, blank icon', () => {
    const b = card.subarray(base.slot * BLOCK_SIZE, (base.slot + 1) * BLOCK_SIZE);
    assert.deepEqual([...b.subarray(0, 4)], [0x53, 0x43, 0x11, 0x01]);
    // "Test save 1" in full-width Shift-JIS, then zeros.
    const title = [0x8273, 0x8285, 0x8293, 0x8294, 0x8140, 0x8293, 0x8281, 0x8296, 0x8285, 0x8140, 0x8250];
    const got = [];
    for (let i = 0; i < title.length; i++) got.push((b[4 + i * 2] << 8) | b[5 + i * 2]);
    assert.deepEqual(got, title);
    assert.ok(b.subarray(4 + title.length * 2, 0x60).every((x) => x === 0));
    // palette and icon frames: blank
    assert.ok(b.subarray(0x60, SAVEMAP_IN_BLOCK).every((x) => x === 0));
  });

  test('Shift-JIS covers every allowed label character', () => {
    const t = shiftJisTitle('Az09 .-');
    assert.deepEqual([...t.subarray(0, 14)], [0x82, 0x60, 0x82, 0x9a, 0x82, 0x4f, 0x82, 0x58, 0x81, 0x40, 0x81, 0x44, 0x81, 0x7c]);
  });
});

describe('no game bytes', () => {
  // Every output byte must be (a) baseline pattern, (b) a description value,
  // (c) the checksum, or (d) a card-format constant. Check (a) by running the
  // generator on two different patterns: exactly the savemap bytes not
  // written by the description or checksum may differ, and they must equal
  // the pattern. Check (b)-(d) by comparing everything else with values
  // built in this test.
  const A = pattern(0x11);
  const B = pattern(0xc4);
  const ca = generateCard(A, base).card;
  const cb = generateCard(B, base).card;
  const savemapStart = base.slot * BLOCK_SIZE + SAVEMAP_IN_BLOCK;
  const descBytes = new Set();
  for (const [off, bytes] of expectedWrites) bytes.forEach((_, i) => descBytes.add(off + i));

  test('each byte is classified, and nothing else depends on the baseline', () => {
    const blank = blankCard();
    const counts = { pattern: 0, description: 0, checksum: 0, constant: 0 };
    for (let i = 0; i < CARD_SIZE; i++) {
      const s = i - savemapStart;
      if (s >= 0 && s < SAVEMAP_SIZE) {
        if (CHECKSUM_BYTES.includes(s)) {
          counts.checksum++;
        } else if (descBytes.has(s)) {
          assert.equal(ca[i], cb[i], `description byte 0x${s.toString(16)} depends on the baseline`);
          counts.description++;
        } else {
          assert.equal(ca[i], A[s], `savemap 0x${s.toString(16)}`);
          assert.equal(cb[i], B[s], `savemap 0x${s.toString(16)}`);
          counts.pattern++;
        }
        continue;
      }
      assert.equal(ca[i], cb[i], `card byte 0x${i.toString(16)} depends on the baseline`);
      counts.constant++;
    }
    assert.equal(counts.checksum, 4);
    assert.equal(counts.description, descBytes.size);
    assert.equal(counts.pattern, SAVEMAP_SIZE - 4 - descBytes.size);

    // Constants: the blank card everywhere except the slot's directory
    // frame and block, which are checked in "card format" above; within the
    // block, everything outside the header and savemap is zero.
    const block0 = base.slot * BLOCK_SIZE;
    const dir0 = base.slot * FRAME_SIZE;
    for (let i = 0; i < CARD_SIZE; i++) {
      const inBlock = i >= block0 && i < block0 + BLOCK_SIZE;
      const inDir = i >= dir0 && i < dir0 + FRAME_SIZE;
      if (!inBlock && !inDir) assert.equal(ca[i], blank[i], `card byte 0x${i.toString(16)}`);
    }
    assert.ok(ca.subarray(savemapStart + SAVEMAP_SIZE, block0 + BLOCK_SIZE).every((x) => x === 0));
  });

  test('the checksum bytes are the checksum of the output savemap', () => {
    const sm = ca.slice(savemapStart, savemapStart + SAVEMAP_SIZE);
    assert.equal(new DataView(sm.buffer).getUint32(0, true), savemapChecksum(sm));
  });

  test('the generator sources embed no binary blobs', () => {
    const dir = path.resolve(HERE, '../../savegen');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
      const src = readFileSync(path.join(dir, f), 'utf8');
      assert.doesNotMatch(src, /base64|atob\(|Buffer\.from\(|\\x[0-9a-f]{2}\\x[0-9a-f]{2}/i, f);
      assert.doesNotMatch(src, /(?:0x[0-9a-f]{2},\s*){16}/i, `${f}: long byte table`);
    }
  });
});
