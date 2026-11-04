#!/usr/bin/env node
// Synthetic PS-X EXE for Tier 1 runner tests. Original project code; it
// contains no game data, BIOS code or SDK code.
//
// The program:
//   1. writes the marker 0x57374646 ("FF7W") to MARKER_ADDR;
//   2. sets up the GPU for a 320x240 15-bit display;
//   3. forever: busy-waits for the VBLANK bit in I_STAT, acknowledges it,
//      increments the 32-bit counter at COUNTER_ADDR, and fills the screen
//      with a colour derived from the counter.
// So the counter tracks emulated frames and the picture changes every frame
// (the colour repeats only after 32768 frames).
//
//   node runner/synth/vblank-counter.js out.exe

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Asm, R, emitDisplaySetup, emitFillFromBits, emitInterruptsOff, emitWaitVblank, psxExe } from './mips.js';

export const LOAD_ADDR = 0x80010000;
export const COUNTER_ADDR = 0x800f0000;
export const MARKER_ADDR = 0x800f0004;
export const MARKER = 0x57374646; // bytes "FF7W" in little-endian RAM
const STACK_TOP = 0x801fff00;

function program() {
  const { zero, t0, t1, t2, t3, t4, t5 } = R;
  const a = new Asm(LOAD_ADDR);

  emitInterruptsOff(a, t0);
  a.li(t2, COUNTER_ADDR);
  a.sw(zero, 0, t2);
  a.li(t1, MARKER);
  a.sw(t1, MARKER_ADDR - COUNTER_ADDR, t2);
  emitDisplaySetup(a, t0, t1);

  emitWaitVblank(a, t0, t4, t5, 'wait');
  a.lw(t3, 0, t2);
  a.nop();
  a.addiu(t3, t3, 1);
  a.sw(t3, 0, t2);
  emitFillFromBits(a, t0, t3);
  a.j('wait');
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
    console.error('usage: vblank-counter.js <out.exe>');
    process.exit(2);
  }
  writeFileSync(out, buildExe());
}
