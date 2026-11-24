// BIN-GZIP archives (#38, moved here for #260 part 2): split INIT/KERNEL.BIN
// into its gzip sections. Pure functions; no DOM, Worker, Node or timer
// dependencies (platform-neutral rule, CLAUDE.md). Decompression is the
// caller's: node:zlib in the runner, DecompressionStream in the browser.
// Original project code, GPL-2.0-or-later.
//
// No game bytes are in this file: it holds the archive layout only.
//
// Sources (facts only, no code copied):
//   wiki   ff7-flat-wiki @ 6389365: "Kernel/Kernel.bin" (PSX path
//          INIT/KERNEL.BIN, 27 gzip sections), "Kernel/Low_level_libraries"
//          (BIN-GZIP archive: per section u16 packed length, u16 unpacked
//          length, u16 file type, then the gzip data).

export class BinGzipError extends Error {}

/** Disc path of the kernel archive on the PSX disc (wiki). */
export const KERNEL_PATH = 'INIT/KERNEL.BIN';
/** BIN-GZIP section header: u16 packed length, u16 unpacked length, u16 file type (wiki). */
export const SECTION_HEADER = 6;
/** Largest archive read; KERNEL.BIN is far smaller. */
export const MAX_ARCHIVE_BYTES = 1024 * 1024;

/**
 * Split a BIN-GZIP archive into its sections: [{ type, packed, unpacked,
 * offset }], where offset is the start of the section's gzip data. Throws
 * BinGzipError on a truncated or malformed archive.
 */
export function parseBinGzip(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new BinGzipError('the archive must be a Uint8Array');
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new BinGzipError('the archive is too large');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sections = [];
  let o = 0;
  while (o < bytes.length) {
    // Zero bytes after the last section (padding to a sector) end the list.
    if (bytes.subarray(o).every((b) => b === 0)) break;
    if (o + SECTION_HEADER > bytes.length) throw new BinGzipError(`truncated section header at 0x${o.toString(16)}`);
    const packed = view.getUint16(o, true);
    const unpacked = view.getUint16(o + 2, true);
    const type = view.getUint16(o + 4, true);
    const offset = o + SECTION_HEADER;
    if (packed === 0) throw new BinGzipError(`empty section at 0x${o.toString(16)}`);
    if (offset + packed > bytes.length) throw new BinGzipError(`section at 0x${o.toString(16)} runs past the end`);
    sections.push({ type, packed, unpacked, offset });
    o = offset + packed;
  }
  return sections;
}

/** The gzip bytes of one section ({ offset, packed } from parseBinGzip), as a view into the archive. */
export function sectionGzip(bytes, sec) {
  return bytes.subarray(sec.offset, sec.offset + sec.packed);
}
