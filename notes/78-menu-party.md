# #78: confirm menu cursor and party data in Tier 2

Status (2026-11-06): done, with one deviation from the contract. Attempts 2 and 3 (`f020888`, `706cc61`) passed every acceptance scenario identically; Cloud is alone at the first battle, so Barret's slot could not be checked. Attempts used: 3 of 3.

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

## Attempt 1 results (`46c7fe4`, tier2: 26 pass, 6 fail; the fails are diagnostics or the Barret expectation)
| scenario | status | metrics |
|---|---|---|
| reactor-mode-2a-cursor-down1 | fail (diag) | row0 **1**, row1 0, row2 0; d_row0 1, d_row1 0, d_row2 0; sel_menu 0; game_state 5 |
| reactor-mode-2b-cursor-down2 | fail (diag) | row0 **2**, row1 0, row2 0; d_row0 1, others 0; sel_menu 0 |
| reactor-mode-2c-cursor-up | fail (diag) | row0 **1**, row1 0, row2 0; d_row0 1, others 0; sel_menu 0 |
| reactor-mode-2d-cursor-sequence | **pass** | w_down1 1, w_down2 1, w_up1 1, w_up0 1, cursor_ok 1, match 1 |
| reactor-mode-2e-party-menu | fail | s0_cloud 1, **s1_barret 0**, s2_empty 1, a0_cloud 1, **a1_barret 0**, hp0_ok 1, hp1_ok 1, menu_ok 1 |
| reactor-mode-4a-party-slots | fail | s0_cloud 1, **s1_barret 0**, s2_empty 1, a0_cloud 1, **a1_barret 0**, a2_empty 0, battle_ok 1 |
| reactor-mode-4b-party-hp | fail | hp0_ok 1, **hp1_ok 0**, mp0_ok 1, mp1_ok 1, max0_ok 1, max1_ok 1, save_hp_ok 1, save_mp_ok 1 |
| every #74/#76/#77 scenario | pass | unchanged |

Reading:
- **Main-menu cursor: the row of `g_PartyMenuTables[0]` (0x8009A0D3).** It reads 0 with the menu just open (change sign +1 to 1), and follows Down, Down, Up exactly; the other two tables' rows stay 0. `g_PartyMenuSelectedMenuId` stays 0 (it is likely set on confirming an item). The step-by-step sequence passes: each value is reached within one frame of the press ending.
- **Party: slot 0 is Cloud (savemap partyID[0] = 0x00, and g_ActiveCharacters[0].id = 0x00), slot 2 is empty, and slot 1 is not Barret**, both at reactor-entrance (menu) and at the first guard battle. So the contract's expectation (Cloud and Barret at the first battle) does not hold: Cloud fights the first guards alone. Attempt 2 checks that slot 1 is empty, and looks for where Barret joins.
- Cloud's live HP (g_ActiveCharacters[0].hp), MP and max HP, and his savemap record's HP and MP, lie in the game's ranges. g_ActiveCharacters[1].hp is outside 1..9999 (consistent with an empty slot). g_ActiveCharacters[2].id is not 0xFF, so an empty slot is told by partyID, not by the id byte.

## Attempt 2 plan (materially different: Cloud alone, a damage check for HP, and a search for Barret)
- `reactor-mode-2a/2b/2c` removed (their job is done); `2d` stays as the cursor acceptance check.
- `reactor-mode-2e-party-menu`, `4a-party-slots`: slot 0 Cloud, slots 1 and 2 empty (0xFF), g_ActiveCharacters[0].id Cloud; 2e also HP/MP/max HP in range.
- `reactor-mode-4b-party-hp`: Cloud's HP, MP and max HP (live) and his savemap HP/MP in range.
- `reactor-mode-4c-party-hp-damage`: 1800 frames of battle with no input; g_ActiveCharacters[0].hp decreases (sign) and max HP is unchanged. This identifies the field as the current HP, which a range alone cannot.
- `reactor-next-3-barret-up`, `-up-right` (diagnostic): from after-battle, walk to md1_1 and wait for the load, then hold up (or up+right) with Circle until partyID[1] reads Barret (0x01), 9000-frame timeout; then 1/0 for partyID[1], g_ActiveCharacters[1].id and HP.
- `semantic/addresses.js`: menuCursor (s8, 0x8009A0D3), partySlot0..2 (Savemap partyID, 0x8009CBDC..DE) and partyHp0 (g_ActiveCharacters[0].hp, 0x8009D85C) confirmed; partyHp1/2 stay hypotheses (same layout one stride on, never seen holding a character). Reader tests updated (`runner/test/unit/semantic.test.js`, `semantic-party-hp.test.js`, `web/test/debug-overlay.test.js`).

