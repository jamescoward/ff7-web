# #99: player position follows g_PlayerModelId

Status (2026-11-07): attempt 1 done (no field with a non-0 player model); attempt 2 (Barret as party leader) pushed.

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
