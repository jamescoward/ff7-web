# #38: boot from a generated save

Status (2026-11-06): in progress. Attempt 1 pushed (`681723f`).

## Sources (reference only; no code copied)
- **Xeeynamo/ff7-decomp @ `9411173034bde2ae4c9b0312167e79c3645ca1be`**, read for addresses, layouts and the values the game stores:
  - `src/main/btlinit.c`: New Game decompresses the KERNEL.BIN section of file type `KERNEL_INIT` (3) to `&Savemap.party` (savemap 0x0054).
  - `src/main/110B8.c` `main()`: the order on New Game (config defaults, savemap reset, kernel copy, config defaults, savemap reset, `SysInitNewGame`); `SysInitNewGame` (bank 4 byte 0 = 1, module field, location 0x74, x/y/triangle 0); `InitFieldFromSavemap` (a loaded save sets `g_GameState`, `g_FieldCurrentMap` and the player position from the savemap); `InitWorldFromSavemap` (a save in a field stores `worldmap_exit_action` 0); the main loop asks for disc `memory_bank_4[0]` when it differs from the inserted one.
  - `src/pc/main.c` `func_80026258` (config defaults), `src/main/cd.c` `SysSavemapReset`.
  - `src/field/field_entity.c` `FieldEntityInitPos`: when the saved X is 0x7FFF the player is placed at the centroid of the saved triangle; otherwise PosX/PosY = saved X/Y << 12.
  - `src/menu/title.c`, `src/menu/savemenu.h`, `config/symbols.savemenu.us.txt`: the title menu (cursor starts on Continue; modes 7 title, 0 slot, 2/3 reading the card, 1 file list, 4 loading; a bad checksum shows "file ruined" and returns to mode 1), `g_MenuStartMode` 0x801E2CF8, `g_TitleFadeState` 0x801E3D54.
  - `src/menu/savemenu.c`: `SaveCalcChecksum` (CRC 0x1021, init 0xFFFF, inverted), called over 0x10F0 bytes from `leader_level` (savemap 0x0004); `GetSaveSlotMask` (bit N for `BASCUS-94163FF7-S(N+1)`; `g_SaveSlotMask` 0x80062F3C); the save header the game writes (`SC`, icon flag 0x11, 1 block).
  - `include/game.h`: `SaveWork`, `SaveHeader`, `FieldEntity` (PosI at +0x72).
- **ff7-flat-wiki @ `638936503b1c`**: `Kernel/Kernel.bin` (PSX path `INIT/KERNEL.BIN`, 27 sections), `Kernel/Low_level_libraries` (BIN-GZIP layout), `Character_starting_stats` (section 4 is copied into the savemap on New Game), `FF_Text` (0xFF ends a string).
- **qhimm forum, topic 4211 (reply #2, dziugo, 2005)**, reachable from this session: the checksum algorithm, the same CRC over 4336 bytes from 0x0004. Read only to confirm `runner/savegen/checksum.js`; nothing copied.
