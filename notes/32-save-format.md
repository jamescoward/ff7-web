# #32: FF7 save format, as used by the save generator

This lists every offset `runner/savegen/` writes, with its source and how sure we are. The categories follow `CLAUDE.md`: **source** means a public document says so; **hypothesis** means no reachable public source states it, so a Tier 2 scenario must confirm it (the game has to accept the card).

No code from save editors or decompilations was used or read. ff7tk was read only as API documentation.

## Sources

| Key | Source | Version read |
|---|---|---|
| wiki | ff7-flat-wiki, "Savemap": <https://ff7-mods.github.io/ff7-flat-wiki/FF7/Savemap.html> | repo `ff7-mods/ff7-flat-wiki` @ `638936503b1c` (2025-02-03) |
| mem | ff7-flat-wiki, "Kernel/Memory_management" (same repo) | same |
| core | PCSX ReARMed `libpcsxcore/sio.c`, `GetMcdBlockInfo()`: how the emulator reads card blocks and directory entries | the pinned commit in `core/pins.env` (`7b0e8f8f`) |
| ff7tk | ff7tk API docs, `FF7SaveInfo`: <https://sithlord48.github.io/ff7tk/classFF7SaveInfo.html> | fetched 2026-11-04 |

Unreachable from agent sessions: the qhimm forum post the wiki links for the checksum (`forums.qhimm.com/index.php?topic=4211.msg60545`), the Wayback Machine, and psx-spx (the usual PS1 memory card reference). All three get a 403 from the proxy, or DNS fails.

## Savemap (0x10F4 = 4340 bytes; wiki, mem)

PS1 byte order is little-endian (MIPS R3000A). The wiki marks the field X/Y as signed.

| Offset | Type | Meaning | Written from | Source |
|---|---|---|---|---|
| 0x0000 | u32 (lower 16 bits used) | checksum | computed | wiki; algorithm is a **hypothesis**, below |
| 0x0005–0x0007 | u8 ×3 | preview portraits 1–3 | `party` | wiki |
| 0x0020 | u32 | preview gil | `gil` | wiki |
| 0x0024 | u32 | preview seconds played | `seconds` | wiki |
| 0x04F8–0x04FA | u8 ×3 | party slots (IDs 0x00–0x0B, 0xFF = none) | `party` | wiki |
| 0x0B7C | u32 | gil | `gil` | wiki |
| 0x0B80 | u32 | total seconds played | `seconds` | wiki |
| 0x0B90 | u8 (low byte of a u32) | z_4[8]: 2 when the module is 1 (field), 0 when 3 | constant 2 | wiki |
| 0x0B94 | u16 | current module: 1 = field, 3 = world map | constant 1 | wiki |
| 0x0B96 | u16 | current location (field ID) | `field.id` | wiki |
| 0x0B9A | s16 | field X | `field.x` | wiki |
| 0x0B9C | s16 | field Y | `field.y` | wiki |
| 0x0B9E | u16 | walkmesh triangle | `field.triangle` | wiki |
| 0x0BA0 | u8 | facing direction | `field.direction` | wiki |
| 0x0BA4 | u16 | main progress variable (bank 1, offset 0) | `progress` | wiki |
| 0x0BB4–0x0BB6 | u8 ×3 | game timer hours, minutes, seconds | `seconds` | wiki |
| 0x0BA4 + 0x100·(n−1) + k | u8 / u16 | save memory bank n (1–5), byte k | `vars[]` | mem (banks 1/2, 3/4, B/C, D/E, 7/F) |

Bytes the description does not name keep the baseline's value. `vars` may not overlap one another or any fixed field: the generator rejects the description.

The preview fields at 0x0004–0x0053 only affect the load menu (wiki: "changing these values does not change any in-game values"). The generator mirrors party, gil and seconds into them so the menu agrees with the game state. It leaves the preview name, HP/MP, level and location text as they are in the baseline. Those are FF Text strings and stats, and a description may hold no free text.

