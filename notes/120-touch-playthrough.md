# #120: headless touch-action playthrough (reactor entrance → first save point)

## Design
- **One growing scenario.** 63 of the 64 Tier 2 slots were taken when this started (2026-11-14), and the cap is in `harness/private-eval/`, a protected path (owner question 2 on #81). So `harness/scenarios/touch-playthrough.json` is the single playthrough scenario. Its input is one generated segment per stretch (`harness/scenarios/segments/touch-<n>-*.json`). A new stretch appends a segment, and the end checks and snapshot move to the new end.
- **Earlier stretches stay checked.** Each stretch ends on a `wait.until` (mode or field ID). A timeout fails the scenario and stops it there, so a later push cannot silently skip an earlier stretch.
- **Generated, not hand-written.** `runner/test/unit/playthrough-scenarios.js` builds the files from the touch layer:
  - walking: `createFieldDrag()` from `web/js/field-drag.js`, given a 40 px drag (short of `RUN_DISTANCE`, so no Cross), and its mask is turned into button names;
  - field buttons: `FIELD_ACTIONS` (`semantic/controls.js`);
  - battle turns: `battlePanelPlan` (`semantic/battle-panel.js`, #116) through `scriptFromPlan` (#111), then `BATTLE_PANEL_ACTIONS.select` and `.confirm`.

  `runner/test/unit/playthrough.test.js` fails if the committed files differ, if a held button is not one a touch control offers, or if a memory address differs from the confirmed `semantic/addresses.js` entry.
- **format 2 limits.** A `press` holds one set of buttons, so "drag up while tapping Interact" holds both for 15 of every 20 frames: a re-landed drag gives the same mask, because `field-drag.js` keeps no direction across a release. Scripts are linear, so the generator must know how many battle turns to plan (see stretch 1).

## Stretch 1: reactor-entrance → first guard battle → md1_1 (`touch-1-first-battle`)
1. Drag up with Interact taps until `gameState` = battle. #76 reached it in 839 frames from `field-after-menu`; this stretch starts directly at `reactor-entrance` (hypothesis: the same walk works).
2. Wait for BattleMenuInit (`battleMenuWidget` = −1). Then **two Attack turns with the battle panel**. Each one: wait for the command menu (widget 1); check the row is 0 (the executor's start check); run the plan (empty for row 0); tap select (○); wait for targeting (widget 0); tap Confirm (○); wait for widget −1. The battle has two guards and one Attack fells at most one, so it lasts at least two turns.
3. Until field mode: ○ every 30 frames. That is Command 1 (empty plan) and Confirm as the panel offers them, for any further turns, plus the classic pad's ○ on the result screens (auto-controls shows the classic pad outside field mode, and the panel is hidden then). The number of extra turns is unknown. Once Tier 2 shows it, the generator can plan them all as turns.
4. Interact taps until the picture is still for 5 s (as `reactor-next-0-after-battle`), then drag up-left until the field ID leaves md1stin (#77), then #77's load rule.

End checks: field ID 0x75 (md1_1), field mode, Cloud's HP in 1..9999, rerun match. Snapshot `touch-md1-1`.

## Results
### Attempt 1 (`5c866b4`, tier2: 63 pass, 1 fail)
| scenario | metrics |
|---|---|
| touch-playthrough | **battle_wait 839**, **turn1 496**, turn2 0, end_wait 0, next_wait 0, next_ok 0, hp_ok 0, match 0 |

Reading:
- **Dragging up with Interact taps from `reactor-entrance` reaches the first guard battle** in 839 frames, the same as #76 from `field-after-menu`. The menu open/close before it changes nothing.
- Cloud's first command menu opened 496 frames after BattleMenuInit (widget −1 → 1).
- Then a wait timed out: one of turn 1's row check, target selection (widget 0) or command taken (widget −1), each within 30 frames, or turn 2's command menu within 1800 frames. A timeout zeroes every later metric, so this run can't say which.
- Every other scenario passed unchanged.

### Attempt 2 (diagnostic)
`t1_target` and `t1_done` are the frames of turn 1's target and taken waits. Turn 2's menu wait is 3600 frames, in case the guards' actions hold Cloud's next turn. **Likely cause, fixed in the same push:** attempt 1 pressed select one frame after the menu opened, but `reactor-mode-4f`, which confirmed these values, left the menu for 30 frames first. A press during the menu's opening may be ignored, so each turn now waits `MENU_SETTLE` = 30 frames before the row check (a real tap can't land in the panel's first frame anyway). `next_ok` and `hp_ok` stay as checks without metrics (the limit is 8).

### Attempt 2 results (`370ccb5`, tier2: 64 pass, 0 fail)
| scenario | metrics |
|---|---|
| touch-playthrough | battle_wait 839, turn1 496, **t1_target 1, t1_done 1, turn2 752**, end_wait 482, next_wait 495, match 1 |

Reading:
- **Stretch 1 passes with touch actions only.** The end checks held: md1_1 (0x75), field mode, Cloud's HP in 1..9999, and the rerun from `reactor-entrance` matched.
- **The cause of attempt 1 was the immediate tap.** With 30 frames between the menu opening and the tap, select reaches target selection one frame after the press (t1_target 1), and Confirm takes the command one frame after its press (t1_done 1), as #110 saw.
- Cloud's second command menu opened 752 frames after the first command was taken. After turn 2, 482 frames of Command 1 / Confirm and result-screen taps ended the battle. How many of those were extra Attack turns is not measured; two planned turns plus the fallback win the battle.
- The walk off took 495 frames, the same as `reactor-next-1-walk-off` (#77). The after-battle field state matches #77's.
- Every other scenario passed unchanged.

### Run 2
The next push repeats the same script, to check determinism (the acceptance asks for two runs).

## Stretch 2: md1_1 → md1_2 (`touch-2-md1-1-walk`, PR #197)
Only one Tier 2 slot, so stretch 1's waits stay in the scenario (a timeout still fails it) but its metric names are dropped: the 8 metrics go to the current stretch.

### Attempt 1 (`4237845`, probe; tier2: 64 pass, 0 fail)
In md1_1 just after it loads: wait 30 frames, mark, drag up 20 frames.
| scenario | metrics |
|---|---|
| touch-playthrough | gw0_to 116, gw1_to 118, g0x −1, g0y −1, g1x −1, g1y 1, up_dx 1, up_dy 1 |

Reading:
- md1_1 gateway 0 leads back to md1stin (116); **gateway 1 leads to md1_2 (118 = 0x76)**.
- Gateway 1's first end lies at −x, +y from the player (signs of x1/y1 only; the line could still straddle the player in x).
- A drag up moves the player +x, +y, as in md1stin (`reactor-field-5-walk-up`), so the camera is turned the same way, and the md1_2 exit is **up-left**, the drag that left md1stin.
- Stretch 1's waits all held (the scenario passed), so stretch 1 repeated for a third run.

### Attempt 2 (diagnostic walk)
A fixed 2400-frame drag up-left with Interact taps (15 of every 20 frames), no `wait.until`, so the end checks report where it got to: `map_cur` and `game_state` at the end, the signs of both ends of gateway 1 against the player (in whatever field it ends in), and the signs of the player's move. The goal check is md1_2 (0x76) in field mode. #101 held Up+Left in md1_1 for 5236 frames (from a generated save, progress 6) and met a random battle without leaving, so up-left alone may hit a wall; if so, attempt 3 uses these signs to route round it.

### Attempt 2 results (`6a723f2`, tier2: 63 pass, 1 fail)
| scenario | metrics |
|---|---|
| touch-playthrough (fail) | map_cur 117, game_state 1, g1x 1, g1y 1, g1x2 1, g1y2 1, mv_dx −1, mv_dy −1 |

Reading:
- **2400 frames of up-left did not leave md1_1**; the game is in field mode at the end, so no battle or menu.
- Over the walk the player's PosX and PosY both fell. A drag up moves +x/+y, so up-left was expected to give mostly +y; the net −x/−y suggests a wall, a slide along one, or a scene moving Cloud (the Interact taps may have started one). Not resolved: there are no metrics for it.
- At the end **both ends of gateway 1 (to md1_2) lie at +x/+y** from the player: the direction a drag up moves.
- Every other scenario passed unchanged.

### Attempt 3 (last of 3)
The same up-left leg (its end state is known), then mark and drag **up** with Interact taps for 1200 frames. Same checks and metrics, with the move signs over the up leg only. If it still doesn't arrive, stop and report on #120 (attempt budget used).

### Attempt 3 results (`423bc94`, tier2: 63 pass, 1 fail)
| scenario | metrics |
|---|---|
| touch-playthrough (fail) | map_cur 117, game_state 1, g1x −1, g1x2 1, g1y 1, g1y2 1, mv_dx 1, mv_dy 1 |

Reading:
- After 1200 more frames of drag up (with Interact taps), the player is **still in md1_1, in field mode**. Over the up leg it moved +x/+y, as a drag up should.
- At the end, **gateway 1 straddles the player in x** (x1 left, x2 right) and **both ends are still at +y**: Cloud is just below the md1_2 exit line but did not cross it, after up to 1200 frames of trying.
- Hypotheses (not tested): a wall or solid model between Cloud and the line (in the game, the party and a gate stand at md1_1's far side); a scene that must play first (the field's script may hold the exit until an event, for example Barret's at the gate, has run, and Interact taps alone did not start it); or the gateway's line is out of reach (z), since `fieldZ` is still a hypothesis.
- Every other scenario passed unchanged.

**Stop: three attempts used** (CLAUDE.md). Stretch 2 is reported on #120 with these blockers; PR #197 stays `[WIP]`. Suggested next step for a fresh budget: one diagnostic that measures, during the up leg, whether PosY stops rising (a `change … since` mark partway), whether a message window opens (`dialogState`, #108) and whether field models other than the player move (a scene); then route accordingly.

## Next stretches (route still unknown)
md1_1 → md1_2 → the reactor interior → the first save point. Field IDs and exits come from `nearby()` gateways (#112) and the field ID reader. There is only one slot, so exploration diagnostics have to share the scenario's 8 metrics. If that is too slow, record it on #120 as the owner question on the slot cap.
