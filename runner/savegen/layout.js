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
//   decomp - Xeeynamo/ff7-decomp @ 9411173 (reference only, no code copied):
//           include/game.h (SaveWork, SaveHeader layouts) and the values the
//           game itself stores (src/main/110B8.c, src/main/cd.c, src/pc/main.c,
//           src/menu/title.c), read for facts (#38)
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
  previewNameEnd: { offset: 0x0008, type: 'u8', source: 'decomp SaveHeader.leader_name (FF Text; 0xFF ends a string: wiki FF_Text)' },
  previewPlaceEnd: { offset: 0x0028, type: 'u8', source: 'decomp SaveHeader.place_name (FF Text; 0xFF ends a string)' },
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
  moduleAux: { offset: 0x0b90, type: 'u32', source: 'decomp SaveWork.worldmap_exit_action (InitWorldFromSavemap stores 0 in a field, 2 on the world map; the wiki says the opposite, #38)' },
  module: { offset: 0x0b94, type: 'u16', source: 'wiki (1 = field, 3 = world map); decomp InitFieldFromSavemap copies it into g_GameState, so a minigame state (6-14, include/game.h) starts that minigame (#80)' },
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
/**
 * worldmap_exit_action value that goes with MODULE_FIELD (0x0B90). The
 * game's own save code (decomp src/main/110B8.c InitWorldFromSavemap) stores
 * 0 when the game state is not the world map, 2 when it is; the wiki's
 * "2 when the module is 1" was the generator's first guess (#32), replaced
 * in #38.
 */
export const MODULE_AUX_FIELD = 0;
/** FF Text end-of-string byte (wiki FF_Text), for the empty preview strings. */
export const FF_TEXT_END = 0xff;

/** Save memory bank n (1-5) starts here (mem, wiki): 0x0BA4 + 0x100 (n-1). */
export const BANK_BASE = 0x0ba4;
export const BANK_SIZE = 0x100;

/**
 * The checksum covers savemap[CHECKSUM_START, SAVEMAP_SIZE): decomp
 * src/menu/title.c checks Savemap.header.checksum against
 * SaveCalcChecksum(sizeof(SaveWork) - 4, &leader_level), i.e. 0x10F0 bytes
 * from 0x0004, compared as a u16 (#38; it was a hypothesis in #32).
 */
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
  iconFlag: 0x02, // 0x11: low 2 bits = icon frames (core); the 0x10 nibble is hyp
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
 * SCUS-94163, then "FF7-Snn". decomp src/menu/savemenu.c GetSaveSlotMask:
 * "bit N set when BASCUS-94163FF7-S(N+1) is present" (the game lists only
 * these names). To be confirmed by a Tier 2 scenario (#38).
 */
export const fileName = (slot) => `BASCUS-94163FF7-S${String(slot).padStart(2, '0')}`;
