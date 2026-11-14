// Tier 1 unit tests for the browser wrapper's pure modules (no browser, no
// core build).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PAD as RUNNER_PAD } from '../../runner/pad.js';
import { dpadMask } from '../js/gamepad.js';
import { pickBootFile } from '../js/files.js';
import { KEY_MAP } from '../js/keyboard.js';
import { blankCard, CARD_SIZE, cardDigest, cardProblem } from '../js/memcard.js';
import { createInputMixer, PAD, padMask } from '../js/pad.js';

test('the web pad table matches the runner pad table', () => {
  assert.deepEqual({ ...PAD }, { ...RUNNER_PAD });
});

test('padMask accepts masks, names and strings', () => {
  assert.equal(padMask('start,cross'), PAD.start | PAD.cross);
  assert.equal(padMask(['up']), PAD.up);
  assert.equal(padMask(5), 5);
  assert.throws(() => padMask('turbo'), /unknown pad button/);
  assert.throws(() => padMask(0x10000), RangeError);
});

test('the input mixer ORs sources and reports only changes', () => {
  const sent = [];
  const mix = createInputMixer((m) => sent.push(m));
  mix.set('touch', PAD.cross);
  mix.set('keys', PAD.up);
  mix.set('keys', PAD.up); // no change
  mix.set('touch', 0);
  mix.releaseAll();
  assert.deepEqual(sent, [PAD.cross, PAD.cross | PAD.up, PAD.up, 0]);
});

test('the d-pad reads 8 directions by angle, with a dead zone', () => {
  const r = 100;
  assert.equal(dpadMask(0, 0, r), 0);
  assert.equal(dpadMask(10, 5, r), 0); // inside the dead zone
  assert.equal(dpadMask(80, 0, r), PAD.right);
  assert.equal(dpadMask(-80, 0, r), PAD.left);
  assert.equal(dpadMask(0, -80, r), PAD.up); // screen y grows down
  assert.equal(dpadMask(0, 80, r), PAD.down);
  assert.equal(dpadMask(60, -60, r), PAD.up | PAD.right);
  assert.equal(dpadMask(-60, 60, r), PAD.down | PAD.left);
  assert.equal(dpadMask(60, 60, r), PAD.down | PAD.right);
  assert.equal(dpadMask(-60, -60, r), PAD.up | PAD.left);
});

test('every keyboard binding names a pad button', () => {
  for (const [code, name] of Object.entries(KEY_MAP)) assert.ok(PAD[name], `${code} -> ${name}`);
});

test('the boot file is picked by type: cue before bin, exe before disc', () => {
  assert.equal(pickBootFile(['Disc (Track 1).bin', 'Disc.cue']), 'Disc.cue');
  assert.equal(pickBootFile(['a.BIN']), 'a.BIN');
  assert.equal(pickBootFile(['prog.exe', 'x.iso']), 'prog.exe');
  assert.equal(pickBootFile(['notes.txt']), null);
});

test('a blank card is a valid raw card with correct frame checksums', () => {
  const c = blankCard();
  assert.equal(c.length, CARD_SIZE);
  assert.equal(cardProblem(c), null);
  for (let f = 0; f < 64; f++) {
    let x = 0;
    for (let i = 0; i < 128; i++) x ^= c[f * 128 + i];
    assert.equal(x, 0, `frame ${f} checksum`);
  }
});

test('card validation rejects wrong sizes and headers', () => {
  assert.match(cardProblem(new Uint8Array(100)), /exactly 131072 bytes/);
  assert.match(cardProblem(new Uint8Array(CARD_SIZE)), /"MC" header/);
  assert.equal(cardProblem('nope'), 'not a byte array');
});

test('card digest changes with content', () => {
  const a = blankCard();
  const b = blankCard();
  assert.equal(cardDigest(a), cardDigest(b));
  b[200] ^= 1;
  assert.notEqual(cardDigest(a), cardDigest(b));
});
