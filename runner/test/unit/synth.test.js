import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LOAD_ADDR, buildExe } from '../../synth/vblank-counter.js';

test('synthetic program is a well-formed PS-X EXE', () => {
  const exe = buildExe();
  assert.equal(exe.toString('latin1', 0, 8), 'PS-X EXE');
  assert.equal(exe.readUInt32LE(0x10), LOAD_ADDR); // pc0
  assert.equal(exe.readUInt32LE(0x18), LOAD_ADDR); // t_addr
  const tSize = exe.readUInt32LE(0x1c);
  assert.equal(tSize % 0x800, 0);
  assert.equal(exe.length, 0x800 + tSize);
  assert.notEqual(exe.readUInt32LE(0x800 + 4), 0); // code present
});

test('synthetic program build is deterministic', () => {
  assert.deepEqual(buildExe(), buildExe());
});
