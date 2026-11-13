# #168: the dialogue choice cursor (dialogPointer, dialogPointerY)

Status (2026-11-13): attempt 1 done (mktinn loads; NPC directions known); attempt 2 (walk and talk, three directions) pushed. Attempts used: 2 of 3.

## The problem
#108 confirmed window 0's state but reached no choice window (field opcode `ask`). To confirm `dialogPointer` (pointerEnabled, +0x1A) and `dialogPointerY` (pointerY, +0x26) a scenario has to reach one. No route is known.

## Constraint: one free scenario slot
Tier 2 runs at most 64 scenarios (the validator's cap, `harness/private-eval/validate/validate.js`, protected). Main holds 61 tier 2 scenarios (the run on `f8c5b7c` counted 62 with this PR's one; the other files in `harness/scenarios/` are tier 1), so an attempt can add **three** scenarios without removing an acceptance check. Removing other issues' acceptance checks would weaken tests, so attempts here stay within those three slots, at most 8 metrics each.

## Choosing a candidate (references only; no game text read)
- ff7-flat-wiki @ `6389365` `docs/FF7/Field/Script/Opcodes/48_ASK.md`: ASK opens a window with options picked with the pointer.
- ff7-flat-wiki `docs/FF7/Savemap.md` names script places where choices are recorded, e.g. `{mktinn/cloud/s4}` (the Wall Market inn's vending machine: 200/100/50 gil items), Tifa's drink choice in mds7 (needs that scene's progress value), Aerith's flower (needs its progress value). No source documents the main progress value of those scenes, so story-triggered choices would be a blind search over progress values, which one slot per run can't afford.
- An innkeeper's "stay the night?" is a plain talk to an NPC that inns offer at any progress (hypothesis). Wall Market's inn (`mktinn`, field 0xC7 per `docs/FF7/Field/Field_ID.md`) is chosen over Kalm's (`elminn_1`): Kalm's inn hosts the flashback scene (`{elminn_2/ballet/s11}`), so its scripts are more likely to branch on progress.
- Talking (Xeeynamo/ff7-decomp@2c9239a `src/field/field_entity.c` FieldEntityCheckTalk, via #112): a Circle press talks to a model within TalkRange + SolidRange that the player faces within 64/256 of a turn. Walking toward an NPC faces it.

## Attempt 1 plan (diagnostic; one push)
`save-boot-14-choice-mktinn-diag`: boot `harness/saves/disc1-mktinn.json` (mktinn, triangle 0, x 0x7FFF, progress 6, Cloud alone, as #99's saves), load as `save-boot-1-load`, 60 frames with no input. Checks the field ID (199) and field mode. Reports `load_done`, `model_count`, and for models 1-3 the sign of PosX and PosY minus the player's (`d1x` … `d3y`). Only signs and counts leave.

What decides attempt 2: the load works, and a model's signs say which way the NPCs lie (models at the player's position, signs 0/0, are likely hidden party models). Attempt 2 then walks that way pressing Circle, and waits until window 0 is in state 6 with pointerEnabled 1; if that works it becomes the acceptance (Down → pointerY + 16, Up → back, Circle closes; rerun matches).

## Results

### Attempt 1 (`f8c5b7c`, tier2: 62 pass, 0 fail)
| scenario | load_done | model_count | d1x d1y | d2x d2y | d3x d3y |
|---|---|---|---|---|---|
| save-boot-14-choice-mktinn-diag | 295 | 5 | 1 −1 | 1 −1 | 1 −1 |

Reading: the generated save loads into mktinn (field ID 199 checked, field mode). The field has 5 models; models 1-3 all lie at larger PosX and smaller PosY than the player, so none is a hidden party model parked on the player (signs would be 0). Every earlier scenario passed unchanged. The diagnostic is removed; its definition is in `f8c5b7c`.

### Attempt 2 plan (one push, three scenarios)
How the pad maps to PosX/PosY depends on the field's camera (at md1stin Right raised PosX, Down lowered both, #77), so three directions are tried at once: `save-boot-14a` Right, `14b` Down, `14c` Right+Down. Each holds its direction for 120 frames from the load point (the walk ends against whatever is in the way, facing it), then presses Circle every 30 frames until window 0's pointerEnabled reads 1 (`ptr_wait`; timeout 1800 frames fails the scenario). Circle every 30 frames advances any plain message before a question, and is rare enough not to pick the option in the frame the pointer appears. Then Down (4 frames) and 12 still frames: `ptr_y` (pointerY), `down_dir` (its sign of change), `win6` (still state 6). `x_dir`/`y_dir` say which way the walk went, so a failed direction still tells the camera mapping.

What decides attempt 3 (the acceptance): a scenario where ptr_wait > 0, win6 = 1 and down_dir = 1 shows the pointer; attempt 3 adds Up (back to the first row: pointerY returns) and Circle (window closes), in that direction only, and confirms both entries.
