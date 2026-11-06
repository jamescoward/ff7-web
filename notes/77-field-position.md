# #77: confirm field ID and player position in Tier 2

Status (2026-11-06): attempt 1 done (`eeabb0b`, tier2: 18 pass, 5 diagnostic fails). Field ID and player position candidates found; the exit off md1stin was not reached. Attempt 2 in progress.

## Sources (reference only; no code copied)
- **Xeeynamo/ff7-decomp @ `9411173034bde2ae4c9b0312167e79c3645ca1be`**: `config/symbols.main.us.txt` (names and addresses) and `include/game.h` (structure layouts: `FieldState`, `FieldEntity`, `SaveWork`, and the comment `Savemap // 0x8009C6E4`). CLAUDE.md allows the decomp as a reference for addresses and structure layouts. Only offsets and field names were read.
- **ff7-mods/ff7-flat-wiki @ `638936503b1c`**: `docs/FF7/Field/Field_ID.md` (field IDs) and the Savemap page (offsets, as in `notes/32-save-format.md`).

## Documented field IDs (ff7-flat-wiki Field_ID)
| ID | Name | Role here |
|---|---|---|
| 0x0074 (116) | md1stin | expected first controllable field (the station platform where Cloud lands) — hypothesis that reactor-entrance is here |
| 0x0075 (117) | md1_1 | expected next field, walking north after the guard battle |
| 0x0076 (118) | md1_2 | |
| 0x0078 (120) | nmkin_1 | |

## Candidates (hypotheses)
| Name | Address | Type | From |
|---|---|---|---|
| `g_FieldCurrentMap` | 0x8009A05C | s16 | symbols + game.h `extern s16 g_FieldCurrentMap` — field ID candidate 1 |
| Savemap `current_location_id` | 0x8009C6E4 + 0x0B96 = 0x8009D27A | u16 | game.h Savemap base + wiki offset — candidate 2; may be a saved copy, updated only on load/save |
| `g_FieldPreloadMapId` | 0x80095DD0 | s32 | symbols — diagnostic (likely the map being preloaded) |
| `FieldState.prevFieldId` | 0x8009ABF4 + 0x64 = 0x8009AC58 | u16 | game.h layout (offset counted from the field list) — diagnostic |
| `g_IsFieldLoading` | 0x800965E8 | s16 | symbols — field-loaded candidate for #38 |
| `g_PlayerModelId` | 0x800965E0 | s16 | symbols — the player's field model index |
| `FieldState.pcModelId` | 0x8009ABF4 + 0x2A | s16 | game.h — another player-index candidate |
| `g_FieldEntity[i].PosX/Y/Z` | 0x80074EA4 + i·0x84 + 0x0C/0x10/0x14 | s32 | symbols (array base) + game.h `FieldEntity` (size 0x84) — live position candidate. The array is indexed by field model id: `g_FieldModelAnimStatus[16]` starts 16·0x84 + 4 bytes later |

Rejected without a run: `FieldState.pcPosX/Y/Z` (+0x04..) and Savemap `field_x/y` (+0x0B9A/C). The layout's own comment says pcPos "stores player position when exiting field or jumping between field maps", and the savemap is the copy written to the card, so neither is the live position.

