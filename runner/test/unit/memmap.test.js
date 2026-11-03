import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RAM_SIZE, ramOffset } from '../../memmap.js';

test('KUSEG, KSEG0 and KSEG1 views map to the same RAM offset', () => {
  for (const base of [0x00000000, 0x80000000, 0xa0000000]) {
    assert.equal(ramOffset(base), 0);
    assert.equal(ramOffset(base + 0x1234, 4), 0x1234);
    assert.equal(ramOffset(base + RAM_SIZE - 1, 1), RAM_SIZE - 1);
    assert.equal(ramOffset(base + RAM_SIZE - 4, 4), RAM_SIZE - 4);
  }
});

test('ranges running past the end of RAM are rejected', () => {
  assert.throws(() => ramOffset(0x801ffffd, 4), RangeError);
  assert.throws(() => ramOffset(0x80000000, RAM_SIZE + 1), RangeError);
});

test('non-RAM addresses are rejected', () => {
  for (const addr of [
    0x00200000, // RAM mirror
    0x1f800000, // scratchpad
    0x1f801070, // I/O
    0x80200000, // past KSEG0 RAM
    0xbfc00000, // BIOS ROM
    0xfffe0130, // cache control
  ]) {
    assert.throws(() => ramOffset(addr), RangeError, `0x${addr.toString(16)}`);
  }
});

test('bad address and length types are rejected', () => {
  for (const addr of [-1, 0x100000000, 1.5, NaN, '0x80000000']) {
    assert.throws(() => ramOffset(addr), RangeError);
  }
  for (const len of [0, -1, 2.5]) {
    assert.throws(() => ramOffset(0x80000000, len), RangeError);
  }
});
