// Tier 1: memory card in slot 1 and in-memory save states (issue #31).
// Synthetic programs only; no game data. Needs core/build.sh + runner/build.sh.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { build as buildPadEcho, BUTTONS_ADDR, COUNTER_ADDR } from '../../../harness/fixtures/pad-echo.js';
import { CARD_SIZE, createBackend } from '../../backend.js';
import { blankCard, FRAME_SIZE, sealFrame } from '../../synth/blank-card.js';
import * as cardRead from '../../synth/card-read.js';

let dir;
before(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ff7-card-'));
  writeFileSync(path.join(dir, 'pad-echo.exe'), buildPadEcho());
  writeFileSync(path.join(dir, 'card-read.exe'), cardRead.build());
});
after(() => rmSync(dir, { recursive: true, force: true }));
const exe = (n) => path.join(dir, n);

/** A blank card whose frame 3 starts with a recognisable pattern. */
function patternCard() {
  const c = blankCard();
  for (let i = 0; i < cardRead.DATA_LEN; i++) c[cardRead.FRAME_INDEX * FRAME_SIZE + i] = 0xc0 + i;
  sealFrame(c, cardRead.FRAME_INDEX);
  return c;
}

describe('blank card generator', () => {
  test('is 128 KiB, starts with MC, and every frame checksum holds', () => {
    const c = blankCard();
    assert.equal(c.length, CARD_SIZE);
    assert.equal(String.fromCharCode(c[0], c[1]), 'MC');
    for (let f = 0; f < 36; f++) {
      let x = 0;
      for (let i = 0; i < FRAME_SIZE; i++) x ^= c[f * FRAME_SIZE + i];
      assert.equal(x, 0, `frame ${f}`);
    }
  });
});

describe('memory card', () => {
  test('round trip: set before loadProgram reads back identical', async () => {
    const b = await createBackend({ memoryCard: true });
    try {
      const card = patternCard();
      b.setCard(card);
      b.loadProgram(exe('pad-echo.exe'));
      b.runFrames(5);
      assert.deepEqual(b.getCard(), card);
    } finally {
      b.close();
    }
  });

  test('round trip: set after loadProgram reads back identical', async () => {
    const b = await createBackend({ memoryCard: true });
    try {
      b.loadProgram(exe('pad-echo.exe'));
      const card = blankCard();
      b.setCard(card);
      assert.deepEqual(b.getCard(), card);
      assert.notEqual(b.getCard(), card, 'a copy, not the same object');
    } finally {
      b.close();
    }
  });

  test('validation: size, type, slot and missing memoryCard option', async () => {
    const b = await createBackend({ memoryCard: true });
    try {
      assert.throws(() => b.setCard(new Uint8Array(100)), RangeError);
      assert.throws(() => b.setCard([1, 2, 3]), RangeError);
      assert.throws(() => b.setCard(blankCard(), 1), RangeError);
      assert.throws(() => b.getCard(), /not available/);
    } finally {
      b.close();
    }
    const plain = await createBackend();
    try {
      assert.throws(() => plain.setCard(blankCard()), /memoryCard: true/);
      assert.throws(() => plain.getCard(), /memoryCard: true/);
    } finally {
      plain.close();
    }
  });

  test('visible to a program: card-read sees the card bytes through SIO0', async () => {
    const b = await createBackend({ memoryCard: true });
    try {
      b.setCard(patternCard());
      b.loadProgram(exe('card-read.exe'));
      b.runFrames(5);
      assert.equal(b.readU32(cardRead.DONE_ADDR), cardRead.DONE_MARKER);
      const reply = b.readMem(cardRead.REPLY_ADDR, cardRead.REPLY_LEN);
      assert.equal(reply[1], 0x08 | 0, 'card flag byte after a fresh card is "new card" (0x08)');
      assert.deepEqual([...reply.subarray(2, 4)], [0x5a, 0x5d], 'card ID bytes');
      const want = patternCard().subarray(
        cardRead.FRAME_INDEX * FRAME_SIZE,
        cardRead.FRAME_INDEX * FRAME_SIZE + cardRead.DATA_LEN,
      );
      assert.deepEqual([...reply.subarray(cardRead.HEADER_LEN)], [...want]);
    } finally {
      b.close();
    }
  });

  test('control: without a card the program reads only 0xFF', async () => {
    const b = await createBackend();
    try {
      b.loadProgram(exe('card-read.exe'));
      b.runFrames(5);
      assert.equal(b.readU32(cardRead.DONE_ADDR), cardRead.DONE_MARKER);
      const reply = b.readMem(cardRead.REPLY_ADDR, cardRead.REPLY_LEN);
      assert.ok(reply.every((x) => x === 0xff));
    } finally {
      b.close();
    }
  });
});

