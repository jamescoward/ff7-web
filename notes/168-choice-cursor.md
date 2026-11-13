# #168: the dialogue choice cursor (dialogPointer, dialogPointerY)

Status (2026-11-13): **blocked.** All three attempts are used and none reached a choice window, or any window at all, in mktinn. The scenarios and the mktinn save are removed; their definitions are in this branch's history (`f8c5b7c`, `f2f9903`, `f780865`).

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

### Attempt 2 (`f2f9903`, tier2: 61 pass, 3 fail)
| scenario | load_done | ptr_wait | x_dir y_dir | ptr_y | down_dir | win6 | match |
|---|---|---|---|---|---|---|---|
| save-boot-14a-choice-mktinn-right | 295 | **0 (timeout)** | 0 0 | 0 | 0 | 0 | 0 |
| save-boot-14b-choice-mktinn-down | 295 | **0 (timeout)** | 0 0 | 0 | 0 | 0 | 0 |
| save-boot-14c-choice-mktinn-right-down | 295 | **0 (timeout)** | 0 0 | 0 | 0 | 0 | 0 |

Every other scenario passed unchanged.

Reading:
- In none of the three directions did pointerEnabled read 1 within 1800 frames of Circle every 30 frames after the walk. **No choice window was reached.**
- A timeout stops the script and zeroes every check (README, Conditions), so `x_dir`/`y_dir` say nothing about where the walk went, and nothing tells whether *any* window opened (a plain message from an NPC, or none at all). That is the design flaw to fix: a raw memory metric (a location named in `metrics`) still reports its value after a timeout (as `map_cur` did in #108's timed-out diagnostic), while `change`/`compare` checks don't.

## Options for attempt 3 (the last in the budget)
1. **Same field, robust diagnostics plus a wider search.** Per scenario, walk several legs (e.g. Right, then Up, then Left) with Circle presses between legs, then the pointer wait. Report raw `win0` and `ptr_en` (they survive a timeout), and replace `change` checks by `mark`-free raw evidence where possible. This tells whether any NPC was talked to.
2. **Another candidate.** The inn's vending machine (`{mktinn/cloud/s4}` in ff7-flat-wiki Savemap: a 200/100/50 gil choice) is a script of Cloud's own entity, which suggests a trigger the player walks into rather than an NPC talk; where it is in the room is unknown.
3. **Stop:** record that no choice window is reachable with the current boot points, and ask (as a `needs-owner` question) for a documented progress value for a story choice (Aerith's flower in md8_1, Tifa's drink in the Seventh Heaven fields).

If attempt 3 also fails, the contract says stop and report the blockers on #168.

## Attempt 3 plan (chosen: option 1, reworked; one push, the same three slots)
Checked against the reference first (Xeeynamo/ff7-decomp@2c9239a, reference only, no code copied): `include/game.h` WindowData puts pointerEnabled at +0x1A and state at +0x2C, so the addresses are right. `src/field/field_dialog.c` FieldDialogAskUpdateStates is the only writer of pointerY (`selectedLine * 16 + 6`, only while an ask waits in TXT_DONE) and sets pointerEnabled 1 there; it also blinks pointerEnabled while an ask window closes. A plain message (FieldDialogMessageUpdateStates) never sets it, so attempt 2's timeouts mean no ask was shown, not a bad address.

What changes from attempt 2:
- **Talk while walking.** Attempt 2 walked for 120 frames and only then pressed Circle, so a walk that slid past an NPC, or stopped out of talk range, never talked. Now phase 1 holds the direction plus Circle for 7 of every 8 frames (a Circle edge every 8 frames while the player walks and faces the way it goes), until window 0 leaves state 0: `win_wait`, timeout 600. It ends on the first frame any message or ask opens, so the player stops there.
- **Every phase reports its own metric.** Earlier wait metrics survive a later timeout (attempt 2's `load_done` did), so the first zero says how far it got: `win_wait` 0 = no talk in that direction; `win_wait` > 0 and `ptr_wait` 0 = a plain message, no ask.
- **The acceptance is in the same run.** After `ptr_wait`: mark `ask`, Down (4 frames, one edge) + 12, mark `down`, Up (4) + 12, `still6` (window 0 still in state 6), Circle (4) picks and closes (`close_wait`: window 0 back to 0, timeout 300), `match` (rerun). pointerY is written only while an ask waits, so its end value is the one after Up: `up_dir` = −1 (lower than after Down: Up moved it, so Down had raised it; Up can only lower or keep it) and `back_dir` = 0 (where the pointer appeared). One edge moves one line, and pointerY is line × 16 + 6, so a one-line move is +16 (from the reference; the run reports signs only).
- Directions as attempt 2 (14a Right, 14b Down, 14c Right+Down), since attempt 2's walk results were lost to the timeouts.

Pass for #168: in one direction, all of win_wait, ptr_wait, still6, close_wait > 0, up_dir −1, back_dir 0, match 1. Then `dialogPointer`/`dialogPointerY` become confirmed, the passing scenario stays and the other two are removed. If none passes, the budget is spent: remove the three scenarios (keep a passing one only), record the metrics here and the blockers on #168, and leave it `status:blocked`.

### Attempt 3 (`f780865`, tier2: 61 pass, 3 fail)
| scenario | load_done | win_wait | ptr_wait | up_dir | back_dir | still6 | close_wait | match |
|---|---|---|---|---|---|---|---|---|
| save-boot-14a-choice-mktinn-right | 295 | **0 (timeout)** | 0 | 0 | 0 | 0 | 0 | 0 |
| save-boot-14b-choice-mktinn-down | 295 | **0 (timeout)** | 0 | 0 | 0 | 0 | 0 | 0 |
| save-boot-14c-choice-mktinn-right-down | 295 | **0 (timeout)** | 0 | 0 | 0 | 0 | 0 | 0 |

Every other scenario passed unchanged.

Reading: in none of the three directions did window 0 leave state 0 within 600 frames of walking with a Circle edge every 8 frames. So no talk happened at all: not a plain message, not an ask. Attempt 2's timeouts are explained by the same thing. Possible causes, none tested:
- the walk never comes within talk range of models 1-3 in these directions (camera mapping unknown here; the walk may stop against furniture or a counter);
- models 1-3 are not talkable at this progress value (their talk scripts may be disabled, or they may be props and not NPCs);
- the player cannot move from triangle 0's centroid in mktinn (never checked here; #99 checked movement in five other fields only).

## Blockers (for whoever takes #168 next)
1. **No known route to an ask.** One field with three directions and two talk methods found no window. A blind search costs one push per three tries, against a 64-scenario cap that main nearly fills (61).
2. **What would unblock it:** a documented location of a talkable NPC with an ask: a field, a progress value and a position. For example, a source giving the innkeeper's coordinates in an inn whose script asks at any progress, or a documented progress value for a story choice (Aerith's flower in md8_1, Tifa's drink in Seventh Heaven). Another way is a diagnostic budget of more than 3 slots, from freeing slots or raising the cap: the cap is in `harness/private-eval/` (protected), so that needs the owner.
3. A cheaper next diagnostic, if someone retries: report `x_dir`/`y_dir` from a walk with **no** wait (so a timeout can't zero them) and `fieldSolidRange`/talk-range signs to models 1-3 (as #112's `nearby()` does). That tells whether the walk reaches any model before any more talk attempts.
