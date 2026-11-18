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

## #200: diagnostic of stretch 2's blocker (PR #201)
This measures and makes no route attempt. Its budget is 2 Tier 2 runs. Both runs replay PR #197 attempt 3's input exactly: in md1_1 after it loads, wait 30 frames, drag up-left for 2400 frames, then drag up for 1200 frames, with Interact taps 15 of every 20 frames. Mark steps take no frames, so they don't change the input. The touch-playthrough scenario is used on the #200 branch only (`DIAGNOSTIC` in the generator); main keeps stretch 1.

### Run 1 (`e9f45c0`, tier2: 63 pass, 1 fail by design)
Marks at 0, 100, 300 and 700 frames into the up leg.

| scenario | metrics |
|---|---|
| touch-playthrough (fail) | dy_100 0, dy_300 0, dy_700 0, dx_700 0, m1_dx 0, m2_dx 0, dlg 0, mcount 7 |

Reading:
- **No message window is open at the end** (dialogState 0), and the field has 7 models. These are plain reads at the end of the run, so they hold whether or not every wait held.
- PosY and PosX show no change after the 100-frame mark, and field models 1 and 2 show no move over the up leg. **This is ambiguous by itself:** a `change` metric is also 0 when an earlier wait timed out (the script then stops there). Attempt 3 saw +1/+1 over the whole up leg, so if the script ran to the end, Cloud moved only in the first 100 frames of the up leg and then stood still for about 1100 frames with no window open and models 1 and 2 still. That points to a wall or solid obstacle, not a scene.
- Run 2 settles the ambiguity and times the stall.

### Run 2 (`ff81bf4`, tier2: 63 pass, 1 fail by design; last of the budget)
Marks at 0, 20, 40, 60 and 100 frames into the up leg.

| scenario | metrics |
|---|---|
| touch-playthrough (fail) | dy_0 1, dx_0 1, dy_20 1, dy_40 1, dy_60 1, dx_100 0, map_cur 117, game_state 1 |

Reading:
- **The script ran to the end:** PosY and PosX rose over the up leg (dy_0, dx_0 = +1, as in attempt 3). So run 1's zeros are real readings, not a timeout.
- **Cloud stops between 60 and 100 frames into the up leg.** PosY still changes after the 60-frame mark (dy_60 +1), and neither PosY nor PosX changes after the 100-frame mark (run 1: dy_100, dx_700 0; run 2: dx_100 0). The input is the same in both runs, and every earlier part of the chain has repeated exactly in each run so far.
- He then stands still in md1_1 (117), in field mode, for about 1100 frames of drag-up with Interact taps.

### Conclusion (#200)
| hypothesis | verdict |
|---|---|
| (a) a wall or solid model stops Cloud below the line | **supported.** He walks up for 60-100 frames, then stops dead, with no sideways slide. Nothing else changes that the diagnostic could see. |
| (b) a scene holds the exit | **not supported as far as measured.** No message window is open at the end; field models 1 and 2 don't move over the up leg; the mode stays field. Not ruled out: a window that opens and closes mid-leg, or models 3-6 moving. |
| (c) the line is out of reach in z | not tested (`fieldZ` is still a hypothesis). It wouldn't explain Cloud stopping dead. |

**Route suggestion for #120 stretch 2 (a fresh budget there):** at the stall point, gateway 1 straddles Cloud in x with both ends above him (+y) (attempt 3). Something blocks the straight-up drag just short of the line.
- Next, try a short drag up-right, then up-left, from the stall point, with `change … since` signs, to find which way slides past the obstacle.
- If neither moves Cloud, read which field model is nearest above him. #112's `nearby()` model positions as signs would show whether a solid model (for example a party member or the gate) stands in the way.

