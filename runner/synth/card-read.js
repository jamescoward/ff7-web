#!/usr/bin/env node
// card-read: an original PS1 homebrew test program that proves a memory card
// in slot 1 is visible to a program. Original project code, GPL-2.0-or-later;
// no game data, BIOS code or SDK code. It talks to the card through the SIO0
// registers directly (no BIOS card calls), like harness/fixtures/pad-echo.js
// does for the pad.
//
// Once, after setting up SIO0, it runs the standard "read sector" exchange
// against the card in port 1 for frame number FRAME_INDEX:
//   host sends  81 52 00 00 MSB LSB 00 00 00 00 <DATA_LEN x 00>
// and stores every reply byte, in order, at REPLY_ADDR. Then it writes
// DONE_MARKER to DONE_ADDR and idles (screen filled with a fixed colour).
// With no card present the replies are all 0xFF.
//
//   node runner/synth/card-read.js out.exe

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Asm, IO, R, emitDisplaySetup, emitFillFromBits, emitInterruptsOff, psxExe } from './mips.js';

export const LOAD_ADDR = 0x80010000;
export const BASE_ADDR = 0x800f0000;
export const DONE_ADDR = BASE_ADDR; // u32
export const DONE_MARKER = 0x454e4f44; // bytes "DONE" in little-endian RAM
export const REPLY_ADDR = BASE_ADDR + 0x10; // u8 x REPLY_LEN
export const FRAME_INDEX = 3; // card frame (128-byte block) to read
export const DATA_LEN = 16; // data bytes captured after the 10 header bytes
export const HEADER_LEN = 10;
export const REPLY_LEN = HEADER_LEN + DATA_LEN;
const STACK_TOP = 0x801fff00;

function program() {
  const { zero, t0, t1, t4, s0, s1 } = R;
  const a = new Asm(LOAD_ADDR);

  emitInterruptsOff(a, t0);
  a.li(s0, BASE_ADDR);
  a.sw(zero, 0, s0);
  emitDisplaySetup(a, t0, t1);
  a.addiu(t1, zero, 0x000d); // JOY_MODE: 8-bit, baud factor 1
  a.sh(t1, IO.JOY_MODE, t0);
  a.addiu(t1, zero, 0x0088); // JOY_BAUD
  a.sh(t1, IO.JOY_BAUD, t0);
  a.addiu(t1, zero, 0x0003); // JOY_CTRL: TX enable, select, port 1
  a.sh(t1, IO.JOY_CTRL, t0);

  const send = [
    0x81, 0x52, 0x00, 0x00, (FRAME_INDEX >> 8) & 0xff, FRAME_INDEX & 0xff, 0x00, 0x00, 0x00, 0x00,
    ...new Array(DATA_LEN).fill(0x00),
  ];
  send.forEach((byte, i) => {
    const wait = `rx${i}`;
    a.addiu(t1, zero, byte);
    a.sb(t1, IO.JOY_DATA, t0);
    a.label(wait);
    a.lhu(t4, IO.JOY_STAT, t0);
    a.nop();
    a.andi(t4, t4, 2); // RX FIFO not empty
    a.beq(t4, zero, wait);
    a.nop();
    a.lbu(s1, IO.JOY_DATA, t0);
    a.nop();
    a.sb(s1, REPLY_ADDR - BASE_ADDR + i, s0);
  });
  a.sh(zero, IO.JOY_CTRL, t0); // deselect

  a.li(t1, DONE_MARKER);
  a.sw(t1, 0, s0);
  a.li(R.t3, 0x1234);
  emitFillFromBits(a, t0, R.t3);
  a.label('idle');
  a.j('idle');
  a.nop();
  return a.assemble();
}

/** Build the PS-X EXE file image. */
export function build() {
  return psxExe(program(), { loadAddr: LOAD_ADDR, stackTop: STACK_TOP });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) {
    console.error('usage: card-read.js <out.exe>');
    process.exit(2);
  }
  writeFileSync(out, build());
}