Field IDs are listed in the wiki's `FF7/Field/Field_ID` page (0x0000–0x0312). `harness/saves/example-field.json` uses 116 (0x0074) as an arbitrary example. Its position and triangle are placeholders, not a checked valid spot.

## Checksum (hypothesis)

- **Source:** the wiki says the slot is a DWord at 0x0000 and that only the lower word is stored. It links the algorithm to a forum post we cannot reach.
- **Hypothesis:** the implementation follows the commonly described algorithm. It is a 16-bit CRC with polynomial 0x1021, initial value 0xFFFF, non-reflected (MSB first), and final XOR 0xFFFF, which is CRC-16/GENIBUS in the CRC catalogue. It covers savemap bytes 0x0004 to 0x10F3 (4336 bytes) and is stored little-endian, with the upper word zero.
- **Vectors used in the test (numbers, not saves):**
  - the CRC catalogue's check value for ASCII `"123456789"`: 0xD64E;
  - derived: empty input gives 0x0000; `[0x00]` gives 0xE1F0 XOR 0xFFFF = 0x1E0F (0xE1F0 is the CRC-16/CCITT-FALSE value of a single zero byte, and GENIBUS is CCITT-FALSE with the result inverted).
- **To confirm:** a Tier 2 scenario (#37/#38) must load a generated card in the game. If the game reports the save as corrupted, the checksum or its range is wrong.

## Memory card (PS1, 128 KiB)

16 blocks of 8 KiB. Block 0 holds frame 0 (header), frames 1–15 (directory) and frames 16–35 (broken-sector list), each 128 bytes, ending in the XOR of the first 127 bytes. The blank card comes from `runner/synth/blank-card.js` (#31), and `web/js/memcard.js` accepts it.

**Directory frame n** (describes block n):

| Offset | Value | Source |
|---|---|---|
| +0x00 | u32 0x51: in use, first (and only) block | core reads the flags byte at +0; ff7tk `BLOCK_INUSE` = 0x51, `BLOCK_EMPTY` = 0xA0 |
| +0x04 | u32 0x2000: file size | **hypothesis** (the standard layout) |
| +0x08 | u16 0xFFFF: no next block | **hypothesis**; agrees with `blankCard()` |
| +0x0A | `BASCUS-94163FF7-Snn` + NUL | core reads a 12-character ID at +0x0A and a name at +0x16. The region `BA` + product code `SCUS-94163` (USA disc 1) + `FF7-Snn` is a **hypothesis**: the game probably lists only names it recognises |
| +0x7F | XOR checksum | as above |

**Save block** (wiki: "PSX header is 512 bytes, checksum @ 0x200"):

| Offset | Value | Source |
|---|---|---|
| 0x000 | `SC` | **hypothesis** (standard PS1 header magic) |
| 0x002 | 0x11: static icon, 1 frame | core (`IconCount = flag & 3`) |
| 0x003 | 1: block count | **hypothesis** |
| 0x004 | title: 32 two-byte Shift-JIS characters | core (big-endian pairs; it maps full-width letters and digits back to ASCII) |
| 0x060 | 16-colour palette: all zero | core |
| 0x080 | icon frames: all zero (a blank, original icon) | core |
| 0x200 | the savemap (0x10F4 bytes) | wiki |
| 0x12F4–0x1FFF | zero | the generator's own choice |

The label (`[A-Za-z0-9 .-]`, at most 24 characters) is written as full-width Shift-JIS: A–Z → 0x8260+, a–z → 0x8281+, 0–9 → 0x824F+, space 0x8140, `.` 0x8144, `-` 0x817C. This matches the core's own conversion table.

## No game bytes

`runner/test/unit/savegen.test.js` runs the generator on two different synthetic patterns. Every card byte is classified:

- **savemap, not written:** must equal the pattern;
- **written:** must equal the hand-written expected value and must not depend on the pattern;
- **checksum:** 4 bytes;
- **everything else:** must not depend on the pattern, and equals the blank card, the checked header, the checked directory entry, or zero.

It also checks that the generator sources contain no base64 or long byte tables. Generated cards are only ever held in memory; none is written to the repo.
