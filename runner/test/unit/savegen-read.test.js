// Reading saves back out of a memory card (#226). Tier 1: cards come from
// the generator with a synthetic baseline, never game data.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { blankCard } from '../../synth/blank-card.js';
import { generateCard } from '../../savegen/index.js';
import { BLOCK_SIZE, FRAME_SIZE, SAVEMAP_IN_BLOCK, SAVEMAP_SIZE } from '../../savegen/layout.js';
import { SLOTS, cardOutcome, changedSlots, readSlot, readSlots } from '../../savegen/read.js';

/** A fixed synthetic pattern: no game bytes. */
const pattern = (seed) => {
  const b = new Uint8Array(SAVEMAP_SIZE);
  for (let i = 0; i < b.length; i++) b[i] = (i * 151 + seed) & 0xff;
  return b;
};

const desc = (slot, extra = {}) => ({
  format: 1,
  label: `Test save ${slot}`,
  slot,
  field: { id: 0x0123, x: 0, y: 0, triangle: 0, direction: 0 },
  party: [0, 255, 255],
  progress: 6,
  ...extra,
});

/** Copy save `slot` (directory frame and block) from card `from` into `into`. */
const copySlot = (into, from, slot) => {
  into.set(from.subarray(slot * FRAME_SIZE, (slot + 1) * FRAME_SIZE), slot * FRAME_SIZE);
  into.set(from.subarray(slot * BLOCK_SIZE, (slot + 1) * BLOCK_SIZE), slot * BLOCK_SIZE);
};

describe('readSlot', () => {
  test('a generated save reads back in use, with a right checksum, its module and location', () => {
    const { card } = generateCard(pattern(1), desc(2, { module: { state: 3, exitAction: 0 } }));
    assert.deepEqual(readSlot(card, 2), { slot: 2, inUse: true, magic: true, checksum: 'right', module: 3, location: 0x0123 });
  });

  test('a field save reads module 1', () => {
    const { card } = generateCard(pattern(2), desc(1));
    assert.equal(readSlot(card, 1).module, 1);
  });

  test('the generator\'s inverted checksum reads wrong', () => {
    const { card } = generateCard(pattern(3), desc(1), { checksum: 'wrong' });
    assert.equal(readSlot(card, 1).checksum, 'wrong');
  });

  test('a changed savemap byte makes the checksum wrong', () => {
    const { card } = generateCard(pattern(4), desc(1));
    card[BLOCK_SIZE + SAVEMAP_IN_BLOCK + 0x100] ^= 1;
    assert.equal(readSlot(card, 1).checksum, 'wrong');
  });

  test('the checksum compares the low 16 bits only', () => {
    const { card } = generateCard(pattern(5), desc(1));
    card[BLOCK_SIZE + SAVEMAP_IN_BLOCK + 3] = 0x5a; // high byte of the u32
    assert.equal(readSlot(card, 1).checksum, 'right');
  });

  test('an empty slot has no save', () => {
    const { card } = generateCard(pattern(6), desc(1));
    assert.deepEqual(readSlot(card, 2), { slot: 2, inUse: false, magic: false, checksum: null, module: null, location: null });
    assert.deepEqual(readSlots(blankCard()).filter((s) => s.inUse || s.magic), []);
  });

  test('a block with no directory entry is not a save', () => {
    const { card } = generateCard(pattern(7), desc(1));
    card.fill(0, FRAME_SIZE, 2 * FRAME_SIZE); // directory frame 1 cleared
    assert.equal(readSlot(card, 1).checksum, null);
  });

  test('two saves both read back', () => {
    const a = generateCard(pattern(8), desc(1)).card;
    const b = generateCard(pattern(9), desc(4, { module: { state: 3, exitAction: 0 } })).card;
    copySlot(a, b, 4);
    const used = readSlots(a).filter((s) => s.inUse);
    assert.deepEqual(used.map((s) => [s.slot, s.checksum, s.module]), [[1, 'right', 1], [4, 'right', 3]]);
  });

  test('bad arguments throw', () => {
    assert.throws(() => readSlot(new Uint8Array(10), 1), RangeError);
    assert.throws(() => readSlot(blankCard(), 0), RangeError);
    assert.throws(() => readSlot(blankCard(), SLOTS + 1), RangeError);
  });
});

describe('changedSlots and cardOutcome', () => {
  const start = () => generateCard(pattern(10), desc(1)).card;

  test('no change: nothing holds', () => {
    const c = start();
    assert.deepEqual(changedSlots(c, c.slice()), []);
    assert.deepEqual(cardOutcome(c, c.slice()), { changed: 0, slot: 0, checksum: 0, module: 0, location: 0, holds: false });
  });

  test('a new world map save in slot 2 holds, with module 3', () => {
    const before = start();
    const after = before.slice();
    copySlot(after, generateCard(pattern(11), desc(2, { module: { state: 3, exitAction: 0 }, field: { id: 2, x: 0, y: 0, triangle: 0, direction: 0 } })).card, 2);
    assert.deepEqual(changedSlots(before, after), [2]);
    assert.deepEqual(cardOutcome(before, after, { module: 3 }), { changed: 1, slot: 2, checksum: 1, module: 3, location: 2, holds: true });
    assert.equal(cardOutcome(before, after, { module: 1 }).holds, false);
  });

  test('an overwrite of slot 1 holds', () => {
    const before = start();
    const after = before.slice();
    copySlot(after, generateCard(pattern(12), desc(1, { module: { state: 3, exitAction: 0 } })).card, 1);
    assert.deepEqual(cardOutcome(before, after, { module: 3 }).slot, 1);
    assert.equal(cardOutcome(before, after, { module: 3 }).holds, true);
  });

  test('a changed slot with a wrong checksum does not hold', () => {
    const before = start();
    const after = before.slice();
    copySlot(after, generateCard(pattern(13), desc(3), { checksum: 'wrong' }).card, 3);
    const o = cardOutcome(before, after);
    assert.equal(o.slot, 3);
    assert.equal(o.checksum, 0);
    assert.equal(o.holds, false);
  });

  test('a slot that was cleared changed but holds no save', () => {
    const before = start();
    const after = blankCard();
    const o = cardOutcome(before, after);
    assert.deepEqual([o.changed, o.slot, o.checksum, o.holds], [1, 1, 0, false]);
  });

  test('changes outside slot frames and blocks (frame 0, block 0) are not slots', () => {
    const before = start();
    const after = before.slice();
    after[5] ^= 0xff; // header frame
    after[16 * FRAME_SIZE + 4] ^= 0xff; // a frame past the directory, inside block 0
    assert.deepEqual(changedSlots(before, after), []);
  });
});
