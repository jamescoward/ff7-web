// Save descriptions with items, materia and equipment (#117): author-chosen
// inventory slots, materia slots and per-record equipment. Tier 1: the
// baseline savemap is a synthetic pattern, never game data. Offsets and
// encodings are written out by hand from notes/117-inventory-equipment.md
// (the wiki's Savemap tables), independent of runner/savegen/layout.js.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildSavemap, descriptionProblems, generateCard } from '../../savegen/index.js';
import { savemapChecksum } from '../../savegen/checksum.js';
import { SAVEMAP_SIZE } from '../../savegen/layout.js';

const pattern = (seed) => {
  const b = new Uint8Array(SAVEMAP_SIZE);
  for (let i = 0; i < b.length; i++) b[i] = (i * 151 + seed) & 0xff;
  return b;
};

const base = {
  format: 1,
  label: 'Inventory 1',
  slot: 1,
  field: { id: 116, x: 0, y: 0, triangle: 12, direction: 0 },
  party: [0, 1, 255],
  progress: 6,
  items: [
    { slot: 0, index: 1, quantity: 7 },
    { slot: 3, index: 300, quantity: 99 },
    { slot: 319, index: 0x13f, quantity: 1 },
  ],
  materia: [
    { slot: 0, id: 0x31, ap: 0x0004d2 },
    { slot: 199, id: 0xfe, ap: 0xffffff },
  ],
  equipment: [
    { record: 0, weapon: 3, armor: 5, accessory: 7, materia: [{ slot: 0, id: 0x11, ap: 0x012345 }, { slot: 8, id: 0x01, ap: 0 }] },
    { record: 8, weapon: 127, armor: 31, accessory: 255 },
  ],
};

const le16 = (v) => [v & 0xff, (v >> 8) & 0xff];
const le32 = (v) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
// Item word: QQQQQQQXXXXXXXXX. Materia: ID in byte 0, AP in bytes 1-3.
const item = (index, q) => le16((q << 9) | index);
const mat = (id, ap) => [id, ap & 0xff, (ap >> 8) & 0xff, (ap >> 16) & 0xff];

const writes = [
  [0x04fc + 0, item(1, 7)],
  [0x04fc + 6, item(300, 99)],
  [0x04fc + 638, item(0x13f, 1)],
  [0x077c + 0, mat(0x31, 0x0004d2)],
  [0x077c + 796, mat(0xfe, 0xffffff)],
  [0x54 + 0x1c, [3, 5, 7]],
  [0x54 + 0x40, mat(0x11, 0x012345)],
  [0x54 + 0x60, mat(0x01, 0)],
  [0x54 + 0x84 * 8 + 0x1c, [127, 31, 255]],
];

describe('items, materia and equipment (#117)', () => {
  const baseline = pattern(0x5a);
  const { savemap } = buildSavemap(baseline, base);
  const { items: _i, materia: _m, equipment: _e, ...plainDesc } = base;
  const plain = buildSavemap(baseline, plainDesc).savemap;

  test('the encodings: 7-bit quantity over a 9-bit index; ID then 24-bit AP', () => {
    assert.deepEqual(item(300, 99), [0x2c, 0xc7]);
    assert.deepEqual(mat(0x31, 0x0004d2), [0x31, 0xd2, 0x04, 0x00]);
  });

  test('each value lands at its offset, little endian', () => {
    for (const [off, bytes] of writes) {
      assert.deepEqual([...savemap.subarray(off, off + bytes.length)], bytes, `0x${off.toString(16)}`);
    }
  });

  test('every other byte equals the description without the new fields (except the checksum)', () => {
    const touched = new Set([0, 1, 2, 3]);
    for (const [off, bytes] of writes) bytes.forEach((_, i) => touched.add(off + i));
    for (let i = 0; i < SAVEMAP_SIZE; i++) {
      if (!touched.has(i)) assert.equal(savemap[i], plain[i], `0x${i.toString(16)}`);
    }
  });

  test('the checksum is still valid, and the card round-trips the savemap', () => {
    const view = new DataView(savemap.buffer);
    assert.equal(view.getUint32(0, true), savemapChecksum(savemap));
    const { card } = generateCard(baseline, base);
    const block = card.subarray(0x2000, 0x4000);
    assert.deepEqual([...block.subarray(0x200, 0x200 + SAVEMAP_SIZE)], [...savemap]);
  });

  test('with characters for the same record, equipped materia is kept and the other slots emptied', () => {
    const d = structuredClone(base);
    d.characters = [{ record: 0, hp: 100, maxHp: 200, mp: 10, maxMp: 20, limit: 0 }];
    assert.deepEqual(descriptionProblems(d), []);
    const s = buildSavemap(baseline, d).savemap;
    assert.deepEqual([...s.subarray(0x54 + 0x40, 0x54 + 0x44)], mat(0x11, 0x012345));
    assert.deepEqual([...s.subarray(0x54 + 0x60, 0x54 + 0x64)], mat(0x01, 0));
    for (let m = 0; m < 16; m++) {
      if (m === 0 || m === 8) continue;
      assert.deepEqual([...s.subarray(0x54 + 0x40 + 4 * m, 0x54 + 0x44 + 4 * m)], le32(0xffffffff), `slot ${m}`);
    }
  });

  test('the fields are optional', () => {
    assert.deepEqual(descriptionProblems(plainDesc), []);
  });

  const bad = {
    'item slot 320': (d) => { d.items[0].slot = 320; },
    'item index 320': (d) => { d.items[0].index = 320; },
    'quantity 0': (d) => { d.items[0].quantity = 0; },
    'quantity 100': (d) => { d.items[0].quantity = 100; },
    'materia slot 200': (d) => { d.materia[0].slot = 200; },
    'materia id 255': (d) => { d.materia[0].id = 255; },
    'ap above 24 bits': (d) => { d.materia[0].ap = 0x1000000; },
    'record 9': (d) => { d.equipment[0].record = 9; },
    'weapon 128': (d) => { d.equipment[0].weapon = 128; },
    'armor 32': (d) => { d.equipment[0].armor = 32; },
    'accessory 32': (d) => { d.equipment[0].accessory = 32; },
    'equipped materia slot 16': (d) => { d.equipment[0].materia[0].slot = 16; },
    'missing armor': (d) => { delete d.equipment[0].armor; },
    'unknown key': (d) => { d.items[0].name = 'x'; },
    'two writes to one item slot': (d) => { d.items.push({ slot: 0, index: 2, quantity: 1 }); },
    'two writes to one materia slot': (d) => { d.materia.push({ slot: 199, id: 1, ap: 0 }); },
    'equipment twice for a record': (d) => { d.equipment.push({ record: 0, weapon: 0, armor: 0, accessory: 0 }); },
  };
  for (const [name, change] of Object.entries(bad)) {
    test(`rejects ${name}`, () => {
      const d = structuredClone(base);
      change(d);
      assert.notDeepEqual(descriptionProblems(d), [], name);
    });
  }
});
