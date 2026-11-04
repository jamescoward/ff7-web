#!/usr/bin/env node
// pad-echo: an original PS1 homebrew test program for Tier 1 scenarios.
// Original project code, GPL-2.0-or-later. It contains no game data, BIOS
// code or SDK code; it is built from source at test time by the assembler
// in runner/synth/mips.js.
//
// The program talks to the controller in port 1 directly through the SIO0
// registers (no BIOS pad routines), so it proves that input injected through
// the backend's setPad reaches a PS1 program's own view of the pad.
//
// Once per VBLANK it:
//   1. increments the u32 frame counter at COUNTER_ADDR;
//   2. sends the standard pad poll 01 42 00 00 00 to port 1 and stores the
//      replies: byte 0 at REPLY_ADDR, the ID byte (0x41 for a digital pad)
//      at REPLY_ADDR+1, the 0x5A marker at REPLY_ADDR+2, and the 16-bit
//      button word (active low, as on the wire) at BUTTONS_ADDR;
//   3. fills the screen with a colour made from the pressed buttons (low 15
//      bits of ~buttons), so the picture depends on input only: frames with
//      the same buttons held have the same hash.
//
//   node harness/fixtures/pad-echo.js out.exe

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  Asm, IO, R, emitDisplaySetup, emitFillFromBits, emitInterruptsOff, emitWaitVblank, psxExe,
} from '../../runner/synth/mips.js';

export const LOAD_ADDR = 0x80010000;
export const BASE_ADDR = 0x800f0000;
export const COUNTER_ADDR = BASE_ADDR; // u32
export const MARKER_ADDR = BASE_ADDR + 4; // u32
export const BUTTONS_ADDR = BASE_ADDR + 8; // u16, active low
export const REPLY_ADDR = BASE_ADDR + 0xc; // u8 x3: first reply, ID, 0x5A
export const MARKER = 0x45444150; // bytes "PADE" in little-endian RAM
const STACK_TOP = 0x801fff00;

// PS1 pad bits in the button word (active low on the wire).
export const PS1_BUTTON_BITS = Object.freeze({
  select: 0, l3: 1, r3: 2, start: 3, up: 4, right: 5, down: 6, left: 7,
  l2: 8, r2: 9, l1: 10, r1: 11, triangle: 12, circle: 13, cross: 14, square: 15,
});

function program() {
  const { zero, t0, t1, t3, t4, t5, s0, s1, s2, s3, s4, s5 } = R;
  const a = new Asm(LOAD_ADDR);

  emitInterruptsOff(a, t0);
  a.li(s0, BASE_ADDR);
  a.sw(zero, 0, s0);
  a.li(t1, MARKER);
  a.sw(t1, MARKER_ADDR - BASE_ADDR, s0);
  emitDisplaySetup(a, t0, t1);
  a.addiu(t1, zero, 0x000d); // JOY_MODE: 8-bit, baud factor 1
  a.sh(t1, IO.JOY_MODE, t0);
  a.addiu(t1, zero, 0x0088); // JOY_BAUD: the usual pad rate
  a.sh(t1, IO.JOY_BAUD, t0);

  let n = 0;
  const xfer = (byte, dst) => {
    const wait = `rx${n++}`;
    a.addiu(t1, zero, byte);
    a.sb(t1, IO.JOY_DATA, t0);
    a.label(wait);
    a.lhu(t4, IO.JOY_STAT, t0);
    a.nop();
    a.andi(t4, t4, 2); // RX FIFO not empty
    a.beq(t4, zero, wait);
    a.nop();
    a.lbu(dst, IO.JOY_DATA, t0);
    a.nop();
  };

  emitWaitVblank(a, t0, t4, t5, 'frame');
  a.lw(t3, 0, s0);
  a.nop();
  a.addiu(t3, t3, 1);
  a.sw(t3, 0, s0);

  a.addiu(t1, zero, 0x0003); // JOY_CTRL: TX enable, select, port 1
  a.sh(t1, IO.JOY_CTRL, t0);
  xfer(0x01, s1); // address the pad
  xfer(0x42, s2); // read command; reply: ID
  xfer(0x00, s3); // reply: 0x5A
  xfer(0x00, s4); // reply: buttons low byte
  xfer(0x00, s5); // reply: buttons high byte
  a.sh(zero, IO.JOY_CTRL, t0); // deselect

  a.sb(s1, REPLY_ADDR - BASE_ADDR, s0);
  a.sb(s2, REPLY_ADDR - BASE_ADDR + 1, s0);
  a.sb(s3, REPLY_ADDR - BASE_ADDR + 2, s0);
  a.sll(s5, s5, 8);
  a.or(s4, s4, s5);
  a.sh(s4, BUTTONS_ADDR - BASE_ADDR, s0);

  a.xori(t3, s4, 0xffff); // pressed buttons, active high
  emitFillFromBits(a, t0, t3);
  a.j('frame');
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
    console.error('usage: pad-echo.js <out.exe>');
    process.exit(2);
  }
  writeFileSync(out, build());
}