describe('save states', () => {
  const STEPS = ['start,cross', 'circle', 'up', 'square'];
  // Same input script for every replay: held buttons change with the frame.
  const input = (i) => STEPS[Math.floor(i / 7) % STEPS.length];

  function replay(b, n) {
    const hashes = [];
    for (let i = 0; i < n; i++) {
      b.setPad(input(i));
      b.stepFrame();
      hashes.push(b.frameHash());
    }
    return hashes;
  }

  test('restore replays bit-identically, twice, and the state is bytes only', async () => {
    const b = await createBackend({ memoryCard: true });
    try {
      b.setCard(blankCard());
      b.loadProgram(exe('pad-echo.exe'));
      for (let i = 0; i < 30; i++) {
        b.setPad(input(i));
        b.stepFrame();
      }
      const filesBefore = readdirSync(dir).sort();
      const snap = b.saveState();
      assert.ok(snap instanceof Uint8Array);
      assert.equal(snap.length, 0x440000);
      const counter = b.readU32(COUNTER_ADDR);
      const buttons = b.readU16(BUTTONS_ADDR);

      const first = replay(b, 60);
      assert.equal(new Set(first).size >= 4, true, 'input made the picture vary');
      const counterAfter = b.readU32(COUNTER_ADDR);
      assert.equal(counterAfter, counter + 60);

      b.loadState(snap);
      assert.equal(b.readU32(COUNTER_ADDR), counter);
      assert.equal(b.readU16(BUTTONS_ADDR), buttons);
      assert.deepEqual(replay(b, 60), first, 'first restore');
      assert.equal(b.readU32(COUNTER_ADDR), counterAfter);

      b.loadState(snap);
      assert.deepEqual(replay(b, 60), first, 'second restore');

      assert.deepEqual(readdirSync(dir).sort(), filesBefore, 'no file created beside the program');
    } finally {
      b.close();
    }
  });

  test('saving does not disturb the run: with and without saveState gives the same hashes', async () => {
    async function run(withSave) {
      const b = await createBackend();
      try {
        b.loadProgram(exe('pad-echo.exe'));
        b.runFrames(10);
        if (withSave) {
          b.saveState();
          b.saveState();
        }
        return replay(b, 20);
      } finally {
        b.close();
      }
    }
    assert.deepEqual(await run(true), await run(false));
  });

  test('a state restores into a fresh backend (same core build)', async () => {
    const b1 = await createBackend();
    let snap;
    let ref;
    try {
      b1.loadProgram(exe('pad-echo.exe'));
      b1.runFrames(20);
      snap = b1.saveState();
      ref = replay(b1, 20);
    } finally {
      b1.close();
    }
    const b2 = await createBackend();
    try {
      b2.loadProgram(exe('pad-echo.exe'));
      b2.loadState(snap);
      assert.deepEqual(replay(b2, 20), ref);
    } finally {
      b2.close();
    }
  });

  test('the state does not contain the card; the card is not rolled back', async () => {
    const b = await createBackend({ memoryCard: true });
    try {
      b.loadProgram(exe('pad-echo.exe'));
      b.setCard(blankCard());
      b.runFrames(3);
      const snap = b.saveState();
      const changed = patternCard();
      b.setCard(changed);
      b.loadState(snap);
      assert.deepEqual(b.getCard(), changed);
    } finally {
      b.close();
    }
  });

  test('validation: wrong size or type is rejected before the core sees it', async () => {
    const b = await createBackend();
    try {
      assert.throws(() => b.saveState(), /no program loaded/);
      b.loadProgram(exe('pad-echo.exe'));
      assert.throws(() => b.loadState(new Uint8Array(10)), RangeError);
      assert.throws(() => b.loadState('/some/path'), RangeError);
      assert.equal(b.saveState.length, 0, 'saveState takes no path');
      assert.equal(b.loadState.length, 1, 'loadState takes only bytes');
    } finally {
      b.close();
    }
  });

  test('no Wasm heap leak across repeated save/load', async () => {
    const b = await createBackend();
    try {
      b.loadProgram(exe('pad-echo.exe'));
      b.runFrames(5);
      const snap = b.saveState();
      for (let i = 0; i < 3; i++) b.loadState(b.saveState());
      const heapAfterWarmup = b.heapBytes();
      for (let i = 0; i < 10; i++) {
        b.loadState(snap);
        b.saveState();
      }
      assert.equal(b.heapBytes(), heapAfterWarmup);
    } finally {
      b.close();
    }
  });
});
