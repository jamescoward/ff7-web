// gte-gpu-stress: an original PS1 homebrew program for the benchmark page
// (issue #8). Original project code, GPL-2.0-or-later. It contains no game,
// BIOS or SDK code.
//
// The page builds the PS-X EXE in the browser from this file, so the preview
// carries no binary. It runs in Node too (the tests build it there): it uses
// only Uint8Array and DataView.
//
// The assembler below is a small subset of runner/synth/mips.js, plus the
// COP2 (GTE) instructions. It is repeated here because the static site
// (web/) can't import from runner/.
//
// Program:
//   1. enables COP2 (SR.CU2) with interrupts off, sets up a 320x240 15-bit
//      display and the GTE (a 30 degree rotation about Z, TRZ = H = 1000,
//      screen offset 160,120);
//   2. transforms the probe vertex (100, 50, 0) once with RTPS and stores
//      SXY2 at PROBE_ADDR, so a test can check the GTE result;
//   3. forever, once per VBLANK: increments the u32 counter at COUNTER_ADDR,
//      clears the screen, then for TRIANGLES triangles: steps a xorshift32
//      generator seeded from the counter, builds a 32x32 right triangle at a
//      pseudo-random position, transforms its three vertices with RTPT and
//      draws it as a Gouraud-shaded triangle (GP0 0x30) from the GTE's
//      screen coordinates. The last SXY2 goes to LAST_ADDR.
// The picture depends only on the counter, so it changes every frame and is
// the same on every run.

export const NAME = 'gte-gpu-stress';
export const VERSION = 1;
export const DEFAULT_TRIANGLES = 1000;

export const LOAD_ADDR = 0x80010000;
export const BASE_ADDR = 0x800f0000;
export const COUNTER_ADDR = BASE_ADDR; // u32, frames drawn
export const MARKER_ADDR = BASE_ADDR + 4; // u32
export const PROBE_ADDR = BASE_ADDR + 8; // u32, SXY2 of the probe vertex
export const LAST_ADDR = BASE_ADDR + 12; // u32, SXY2 of the frame's last triangle
export const MARKER = 0x53455453; // bytes "STES" in little-endian RAM
const STACK_TOP = 0x801fff00;
const SIZE = 32; // triangle leg, in GTE units (scale 1 at TRZ = H)

// GTE setup: 30 degrees about Z in 4.12 fixed point.
export const GTE = Object.freeze({ cos: 3547, sin: 2048, trz: 1000, h: 1000, ofx: 160, ofy: 120 });
export const PROBE = Object.freeze({ x: 100, y: 50 });

const R = Object.freeze({
  zero: 0, at: 1, v0: 2, v1: 3, a0: 4, a1: 5, a2: 6, a3: 7,
  t0: 8, t1: 9, t2: 10, t3: 11, t4: 12, t5: 13, t6: 14, t7: 15,
  s0: 16, s1: 17, s2: 18, s3: 19, s4: 20, s5: 21, s6: 22, s7: 23,
  t8: 24, t9: 25, sp: 29, ra: 31,
});

const IO = Object.freeze({ I_STAT: 0x1070, I_MASK: 0x1074, GP0: 0x1810, GP1: 0x1814 });

const imm16 = (v) => v & 0xffff;
const iType = (op, rs, rt, imm) => ((op << 26) | (rs << 21) | (rt << 16) | imm16(imm)) >>> 0;
const rType = (rs, rt, rd, sh, fn) => ((rs << 21) | (rt << 16) | (rd << 11) | (sh << 6) | fn) >>> 0;
const cop = (z, sub, rt, rd) => ((((0x10 | z) << 26) | (sub << 21) | (rt << 16) | (rd << 11)) >>> 0);

