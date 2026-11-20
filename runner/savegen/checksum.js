// FF7 savemap checksum. Original project code, GPL-2.0-or-later.
//
// The wiki (Savemap, offset 0x0000) says the checksum is a 32-bit slot whose
// lower 16 bits hold the value, and links the algorithm to a forum post that
// is not reachable from agent sessions. What is implemented here is a
// HYPOTHESIS, written from the common description of the algorithm (see
// notes/32-save-format.md): a 16-bit CRC, polynomial 0x1021, initial value
// 0xFFFF, bits processed most-significant first, no reflection, result
// inverted (XOR 0xFFFF), over savemap bytes 0x0004 to the end. In CRC
// catalogue terms this is CRC-16/GENIBUS. The unit test checks it against
// that catalogue's published check value. Tier 2: the game accepts saves
// generated with it (#38, save-boot-1), and after an in-game save the
// rewritten slot reads back right with it (#226, save-boot-20a:
// savegen/read.js). That the game rewrote the savemap bytes, not only the
// directory entry, is very likely but not separately measured.

import { CHECKSUM_START, SAVEMAP_SIZE } from './layout.js';

/** CRC-16/GENIBUS of `bytes`. */
export function crc16Genibus(bytes) {
  let r = 0xffff;
  for (let i = 0; i < bytes.length; i++) {
    r ^= bytes[i] << 8;
    for (let b = 0; b < 8; b++) r = r & 0x8000 ? ((r << 1) ^ 0x1021) & 0xffff : (r << 1) & 0xffff;
  }
  return r ^ 0xffff;
}

/** The checksum of a savemap (bytes 0x0004 to the end). */
export function savemapChecksum(savemap) {
  if (savemap.length !== SAVEMAP_SIZE) throw new Error(`a savemap is ${SAVEMAP_SIZE} bytes, not ${savemap.length}`);
  return crc16Genibus(savemap.subarray(CHECKSUM_START));
}
