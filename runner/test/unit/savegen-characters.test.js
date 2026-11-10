// Save descriptions with character records (#130): author-chosen HP, MP and
// limit bar. Tier 1: the baseline savemap is a synthetic pattern, never game
// data. Offsets are written out by hand from notes/130-party-status.md (the
// wiki's "Character Record" table), independent of runner/savegen/layout.js.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildSavemap, descriptionProblems } from '../../savegen/index.js';
import { SAVEMAP_SIZE } from '../../savegen/layout.js';

const pattern = (seed) => {
  const b = new Uint8Array(SAVEMAP_SIZE);
  for (let i = 0; i < b.length; i++) b[i] = (i * 151 + seed) & 0xff;
  return b;
};

const base = {
  format: 1,
  label: 'Stats 1',
  slot: 1,
  field: { id: 116, x: 0, y: 0, triangle: 12, direction: 0 },
  party: [0, 1, 2],
  progress: 6,
  characters: [
    { record: 0, hp: 0x0123, maxHp: 0x0456, mp: 0x0078, maxMp: 0x0099, limit: 0x64 },
    { record: 8, hp: 9999, maxHp: 9999, mp: 0, maxMp: 999, limit: 255 },
  ],
};

const le16 = (v) => [v & 0xff, v >> 8];

// [offset, bytes] for each described record: 0x0054 + 0x84 * record.
const expected = (rec, c) => {
  const at = 0x54 + 0x84 * rec;
  return [
    [at + 0x0f, [c.limit]],
    [at + 0x2c, le16(c.hp)],
    [at + 0x2e, le16(c.maxHp)],
    [at + 0x30, le16(c.mp)],
    [at + 0x32, le16(c.maxMp)],
    [at + 0x38, le16(c.maxHp)],
    [at + 0x3a, le16(c.maxMp)],
    [at + 0x40, Array(64).fill(0xff)], // 16 materia slots, all empty
  ];
};

describe('character records (#130)', () => {
  const baseline = pattern(0x33);
  const { savemap } = buildSavemap(baseline, base);
  const { characters: _omit, ...withoutCharacters } = base;
  const plain = buildSavemap(baseline, withoutCharacters).savemap;
  const writes = base.characters.flatMap((c) => expected(c.record, c));

  test('each value lands at its record offset, little endian; materia slots are emptied', () => {
    for (const [off, bytes] of writes) {
      assert.deepEqual([...savemap.subarray(off, off + bytes.length)], bytes, `0x${off.toString(16)}`);
    }
  });

  test('every other byte equals the same description without characters (except the checksum)', () => {
    const touched = new Set([0, 1, 2, 3]);
    for (const [off, bytes] of writes) bytes.forEach((_, i) => touched.add(off + i));
    for (let i = 0; i < SAVEMAP_SIZE; i++) {
      if (!touched.has(i)) assert.equal(savemap[i], plain[i], `0x${i.toString(16)}`);
    }
  });

  test('the field is optional', () => {
    const d = structuredClone(base);
    delete d.characters;
    assert.deepEqual(descriptionProblems(d), []);
  });

  const bad = {
    'record 9': (d) => { d.characters[0].record = 9; },
    'maxHp below 10': (d) => { d.characters[0].maxHp = 9; d.characters[0].hp = 9; },
    'maxHp 10000': (d) => { d.characters[0].maxHp = 10000; },
    'maxMp 1000': (d) => { d.characters[0].maxMp = 1000; },
    'limit 256': (d) => { d.characters[0].limit = 256; },
    'missing limit': (d) => { delete d.characters[0].limit; },
    'unknown member': (d) => { d.characters[0].atb = 1; },
    'too many records': (d) => { d.characters = Array.from({ length: 10 }, (_, i) => ({ ...base.characters[0], record: i % 9 })); },
    'hp above maxHp': (d) => { d.characters[0].hp = d.characters[0].maxHp + 1; },
    'mp above maxMp': (d) => { d.characters[0].mp = d.characters[0].maxMp + 1; },
    'the same record twice': (d) => { d.characters[1].record = 0; },
  };
  for (const [name, mutate] of Object.entries(bad)) {
    test(`rejects: ${name}`, () => {
      const d = structuredClone(base);
      mutate(d);
      const problems = descriptionProblems(d);
      assert.ok(problems.length > 0, 'expected a problem');
      if (name === 'the same record twice') assert.match(problems.join('; '), /overlaps/);
      if (/above/.test(name)) assert.match(problems.join('; '), /above/);
    });
  }
});