class Asm {
  constructor(base) {
    this.base = base;
    this.words = [];
    this.labels = {};
    this.fixups = [];
  }
  get pc() { return this.base + this.words.length * 4; }
  label(name) {
    if (name in this.labels) throw new Error(`duplicate label ${name}`);
    this.labels[name] = this.pc;
  }
  emit(w) { this.words.push(w >>> 0); }
  nop() { this.emit(0); }
  lui(rt, imm) { this.emit(iType(0x0f, 0, rt, imm)); }
  ori(rt, rs, imm) { this.emit(iType(0x0d, rs, rt, imm)); }
  andi(rt, rs, imm) { this.emit(iType(0x0c, rs, rt, imm)); }
  addiu(rt, rs, imm) { this.emit(iType(0x09, rs, rt, imm)); }
  lw(rt, off, base) { this.emit(iType(0x23, base, rt, off)); }
  sw(rt, off, base) { this.emit(iType(0x2b, base, rt, off)); }
  sll(rd, rt, sh) { this.emit(rType(0, rt, rd, sh, 0x00)); }
  srl(rd, rt, sh) { this.emit(rType(0, rt, rd, sh, 0x02)); }
  and(rd, rs, rt) { this.emit(rType(rs, rt, rd, 0, 0x24)); }
  or(rd, rs, rt) { this.emit(rType(rs, rt, rd, 0, 0x25)); }
  xor(rd, rs, rt) { this.emit(rType(rs, rt, rd, 0, 0x26)); }
  nor(rd, rs, rt) { this.emit(rType(rs, rt, rd, 0, 0x27)); }
  mtc0(rt, rd) { this.emit(cop(0, 0x04, rt, rd)); }
  mtc2(rt, rd) { this.emit(cop(2, 0x04, rt, rd)); }
  mfc2(rt, rd) { this.emit(cop(2, 0x00, rt, rd)); }
  ctc2(rt, rd) { this.emit(cop(2, 0x06, rt, rd)); }
  gte(cmd) { this.emit((((0x12 << 26) | (1 << 25) | cmd) >>> 0)); }
  li(rt, v) {
    v >>>= 0;
    this.lui(rt, v >>> 16);
    if (v & 0xffff) this.ori(rt, rt, v & 0xffff);
  }
  branch(op, rs, rt, label) {
    this.fixups.push({ at: this.words.length, label, kind: 'branch' });
    this.emit(iType(op, rs, rt, 0));
  }
  beq(rs, rt, label) { this.branch(0x04, rs, rt, label); }
  bne(rs, rt, label) { this.branch(0x05, rs, rt, label); }
  j(label) {
    this.fixups.push({ at: this.words.length, label, kind: 'jump' });
    this.emit(0x02 << 26);
  }
  assemble() {
    for (const f of this.fixups) {
      const target = this.labels[f.label];
      if (target === undefined) throw new Error(`undefined label ${f.label}`);
      const here = this.base + f.at * 4;
      if (f.kind === 'branch') this.words[f.at] = (this.words[f.at] | imm16((target - (here + 4)) >> 2)) >>> 0;
      else this.words[f.at] = (this.words[f.at] | ((target >>> 2) & 0x3ffffff)) >>> 0;
    }
    const out = new Uint8Array(this.words.length * 4);
    const dv = new DataView(out.buffer);
    this.words.forEach((w, i) => dv.setUint32(i * 4, w, true));
    return out;
  }
}

// GTE commands (sf = 1, lm = 0).
const RTPS = 0x0180001;
const RTPT = 0x0280030;
// GTE register numbers.
const D = Object.freeze({ VXY0: 0, VZ0: 1, VXY1: 2, VZ1: 3, VXY2: 4, VZ2: 5, SXY0: 12, SXY1: 13, SXY2: 14 });
const C = Object.freeze({ R11R12: 0, R13R21: 1, R22R23: 2, R31R32: 3, R33: 4, TRX: 5, TRY: 6, TRZ: 7, OFX: 24, OFY: 25, H: 26 });

const pair = (lo, hi) => ((lo & 0xffff) | ((hi & 0xffff) << 16)) >>> 0;

