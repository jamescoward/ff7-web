// FF7 (PS1) savemap and memory card layout, as data. Original project code,
// GPL-2.0-or-later.
//
// Every entry names its source; the full list with links and the reasoning
// is in notes/32-save-format.md. Sources:
//   wiki  - ff7-flat-wiki "Savemap" page (ff7-mods/ff7-flat-wiki @ 6389365),
//           https://ff7-mods.github.io/ff7-flat-wiki/FF7/Savemap.html
//   mem   - ff7-flat-wiki "Kernel/Memory_management" (same commit)
//   core  - the pinned PCSX ReARMed core, libpcsxcore/sio.c GetMcdBlockInfo()
//           (core/pins.env), which reads the PS1 card format
//   ff7tk - ff7tk API documentation, FF7SaveInfo (sithlord48.github.io/ff7tk),
//           read as documentation only
//   hyp   - not found in a reachable public source; stated in the notes and
//           to be confirmed by a Tier 2 scenario (the game must accept it)
// No code from save editors or decompilations is used.

/** Size of the savemap (wiki, mem: 0x10F4 = 4340 bytes). */
export const SAVEMAP_SIZE = 0x10f4;

/**
 * Savemap fields the generator writes. Little-endian (the PS1's R3000A is
 * little-endian; the wiki marks 16-bit X/Y as signed).
 */
export const SAVEMAP = Object.freeze({
  checksum: { offset: 0x0000, type: 'u32', source: 'wiki (lower word used)' },
  previewPortrait1: { offset: 0x0005, type: 'u8', source: 'wiki' },
  previewPortrait2: { offset: 0x0006, type: 'u8', source: 'wiki' },
  previewPortrait3: { offset: 0x0007, type: 'u8', source: 'wiki' },
  previewGil: { offset: 0x0020, type: 'u32', source: 'wiki' },
  previewSeconds: { offset: 0x0024, type: 'u32', source: 'wiki' },
  party1: { offset: 0x04f8, type: 'u8', source: 'wiki' },
  party2: { offset: 0x04f9, type: 'u8', source: 'wiki' },
  party3: { offset: 0x04fa, type: 'u8', source: 'wiki' },
  gil: { offset: 0x0b7c, type: 'u32', source: 'wiki' },
  seconds: { offset: 0x0b80, type: 'u32', source: 'wiki' },
  moduleAux: { offset: 0x0b90, type: 'u8', source: 'wiki (z_4[8], low byte; 2 when module is field)' },
  module: { offset: 0x0b94, type: 'u16', source: 'wiki (1 = field, 3 = world map)' },
  fieldId: { offset: 0x0b96, type: 'u16', source: 'wiki (current location)' },
  fieldX: { offset: 0x0b9a, type: 's16', source: 'wiki' },
  fieldY: { offset: 0x0b9c, type: 's16', source: 'wiki' },
  fieldTriangle: { offset: 0x0b9e, type: 'u16', source: 'wiki' },
  fieldDirection: { offset: 0x0ba0, type: 'u8', source: 'wiki' },
  progress: { offset: 0x0ba4, type: 'u16', source: 'wiki (main progress variable, bank 1 offset 0)' },
  timerHours: { offset: 0x0bb4, type: 'u8', source: 'wiki' },
  timerMinutes: { offset: 0x0bb5, type: 'u8', source: 'wiki' },
  timerSeconds: { offset: 0x0bb6, type: 'u8', source: 'wiki' },
});

/** Module values (wiki, 0x0B94). */
export const MODULE_FIELD = 1;
/** z_4[8] value that goes with MODULE_FIELD (wiki, 0x0B90). */
export const MODULE_AUX_FIELD = 2;

/** Save memory bank n (1-5) starts here (mem, wiki): 0x0BA4 + 0x100 (n-1). */
export const BANK_BASE = 0x0ba4;
export const BANK_SIZE = 0x100;

/** The checksum covers savemap[CHECKSUM_START, SAVEMAP_SIZE) (hyp). */
export const CHECKSUM_START = 0x0004;

export const TYPE_SIZE = Object.freeze({ u8: 1, u16: 2, s16: 2, u32: 4 });

// ---- PS1 memory card (128 KiB, 16 blocks of 8 KiB, 128-byte frames) ----

export const CARD_SIZE = 0x20000;
export const BLOCK_SIZE = 0x2000;
export const FRAME_SIZE = 0x80;

/**
 * Save block header, frame 0 of the block (core: icon flag at +2, title at
 * +4 as 2-byte Shift-JIS characters, palette at +0x60, icon frames from
 * +0x80). The "SC" magic and the block count at +3 are the standard PS1
 * header (hyp: not in a reachable source; checked by the BIOS and game).
 */
export const BLOCK_HEADER = Object.freeze({
  magic: 0x00, // 'S', 'C'
  iconFlag: 0x02, // 0x11: static icon, 1 frame (low 2 bits = icon frames, core)
  blockCount: 0x03,
  title: 0x04, // 64 bytes: 32 Shift-JIS characters
  titleBytes: 64,
  palette: 0x60, // 16 x u16
  icon: 0x80, // 16x16 x 4 bpp = 128 bytes per frame
});
export const ICON_FLAG_STATIC_1 = 0x11;

/** FF7's PS1 slot header is 512 bytes; the savemap follows (wiki). */
export const SAVEMAP_IN_BLOCK = 0x200;

/**
 * Directory frame n (1-15) describes block n (core: state at +0, file name
 * at +0x0A; ff7tk: state values). Size at +4 and next-block at +8 are the
 * standard layout (hyp), and agree with web/js/memcard.js blankCard().
 */
export const DIR = Object.freeze({
  state: 0x00, // u32
  size: 0x04, // u32
  next: 0x08, // u16, 0xFFFF = none
  name: 0x0a, // up to 20 ASCII bytes + NUL
});
export const DIR_IN_USE_FIRST = 0x51; // ff7tk BLOCK_INUSE
export const DIR_FREE = 0xa0; // ff7tk BLOCK_EMPTY

/**
 * Directory file name of FF7 (USA, disc 1) save n: region "BA", product code
 * SCUS-94163, then "FF7-Snn" (hyp: the game lists only files it recognises,
 * so a Tier 2 scenario must confirm it).
 */
export const fileName = (slot) => `BASCUS-94163FF7-S${String(slot).padStart(2, '0')}`;
