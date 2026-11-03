// PS1 main-RAM address mapping for the backend's readMem / writeMem.
//
// Accepted addresses are the three CPU views of the 2 MB main RAM:
//   KUSEG 0x00000000–0x001FFFFF, KSEG0 0x80000000–0x801FFFFF,
//   KSEG1 0xA0000000–0xA01FFFFF.
// The RAM mirrors at 0x00200000–0x007FFFFF, scratchpad and I/O are rejected:
// the semantic layer works with KSEG0 addresses, and anything else is a bug.

export const RAM_SIZE = 0x200000;
const SEGMENTS = [0x00000000, 0x80000000, 0xa0000000];

/** Map a PS1 address range to an offset into main RAM, or throw RangeError. */
export function ramOffset(addr, len = 1) {
  if (!Number.isInteger(addr) || addr < 0 || addr > 0xffffffff) {
    throw new RangeError(`address must be a 32-bit unsigned integer, got ${addr}`);
  }
  if (!Number.isInteger(len) || len < 1) {
    throw new RangeError(`length must be a positive integer, got ${len}`);
  }
  for (const base of SEGMENTS) {
    const off = addr - base;
    if (off >= 0 && off < RAM_SIZE) {
      if (off + len > RAM_SIZE) {
        throw new RangeError(`range 0x${hex32(addr)}+${len} runs past the end of RAM`);
      }
      return off;
    }
  }
  throw new RangeError(`0x${hex32(addr)} is not a main-RAM address`);
}

export function hex32(n) {
  return (n >>> 0).toString(16).padStart(8, '0');
}
