#!/usr/bin/env node
// border-box: an original PS1 homebrew test program for the automatic
// picture crop (issue #24). Original project code, GPL-2.0-or-later. It
// contains no game data, BIOS code or SDK code; it is built from source at
// test time by the assembler in runner/synth/mips.js.
//
// It shows a 320x240 picture: a filled box on black, whose borders change on
// a schedule of VBLANKs (PHASES). Each VBLANK it:
//   1. increments the u32 frame counter at COUNTER_ADDR;
//   2. stores the current phase index (u32) at PHASE_ADDR;
//   3. clears the screen to black and fills the phase's box, if it has one.
//
//   node harness/fixtures/border-box.js out.exe

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  Asm, IO, R, emitDisplaySetup, emitInterruptsOff, emitWaitVblank, psxExe,
} from '../../runner/synth/mips.js';

export const LOAD_ADDR = 0x80010000;
export const BASE_ADDR = 0x800f0000;
export const COUNTER_ADDR = BASE_ADDR; // u32
export const MARKER_ADDR = BASE_ADDR + 4; // u32
export const PHASE_ADDR = BASE_ADDR + 8; // u32
export const MARKER = 0x584f4242; // bytes "BBOX" in little-endian RAM
export const WIDTH = 320;
export const HEIGHT = 240;
const STACK_TOP = 0x801fff00;

/**
 * The schedule: from VBLANK `from`, show `box` (insets from each edge, or
 * null for an all-black screen). Horizontal insets are multiples of 16: the
 * GPU's fill command works in 16-pixel columns.
 */
export const PHASES = Object.freeze([
  { from: 0, box: null, colour: 0 }, // black: nothing to crop
  { from: 30, box: { top: 24, right: 32, bottom: 24, left: 32 }, colour: 0x40a0e0 }, // borders: narrow after ~1 s
  { from: 240, box: { top: 8, right: 0, bottom: 8, left: 0 }, colour: 0xe0a040 }, // wider: widen at once
]);

function emitFill(a, io, colour, x, y, w, h) {
  const { t1 } = R;
  a.li(t1, (0x02000000 | colour) >>> 0); // GP0(02) fill rectangle, 24-bit colour
  a.sw(t1, IO.GP0, io);
  a.li(t1, ((y << 16) | x) >>> 0);
  a.sw(t1, IO.GP0, io);
  a.li(t1, ((h << 16) | w) >>> 0);
  a.sw(t1, IO.GP0, io);
}

function program() {
  const { zero, t0, t1, t3, t4, t5, s0 } = R;
  const a = new Asm(LOAD_ADDR);

  emitInterruptsOff(a, t0);
  a.li(s0, BASE_ADDR);
  a.sw(zero, 0, s0);
  a.li(t1, MARKER);
  a.sw(t1, MARKER_ADDR - BASE_ADDR, s0);
  emitDisplaySetup(a, t0, t1);

  emitWaitVblank(a, t0, t4, t5, 'frame');
  a.lw(t3, 0, s0);
  a.nop();
  a.addiu(t3, t3, 1);
  a.sw(t3, 0, s0);
  emitFill(a, t0, 0, 0, 0, WIDTH, HEIGHT); // black

  // Find the phase: the last one whose `from` is <= the counter.
  for (let i = PHASES.length - 1; i >= 0; i--) {
    const p = PHASES[i];
    const next = `phase${i - 1}`;
    if (i > 0) {
      a.sltiu(t4, t3, p.from); // t4 = counter < from
      a.beq(t4, zero, `show${i}`);
      a.nop();
      a.j(next);
      a.nop();
    }
    a.label(`show${i}`);
    a.addiu(t1, zero, i);
    a.sw(t1, PHASE_ADDR - BASE_ADDR, s0);
    if (p.box) {
      const { top, right, bottom, left } = p.box;
      emitFill(a, t0, p.colour, left, top, WIDTH - left - right, HEIGHT - top - bottom);
    }
    a.j('frame');
    a.nop();
    if (i > 0) a.label(next);
  }
  return a.assemble();
}

/** Build the PS-X EXE file image. */
export function build() {
  return psxExe(program(), { loadAddr: LOAD_ADDR, stackTop: STACK_TOP });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) {
    console.error('usage: border-box.js <out.exe>');
    process.exit(2);
  }
  writeFileSync(out, build());
}
