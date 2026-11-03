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

export const LOAD_ADDR = 0x80010000;
export const COUNTER_ADDR = 0x800f0000;
export const MARKER_ADDR = 0x800f0004;
export const MARKER = 0x57374646; // bytes "FF7W" in little-endian RAM
const STACK_TOP = 0x801fff00;

// --- a tiny MIPS I encoder (only what this program needs) -----------------
const R = { zero: 0, t0: 8, t1: 9, t2: 10, t3: 11, t4: 12, t5: 13, t6: 14, t7: 15 };
const imm16 = (v) => v & 0xffff;
const iType = (op, rs, rt, imm) => ((op << 26) | (rs << 21) | (rt << 16) | imm16(imm)) >>> 0;
const rType = (rs, rt, rd, sh, fn) => ((rs << 21) | (rt << 16) | (rd << 11) | (sh << 6) | fn) >>> 0;

class Asm {
  constructor(base) {
    this.base = base;
    this.words = [];
    this.labels = {};
    this.fixups = [];
  }
  get pc() {
    return this.base + this.words.length * 4;
  }
  label(name) {
    this.labels[name] = this.pc;
  }
  emit(w) {
    this.words.push(w >>> 0);
  }
  nop() { this.emit(0); }
  lui(rt, imm) { this.emit(iType(0x0f, 0, rt, imm)); }
  ori(rt, rs, imm) { this.emit(iType(0x0d, rs, rt, imm)); }
  andi(rt, rs, imm) { this.emit(iType(0x0c, rs, rt, imm)); }
  addiu(rt, rs, imm) { this.emit(iType(0x09, rs, rt, imm)); }
  lw(rt, off, base) { this.emit(iType(0x23, base, rt, off)); }
  sw(rt, off, base) { this.emit(iType(0x2b, base, rt, off)); }
  sll(rd, rt, sh) { this.emit(rType(0, rt, rd, sh, 0x00)); }
  and(rd, rs, rt) { this.emit(rType(rs, rt, rd, 0, 0x24)); }
  or(rd, rs, rt) { this.emit(rType(rs, rt, rd, 0, 0x25)); }
  mtc0(rt, rd) { this.emit(((0x10 << 26) | (0x04 << 21) | (rt << 16) | (rd << 11)) >>> 0); }
  li(rt, v) {
    v >>>= 0;
    this.lui(rt, v >>> 16);
    if (v & 0xffff) this.ori(rt, rt, v & 0xffff);
  }
  beq(rs, rt, label) {
    this.fixups.push({ at: this.words.length, label, kind: 'branch' });
    this.emit(iType(0x04, rs, rt, 0));
  }
  j(label) {
    this.fixups.push({ at: this.words.length, label, kind: 'jump' });
    this.emit(0x02 << 26);
  }
  assemble() {
    for (const f of this.fixups) {
      const target = this.labels[f.label];
      if (target === undefined) throw new Error(`undefined label ${f.label}`);
      const here = this.base + f.at * 4;
      if (f.kind === 'branch') {
        this.words[f.at] = (this.words[f.at] | imm16((target - (here + 4)) >> 2)) >>> 0;
      } else {
        this.words[f.at] = (this.words[f.at] | ((target >>> 2) & 0x3ffffff)) >>> 0;
      }
    }
    const buf = Buffer.alloc(this.words.length * 4);
    this.words.forEach((w, i) => buf.writeUInt32LE(w, i * 4));
    return buf;
  }
}

function program() {
  const { zero, t0, t1, t2, t3, t4, t5, t6, t7 } = R;
  const a = new Asm(LOAD_ADDR);
  const IO = 0x1f80; // upper half of 0x1F800000
  const I_STAT = 0x1070, I_MASK = 0x1074, GP0 = 0x1810, GP1 = 0x1814;

  a.mtc0(zero, 12); // COP0 SR = 0: interrupts off, so nothing else acks VBLANK
  a.lui(t0, IO);
  a.sw(zero, I_MASK, t0);

  a.li(t2, COUNTER_ADDR);
  a.sw(zero, 0, t2);
  a.li(t1, MARKER);
  a.sw(t1, MARKER_ADDR - COUNTER_ADDR, t2);

  for (const cmd of [
    0x00000000, // GP1(00) reset
    0x06c60260, // GP1(06) horizontal display range
    0x07040010, // GP1(07) vertical display range
    0x05000000, // GP1(05) display start 0,0
    0x08000001, // GP1(08) 320x240, NTSC, 15-bit
    0x03000000, // GP1(03) display on
  ]) {
    a.li(t1, cmd);
    a.sw(t1, GP1, t0);
  }
  for (const cmd of [
    0xe1000400, // draw mode: drawing to the display area allowed
    0xe3000000, // drawing area top-left 0,0
    0xe403bd3f, // drawing area bottom-right 319,239
    0xe5000000, // drawing offset 0,0
  ]) {
    a.li(t1, cmd);
    a.sw(t1, GP0, t0);
  }

  a.label('wait');
  a.lw(t4, I_STAT, t0);
  a.nop(); // load delay slot
  a.andi(t4, t4, 1);
  a.beq(t4, zero, 'wait');
  a.nop(); // branch delay slot
  a.addiu(t5, zero, -2);
  a.sw(t5, I_STAT, t0); // ack VBLANK only

  a.lw(t3, 0, t2);
  a.nop();
  a.addiu(t3, t3, 1);
  a.sw(t3, 0, t2);

  // Colour: counter bits 0-4 -> red, 5-9 -> green, 10-14 -> blue, each in
  // the top 5 bits of its byte (the GPU keeps those in 15-bit mode), so the
  // picture only repeats after 32768 frames.
  a.sll(t6, t3, 3);
  a.andi(t6, t6, 0x00f8);
  a.sll(t7, t3, 6);
  a.andi(t7, t7, 0xf800);
  a.or(t6, t6, t7);
  a.sll(t7, t3, 9);
  a.li(t1, 0x00f80000);
  a.and(t7, t7, t1);
  a.or(t6, t6, t7);
  a.lui(t7, 0x0200); // GP0(02) fill rectangle
  a.or(t6, t6, t7);
  a.sw(t6, GP0, t0);
  a.sw(zero, GP0, t0); // x=0, y=0
  a.li(t7, 0x00f00140); // h=240, w=320
  a.sw(t7, GP0, t0);
  a.j('wait');
  a.nop();
  return a.assemble();
}

/** Build the PS-X EXE file image. */
export function buildExe() {
  const text = program();
  const tSize = Math.ceil(text.length / 0x800) * 0x800;
  const exe = Buffer.alloc(0x800 + tSize);
  exe.write('PS-X EXE', 0, 'latin1');
  exe.writeUInt32LE(LOAD_ADDR, 0x10); // pc0
  exe.writeUInt32LE(0, 0x14); // gp0
  exe.writeUInt32LE(LOAD_ADDR, 0x18); // t_addr
  exe.writeUInt32LE(tSize, 0x1c); // t_size
  exe.writeUInt32LE(STACK_TOP, 0x30); // s_addr
  text.copy(exe, 0x800);
  return exe;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) {
    console.error('usage: vblank-counter.js <out.exe>');
    process.exit(2);
  }
  writeFileSync(out, buildExe());
}
