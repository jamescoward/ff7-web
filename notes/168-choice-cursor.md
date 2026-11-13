# #168: the dialogue choice cursor (dialogPointer, dialogPointerY)

Status (2026-11-13): attempt 1 (diagnostic) pushed, waiting for Tier 2. Attempts used: 1 of 3.

## The problem
#108 confirmed window 0's state but reached no choice window (field opcode `ask`). To confirm `dialogPointer` (pointerEnabled, +0x1A) and `dialogPointerY` (pointerY, +0x26) a scenario has to reach one. No route is known.

## Constraint: one free scenario slot
Tier 2 runs at most 64 scenarios (the validator's cap, `harness/private-eval/validate/validate.js`, protected). Main holds 63, so each attempt can add **one** scenario without removing an acceptance check. Removing other issues' acceptance checks would weaken tests, so every attempt here is a single scenario with at most 8 metrics.

## Choosing a candidate (references only; no game text read)
- ff7-flat-wiki @ `6389365` `docs/FF7/Field/Script/Opcodes/48_ASK.md`: ASK opens a window with options picked with the pointer.
- ff7-flat-wiki `docs/FF7/Savemap.md` names script places where choices are recorded, e.g. `{mktinn/cloud/s4}` (the Wall Market inn's vending machine: 200/100/50 gil items), Tifa's drink choice in mds7 (needs that scene's progress value), Aerith's flower (needs its progress value). No source documents the main progress value of those scenes, so story-triggered choices would be a blind search over progress values, which one slot per run can't afford.
- An innkeeper's "stay the night?" is a plain talk to an NPC that inns offer at any progress (hypothesis). Wall Market's inn (`mktinn`, field 0xC7 per `docs/FF7/Field/Field_ID.md`) is chosen over Kalm's (`elminn_1`): Kalm's inn hosts the flashback scene (`{elminn_2/ballet/s11}`), so its scripts are more likely to branch on progress.
- Talking (Xeeynamo/ff7-decomp@2c9239a `src/field/field_entity.c` FieldEntityCheckTalk, via #112): a Circle press talks to a model within TalkRange + SolidRange that the player faces within 64/256 of a turn. Walking toward an NPC faces it.

## Attempt 1 plan (diagnostic; one push)
`save-boot-14-choice-mktinn-diag`: boot `harness/saves/disc1-mktinn.json` (mktinn, triangle 0, x 0x7FFF, progress 6, Cloud alone, as #99's saves), load as `save-boot-1-load`, 60 frames with no input. Checks the field ID (199) and field mode. Reports `load_done`, `model_count`, and for models 1-3 the sign of PosX and PosY minus the player's (`d1x` … `d3y`). Only signs and counts leave.

What decides attempt 2: the load works, and a model's signs say which way the NPCs lie (models at the player's position, signs 0/0, are likely hidden party models). Attempt 2 then walks that way pressing Circle, and waits until window 0 is in state 6 with pointerEnabled 1; if that works it becomes the acceptance (Down → pointerY + 16, Up → back, Circle closes; rerun matches).

## Results
_Pending._
