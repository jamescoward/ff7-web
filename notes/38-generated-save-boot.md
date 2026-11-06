# #38: boot from a generated save

Status (2026-11-06): done. Attempt 2 (`2e61c73`) passed 32/32 Tier 2 scenarios, both save-boot scenarios included. Attempts used: 2 of 3.

## Sources (reference only; no code copied)
- **Xeeynamo/ff7-decomp @ `9411173034bde2ae4c9b0312167e79c3645ca1be`**, read for addresses, layouts and the values the game stores:
  - `src/main/btlinit.c`: on New Game the game decompresses the KERNEL.BIN section of file type `KERNEL_INIT` (3) to `&Savemap.party` (savemap 0x0054).
  - `src/main/110B8.c`:
    - `main()` gives the New Game order: config defaults, savemap reset, kernel copy, config defaults, savemap reset, `SysInitNewGame`. The main loop asks for disc `memory_bank_4[0]` when it differs from the inserted disc.
    - `SysInitNewGame` stores bank 4 byte 0 = 1, the field module, location 0x74, and x/y/triangle 0.
    - `InitFieldFromSavemap`: a loaded save sets `g_GameState`, `g_FieldCurrentMap` and the player position from the savemap.
    - `InitWorldFromSavemap`: a save made in a field stores `worldmap_exit_action` = 0.
  - `src/pc/main.c` `func_80026258` (the config defaults) and `src/main/cd.c` `SysSavemapReset`.
  - `src/field/field_entity.c` `FieldEntityInitPos`: if the saved X is 0x7FFF, the player is placed at the centroid of the saved triangle; otherwise PosX/PosY = saved X/Y << 12.
  - `src/menu/title.c` and `savemenu.h` give the title menu:
    - the cursor starts on Continue (`TitleInit` sets row 1);
    - the modes are 7 title, 0 slot, 2/3 reading the card, 1 file list, 4 loading;
    - a bad checksum shows "file ruined" and returns to mode 1.
  - `config/symbols.savemenu.us.txt`: `g_MenuStartMode` 0x801E2CF8, `g_TitleFadeState` 0x801E3D54.
  - `src/menu/savemenu.c`:
    - `SaveCalcChecksum` (CRC 0x1021, init 0xFFFF, inverted), over 0x10F0 bytes from `leader_level` (savemap 0x0004);
    - `GetSaveSlotMask`: bit N is set for `BASCUS-94163FF7-S(N+1)`, kept in `g_SaveSlotMask` 0x80062F3C;
    - the save header the game writes: `SC`, icon flag 0x11, 1 block.
  - `include/game.h`: the `SaveWork`, `SaveHeader` and `FieldEntity` layouts (PosI is at +0x72).
- **ff7-flat-wiki @ `638936503b1c`**:
  - `Kernel/Kernel.bin`: the PSX path is `INIT/KERNEL.BIN`, with 27 sections.
  - `Kernel/Low_level_libraries`: the BIN-GZIP layout.
  - `Character_starting_stats`: section 4 is copied into the savemap on New Game.
  - `FF_Text`: 0xFF ends a string.
- **qhimm forum, topic 4211, reply #2 (dziugo, 2005)**, now reachable from agent sessions. It gives the checksum: the same CRC over 4336 bytes from 0x0004. Read only to confirm `runner/savegen/checksum.js`; nothing was copied.