## Attempt 2 results (`f020888`, tier2: 30 pass, 2 fail; the fails are the Barret search)
| scenario | status | metrics |
|---|---|---|
| reactor-mode-2d-cursor-sequence | pass | w_down1 1, w_down2 1, w_up1 1, w_up0 1, cursor_ok 1, match 1 (second run, identical) |
| reactor-mode-2e-party-menu | pass | s0_cloud 1, s1_empty 1, s2_empty 1, a0_cloud 1, hp0_ok 1, mp0_ok 1, max0_ok 1, menu_ok 1 |
| reactor-mode-4a-party-slots | pass | s0_cloud 1, s1_empty 1, s2_empty 1, a0_cloud 1, battle_ok 1 |
| reactor-mode-4b-party-hp | pass | hp0_ok 1, mp0_ok 1, max0_ok 1, save_hp_ok 1, save_mp_ok 1, battle_ok 1 |
| reactor-mode-4c-party-hp-damage | pass | **hp_dir -1**, max_dir 0, battle_ok 1, match 1 |
| reactor-next-3-barret-up / -up-right | fail (diag) | barret_wait 0 (9000-frame timeout), s1_barret 0, a1_barret 0, hp1_ok 0, map_cur 117, game_state 1, loading 2 |
| every other scenario | pass | unchanged from attempt 1 (and from #77) |

Reading:
- **Cloud is alone at reactor-entrance and at the first guard battle**: partyID = [0x00, 0xFF, 0xFF], in the menu and in battle.
- **g_ActiveCharacters[0].hp is the current HP**: it falls during 30 s of the guards attacking, while max HP stays the same.
- The cursor sequence passed again, identically: two runs.
- **No Barret yet**: 150 s of up (or up-right) with Circle in md1_1 left Cloud in md1_1 with slot 1 still not Barret.

## Attempt 3 plan (the last; a different exploration, and the second run of every acceptance check)
- Acceptance scenarios unchanged: their second Tier 2 run.
- `reactor-next-3-barret-up`, `-up-left` (diagnostic): from md1_1 (as attempt 2), 150 rounds of a 60-frame pattern: direction + Circle, direction alone, then Circle, Start and Select (in case Circle alone was stuck in dialogue or a name entry). End checks: partyID[1] = Barret, g_ActiveCharacters[1].id = Barret, its HP in range; map_cur reported.
- If neither finds Barret, they are removed in a final commit (they are this PR's own diagnostics), Barret's ID stays documented but unobserved, and partyHp1/2 stay hypotheses.

## Attempt 3 results (`706cc61`, tier2: 30 pass, 2 fail; the fails are the Barret search)
| scenario | status | metrics |
|---|---|---|
| reactor-mode-2d, 2e, 4a, 4b, 4c | pass | identical to attempt 2, metric for metric |
| reactor-next-3-barret-up | fail (diag) | s1_barret 0, a1_barret 0, hp1_ok 0, map_cur 117, game_state 1, loading 2 |
| reactor-next-3-barret-up-left | fail (diag) | s1_barret 0, a1_barret 0, hp1_ok 0, map_cur 117, **game_state 2** (a battle in md1_1), loading 0 |
| every other scenario | pass | identical to attempt 2 |

Every scenario except the two diagnostics reported the same status and deterministic metrics as attempt 2 (compared field by field). The Barret search did not add Barret in md1_1, and up-left ran into a battle there with Cloud still alone. The budget is spent, so the two diagnostics and their segments were removed in the final commit (they were this PR's own diagnostics, not acceptance checks), to leave Tier 2 green.

## Outcome
**Confirmed (Tier 2, two identical runs, attempts 2 and 3):**
| Entry | Address | Type | Scenario | Evidence |
|---|---|---|---|---|
| `menuCursor` | 0x8009A0D3 (g_PartyMenuTables[0] + 0x0B row) | s8 | reactor-mode-2d-cursor-sequence | from menu-open: Down → 1, Down → 2, Up → 1, Up → 0, each within one frame of the press; the other two tables' rows stay 0 (attempt 1) |
| `partySlot0..2` | 0x8009CBDC..DE (Savemap + 0x04F8, partyID) | u8 | reactor-mode-4a-party-slots (also 2e) | Cloud (0x00), empty (0xFF), empty, in the field menu at reactor-entrance and at the first guard battle |
| `partyHp0` | 0x8009D85C (g_ActiveCharacters[0] + 0x10) | s16 | reactor-mode-4c-party-hp-damage (also 2e, 4b) | in 1..9999 in the menu and in battle; falls during 30 s of the guards attacking, max HP (+0x12) unchanged; g_ActiveCharacters[0].id = Cloud |

Also checked in range, not in the table: Cloud's MP and max HP (live), and his savemap record's HP and MP.

**Deviation from the contract.** #78 expected Cloud and Barret at the first guard battle. The game has Cloud alone there (partyID[1] is 0xFF, in two runs, and already at reactor-entrance). So "slot 1 holds Barret (0x01)" was replaced by "slot 1 is empty", which the same address shows. Barret's ID is documented (wiki Savemap) but not observed. Checking it needs a boot point after Barret joins, which #38 (boot from a generated save) can give.

**Still hypotheses:** `partyHp1`, `partyHp2` (the same layout one 0x440 stride on; never seen with a character in the slot). `party()` is confirmed, `partyHp()` is not (one of its three entries is a hypothesis).

**"Documented starting ranges".** No readable source gives starting HP/MP numbers, so the checks use the game's limits (HP 1..9999, MP 0..999), plus the damage direction, which identifies the current-HP field better than any range could.

**Limits and follow-ups:**
- The main menu only; sub-menu and battle command cursors are out of scope (M3/M4).
- A party check with Barret or a full party, from a save-based boot point (#38).
- An empty slot is told by partyID (0xFF), not by g_ActiveCharacters[i].id (slot 2's id byte is not 0xFF; attempt 1).
