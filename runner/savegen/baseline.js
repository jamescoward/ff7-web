// The baseline savemap for generated saves: the state a New Game starts
// from, rebuilt at test time from the disc's own initialization data (#38).
// Original project code, GPL-2.0-or-later.
//
// Only the Tier 2 sandbox runs this on the real disc; nothing it reads
// leaves the sandbox (docs/SECURITY.md, "Generated save boot points"). Tier 1
// tests run it on a synthetic KERNEL.BIN built from the documented
// structure. No game bytes are in this file: it holds the archive layout,
// and the offsets and values a New Game stores, each with its source.
//
// Sources (facts only, no code copied):
//   wiki   ff7-flat-wiki @ 6389365: "Kernel/Kernel.bin" (PSX path
//          INIT/KERNEL.BIN, 27 gzip sections), "Kernel/Low_level_libraries"
//          (BIN-GZIP archive: per section u16 packed length, u16 unpacked
//          length, u16 file type, then the gzip data), "Character_starting_
//          stats" (section 4, "Initialization data", is copied into the
//          savemap on New Game).
//   decomp Xeeynamo/ff7-decomp @ 9411173 (reference only): src/main/btlinit.c
//          (the New Game path decompresses the section of file type
//          KERNEL_INIT = 3 to &Savemap.party, savemap 0x0054),
//          src/main/110B8.c main() (order: config defaults, savemap reset,
//          kernel copy, config defaults, savemap reset, SysInitNewGame),
//          src/pc/main.c func_80026258 (config defaults), src/main/cd.c
//          SysSavemapReset, src/main/110B8.c SysInitNewGame, and
//          include/game.h SaveWork for the offsets.

import { constants as zlibConstants, gunzipSync, inflateRawSync } from 'node:zlib';

import { openDisc } from '../disc.js';
import { SAVEMAP_SIZE } from './layout.js';

/** Disc path of the kernel archive on the PSX disc (wiki). */
export const KERNEL_PATH = 'INIT/KERNEL.BIN';
/** BIN-GZIP section header: u16 packed length, u16 unpacked length, u16 file type (wiki). */
export const SECTION_HEADER = 6;
/** File type of the initialization data section (decomp KERNEL_INIT; the wiki's section 4). */
export const KERNEL_INIT_TYPE = 3;
/** Where the initialization data goes in the savemap: &Savemap.party (decomp). */
export const INIT_OFFSET = 0x0054;
/** Largest archive read; KERNEL.BIN is far smaller. */
const MAX_ARCHIVE_BYTES = 1024 * 1024;

export class BaselineError extends Error {}

/**
 * Split a BIN-GZIP archive into its sections: [{ type, packed, unpacked,
 * offset }], where offset is the start of the section's gzip data. Throws
 * BaselineError on a truncated or malformed archive.
 */
export function parseBinGzip(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new BaselineError('the archive must be a Uint8Array');
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new BaselineError('the archive is too large');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sections = [];
  let o = 0;
  while (o < bytes.length) {
    if (o + SECTION_HEADER > bytes.length) throw new BaselineError(`truncated section header at 0x${o.toString(16)}`);
    const packed = view.getUint16(o, true);
    const unpacked = view.getUint16(o + 2, true);
    const type = view.getUint16(o + 4, true);
    const offset = o + SECTION_HEADER;
    if (packed === 0) throw new BaselineError(`empty section at 0x${o.toString(16)}`);
    if (offset + packed > bytes.length) throw new BaselineError(`section at 0x${o.toString(16)} runs past the end`);
    sections.push({ type, packed, unpacked, offset });
    o = offset + packed;
  }
  return sections;
}

/**
 * The initialization data: the first section of file type KERNEL_INIT_TYPE,
 * decompressed. Throws BaselineError if there is none, it does not
 * decompress, its length is not the header's, or it does not fit the
 * savemap from INIT_OFFSET.
 */
export function initData(kernel) {
  const sec = parseBinGzip(kernel).find((s) => s.type === KERNEL_INIT_TYPE);
  if (!sec) throw new BaselineError(`no section of file type ${KERNEL_INIT_TYPE}`);
  const gz = kernel.subarray(sec.offset, sec.offset + sec.packed);
  let data;
  try {
    data = new Uint8Array(gunzipSync(gz));
  } catch (e) {
    // A gzip member whose trailer does not check out: inflate the deflate
    // stream after a plain 10-byte header (flags 0, as the wiki shows), and
    // let the length check below decide.
    if (gz.length < 10 || gz[0] !== 0x1f || gz[1] !== 0x8b || gz[2] !== 8 || gz[3] !== 0) {
      throw new BaselineError(`the initialization data is not gzip data (${e.code ?? e.message})`);
    }
    try {
      data = new Uint8Array(inflateRawSync(gz.subarray(10), { finishFlush: zlibConstants.Z_SYNC_FLUSH }));
    } catch (e2) {
      throw new BaselineError(`the initialization data does not decompress (${e2.code ?? e2.message})`);
    }
  }
  if (data.length !== sec.unpacked) throw new BaselineError('the initialization data is not the length its header gives');
  if (data.length === 0 || INIT_OFFSET + data.length > SAVEMAP_SIZE) {
    throw new BaselineError('the initialization data does not fit the savemap');
  }
  return data;
}

