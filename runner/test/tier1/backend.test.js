// Tier 1: backend interface against the real Wasm core and a synthetic
// program (no game data). Needs core/build.sh and runner/build.sh.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createBackend } from '../../backend.js';
import { RAM_SIZE } from '../../memmap.js';
import { PAD } from '../../pad.js';
import { COUNTER_ADDR, LOAD_ADDR, MARKER, MARKER_ADDR } from '../../synth/vblank-counter.js';
import { synthExe } from './helpers.js';

const RETRO_DEVICE_ID_JOYPAD_MASK = 256;

describe('backend on the synthetic program', () => {
  let b;
  let fx;
  before(async () => {
    fx = synthExe();
    b = await createBackend();
    b.loadProgram(fx.exe);
  });
  after(() => {
    b?.close();
    fx?.cleanup();
  });

  test('onFrameEnd fires once per frame, in order, and can unsubscribe', () => {
    const seen = [];
    const off = b.onFrameEnd(({ frame }) => seen.push(frame));
    const start = b.frame;
    b.runFrames(3);
    off();
    b.stepFrame();
    assert.deepEqual(seen, [start + 1, start + 2, start + 3]);
  });

  test('the program runs: marker set and counter tracks frames', () => {
    assert.equal(b.readU32(MARKER_ADDR), MARKER);
    assert.equal(b.readU32(COUNTER_ADDR), b.frame);
    b.runFrames(10);
    assert.equal(b.readU32(COUNTER_ADDR), b.frame);
  });

  test('the core produces a 320x240 picture that changes every frame', () => {
    const info = b.frameInfo();
    assert.equal(info.width, 320);
    assert.equal(info.height, 240);
    assert.ok(info.hasData);
    const h1 = b.frameHash();
    assert.equal(b.frameHash(), h1, 'hash is stable without stepping');
    b.stepFrame();
    assert.notEqual(b.frameHash(), h1);
  });

  test('readMem: segment views alias, little-endian helpers agree', () => {
    const k0 = b.readMem(LOAD_ADDR, 16);
    assert.deepEqual(b.readMem(LOAD_ADDR - 0x80000000, 16), k0);
    assert.deepEqual(b.readMem(LOAD_ADDR + 0x20000000, 16), k0);
    const m = b.readMem(MARKER_ADDR, 4);
    assert.equal(Buffer.from(m).toString('latin1'), 'FF7W');
    assert.equal(b.readU16(MARKER_ADDR), MARKER & 0xffff);
    assert.equal(b.readU8(MARKER_ADDR + 3), MARKER >>> 24);
  });

  test('readMem: bounds are enforced', () => {
    assert.equal(b.readMem(0x80000000 + RAM_SIZE - 4, 4).length, 4);
    assert.throws(() => b.readMem(0x80000000 + RAM_SIZE - 3, 4), RangeError);
    assert.throws(() => b.readMem(0x80000000 + RAM_SIZE), RangeError);
    assert.throws(() => b.readMem(0x1f800000), RangeError);
    assert.throws(() => b.readMem(0x80000000, 0), RangeError);
  });

  test('readMem returns a copy, not a live view', () => {
    const before = b.readU32(COUNTER_ADDR);
    const snap = b.readMem(COUNTER_ADDR, 4);
    b.stepFrame();
    assert.equal(snap[0] | (snap[1] << 8), before & 0xffff);
    assert.notEqual(b.readU32(COUNTER_ADDR), before);
  });

  test('writeMem is disabled by default', () => {
    assert.throws(() => b.writeMem(0x80100000, [1, 2, 3]), /disabled/);
  });

  test('setPad: each bit reaches the input callback the core polls', () => {
    for (const [name, bit] of Object.entries(PAD)) {
      b.setPad([name]);
      const id = Math.log2(bit);
      assert.equal(b.inputState(0, id), 1, name);
      assert.equal(b.inputState(0, RETRO_DEVICE_ID_JOYPAD_MASK) & 0xffff, bit, name);
      for (let other = 0; other < 16; other++) {
        if (other !== id) assert.equal(b.inputState(0, other), 0, `${name} vs ${other}`);
      }
    }
    b.setPad(PAD.start | PAD.cross);
    assert.equal(b.inputState(0, RETRO_DEVICE_ID_JOYPAD_MASK) & 0xffff, PAD.start | PAD.cross);
    assert.equal(b.inputState(1, RETRO_DEVICE_ID_JOYPAD_MASK), 0, 'port 1 untouched');
    b.setPad(PAD.r3, 1);
    assert.equal(b.inputState(1, 15), 1);
    b.setPad(0);
    b.setPad(0, 1);
    assert.equal(b.inputState(0, RETRO_DEVICE_ID_JOYPAD_MASK), 0);
  });

  test('setPad: invalid masks and ports are rejected', () => {
    assert.throws(() => b.setPad(0x10000), RangeError);
    assert.throws(() => b.setPad(-1), RangeError);
    assert.throws(() => b.setPad(['jump']), RangeError);
    assert.throws(() => b.setPad(0, 2), RangeError);
  });

  test('the core polls input every frame', () => {
    const polls = b.stats().inputPolls;
    b.runFrames(5);
    assert.equal(b.stats().inputPolls - polls, 5);
  });
});

test('writeMem works when explicitly allowed, within bounds', async () => {
  const fx = synthExe();
  const b = await createBackend({ allowMemoryWrite: true });
  try {
    b.loadProgram(fx.exe);
    b.runFrames(2);
    b.writeMem(0x80100000, [0xde, 0xad, 0xbe, 0xef]);
    assert.equal(b.readU32(0x80100000), 0xefbeadde);
    assert.throws(() => b.writeMem(0x801ffffe, [1, 2, 3, 4]), RangeError);
    // The program's own counter keeps working after an unrelated write.
    const c = b.readU32(COUNTER_ADDR);
    b.stepFrame();
    assert.equal(b.readU32(COUNTER_ADDR), c + 1);
  } finally {
    b.close();
    fx.cleanup();
  }
});

test('a backend refuses to step before a program is loaded', async () => {
  const b = await createBackend();
  try {
    assert.throws(() => b.stepFrame(), /no program/);
    assert.throws(() => b.readMem(0x80000000), /not available|no program/);
  } finally {
    b.close();
  }
});
