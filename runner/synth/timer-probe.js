#!/usr/bin/env node
// timer-probe: an original PS1 homebrew test program for Tier 1 tests of
// save state round trips (#88). Original project code, GPL-2.0-or-later; it
// contains no game data, BIOS code or SDK code.
//
// The program sets the three root counters running free on different
// clocks, then once per VBLANK stores what it sees in RAM:
//   COUNTER_ADDR  u32  VBLANKs seen
//   LOOPS_ADDR    u32  busy-wait iterations before this VBLANK
//   RC0_ADDR      u16  root counter 0, dot clock (the core counts it at rate 5)
//   RC1_ADDR      u16  root counter 1, system clock (rate 1)
//   RC2_ADDR      u16  root counter 2, system clock / 8 (rate 8)
//   VOL_ADDR      u16 x4  SPU voices 0-3 current envelope volume
//   ENDX_ADDR     u16  SPU voices that reached an end block
// and fills the screen with a colour made from counter 2. Voices 0-3 are
// keyed on at start with different pitches and envelopes (over SPU RAM as
// the core clears it), so the SPU's state is exercised too. A program that
// reads timers like this makes main RAM depend on the exact cycle the core
// is at, so a restored state that loses part of a tick or a fraction of a
// cycle shows up in RAM within a frame (notes/88-snapshot-divergence.md).
//
//   node runner/synth/timer-probe.js out.exe

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Asm, R, emitDisplaySetup, emitFillFromBits, emitInterruptsOff, psxExe } from './mips.js';

export const LOAD_ADDR = 0x80010000;
export const BASE_ADDR = 0x800f0000;
export const COUNTER_ADDR = BASE_ADDR;
export const LOOPS_ADDR = BASE_ADDR + 4;
export const RC0_ADDR = BASE_ADDR + 8;
export const RC1_ADDR = BASE_ADDR + 10;
export const RC2_ADDR = BASE_ADDR + 12;
export const VOL_ADDR = BASE_ADDR + 16;
export const ENDX_ADDR = BASE_ADDR + 24;
const STACK_TOP = 0x801fff00;

// Root counter registers, offsets from 0x1F800000 (counter n at 0x1100 + 0x10 n).
const RC_COUNT = (n) => 0x1100 + 0x10 * n;
const RC_MODE = (n) => 0x1104 + 0x10 * n;
const I_STAT = 0x1070;
const SPU_VOICE = (v) => 0x1c00 + 0x10 * v;

function program() {
  const { zero, t0, t1, t3, t4, t5, s0, s1 } = R;
  const a = new Asm(LOAD_ADDR);

  emitInterruptsOff(a, t0);
  a.li(s0, BASE_ADDR);
  a.sw(zero, 0, s0);
  emitDisplaySetup(a, t0, t1);
  for (const [n, mode] of [[0, 0x0100], [1, 0x0000], [2, 0x0200]]) {
    a.addiu(t1, zero, mode); // free run; clock source bits 8-9
    a.sh(t1, RC_MODE(n), t0);
  }
  const w16 = (off, v) => {
    a.li(t1, v);
    a.sh(t1, off, t0);
  };
  w16(0x1daa, 0xc000); // SPUCNT: on, unmuted
  w16(0x1d80, 0x3fff); // main volume left, right
  w16(0x1d82, 0x3fff);
  for (let v = 0; v < 4; v++) {
    const b = SPU_VOICE(v);
    w16(b + 0, 0x3fff); // volume left, right
    w16(b + 2, 0x3fff);
    w16(b + 4, 0x0400 + v * 0x333); // pitch
    w16(b + 6, 0x0200 + v * 0x40); // start address / 8
    w16(b + 8, 0x8f0f + v); // ADSR attack, decay, sustain level
    w16(b + 10, 0x0fc0 | (v * 3)); // ADSR sustain, release
  }
  w16(0x1d88, 0x000f); // key on voices 0-3

  a.label('frame');
  a.addiu(s1, zero, 0);
  a.label('wait');
  a.addiu(s1, s1, 1);
  a.lw(t4, I_STAT, t0);
  a.nop(); // load delay slot
  a.andi(t4, t4, 1);
  a.beq(t4, zero, 'wait');
  a.nop(); // branch delay slot
  a.addiu(t5, zero, -2);
  a.sw(t5, I_STAT, t0); // ack VBLANK only

  a.lw(t3, 0, s0);
  a.nop();
  a.addiu(t3, t3, 1);
  a.sw(t3, 0, s0);
  a.sw(s1, LOOPS_ADDR - BASE_ADDR, s0);
  for (const [n, addr] of [[0, RC0_ADDR], [1, RC1_ADDR], [2, RC2_ADDR]]) {
    a.lhu(t1, RC_COUNT(n), t0);
    a.nop();
    a.sh(t1, addr - BASE_ADDR, s0);
  }
  emitFillFromBits(a, t0, t1); // t1 holds counter 2
  for (let v = 0; v < 4; v++) {
    a.lhu(t1, SPU_VOICE(v) + 0xc, t0); // current envelope volume
    a.nop();
    a.sh(t1, VOL_ADDR + 2 * v - BASE_ADDR, s0);
  }
  a.lhu(t1, 0x1d9c, t0); // ENDX
  a.nop();
  a.sh(t1, ENDX_ADDR - BASE_ADDR, s0);
  a.j('frame');
  a.nop();
  return a.assemble();
}

/** Build the PS-X EXE file image. */
export function buildExe() {
  return psxExe(program(), { loadAddr: LOAD_ADDR, stackTop: STACK_TOP });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) {
    console.error('usage: timer-probe.js <out.exe>');
    process.exit(2);
  }
  writeFileSync(out, buildExe());
}
