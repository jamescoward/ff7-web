# #112: field interactables (`nearby()`)

Status (2026-11-12): done. Attempt 1 (`dcb5cb7`, and again on `c7f3645`) passed: tier2 61 pass, 0 fail, the same metrics both times. Attempts used: 1 of 3.

## Sources (reference only; no code copied)
**Xeeynamo/ff7-decomp @ `2c9239a4da08f039b1dcd4a3c9c34fe3fe7287fe`** (AGPL; facts only, cited by commit):
- `config/symbols.main.us.txt`: g_FieldState 0x8009ABF4, g_FieldTriggers 0x800716C4, g_FieldModelCount 0x8009C6C4, g_FieldEntity 0x80074EA4, g_FieldLines 0x8007E7AC.
- `include/game.h`: FieldState (modelCount +0x28, pcModelId +0x2A), FieldEntity (size 0x84: PosZ +0x14, Dir +0x38, TalkOff +0x5B, SolidRange +0x6C, TalkRange +0x6E), FieldTriggers (gateways[12] at +0x38), FieldGateway (0x18 bytes: LinePos x1,y1,z1,x2,y2,z2 as s16, fieldMapId u16 at +0x12), LinePos.
- `src/field/field_private.h`: FieldDatHeader (triggers pointer; field file at 0x80115000, textures from 0x80128000).
- `src/field/field_entity.c`: FieldEntityCheckTalk, FieldEntityDirByVec, FieldEntityGatewayCheck, FieldEntitySqrDistToLine, FieldEntityInitPos.

## What the game does (as the decomp describes it)
- **There is no persistent "can talk" flag.** On the frame Circle goes down, the field module looks at every model other than the player whose TalkOff is clear and that is not at the player's exact x/y, with a height difference under 256. A model qualifies when its ground distance is less than its TalkRange plus the player's SolidRange and the player faces it within 64/256 of a turn. The one faced most directly gets `requestTalkScript = 1`, which its script then consumes. So "in range" can only be computed from the same values; `semantic/nearby.js talkCheck` restates that rule (own implementation; the game's angle uses a lookup table, so ours may differ by a step).
- **Facing convention:** FieldEntity.Dir is 64 more than the angle of a vector measured from +x towards +y, in 1/256 turns.
- **Gateways** are line segments in the field file, behind the pointer g_FieldTriggers. The game checks them while the player moves: if the player is within its SolidRange of the line (and the nearest point lies within the segment) and the step crosses the line, it changes field. Unused slots have fieldMapId 0x7FFF.
- **Save points:** nothing found yet that tells a save point model from another model; `nearby()` never reports `save` (follow-up).
- g_FieldLines (32 FieldLine records: event lines with touch/talk requests) are script lines, not exits; not used.

## What changed
- **Format 2** (`runner/format2.js`, `runner/scenario.js`, `harness/schema/scenario.schema.json`, `harness/README.md`): a memory location may carry `deref` (addr holds a u32 pointer; the location is pointer + offset, read again each time; missing when not in main RAM). A new `compare` check reports only the sign of `mem - (with >> shift)`. Both are needed because the gateways sit behind a pointer and their position only means something relative to the player's; only signs leave, as with `change`.
- **Semantic layer:** entries `fieldModelCount`, `fieldZ`, `fieldDir`, `fieldSolidRange`, `fieldTalkOff`, `fieldTalkRange`, `fieldTriggers` (all hypotheses), `FIELD_GATEWAYS` layout; `semantic/nearby.js` (pure rules); `layer.nearby()`.

## Attempt 1 plan (one push)
Both from `after-battle` (md1stin, Cloud alone), within the 64-scenario cap (63 used):
- `reactor-next-3-exit-side`: g_FieldTriggers points into 0x80115000..0x80127FFF (ptr_ok); gateway 0 leads to md1_1 0x75 (gw0_md1_1); gateway 1 does not (diagnostic); both ends of gateway 0's line are left of the player (x1s, x2s: sign of end − PosX>>12) and above it (y1s, y2s), the side #77's walk leaves by (up-left). Signs are reported even when a check fails.
- `reactor-next-4-models`: modelCount in 1..16, equal to g_FieldModelCount (cnt_agree: sign), player index below it (pm_below), the player's SolidRange in 1..255, Dir in 32..96 after holding right 30 frames (+x is 64), and the player's own TalkOff reads 0 (diagnostic).

What decides attempt 2: which gateway leads to md1_1 and where its ends lie; whether the count candidates agree; whether Dir follows the stated convention.

## Results

### Attempt 1 (`dcb5cb7` and `c7f3645`: two Tier 2 runs, 61 pass, 0 fail, identical metrics)
| scenario | metrics |
|---|---|
| reactor-next-3-exit-side | ptr_ok 1, gw0_md1_1 1, gw1_not_md1_1 1, x1s −1, x2s −1, y1s 1, y2s 1, match 1 |
| reactor-next-4-models | count_ok 1, cnt_agree 0, pm_below −1, solid_ok 1, dir_right 1, talk_clear 1, match 1 |

Every earlier scenario passed unchanged.

Reading:
- **Gateways:** g_FieldTriggers points into the field file area, gateway 0 leads to md1_1 (the field #77's up-left walk reaches) and gateway 1 does not. Both ends of gateway 0's line lie left of and above the player: the exit is on the side the walk leaves by. That is the contract's exit acceptance, and it confirms the pointer, the gateways' offset (+0x38), the record size (gateway 1 at +0x18 read something other than 0x75), fieldMapId at +0x12 and x/y at +0/+2/+6/+8. z (+4, +0xA) was not checked.
- **Models:** g_FieldState.modelCount and g_FieldModelCount agree (sign 0) and are in 1..16; the player index is below it. The player's SolidRange is in 1..255. Dir after walking right (PosX rising) is in 32..96: +x is 64, as FieldEntityDirByVec's convention says.
- The player's own TalkOff reads 0; that says nothing about NPCs, so fieldTalkOff stays a hypothesis.

Confirmed: `fieldTriggers` (with FIELD_GATEWAYS' x, y and fieldMapId), `fieldModelCount`, `fieldSolidRange`, `fieldDir`. Still hypotheses: `fieldZ`, `fieldTalkOff`, `fieldTalkRange`.

## Outcome
- `nearby()` reports exits (`kind: 'exit'`, `to`, `dx`, `dy`, `inRange`) from confirmed entries, except that the exit's `inRange` also uses fieldZ.
- **"Can act" flag: none exists** (the decomp evaluates talk range only on the Circle press). As the contract allows, `nearby()` falls back to the game's own rule over entity values (talkCheck), stated as a hypothesis: `confirmed` is false while fieldTalkRange, fieldTalkOff and fieldZ are hypotheses. No reachable field with a talkable NPC is known yet: #108 found no field window in md1stin after the first battle.
- `save` is never reported: no signal tells a save point model apart.

## Follow-ups
- Confirm the talk rule (fieldTalkRange, fieldTalkOff, fieldZ) in Tier 2: walk up to a talkable NPC in a reachable field, check that the predicted `inRange` turns on, and that Circle then opens a message window (dialogState, confirmed by #108). It needs a boot point with an NPC (#80's catalogue).
- Tell save points apart (a model the save point script owns, or the menu's save flag) to report `kind: 'save'`.