## What was built
- **Baseline reader** (`runner/savegen/baseline.js`): reads `INIT/KERNEL.BIN` from the disc inside the sandbox and finds the first section of file type 3. It reads up to that section only, and zero padding after the last section ends the list. It gunzips the section, with a raw-inflate fallback if the gzip trailer does not check out. It then rebuilds the New Game savemap in the game's order: config defaults, reset, the init data at 0x0054, config defaults, reset, `SysInitNewGame`. Only these documented values are written; nothing read from the disc leaves the run. Tier 1 runs it on a synthetic KERNEL.BIN built from the wiki's layout, alone and inside a synthetic ISO.
- **Generator changes** (`runner/savegen/`):
  - `worldmap_exit_action` (0x0B90) is now a u32 0 in a field (the game's own value), not the wiki's 2.
  - The preview leader name (0x0008) and location (0x0028) are empty FF Text strings (0xFF).
  - `generateCard(..., { checksum: 'wrong' })` stores the checksum's low word inverted.
- **Format 2** (`runner/format2.js`, `harness/schema/scenario.schema.json`):
  - `boot: { disc: 1, save, slot: 1, from?, checksum? }`. The boot point defaults to `title-card`. The card is generated once per run from the disc baseline. It replaces the blank card in every core instance that restores the title snapshot, and the restore flags the card as new (notes/31). A "boot" replay swaps the card at T the same way.
  - `{ "mark": NAME }` steps record every numeric location.
  - `change` checks take `since: NAME`.
  - `tier2.js` starts a save boot from `title-card`.
- **Boot point** (`harness/saves/disc1-md1stin.json`): md1stin (116), x = 0x7FFF, triangle 12, party Cloud alone, progress 6.
- **Scenarios**: `save-boot-1-load`, `save-boot-2-bad-checksum`, and the segment `field-loaded`. `reactor-next-0-after-battle` also reports `progress` and `tri0`.

## The load sequence
From the title snapshot (`title-card`, T = 1250), the script presses Circle (4 frames every 30) until `g_GameState` reads field (1, confirmed #76). The title cursor starts on Continue, the slot cursor on slot 1 and the file cursor on save 1, so Circle alone loads save 1. No press can reach New Game, which needs Down.

Then the segment `field-loaded` applies #77's rule: field mode, then `g_IsFieldLoading` leaves 2 and reads 2 again. At the title it reads 0, so it has already left 2, and the wait is for the load to finish.

## Attempt 1 (`681723f`, tier2: 30 pass, 2 fail)
- The load sequence waited on the title overlay's `g_MenuStartMode` and `g_TitleFadeState` (7 → 0 → reading → 1 → 4, then fade out).
- The description was a placeholder: md1stin, progress 0, triangle 0.
- `reactor-next-0-after-battle` also reported **progress 6, tri0 12**.
- **Both save-boot scenarios failed with every metric 0**, `slot_mask`, `title_mode` and `title_fade` included. A run that stops before the script reports 0 for memory metrics, so this means the run stopped at boot, or the first title wait timed out. No `boot_stage` metric was listed, so the two can't be told apart.
- **Likely cause (not proven): the kernel reader refused the disc's archive.** It threw on a zero-length section, and an archive padded to a sector ends in zeros. Attempt 2's reader stops at padding and reads only up to the type 3 section, and attempt 2's metrics include `boot_stage`. The title-menu waits were dropped as well (below), so attempt 2 does not isolate the cause.

## Attempt 2 (`2e61c73`, tier2: 32 pass, 0 fail)
| scenario | metrics |
|---|---|
| save-boot-1-load | boot_stage 6, **w_field 400**, **load_done 371**, **slot_mask 1**, **tri_ok 1**, **x_dir 1, y_dir 1**, match 1 |
| save-boot-2-bad-checksum | boot_stage 6, disc_error 0, **no_field 1**, **listed 1**, slot_mask 1, **title_mode 1**, **title_fade 1**, match 1 |
| reactor-next-0-after-battle | progress 6, tri0 12 (as attempt 1), the rest unchanged |
| the 29 earlier scenarios | pass, unchanged |

Reading:
- **The generated card is accepted.** Save 1 is listed (`g_SaveSlotMask` = 1). The game reaches field mode 400 frames after the title snapshot, and the field finishes loading 371 frames later.
- **The three checks pass.**
  - The field ID is md1stin (116).
  - The player stands on triangle 12, the description's, placed by the game from x = 0x7FFF.
  - The field is live: after 60 still frames, 40 frames of Up and 40 of Right moved the player, and both PosX and PosY increased. That agrees with #77's directions at md1stin.
- **A wrong checksum fails cleanly.** With the same minute of Circle presses, the save is listed but never loads: the game stays at the title. The title menu ends in the file list (mode 1) with no fade-out (1), which is what the game's code does for "file ruined".
- **Deterministic within the run:** match 1 in both scenarios (the same run from the title snapshot ends in the same RAM and picture).

## Hypotheses from notes/32
| Hypothesis | Verdict | Evidence |
|---|---|---|
| Checksum: CRC-16/GENIBUS (0x1021, init 0xFFFF, inverted) | **confirmed** | right card loads, inverted checksum is rejected (attempt 2); source: decomp `SaveCalcChecksum`, qhimm post |
| Checksum range: 0x0004..0x10F3 | **confirmed** | as above; decomp passes 0x10F0 bytes from `leader_level` |
| Checksum stored as u32, upper word 0 | **confirmed** | the game compares the stored u32 with a u16 result, and the right card loads |
| Directory file name `BASCUS-94163FF7-S01` | **confirmed** | `g_SaveSlotMask` = 1 (save 1 listed) in both scenarios |
| Directory entry: size 0x2000 at +4, next 0xFFFF at +8 | **confirmed** (as a set) | the BIOS opened and read the file |
| Block header: `SC`, icon flag 0x11, block count 1 | **confirmed** (as a set) | the file was listed and loaded; the game writes the same values (decomp) |
| 0x0B90 = 2 with module field (wiki) | **rejected** | the game stores 0 in a field (decomp); the generator writes 0, and that card loads |
| Upper 3 bytes of 0x0B90 harmless | moot | now written in full as a u32 0 |

Each header field is confirmed only as part of a card the game accepts, not one by one.

## Deviations from the contract
- **"A real save point plus its documented story-progress value."** No reachable source documents progress values or save-point positions. The wiki names the variable but lists no values; the decomp has no field data. So the first boot point is md1stin, where the game itself stands after the first guard battle: the main progress variable reads 6 there and Cloud stands on triangle 12, both measured in Tier 2 (`reactor-next-0-after-battle`). There is no save point at md1stin. This is a known-good combination (the game loads it and the field is live), but it is not a save point; a save-point boot point is left for #80's catalogue.
- **"Player position within tolerance."** No coordinate is documented either. The description uses x = 0x7FFF, which makes the game place the player at the centroid of the saved triangle. The check is that the player stands on that triangle (exact), not a coordinate tolerance.
- **The load sequence** waits on confirmed addresses only (game mode, then #77's field-loaded rule), with Circle pressed meanwhile. It does not wait on title-menu addresses. The title-overlay addresses (`g_MenuStartMode`, `g_TitleFadeState`) read plausible values in attempt 2 (1 and 1 in the file list after a rejection), but that is one reading each, so they stay hypotheses.

## Barret (#101)
This boot point has Cloud alone (party 0, 255, 255), as the game has it at md1stin. It does not put Barret in the party. A description with `party: [0, 1, 255]` (or a later field with its progress value) is the way to give #101 a boot point with Barret; that is #101's work.

## Limits and follow-ups
- Position entries read field model 0; the scenario checks `g_PlayerModelId` = 0 after the load. Other fields need #99.
- The KERNEL.BIN padding explanation for attempt 1 is not proven.
- A second Tier 2 run of the same scenarios comes with the commit that adds these notes (see the PR).