function program(triangles) {
  const { zero, t0, t1, t2, t3, t4, t5, t6, t7, t8, t9, a0, a1, a2, s0, s1, s2, s3 } = R;
  const a = new Asm(LOAD_ADDR);

  // COP0 SR: CU2 on (the GTE), interrupts off, so nothing else acks VBLANK.
  a.li(t1, 0x40000000);
  a.mtc0(t1, 12);
  a.lui(t0, 0x1f80);
  a.sw(zero, IO.I_MASK, t0);
  a.li(s0, BASE_ADDR);
  a.sw(zero, 0, s0);
  a.li(t1, MARKER);
  a.sw(t1, MARKER_ADDR - BASE_ADDR, s0);

  for (const cmd of [0x00000000, 0x06c60260, 0x07040010, 0x05000000, 0x08000001, 0x03000000]) {
    a.li(t1, cmd);
    a.sw(t1, IO.GP1, t0);
  }
  for (const cmd of [0xe1000400, 0xe3000000, 0xe403bd3f, 0xe5000000]) {
    a.li(t1, cmd);
    a.sw(t1, IO.GP0, t0);
  }

  const { cos, sin, trz, h, ofx, ofy } = GTE;
  for (const [reg, v] of [
    [C.R11R12, pair(cos, -sin)], [C.R13R21, pair(0, sin)], [C.R22R23, pair(cos, 0)],
    [C.R31R32, 0], [C.R33, 0x1000], [C.TRX, 0], [C.TRY, 0], [C.TRZ, trz],
    [C.OFX, ofx << 16], [C.OFY, ofy << 16], [C.H, h],
  ]) {
    a.li(t1, v);
    a.ctc2(t1, reg);
  }

  // Probe: one RTPS of a known vertex.
  a.li(t1, pair(PROBE.x, PROBE.y));
  a.mtc2(t1, D.VXY0);
  a.mtc2(zero, D.VZ0);
  a.nop();
  a.gte(RTPS);
  a.nop();
  a.nop();
  a.mfc2(t2, D.SXY2);
  a.nop();
  a.sw(t2, PROBE_ADDR - BASE_ADDR, s0);

  a.li(t9, 0x00ffffff);
  a.label('frame');
  a.lw(t1, IO.I_STAT, t0);
  a.nop();
  a.andi(t1, t1, 1);
  a.beq(t1, zero, 'frame');
  a.nop();
  a.addiu(t1, zero, -2);
  a.sw(t1, IO.I_STAT, t0); // ack VBLANK only

  a.lw(s1, 0, s0);
  a.nop();
  a.addiu(s1, s1, 1);
  a.sw(s1, 0, s0);

  // Clear to black: GP0(02) fill 320x240 at 0,0.
  a.lui(t1, 0x0200);
  a.sw(t1, IO.GP0, t0);
  a.sw(zero, IO.GP0, t0);
  a.li(t1, 0x00f00140);
  a.sw(t1, IO.GP0, t0);

  a.li(t1, 0x9e3779b9);
  a.xor(s2, s1, t1); // xorshift32 seed (non-zero for any realistic counter)
  a.li(s3, triangles);

  a.label('tri');
  a.sll(t1, s2, 13);
  a.xor(s2, s2, t1);
  a.srl(t1, s2, 17);
  a.xor(s2, s2, t1);
  a.sll(t1, s2, 5);
  a.xor(s2, s2, t1);

  a.andi(t2, s2, 0x1ff);
  a.addiu(t2, t2, -256); // x in [-256, 255]
  a.srl(t3, s2, 9);
  a.andi(t3, t3, 0xff);
  a.addiu(t3, t3, -128); // y in [-128, 127]
  a.sll(t5, t3, 16);
  a.andi(t4, t2, 0xffff);
  a.or(a0, t5, t4); // v0 = (x, y)
  a.addiu(t6, t2, SIZE);
  a.andi(t6, t6, 0xffff);
  a.or(a1, t5, t6); // v1 = (x + SIZE, y)
  a.addiu(t6, t3, SIZE);
  a.sll(t6, t6, 16);
  a.or(a2, t6, t4); // v2 = (x, y + SIZE)

  a.mtc2(a0, D.VXY0);
  a.mtc2(zero, D.VZ0);
  a.mtc2(a1, D.VXY1);
  a.mtc2(zero, D.VZ1);
  a.mtc2(a2, D.VXY2);
  a.mtc2(zero, D.VZ2);
  a.nop();
  a.gte(RTPT);
  a.nop();
  a.nop();
  a.mfc2(a0, D.SXY0);
  a.mfc2(a1, D.SXY1);
  a.mfc2(a2, D.SXY2);
  a.nop();

  a.srl(t7, s2, 8); // colour 0, with the command byte
  a.lui(t8, 0x3000);
  a.or(t7, t7, t8);
  a.and(t4, s2, t9); // colour 1
  a.nor(t6, s2, zero);
  a.and(t6, t6, t9); // colour 2
  a.sw(t7, IO.GP0, t0);
  a.sw(a0, IO.GP0, t0);
  a.sw(t4, IO.GP0, t0);
  a.sw(a1, IO.GP0, t0);
  a.sw(t6, IO.GP0, t0);
  a.sw(a2, IO.GP0, t0);

  a.addiu(s3, s3, -1);
  a.bne(s3, zero, 'tri');
  a.nop();
  a.sw(a2, LAST_ADDR - BASE_ADDR, s0);
  a.j('frame');
  a.nop();
  return a.assemble();
}

/** Build the PS-X EXE image as a Uint8Array. */
export function build({ triangles = DEFAULT_TRIANGLES } = {}) {
  if (!Number.isInteger(triangles) || triangles < 1 || triangles > 0x7fff) {
    throw new RangeError(`triangles must be 1..32767, got ${triangles}`);
  }
  const text = program(triangles);
  const tSize = Math.ceil(text.length / 0x800) * 0x800;
  const exe = new Uint8Array(0x800 + tSize);
  const dv = new DataView(exe.buffer);
  exe.set([...'PS-X EXE'].map((c) => c.charCodeAt(0)), 0);
  dv.setUint32(0x10, LOAD_ADDR, true); // pc0
  dv.setUint32(0x18, LOAD_ADDR, true); // t_addr
  dv.setUint32(0x1c, tSize, true); // t_size
  dv.setUint32(0x30, STACK_TOP, true); // s_addr
  exe.set(text, 0x800);
  return exe;
}

/** The probe's expected screen position, computed like the GTE (RTPS, sf = 1). */
export function expectedProbe() {
  const { cos, sin, trz, h, ofx, ofy } = GTE;
  const ir1 = Math.trunc((cos * PROBE.x - sin * PROBE.y) / 4096);
  const ir2 = Math.trunc((sin * PROBE.x + cos * PROBE.y) / 4096);
  // h / sz = 1 here; the GTE's reciprocal is approximate, hence a ±1 tolerance in tests.
  const scale = h / trz;
  return { x: ofx + Math.round(ir1 * scale), y: ofy + Math.round(ir2 * scale) };
}
