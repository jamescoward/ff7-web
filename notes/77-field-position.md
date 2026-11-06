# #77: confirm field ID and player position in Tier 2

Status (2026-11-06): done. Attempt 3 (`0eecadc`, rerun `f889303`) passed 25/25 Tier 2 scenarios twice, identically. Confirmed: fieldId = g_FieldCurrentMap, fieldX/fieldY = g_FieldEntity[0] PosX/PosY, fieldLoading = g_IsFieldLoading (value 2, settled). Attempts used: 3 of 3.

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

### Attempt 1, second run (`32a0734`, a test-only change; tier2: 18 pass, 5 fail)
Every scenario's status and every deterministic metric (all but fps, run_ms, saved_ms) equal the first run's, all 23 scenarios (compared field by field). So the field ID, the still check and the four walk directions are deterministic across two Tier 2 runs.

### Attempt 2 plan (materially different: acceptance checks on the found addresses, and an exit search without Circle)
- `reactor-field-1-id`: g_FieldCurrentMap = 0x74 (id_ok) and the savemap copy = 0x74, game_state 1, match.
- `reactor-field-2-still`: PosX/PosY of entity 0 unchanged for 120 frames; g_PlayerModelId = 0; match.
- `reactor-field-3..6-walk-{right,left,up,down}`: right X up, left X down, up X and Y up, down X and Y down (directions from attempt 1); match.
- `reactor-next-0-after-battle`: from `battle`, back to the field and a still picture (as reactor-mode-5); keeps `after-battle`.
- `reactor-next-1..5-{up-left,left,up-right,right,down}` (diagnostic): hold the direction without Circle until g_FieldCurrentMap differs from 0x74, then until g_IsFieldLoading reads 2 again. Looks for the exit to md1_1 (0x75) and the field-loaded condition.
- Removed: `reactor-next-field` (attempt 1's Up + Circle) and the entity-1/Z probes.

### Attempt 2 results (`2f5b4d5`, tier2: 24 pass, 4 fail; the fails are exit-search diagnostics)
| scenario | status | metrics |
|---|---|---|
| reactor-field-1-id | pass | id_ok 1, match 1, map_cur 116, map_save 116, map_preload 117, loading 2, game_state 1, player_model 0 |
| reactor-field-2-still | pass | still_x 0, still_y 0, match 1, player_model 0 |
| reactor-field-3-walk-right | pass | x_dir 1, match 1 |
| reactor-field-4-walk-left | pass | x_dir -1, match 1 |
| reactor-field-5-walk-up | pass | x_dir 1, y_dir 1, match 1 |
| reactor-field-6-walk-down | pass | x_dir -1, y_dir -1, match 1 |
| reactor-next-0-after-battle | pass | end_wait 1297, field_still 588, map_cur 116, loading 2, match 1 |
| reactor-next-1-up-left | **pass** | **next_wait 495, map_cur 117** (0x75, md1_1), map_save 116, map_preload 116, prev_field 116, **loading 1**, settle_wait 1, game_state 1 |
| reactor-next-2..5 (left, up-right, right, down) | fail (diag) | next_wait 0 (60 s timeout), map_cur 116 |

Reading:
- **The four position checks pass** with the signs attempt 1 measured, in a third Tier 2 run.
- **Walking up-left leaves md1stin for md1_1 (0x75), the documented next field**, 495 frames after the battle's still picture. Straight left, up-right, right and down don't in 60 s.
- **The field ID changes before the new field has loaded.** One frame after the change `g_IsFieldLoading` still read 2 (settle_wait 1). 120 frames later it read 1 and the savemap copy still read 116. So the load starts after the ID changes. "Field mode and a valid field ID" is not enough for #38; attempt 3 checks that `g_IsFieldLoading` returns to 2.

### Attempt 2, second run (`fa37fc7`, a notes-only commit; tier2: 24 pass, 4 fail)
All 28 scenarios equal the first run's status and deterministic metrics, including reactor-next-1-up-left (next_wait 495, map_cur 117, loading 1). So the four position checks and the walk-off to md1_1 are deterministic across two Tier 2 runs.

### Attempt 3 (last: the exit as an acceptance check, the load sequence, and the table)
- `reactor-next-1-walk-off`: up-left until the ID differs from 0x74, 10 s idle; map_cur = 0x75 (next_ok), field mode, match.
- `reactor-next-2-load-sequence`: up-left until the ID changes; until `g_IsFieldLoading` leaves 2 (load_start), then until it reads 2 again (load_done); then check ID 0x75, field mode, loading 2.
- `semantic/addresses.js`: `fieldId` = g_FieldCurrentMap (s16), `fieldX`/`fieldY` = g_FieldEntity[0] PosX/PosY (s32), all **confirmed**; new `fieldLoading` = g_IsFieldLoading, hypothesis until load_done passes. Tests updated (`runner/test/unit/semantic.test.js`, `web/test/debug-overlay.test.js`, which now take the field badges from the shipped table, as #96 did for Mode).
- Known limit: the position entries read model index 0, which is the player at md1stin (g_PlayerModelId 0). Other fields may put the player at another index; a reader that indexes by g_PlayerModelId is a follow-up.

### Attempt 3 results (`0eecadc` and `f889303`: tier2 25 pass, 0 fail, both runs identical apart from timing)
| scenario | metrics |
|---|---|
| reactor-field-1-id | id_ok 1, match 1, map_cur 116, map_save 116, map_preload 117, loading 2, game_state 1, player_model 0 |
| reactor-field-2-still | still_x 0, still_y 0, match 1, player_model 0 |
| reactor-field-3-walk-right / 4-left | x_dir 1 / -1, match 1 |
| reactor-field-5-walk-up / 6-down | x_dir 1, y_dir 1 / x_dir -1, y_dir -1, match 1 |
| reactor-next-0-after-battle | end_wait 1297, field_still 588, map_cur 116, loading 2, match 1 |
| reactor-next-1-walk-off | **next_ok 1, map_cur 117** (md1_1), next_wait 495, loading 2, map_save 116, game_state 1, match 1 |
| reactor-next-2-load-sequence | next_wait 495, **load_start 114, load_done 66**, map_cur 117, loading 2, map_save 116, prev_field 116, game_state 1 |

## Outcome
**Acceptance (#77):**
- The field ID equals the documented ID of the first controllable field: g_FieldCurrentMap = 0x74 (md1stin) at reactor-entrance.
- No input for 120 frames: the position does not change (still_x 0, still_y 0).
- Scripted walks change the position in the expected direction. Right raises X and left lowers it. Up raises X and Y, down lowers both.
- Walking off the first screen (up-left) changes the field ID to the documented next field, md1_1 (0x75).
- Deterministic: the field ID and the walk directions over four Tier 2 runs (attempts 1-3, each run twice), and the walk-off over four (attempts 2-3); every rerun from the same snapshot matched.

**Field-loaded condition for #38:** gameState field, and, after the field ID last changed, g_IsFieldLoading has left 2 and reads 2 again. A single read is not enough. The ID changes first, and the load starts 114 frames later, with g_IsFieldLoading still 2 in between. It finished 66 frames after that. For a boot from a save, where there is no earlier field, the same rule needs checking in #38.

**Also seen:** the savemap copy of the field ID (0x8009C6E4 + 0x0B96) still read md1stin 10 s after reaching md1_1. It is a saved copy, updated at some later point (a save or a menu, not checked), so the semantic layer reads g_FieldCurrentMap.

**Limits and follow-ups:**
- Position reads model index 0, the player at md1stin. A reader that indexes g_FieldEntity by g_PlayerModelId is a follow-up.
- The units of PosX/PosY (raw s32; possibly fixed point) are not interpreted; only direction is confirmed.
- Right and left both raised Y. That is consistent with a camera at an angle; not explained.
