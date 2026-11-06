# #78: confirm menu cursor and party data in Tier 2

Status (2026-11-06): attempt 1 pushed (diagnostic + first acceptance guesses).

## Sources (reference only; no code copied)
- **Xeeynamo/ff7-decomp @ `9411173034bde2ae4c9b0312167e79c3645ca1be`**: `config/symbols.main.us.txt` (names and addresses), `include/game.h` (layouts: `MenuTable`, `SaveWork`, `SavePartyMember` record, `ActiveCharacterData`), and the indexing seen in `src/menu/savemenu.c` `UpdateSaveHeader` (it reads `g_ActiveCharacters[i]` for party slot `i`, where `Savemap.partyID[i]` is not 0xFF). Only offsets, names and indexing were read.
- **ff7-mods/ff7-flat-wiki @ `638936503b1c`**: `docs/FF7/Savemap.md` (party slots at 0x04F8–0x04FA, character IDs 0x00 Cloud, 0x01 Barret, 0xFF none; character records at 0x0054, 0x84 each), `docs/FF7/Battle/Battle_Mechanics.md` ("Active Character Data": +0x000 character ID, +0x010 current HP, +0x012 max HP, +0x014 current MP, +0x016 max MP), `docs/FF7/Character_starting_stats.md` (KERNEL.BIN section 4 is copied into the savemap on New Game; it gives no numbers).

## Candidates (hypotheses)
| Name | Address | Type | From |
|---|---|---|---|
| `g_PartyMenuTables[k].row`, k = 0..2 | 0x8009A0C8 + k·0x12 + 0x0B = 0x8009A0D3 / 0x8009A0E5 / 0x8009A0F7 | s8 | symbols (`g_PartyMenuTables`, size 0x36 = 3 tables) + game.h `MenuTable` (size 0x12, `row` at +0x0B). The main menu (`SysMenuDrawMainMenu`) is in the main executable, and these are the main executable's only menu tables |
| `g_PartyMenuSelectedMenuId` | 0x80062F94 | s32 | symbols; diagnostic |
| Savemap `partyID[0..2]` | 0x8009C6E4 + 0x04F8.. = 0x8009CBDC / DD / DE | u8 | game.h `SaveWork` + wiki Savemap |
| `g_ActiveCharacters[i]` id / hp / maxHp / mp | 0x8009D84C + i·0x440 + 0x000 / 0x010 / 0x012 / 0x014 | u8 / s16 | symbols + game.h `ActiveCharacterData` (size 0x440) + wiki Active Character Data |
| Savemap character record HP/MP (Cloud, Barret) | 0x8009C6E4 + 0x54 + id·0x84 + 0x2C (curHP) / 0x30 (curMP) | u16 | game.h `SavePartyMember` + wiki |

## "Documented starting ranges"
No source we can read gives the starting HP or MP numbers (the wiki page for KERNEL.BIN section 4 describes the format only). So the HP/MP checks use the game's limits instead: current and max HP in 1..9999 (alive, below the 9999 cap the wiki's Customising page mentions), current MP in 0..999. This is weaker than a starting range; it rules out reading the wrong structure (an ID byte, a pointer, a negative value) but not a neighbouring HP field. The slot IDs and the per-slot ids carry the identification.

## Attempt 1 plan (one push, 7 new scenarios, 32 in total)
- `reactor-mode-2a/2b/2c-cursor-*` (diagnostic): from `menu-open`, Down; Down, Down; Down, Down, Up (each press 4 frames, then 30 idle). Report the three row candidates at the end and the sign of their change from `menu-open`.
- `reactor-mode-2d-cursor-sequence` (acceptance guess, candidate 1 = table 0): Down → wait until row = 1, Down → 2, Up → 1, Up → 0, each with a 60-frame timeout; match on a rerun.
- `reactor-mode-2e-party-menu`: from `menu-open`, slot IDs Cloud/Barret/empty, `g_ActiveCharacters` ids and HP ranges.
- `reactor-mode-4a-party-slots` and `4b-party-hp`: the same at the first guard battle (`battle`), plus MP and max HP and the savemap records.
