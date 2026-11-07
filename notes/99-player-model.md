# #99: player position follows g_PlayerModelId

Status (2026-11-07): done. Attempts 1 and 2 found no reachable state where the player is not model 0. Attempt 3 (`fdc80b2`, tier2 33 pass, 0 fail) confirms g_PlayerModelId = 0 at nmkin_1, the second field. Attempts used: 3 of 3.

## Sources (reference only; no code copied)
- **Xeeynamo/ff7-decomp @ `9411173034bde2ae4c9b0312167e79c3645ca1be`**: `config/symbols.main.us.txt` (g_PlayerModelId 0x800965E0, g_FieldEntity 0x80074EA4, g_FieldModelAnimStatus 16 entities on) and `include/game.h` (FieldEntity, size 0x84, PosX +0x0C, PosY +0x10; FieldState at 0x8009ABF4, pcModelId at +0x2A).
- **ff7-mods/ff7-flat-wiki @ `638936503b1c`**: `docs/FF7/Field/Field_ID.md` for the field IDs below.

## What changed (Tier 1)
- `semantic/addresses.js`: optional `stride` + `count` on an entry make it an array (element i at address + i·stride). `fieldX`/`fieldY` are arrays over the 16 field models (stride 0x84). New entry `playerModel` (g_PlayerModelId, s16), confirmed for the value 0 only (`confirmedValues`), from #77's `reactor-field-2-still` (expects 0, and model 0 is the one that moves at md1stin) and #38's `save-boot-1-load`.
- `semantic/layer.js`: `playerPosition()` reads `playerModel`, then that element of `fieldX`/`fieldY`; value `{ x, y, model }`. Confirmed only when the model index is a confirmed value (0) and the position entries are confirmed. An index outside 0..15 gives reason `out of range` and reads nothing more. No playerModel entry: `no address` (no silent fallback to model 0).
- The overlay row text is unchanged (`web/js/overlay-state.js` is outside the contract); it shows x and y of the player model.

## Attempt 1 plan (diagnostic; one push)
Every scenario reports g_PlayerModelId (`player_model`), FieldState.pcModelId (`pc_model`, a second candidate) and, after 60 still frames and a walk up 40 + right 40 frames, the sign of the PosX change of models 0, 1 and 2 (`mv0..mv2`). Only small integers leave.