## #202: probe a way past the obstacle (PR #203)
This measures and makes no route attempt (budget: 2 Tier 2 runs). Input: in md1_1 after it loads, wait 30 frames; drag up-left for 2400 frames (attempt 3's first leg); drag up for 200 frames, which reaches #200's stall (60-100 frames in); then mark `p0`, drag in the probe direction for 600 frames with a mark `p200` 200 frames in; wait 30 frames. Interact taps go 15 of every 20 frames throughout. Branch only (`DIAGNOSTIC`, `PROBE` in the generator).

### Run 1: probe up-right (`3c023c5`, tier2: 64 pass, 0 fail)
| scenario | metrics |
|---|---|
| touch-playthrough | dx_p0 1, dy_p0 1, dy_p200 1, g1x −1, g1x2 −1, g1y 1, map_cur 117, game_state 1 |

Reading:
- **Up-right moves Cloud from the stall point**, +x and +y over the probe, and he is still moving in y after 200 frames of it (dy_p200 +1). It is not a dead end.
- At the end **both of gateway 1's x ends are left of him** (g1x, g1x2 −1; at the stall they straddled him, attempt 3), and its y1 end is still above him (g1y +1). So he slid along the obstacle to the right, past the line's right end, without reaching it in y.
- He stays in md1_1 (117), in field mode.
- So up-right is the wrong way past the obstacle: it goes round to the right of the exit. Run 2 tries up-left.

### Run 2: probe up-left (`b1c8f02`, tier2: 64 pass, 0 fail; last of the budget)
| scenario | metrics |
|---|---|
| touch-playthrough | dx_p0 −1, dy_p0 −1, dy_p200 −1, g1x 1, g1x2 1, g1y 1, map_cur 117, game_state 1 |

Reading:
- **Up-left moves Cloud from the stall point too, but away from the line:** −x and −y over the probe, still moving after 200 frames.
- At the end **both of gateway 1's x ends are right of him** (g1x, g1x2 +1), and y1 is still above him. He went past the line's left end, moving back down in y.
- He stays in md1_1 (117), in field mode.

### Conclusion (#202)
- From #200's stall point, Cloud is **not stuck**: both diagonal drags move him, over the whole probe and still after 200 frames of it. The signs don't show whether he moved every frame.
- **Neither reaches gateway 1's line.** Up-right slides along the obstacle to the right, past the line's right end, with y still rising but below y1. Up-left goes back down (−y) and past the left end.
- So the obstacle spans at least the line's x-range just below it. A straight or diagonal drag from below does not reach the md1_2 exit.
- Hypothesis: screen up-left gives −x/−y here, while screen up gives +x/+y. That is not a simple rotation, but sliding along the obstacle confounds it. Either way, screen directions are a poor guide here, and the route needs world-space feedback.

**Route suggestion for #120 stretch 2 (a fresh budget there):**
- Approach gateway 1 from the side. After run 1's up-right slide (which ends right of the line and still rising in y), drag up, then left, with `compare` signs against gateway 1 to see whether Cloud gets above y1 there.
- Alternatively, read the walkmesh or the nearest solid model at the stall point. That needs new address-table entries, so it is its own issue.
- Not tested: whether gateway 1's line is reachable in z (`fieldZ` is a hypothesis), and whether y2 differs from y1 (only y1 was compared).

## #204: is a field model the obstacle? (PR #205)
This measures and makes no route attempt (budget: 2 Tier 2 runs). Input: in md1_1 after it loads, wait 30 frames; drag up-left for 2400 frames, then up for 200 frames (to #200's stall point, as #202); wait 30 frames. Interact taps go 15 of every 20 frames throughout. Branch only (`DIAGNOSTIC`, `DIAG_RUN` in the generator). The positions of field models 1-6 (`fieldX`/`fieldY` elements 1-6) are hypotheses: #99 confirmed only element 0.

### Run 1: models' y against Cloud (`c03ca4e`, tier2: 64 pass, 0 fail)
| scenario | metrics |
|---|---|
| touch-playthrough | m1y 1, m2y 1, m3y 1, m4y 1, m5y 1, m6y 1, g1y 1, map_cur 117 |

Reading:
- **Every other field model (1-6) is above Cloud in y** at the stall point (PosY greater, raw units). Gateway 1's y1 is above him too (+1, as in #202), and he is still in md1_1 (117), in field mode.
- So Cloud is the lowest model here. This alone doesn't single out an obstacle: run 2 checks which models lie below gateway 1's line, between Cloud and the exit.

### Run 2: models against gateway 1's line (`e0ec4da`, tier2: 64 pass, 0 fail; last of the budget)
| scenario | metrics |
|---|---|
| touch-playthrough | l1 1, l2 1, l3 1, l4 1, l5 −1, l6 −1, g1y2 1, map_cur 117 |

`l<k>` is the sign of gateway 1's y1 minus model k's PosY (>> 12, field units): +1 means the model is below the line.

Reading:
- **Models 1-4 are below the md1_2 line and above Cloud** (run 1): in y they lie between him and the exit. Models 5 and 6 are beyond the line.
- Gateway 1's other end (y2) is above Cloud too (g1y2 +1), so the whole line is above him, as #202 found for y1.
- Their x against the line's ends was not measured (budget), so whether any of models 1-4 stands inside the line's x-range, right in Cloud's way, is open.

### Conclusion (#204)
- Four field models stand in the band between Cloud's stall point and the md1_2 exit line (in y). That fits a **solid model** hypothesis (#200, #202: the obstacle spans the line's x-range just below it): for example party members or an NPC at the exit, which a field-script scene may move. It does not rule out a walkmesh wall.
- Caveats: model positions for k ≥ 1 are address-table hypotheses (#99 confirmed only model 0), and only y was compared.
- **Suggested next step for #120 stretch 2** (needs a fresh budget there; the 3/3 stop stands): read models 1-4's x against gateway 1's x1/x2 (8 metrics fit), and, if one stands in the line's x-range, check whether it is talkable (`fieldTalkOff`, hypothesis) and try Interact while facing it. A field-script scene may need a talk to clear the way.

## Stretch 2, fresh budget (owner, 2026-11-18): attempt 1, a batch of probes
The owner gave stretch 2 a fresh budget of 3 attempts (#120, comment of 2026-11-18) and raised the Tier 2 cap to 128 (PR #206). So attempt 1 batches four probes, each its own scenario booting from `touch-md1-1` (`touch-playthrough` runs first and keeps it; file names sort `touch-p` < `touch-s`). `touch-playthrough` stays stretch 1 and stays green. All input is drag directions (field-drag.js) and Interact taps (15 of every 20 frames). Generated by `probeScenarios()` (`PROBES_ON`).

| scenario | question | metrics |
|---|---|---|
| `touch-s2a-models-x` | which of models 1-4 stands in gateway 1's x-range at #200's stall point (#204's suggested step) | `a<k>` / `b<k>`: sign of x1 / x2 minus model k's x |
| `touch-s2b-window-up-left` | does window 0 open during the up-left leg (taps would close it again, so #200's end read would miss it) | `w_ul`, `w_close`, `map_cur`, `dlg` |
| `touch-s2c-window-up` | the same during the up leg; if so, close it and drag up to the exit | `w_up`, `w_close`, `w_exit`, `map_cur`, `dlg` |
| `touch-s2d-around-right` | a route round the obstacle's right end: stall, up-right 600, up 400, left 1200 | `map_cur`, `dy_u2`, `dx_l`, `dy_l`, `g1x`, `g1x2`, `g1y`, `g1y2` |

A wait that times out stops its script and reports 0 (s2b, s2c), so those probes may fail by design. Model positions for k ≥ 1 are still hypotheses (#99).
