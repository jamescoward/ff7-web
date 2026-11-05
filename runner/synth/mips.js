// A tiny MIPS I assembler and PS-X EXE writer for original test programs.
// Original project code (GPL-2.0-or-later). It encodes only the instructions
// the project's synthetic and homebrew test programs use; it contains no
// BIOS, SDK or game code.

export const R = Object.freeze({
  zero: 0, at: 1, v0: 2, v1: 3, a0: 4, a1: 5, a2: 6, a3: 7,
  t0: 8, t1: 9, t2: 10, t3: 11, t4: 12, t5: 13, t6: 14, t7: 15,
  s0: 16, s1: 17, s2: 18, s3: 19, s4: 20, s5: 21, s6: 22, s7: 23,
  t8: 24, t9: 25, sp: 29, ra: 31,
});

const imm16 = (v) => v & 0xffff;
const iType = (op, rs, rt, imm) => ((op << 26) | (rs << 21) | (rt << 16) | imm16(imm)) >>> 0;
const rType = (rs, rt, rd, sh, fn) => ((rs << 21) | (rt << 16) | (rd << 11) | (sh << 6) | fn) >>> 0;

export class Asm {
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
    if (name in this.labels) throw new Error(`duplicate label ${name}`);
    this.labels[name] = this.pc;
  }
  emit(w) {
    this.words.push(w >>> 0);
  }
  nop() { this.emit(0); }
  lui(rt, imm) { this.emit(iType(0x0f, 0, rt, imm)); }
  ori(rt, rs, imm) { this.emit(iType(0x0d, rs, rt, imm)); }
  andi(rt, rs, imm) { this.emit(iType(0x0c, rs, rt, imm)); }
  xori(rt, rs, imm) { this.emit(iType(0x0e, rs, rt, imm)); }
  addiu(rt, rs, imm) { this.emit(iType(0x09, rs, rt, imm)); }
  sltiu(rt, rs, imm) { this.emit(iType(0x0b, rs, rt, imm)); }
  lbu(rt, off, base) { this.emit(iType(0x24, base, rt, off)); }
  lhu(rt, off, base) { this.emit(iType(0x25, base, rt, off)); }
  lw(rt, off, base) { this.emit(iType(0x23, base, rt, off)); }
  sb(rt, off, base) { this.emit(iType(0x28, base, rt, off)); }
  sh(rt, off, base) { this.emit(iType(0x29, base, rt, off)); }
  sw(rt, off, base) { this.emit(iType(0x2b, base, rt, off)); }
  sll(rd, rt, sh) { this.emit(rType(0, rt, rd, sh, 0x00)); }
  srl(rd, rt, sh) { this.emit(rType(0, rt, rd, sh, 0x02)); }
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

/** Wrap assembled code in a PS-X EXE image that loads and starts at `loadAddr`. */
export function psxExe(text, { loadAddr, stackTop }) {
  const tSize = Math.ceil(text.length / 0x800) * 0x800;
  const exe = Buffer.alloc(0x800 + tSize);
  exe.write('PS-X EXE', 0, 'latin1');
  exe.writeUInt32LE(loadAddr, 0x10); // pc0
  exe.writeUInt32LE(0, 0x14); // gp0
  exe.writeUInt32LE(loadAddr, 0x18); // t_addr
  exe.writeUInt32LE(tSize, 0x1c); // t_size
  exe.writeUInt32LE(stackTop, 0x30); // s_addr
  text.copy(exe, 0x800);
  return exe;
}

// --- shared PS1 hardware snippets -----------------------------------------
export const IO_HI = 0x1f80; // upper half of 0x1F800000 (I/O registers)
export const IO = Object.freeze({
  JOY_DATA: 0x1040, JOY_STAT: 0x1044, JOY_MODE: 0x1048, JOY_CTRL: 0x104a, JOY_BAUD: 0x104e,
  I_STAT: 0x1070, I_MASK: 0x1074, GP0: 0x1810, GP1: 0x1814,
});

/** Interrupts off, and load 0x1F800000 into `io`. */
export function emitInterruptsOff(a, io) {
  a.mtc0(R.zero, 12); // COP0 SR = 0: interrupts off, so nothing else acks VBLANK
  a.lui(io, IO_HI);
  a.sw(R.zero, IO.I_MASK, io);
}

/** A 320x240 15-bit display with drawing allowed. `io` holds 0x1F800000. */
export function emitDisplaySetup(a, io, scratch) {
  for (const cmd of [
    0x00000000, // GP1(00) reset
    0x06c60260, // GP1(06) horizontal display range
    0x07040010, // GP1(07) vertical display range
    0x05000000, // GP1(05) display start 0,0
    0x08000001, // GP1(08) 320x240, NTSC, 15-bit
    0x03000000, // GP1(03) display on
  ]) {
    a.li(scratch, cmd);
    a.sw(scratch, IO.GP1, io);
  }
  for (const cmd of [
    0xe1000400, // draw mode: drawing to the display area allowed
    0xe3000000, // drawing area top-left 0,0
    0xe403bd3f, // drawing area bottom-right 319,239
    0xe5000000, // drawing offset 0,0
  ]) {
    a.li(scratch, cmd);
    a.sw(scratch, IO.GP0, io);
  }
}

/** Busy-wait for VBLANK in I_STAT and acknowledge it. */
export function emitWaitVblank(a, io, scratch, ackReg, label) {
  a.label(label);
  a.lw(scratch, IO.I_STAT, io);
  a.nop(); // load delay slot
  a.andi(scratch, scratch, 1);
  a.beq(scratch, R.zero, label);
  a.nop(); // branch delay slot
  a.addiu(ackReg, R.zero, -2);
  a.sw(ackReg, IO.I_STAT, io); // ack VBLANK only
}

/**
 * Fill the screen with a colour holding the low 15 bits of `value`: bits 0-4
 * red, 5-9 green, 10-14 blue, each in the top 5 bits of its byte (the GPU
 * keeps those in 15-bit mode). Clobbers t1, t6, t7.
 */
export function emitFillFromBits(a, io, value) {
  const { t1, t6, t7, zero } = R;
  a.sll(t6, value, 3);
  a.andi(t6, t6, 0x00f8);
  a.sll(t7, value, 6);
  a.andi(t7, t7, 0xf800);
  a.or(t6, t6, t7);
  a.sll(t7, value, 9);
  a.li(t1, 0x00f80000);
  a.and(t7, t7, t1);
  a.or(t6, t6, t7);
  a.lui(t7, 0x0200); // GP0(02) fill rectangle
  a.or(t6, t6, t7);
  a.sw(t6, IO.GP0, io);
  a.sw(zero, IO.GP0, io); // x=0, y=0
  a.li(t7, 0x00f00140); // h=240, w=320
  a.sw(t7, IO.GP0, io);
}