| scenario | how it gets there | field |
|---|---|---|
| reactor-next-3-player-model | from `after-battle`, walk up-left off md1stin (#77), field-loaded rule | md1_1 0x75 |
| save-boot-3-model-md1-2 | generated save, triangle 0, x 0x7FFF | md1_2 0x76 |
| save-boot-4-model-nmkin-1 | same | nmkin_1 0x78 |
| save-boot-5-model-md8-1 | same | md8_1 0x85 |
| save-boot-6-model-mds7st1 | same | mds7st1 0x90 |
| save-boot-7-model-mds7 | same | mds7 0x97 |

The saves use progress 6 and Cloud alone (md1stin's values): no source documents each field's own progress value, so a field's scripts may behave differently than in normal play (events, or a failed load). That is part of what the run shows.

What decides attempt 2: a field where `player_model` ≠ 0 and the model that moves equals it. Then attempt 2 turns that field into an acceptance check (player_model = N, and PosX/PosY of element N change in the expected direction, element 0 not), and adds N to `playerModel.confirmedValues`. If every reachable field reads 0, the issue records why no non-0 field can be reached yet, as the contract allows.

## Results

### Attempt 1 (`a5264b1`, tier2: 32 pass, 6 fail; the fails are the diagnostic `mv1`/`mv2` checks)
| scenario | load_done | map_cur | player_model | pc_model | mv0 | mv1 | mv2 |
|---|---|---|---|---|---|---|---|
| reactor-next-3-player-model | 66 | 117 (md1_1) | 0 | 0 | 1 | 0 | 0 |
| save-boot-3-model-md1-2 | 354 | 118 (md1_2) | 0 | 0 | 1 | **1** | 0 |
| save-boot-4-model-nmkin-1 | 352 | 120 (nmkin_1) | 0 | 0 | 1 | 0 | 0 |
| save-boot-5-model-md8-1 | 342 | 133 (md8_1) | 0 | 0 | 1 | 0 | 0 |
| save-boot-6-model-mds7st1 | 392 | 144 (mds7st1) | 0 | 0 | 1 | 0 | 0 |
| save-boot-7-model-mds7 | 474 | 151 (mds7) | 0 | 0 | 1 | 0 | 0 |

w_field was 400 in every save boot. Every earlier scenario passed unchanged.

Reading:
- **Every generated save loads into its field**: the field ID is the description's, the load finishes, and the pad moves the player. Triangle 0 with x 0x7FFF works as a boot point in these five fields, with md1stin's progress value.
- **The player is model 0 in all six fields** (both candidates read 0, and model 0 is the one that moves). With Cloud leading alone, the field's first model seems to be the player. So these fields can't confirm a non-0 value.
- **md1_2: model 1 also moved** during the walk. It may be an NPC on its own path, or a follower; attempt 1 had no still window to tell.

### Attempt 2 plan (materially different: change the party leader, not the field)
Hypothesis: the field scripts give the player role to the model of the party leader (savemap partyID[0]). With Barret leading, the player model should be Barret's model, which need not be index 0. Barret's model is in md1stin (he jumps off the train in the opening) and md1_2.
- `save-boot-3-walk-barret-md1stin`: md1stin, triangle 12 (#38's boot point), party Barret, Cloud, empty.
- `save-boot-4-walk-barret-md1-2` and `save-boot-5-still-barret-md1-2`: md1_2, triangle 0, same party.
- `save-boot-6-walk-barret-nmkin-1`: nmkin_1, triangle 0, same party.
- `save-boot-7-still-cloud-md1-2`: md1_2 with Cloud alone, as attempt 1, to explain model 1.

The walk scenarios report `player_model`, the field ID and the sign of the PosX change of models 0-2 over a walk up 40 + right 40 frames (`mv0..mv2`). A `change` check compares with the end of the script, so a still window can't sit before the walk in the same scenario; the still scenarios instead report the signs over 90 frames with no input (`s0..s2`), which tells NPCs and followers from the player. They are needed only in md1_2: in md1stin and nmkin_1 only model 0 moved in attempt 1. Attempt 1's six scenarios and five saves are removed; their results are above.

What decides attempt 3: if Barret leading gives player_model N ≠ 0 and model N moves only under the pad, attempt 3 turns that into the acceptance check and adds N to `playerModel.confirmedValues`.

### Attempt 2 (`bc9a94c`, tier2: 34 pass, 3 fail; the fails are the diagnostic `mv1`/`mv2` checks)
| scenario | load_done | map_cur | player_model | s0 s1 s2 (still) | mv0 mv1 mv2 (walk) |
|---|---|---|---|---|---|
| save-boot-3-walk-barret-md1stin | 371 | 116 | 0 | | 1 0 0 |
| save-boot-4-walk-barret-md1-2 | 354 | 118 | 0 | | 1 0 0 |
| save-boot-5-still-barret-md1-2 | 354 | 118 | 0 | 0 0 0 | |
| save-boot-6-walk-barret-nmkin-1 | 352 | 120 | 0 | | 1 0 0 |
| save-boot-7-still-cloud-md1-2 | 354 | 118 | 0 | 0 0 0 | |

Every earlier scenario passed unchanged.

Reading:
- **With Barret leading, the player is still model 0** in md1stin, md1_2 and nmkin_1, and only model 0 moves under the pad. So the party leader does not move the player to another model index here; the leader's character is presumably drawn with model 0's slot. The hypothesis is rejected.
- **No model moves on its own in md1_2** over 90 still frames, with either party. Attempt 1's mv1 = 1 there (Cloud alone, walking) is so far unexplained: perhaps a model that reacts to the player (a follower or a script triggered by walking), which the walk with Barret leading didn't trigger. Not needed for #99.

## Outcome
**No reachable state has g_PlayerModelId ≠ 0.** It read 0 in seven fields (md1stin, md1_1, md1_2, nmkin_1, md8_1, mds7st1, mds7), with Cloud or Barret leading, and model 0 was always the one the pad moved. FieldState.pcModelId read the same everywhere. A non-0 value probably needs a field whose script makes another model the player (for example a scene where the player controls a different character), which needs that field's own progress value; no reachable source documents those (#38's deviation). The contract allows recording this instead.

**Attempt 3 (the acceptance):** `save-boot-3-player-model-nmkin-1` boots nmkin_1 from a generated save (`harness/saves/disc1-nmkin-1.json`) and checks g_PlayerModelId = 0, model 0's PosX and PosY change under the pad, model 1's PosX doesn't, and a rerun matches. With md1stin (#77's `reactor-field-2-still`), that is the second field the contract asks for, for the value 0. `playerModel.confirmedValues[0]` names it. The attempts 1-2 diagnostics and their saves are removed.

**Attempt 3 result (`fdc80b2`, tier2: 33 pass, 0 fail):** `save-boot-3-player-model-nmkin-1`: model_ok 1, player_model 0, x_dir 1, y_dir 1, other_still 0, match 1, map_cur 120, load_done 352. Every earlier scenario passed unchanged. The nmkin_1 values (player_model 0, model 0 moving, load_done 352) are the same as in attempts 1 and 2, so three Tier 2 runs agree.

**Limits and follow-ups:**
- `playerPosition()` indexes by g_PlayerModelId, but only index 0 is confirmed; any other index is reported as a hypothesis until a scenario sees one.
- The first field where another model is the player, once a boot point for it exists (#80's catalogue), would confirm the indexing itself.