## A new check kind: `change` (runner)
Format 2 checks only end-of-script values, so "x increased" had no form without reporting coordinates. `{ "change": { "mem", "is": increased|decreased|unchanged|changed, "signed" } }` compares the value at the end of the script with the value at its start, inside the run. Its metric is the sign of end − start (−1/0/1), so only a small integer leaves. Schema: `harness/schema/scenario.schema.json` (outside the issue's listed paths; a non-protected path, stated in the PR). Tests: unit (`runner/test/unit/format2.test.js`), Tier 1 on pad-echo (`runner/test/tier1/format2.test.js`).

## Attempt 1 plan (diagnostic; one push)
All start from the `reactor-entrance` snapshot (#74), except the last, which starts from `battle` (#76).
- `reactor-field-1-id`: 120 frames, no input. Reports every field ID candidate, `loading`, `cloud_entity`; `id_ok` = g_FieldCurrentMap reads 0x74.
- `reactor-field-2-still`: 120 frames, no input. `unchanged` on entity 0 and 1 X/Y/Z; reports the player-index candidates.
- `reactor-field-3..6-walk-{right,down,left,up}`: hold the direction 60 frames, then 10 idle. Sign of each candidate's change.
- `reactor-next-field`: from `battle`, Circle until field, then Up + Circle until g_FieldCurrentMap differs from 0x74 (`next_wait`), then until `loading` reads 0 (`load_wait`), 120 frames more; reports the field ID candidates. Expect md1_1 = 0x75.

What decides attempt 2: which entity index moves (and whether it equals `player_model`), which axes map to screen right/down, and which field ID candidate tracks the map change.

## Results

### Attempt 1 (`eeabb0b`, tier2: 18 pass, 5 fail; the fails are diagnostics)
| scenario | status | metrics |
|---|---|---|
| reactor-field-1-id | pass | **id_ok 1, map_cur 116** (0x74, md1stin), map_save 116, map_preload 117 (0x75, md1_1), prev_field 116, **loading 2**, game_state 1, cloud_entity 1 |
| reactor-field-2-still | pass | every sign 0 (entity 0 and 1, X/Y/Z), player_model 0, pc_model 0 |
| reactor-field-3-walk-right | fail (diag) | dx0 **1**, dy0 1, dz0 1; entity 1 all 0; player_model 0 |
| reactor-field-4-walk-down | fail (diag) | dx0 **-1**, dy0 **-1**, dz0 0; entity 1 all 0 |
| reactor-field-5-walk-left | fail (diag) | dx0 **-1**, dy0 1, dz0 0; entity 1 all 0 |
| reactor-field-6-walk-up | fail (diag) | dx0 **1**, dy0 **1**, dz0 0; entity 1 all 0 |
| reactor-next-field | fail (diag) | next_wait 0 (timeout after 5400 frames of Up + Circle), map_cur 116, loading 2, game_state 1 |
| every #74/#76 scenario | pass | unchanged; reactor-entrance-equals-scratch now also passes (match_boot 1, every same_* 1: #88's fix) |

Reading:
- **Field ID: `g_FieldCurrentMap` reads the documented md1stin ID (0x74) at reactor-entrance.** The savemap copy reads the same. `g_FieldPreloadMapId` reads 0x75 (md1_1): the field the game preloads next, which agrees with the wiki's next field.
- **Player position: `g_FieldEntity[0]` moves with the pad and is still without input; entity 1 never moves.** `g_PlayerModelId` and `FieldState.pcModelId` both read 0, so index 0 is the player (both are candidates for a general index).
- **Directions:** right and left are opposite in X (+/−), up and down are opposite in both X and Y (+,+ / −,−). The field camera is not aligned with the walkmesh axes, so a screen direction moves both components. Right and left both raised Y. Down and left read Y opposite to up and right, but right's +Y is not opposite to left's +Y. That is consistent with a camera at an angle plus walkmesh edges, and not explained yet. The acceptance checks use only the opposite pairs: X for right/left, and X and Y for up/down.
- **`g_IsFieldLoading` reads 2 in a settled field, not 0**, so "loading = 0" is not the field-loaded condition. Attempt 2 records it across a map change.
- **The exit:** 90 s of Up + Circle after the battle did not leave md1stin. Either the exit is not straight up, or Circle kept starting something. Attempt 2 tries several directions without Circle.

### Attempt 2 plan (materially different: acceptance checks on the found addresses, and an exit search without Circle)
- `reactor-field-1-id`: g_FieldCurrentMap = 0x74 (id_ok) and the savemap copy = 0x74, game_state 1, match.
- `reactor-field-2-still`: PosX/PosY of entity 0 unchanged for 120 frames; g_PlayerModelId = 0; match.
- `reactor-field-3..6-walk-{right,left,up,down}`: right X up, left X down, up X and Y up, down X and Y down (directions from attempt 1); match.
- `reactor-next-0-after-battle`: from `battle`, back to the field and a still picture (as reactor-mode-5); keeps `after-battle`.
- `reactor-next-1..5-{up-left,left,up-right,right,down}` (diagnostic): hold the direction without Circle until g_FieldCurrentMap differs from 0x74, then until g_IsFieldLoading reads 2 again. Looks for the exit to md1_1 (0x75) and the field-loaded condition.
- Removed: `reactor-next-field` (attempt 1's Up + Circle) and the entity-1/Z probes.