// What a New Game stores around the kernel copy, as [offset, type, value]
// in savemap order of application (decomp; offsets from include/game.h
// SaveWork). The last pass wins, as in the game.
const BANK1 = 0x0ba4;
const BANK2 = 0x0ca4;
const BANK4 = 0x0ea4;
/** func_80026258: battle speed, battle message speed, field message speed, config, button map 0..15. */
const CONFIG_DEFAULTS = [
  [0x10d8, 'u8', 128],
  [0x10d9, 'u8', 128],
  [0x10ec, 'u8', 128],
  [0x10da, 'u16', 0x41],
  ...Array.from({ length: 16 }, (_, i) => [0x10dc + i, 'u8', i]),
];
/** SysSavemapReset (after the banks 1-5 are zeroed). */
const RESET = [
  [0x04f8, 'u8', 0x00], [0x04f9, 'u8', 0xff], [0x04fa, 'u8', 0xff], // partyID: Cloud, none, none
  [BANK2 + 9, 'u8', 0x00], [BANK2 + 10, 'u8', 0xff], [BANK2 + 11, 'u8', 0xff],
  [0x10a6, 'u16', 1], // phs_visibility_mask: only Cloud
  [BANK4 + 0x68, 'u8', 0xff], // start of the location name: empty FF Text
  [BANK1 + 0x1c, 'u8', 0xff], [BANK1 + 0x1d, 'u8', 0xff], // menu visibility
  [0x0b80, 'u32', 0], // time
  [0x0b84, 'u32', 0], // countdown timer
];
/** SysInitNewGame. */
const NEW_GAME = [
  [BANK4, 'u8', 1], // memory_bank_4[0]: the disc the save is for; the game asks for that disc when it differs
  [0x0b90, 'u32', 0], // worldmap_exit_action
  [0x0b94, 'u16', 1], // current_module: field
  [0x0b96, 'u16', 0x74], // current_location_id: md1stin
  [0x0b9a, 'u16', 0], [0x0b9c, 'u16', 0], [0x0b9e, 'u16', 0], // field x, y, triangle
  [0x0ba0, 'u8', 0], [0x0ba1, 'u8', 0], [0x0ba2, 'u8', 0], // direction, step id, step offset
];
const BANKS = [BANK1, BANK1 + 5 * 0x100]; // memory_bank_1..5, zeroed by SysSavemapReset

function store(view, [offset, type, value]) {
  if (type === 'u8') view.setUint8(offset, value);
  else if (type === 'u16') view.setUint16(offset, value, true);
  else view.setUint32(offset, value, true);
}

/**
 * The savemap a New Game starts from, given the initialization data: zero,
 * then the game's steps in its order. Returns a new Uint8Array(SAVEMAP_SIZE).
 */
export function newGameSavemap(init) {
  if (!(init instanceof Uint8Array) || init.length === 0 || INIT_OFFSET + init.length > SAVEMAP_SIZE) {
    throw new BaselineError('the initialization data does not fit the savemap');
  }
  const savemap = new Uint8Array(SAVEMAP_SIZE);
  const view = new DataView(savemap.buffer);
  const reset = () => {
    savemap.fill(0, BANKS[0], BANKS[1]);
    RESET.forEach((w) => store(view, w));
  };
  CONFIG_DEFAULTS.forEach((w) => store(view, w));
  reset();
  savemap.set(init, INIT_OFFSET);
  CONFIG_DEFAULTS.forEach((w) => store(view, w));
  reset();
  NEW_GAME.forEach((w) => store(view, w));
  return savemap;
}

/** The New Game baseline from a KERNEL.BIN archive's bytes. */
export const baselineFromKernel = (kernel) => newGameSavemap(initData(kernel));

/**
 * The New Game baseline from a disc image (disc.js openDisc: a .bin, .iso
 * or .cue). Throws DiscError if the disc or the file can't be read, and
 * BaselineError if the archive is not what the documentation describes.
 */
export function baselineFromDisc(discFile) {
  const disc = openDisc(discFile);
  try {
    const kernel = disc.read(KERNEL_PATH);
    return baselineFromKernel(new Uint8Array(kernel.buffer, kernel.byteOffset, kernel.byteLength));
  } finally {
    disc.close();
  }
}
