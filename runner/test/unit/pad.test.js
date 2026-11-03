import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PAD, padMask, padNames } from '../../pad.js';

test('every button is a distinct single bit covering 0..15', () => {
  const bits = Object.values(PAD);
  assert.equal(bits.length, 16);
  assert.equal(bits.reduce((a, b) => a | b, 0), 0xffff);
  for (const b of bits) assert.equal(b & (b - 1), 0);
});

test('libretro joypad ids map to PS1 names', () => {
  // RETRO_DEVICE_ID_JOYPAD_B=0 (Cross), Y=1 (Square), START=3, A=8 (Circle), X=9 (Triangle)
  assert.equal(PAD.cross, 1 << 0);
  assert.equal(PAD.square, 1 << 1);
  assert.equal(PAD.start, 1 << 3);
  assert.equal(PAD.circle, 1 << 8);
  assert.equal(PAD.triangle, 1 << 9);
  assert.equal(PAD.r3, 1 << 15);
});

test('padMask accepts masks, name arrays and comma strings', () => {
  assert.equal(padMask(0), 0);
  assert.equal(padMask(0xffff), 0xffff);
  assert.equal(padMask(['start', 'cross']), PAD.start | PAD.cross);
  assert.equal(padMask('start, Cross'), PAD.start | PAD.cross);
  assert.equal(padMask(''), 0);
  assert.deepEqual(padNames(PAD.up | PAD.l1), ['up', 'l1']);
});

test('padMask rejects out-of-range masks and unknown names', () => {
  for (const bad of [-1, 0x10000, 1.5, NaN]) assert.throws(() => padMask(bad), RangeError);
  assert.throws(() => padMask(['jump']), RangeError);
  assert.throws(() => padMask({}), TypeError);
});
