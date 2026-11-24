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

### Fresh attempt 1 results (`b89cbc0`, tier2: 65 pass, 3 fail by design)
`touch-playthrough` (stretch 1) passed with the same metrics as before (battle_wait 839, turn1 496, turn2 752, end_wait 482, next_wait 495, match 1).

| scenario | status | metrics |
|---|---|---|
| touch-s2a-models-x | pass | a1 −1, b1 −1; a2 1, b2 1; **a3 −1, b3 1**; a4 −1, b4 −1 |
| touch-s2b-window-up-left | fail (by design) | w_ul 0, w_close 0, map_cur 117, dlg 0 |
| touch-s2c-window-up | fail (by design) | w_up 0, w_close 0, w_exit 0, map_cur 117, dlg 0 |
| touch-s2d-around-right | fail (md1_2 not reached) | dy_u2 1, dx_l −1, dy_l 1, g1x −1, g1x2 −1, g1y 1, g1y2 1, map_cur 117 |

Reading:
- **Model 3 is the only one of models 1-4 inside gateway 1's x-range** (x1 < its x < x2). Model 2 is left of the line, and models 1 and 4 are right of it. With #204, model 3 stands between Cloud's stall point and the exit line, in both x and y. (Model positions for k ≥ 1 are still hypotheses.)
- **No message window opens** during 2400 frames of up-left or 1200 frames of up with Interact taps. So dragging up into the obstacle and tapping Interact starts no talk.
- Round the right end: after the up-right slide, 400 frames up keep raising PosY, and the left drag moves Cloud left and still up. He ends right of the whole line and still below it (both ends +y). This route doesn't reach the line in 2200 frames.

## Stretch 2, fresh attempt 2: talk to model 3 facing other ways
Six probes replace attempt 1's, again booting from `touch-md1-1` with `touch-playthrough` left as stretch 1:
- `touch-s2f-talk-{up-left,up-right,left,right,still}`: segment `touch-2-stall`, then Interact taps while dragging that way (or with no drag), until window 0 opens (`w_talk`, 600 frames). If it opens: taps until it closes (`w_close`), then drag up until the field ID leaves md1_1 (`w_exit`), and check md1_2.
- `touch-s2e-models-still`: after the stall, 600 frames with no input. Do models 1-4 move (`dy1..dy4`, `dx3`), which would mean a scene is running? Which side of Cloud is model 3 (`c3x`)? `dxc` checks that Cloud stays put.

### Fresh attempt 2 results (`aa67516`, tier2: 65 pass, 5 fail by design)
`touch-playthrough` passed unchanged.

| scenario | status | metrics |
|---|---|---|
| touch-s2e-models-still | pass | c3x 1, dy1 0, dy2 0, dy3 0, dy4 0, dx3 0, dxc 0, map_cur 117 |
| touch-s2f-talk-{up-left,up-right,left,right,still} | fail (no window) | w_talk 0, w_close 0, w_exit 0, map_cur 117, dlg 0 (all five) |

Reading:
- **No message window opens** in 600 frames of Interact taps facing up-left, up-right, left or right, or with no drag. With attempt 1 (up-left, up), Interact at the stall point starts no talk in any direction.
- **Models 1-4 don't move** during 600 still frames, and Cloud stays put: no scene is running at the stall. Model 3 (the one in the line's x-range) is to Cloud's right.
- So the way past is not a talk at the stall. Left: a scene trigger elsewhere in md1_1 that the route never crossed, or a walkmesh route not yet tried.

## Stretch 2, fresh attempt 3 (last): route sweeps over md1_1
Eight sweeps (`touch-s2g-sweep-*`) replace attempt 2's probes. Each boots from `touch-md1-1`, waits 30 frames, marks `go`, then drags with Interact taps: up 2400; up-right 2400; right 1200 then up 1200; from the stall right 300 then up 900, or left 300 then up 900; from the stall down 200, right 600, up 900, left 600; up-left 1200, up 600, right 900, up 600; and from the stall **running** (a drag past RUN_DISTANCE adds Cross, as field-drag.js does) up 600, up-right 300, up-left 300. Each checks for md1_2 at the end. Metrics: `map_cur`; `dy1..dy4` and `dx3`, the field models' moves since `go` (a scene started); `cy`, Cloud's PosY since `go`; `dlg`.

### Fresh attempt 3 results (`2916822`, tier2: 64 pass, 8 fail; last of the fresh budget)
`touch-playthrough` passed unchanged.

| sweep | map_cur | cy | dy1 dy2 dy3 dy4 dx3 | dlg |
|---|---|---|---|---|
| up 2400 | 117 | 1 | 0 0 0 0 0 | 0 |
| up-right 2400 | 117 | 1 | 0 0 0 0 0 | 0 |
| right 1200, up 1200 | 117 | 1 | 0 0 0 0 0 | 0 |
| stall, right 300, up 900 | 117 | 1 | 0 0 0 0 0 | 0 |
| stall, left 300, up 900 | 117 | 1 | 0 0 0 0 0 | 0 |
| stall, down 200, right 600, up 900, left 600 | 117 | 1 | 0 0 0 0 0 | 0 |
| stall, run up 600, up-right 300, up-left 300 | 117 | 1 | 0 0 0 0 0 | 0 |
| up-left 1200, up 600, right 900, up 600 | **116** | 1 | −1 1 1 1 1 | 0 |

Reading:
- **No sweep reaches md1_2.** In md1_1, models 1-4 never move and no window opens, from the entry or from the stall, walking or running.
- The up-left, up, right, up sweep ends in **md1stin (116)**: it crossed gateway 0 back. Its model signs come from md1stin's models, so they say nothing about md1_1.
- **Stop (fresh budget 3/3).** Six attempts over two budgets, plus three measurement-only issues (#200, #202, #204), haven't found the way to md1_2. What is known: model 3 stands in the exit line's x-range, between the stall point and the line. Nothing in md1_1 reacts to Interact at the stall or along these sweeps. No scene runs.
- **No touch action is shown to be missing.** Every stretch-2 input is a walk or run drag plus Interact, which is all the classic pad does in a field without a menu. The blocker is route knowledge (a trigger or path not found), not a touch action.

## Stretch 2, owner-hint attempt (owner, 2026-11-23): talk to a party member
The owner's hint, from memory and so a hypothesis: in md1_1 the way to md1_2 opens after talking to a party member (Biggs, else Jessie). If this fails, stretch 2 gets a third budget of 3 attempts that reads md1_1's line triggers and walkmesh instead of more sweeps.

Why it is worth a fresh look after "no talk at the stall": fresh attempts 1-3 watched only message window 0 and pressed Interact wherever Cloud stopped. Since then #237 confirmed the talk rule (`fieldTalkOff`, `fieldTalkRange`, `fieldSolidRange`, format 2's `near`), and #224 found messages that open in window 1.

The eight sweeps (`touch-s2g-*`) are replaced by ten probes (`hintScenarios()`), all booting from `touch-md1-1`; `touch-playthrough` stays stretch 1. Memory comes from the address table: windows 0-3 (`DIALOG_STATE_ENTRIES`), and element k of `fieldX`, `fieldY`, `fieldTalkRange`, `fieldTalkOff`, plus the player's `fieldSolidRange`.

| scenario | question | metrics |
|---|---|---|
| `touch-s2h-info-entry` | at md1_1's entry: is any of models 1-4 talkable (TalkOff) and in talk range | `off1..off4` (raw), `n1..n4` (near sign; −1 within) |
| `touch-s2h-info-stall` | the same at #200's stall point | the same |
| `touch-s2h-talk-{right,up-right,up,up-left,left,still}` | from the stall, Interact taps facing that way (or no drag): does **window 1** open? If so, close it and drag up to the exit | `w1_open`, `w1_close`, `exit`, `map_cur`, `n1..n4` at the end |
| `touch-s2h-talk-{r150,l150}-up` | the same after a 150-frame step right / left (model 3 is to Cloud's right) | the same |

A wait that times out stops its script and reports 0. md1_2 is the only end check, so the talk probes fail by design unless one reaches it.

### Owner-hint attempt results (`5035cc4`, tier2: 109 pass, 2 fail, 8 error)
`touch-playthrough` (stretch 1) passed with the same metrics as before (battle_wait 839, turn1 496, turn2 752, end_wait 482, next_wait 495, match 1).

| scenario | status | metrics |
|---|---|---|
| touch-s2h-info-entry | fail (by design) | off1 **1**, off2 0, off3 0, off4 0; n1 1, n2 1, n3 1, n4 1 |
| touch-s2h-info-stall | fail (by design) | off1 **1**, off2 0, off3 0, off4 0; n1 1, n2 1, n3 1, n4 1 |
| touch-s2h-talk-* (all 8) | **error** | none (not run, see below) |

Reading:
- **Models 2, 3 and 4 are talkable** (TalkOff 0); model 1 is not (TalkOff 1), at the entry and at the stall alike.
- **No model is within talk range** (ground distance ≥ TalkRange_k + the player's SolidRange) at the entry or at the stall. So every Interact press at the stall in fresh attempts 1-3 could not have started a talk under the confirmed rule (#237), whichever window it would open. The hint is not tested yet: Cloud has to be brought into range of model 2, 3 or 4 first.
- **The talk probes were most likely never started: the run hit Tier 2's time deadline.** `runner/tier2.js` stops starting scenarios after 1140 s (`--deadline-s`, under the sandbox's 1200 s limit) and reports the rest as `error`. The eval step ran 1149 s (04:50:21 to 05:09:30), and the eight errors are exactly the last eight scenarios in file order. A scenario fault isn't ruled out from this run alone, but the same steps load and pass every Tier 1 check. Tier 2's wall-clock budget, not the 128-slot cap, now limits how many probes a run can carry; main's own ~109 scenarios already take most of it.

**Next (cheap, few scenarios):** one probe at the stall that brackets how far out of range models 2-4 are, with `near` checks at several `plus` values (for example model 3 at +32, +64, +128, +256 and models 2 and 4 at +64, +256), then a walk towards the nearest talkable model (model 3 is right of Cloud and above him) with Interact taps, watching window 1 and the near sign. Keep each push to two or three probe scenarios because of the time budget.

### Owner-hint attempt, run 2 results (`0b3d215`, tier2: 110 pass, 3 fail)
`touch-playthrough` (stretch 1) passed unchanged. The eval step took 14.5 min with 113 scenarios, and nothing hit the deadline.

| scenario | status | metrics |
|---|---|---|
| touch-s2i-a-stall | pass | map_cur 117 (snapshot `touch-stall` kept) |
| touch-s2i-b-range | fail (by design) | n3p32 1, n3p64 1, n3p128 1, n3p256 1; n2p64 1, n2p256 1; n4p64 1, n4p256 1 |
| touch-s2i-walk-up-right | fail | w1_open 0 (timeout), so every later value is 0; map_cur 117 |
| touch-s2i-walk-right-up | fail | the same |

Reading:
- The kept snapshot chains: the other three probes booted from `touch-stall`.
- At the stall, **models 2, 3 and 4 are each more than 256 field units beyond talk range** (TalkRange_k + SolidRange_0 + 256).
- Neither walk towards model 3 (up-right with Interact taps, or right 150 and then up) opened window 1 within 900 frames. The timeout zeroed the end checks, so it is not known where the walks ended or whether they came closer.

### Owner-hint attempt, run 3 plan (`touch-s2i-*`)
`touch-s2i-a-stall` stays. The range probe and the two waiting walks are replaced:
- `touch-s2i-b-axis-3`: the sign of |model 3 − Cloud| along PosX and along PosY, minus 256, 512, 1024 and 2048 field units. A `near` check with the other coordinate set to Cloud's own gives one axis only.
- `touch-s2i-c-axis-24`: the same for models 2 and 4, at 512 and 2048.
- `touch-s2i-walk-right-300` and `touch-s2i-walk-up-right-300`: from the stall, drag with Interact taps for 300 frames, then 30 still frames. There is **no wait**, so nothing can zero the end values. Metrics:
  - n3, n3p256 and n3p1024;
  - raw w0 and w1;
  - cx and cy, the sign of Cloud's PosX and PosY change;
  - map_cur.

What it decides:
- A walk whose n3 bracket falls below the stall's (for example n3p256 −1) is heading into range. The next run lengthens that walk and taps until window 1 opens.
- If neither walk moves Cloud closer (cx or cy 0, or the brackets unchanged), the way to model 3 is walled. Use the axis brackets to try a route round.
- If nothing works, the hint attempt ends and the owner's third budget (line triggers and walkmesh) starts.

### Owner-hint attempt, run 3 results (`520b9ab`, tier2: 110 pass, 4 fail; the fails are probes)
`touch-playthrough` (stretch 1) passed unchanged. `touch-s2i-a-stall` passed (map_cur 117).

Axis brackets at the stall (sign of |model k − Cloud| along one axis minus n field units):

| model | ax | ay | \|Δx\| | \|Δy\| |
|---|---|---|---|---|
| 3 | 256 −, 512 −, 1024 −, 2048 − | 256 +, 512 +, 1024 +, 2048 − | < 256 | 1024–2048 |
| 2 | 512 −, 2048 − | 512 +, 2048 − | < 512 | 512–2048 |
| 4 | 512 −, 2048 − | 512 +, 2048 − | < 512 | 512–2048 |

Fixed walks from the stall (Interact taps, 300 frames, then 30 still; no wait):

| walk | cx | cy | n3 | n3p256 | n3p1024 | w0 | w1 | map_cur |
|---|---|---|---|---|---|---|---|---|
| right 300 | +1 | −1 | 1 | 1 | 1 | 0 | 0 | 117 |
| up-right 300 | +1 | +1 | 1 | 1 | **−1** | 0 | 0 | 117 |

Reading:
- **Model 3 is almost straight along PosY from the stall** (x within 256, y 1024–2048). Models 2 and 4 are in the same band.
- **Up-right closes in on model 3**: after 300 frames it is within TalkRange + SolidRange + 1024, but not + 256. Right moves Cloud −y and away. So model 3 lies on Cloud's +y side.
- Up-right also moves Cloud +x, so a longer up-right walk may drift past model 3 in x. Up or up-left may hold x better (md1_1's pad-to-axis mapping is not measured for those).
- No window was open at the end of either walk.

### Owner-hint attempt, run 4 plan (`touch-s2i-go-*`)
The axis probes and run 3's walks are removed (definitions in `520b9ab`); `touch-s2i-a-stall` stays. Five fixed walks from the stall: up-right 450 and 600, up 300 and 450, up-left 300. Each drags with **no Interact** for that time, then 10 still frames, Interact for 4 frames, and 40 still frames. Nothing waits on a condition. Metrics: n3, n3p256, ax3_256, ay3_256, raw w0 and w1, cx, cy.

What it decides:
- **A walk ends in range (n3 −1) and a window reads 6:** model 3's talk opens. Next, press through it and drag up to the exit, as the owner's hint expects.
- **In range but no window:** the hint fails for model 3. Try models 2 and 4 the same way, or start the third budget (line triggers and walkmesh).
- **Not in range:** the per-axis signs show which leg to add (x within 256 and y within 256 means close).

### Owner-hint attempt, run 4 results (`5190ebf`, tier2 run 464: 110 pass, 5 fail; the fails are the walks, md1_2 not reached by design)
Recorded 2026-11-24 from the `eval` job log. `touch-playthrough` (stretch 1) and `touch-s2i-a-stall` (map_cur 117) passed unchanged. Eval step 10.1 min.

| walk | cx | cy | n3 | n3p256 | ax3_256 | ay3_256 | w0 | w1 |
|---|---|---|---|---|---|---|---|---|
| up 300 | 0 | 0 | 1 | 1 | −1 | +1 | 0 | 0 |
| up 450 | 0 | 0 | 1 | 1 | −1 | +1 | 0 | 0 |
| up-left 300 | −1 | −1 | 1 | 1 | −1 | +1 | 0 | 0 |
| up-right 450 | +1 | +1 | 1 | 1 | **+1** | **−1** | 0 | 0 |
| up-right 600 | +1 | +1 | 1 | 1 | +1 | −1 | 0 | 0 |

Reading:
- **Up does not move Cloud at all from the stall** (cx, cy 0): a wall, most likely.
- Up-left moves him −x −y, away from model 3 (which is on his +y side).
- **Up-right lines Cloud up with model 3 along PosY** (Δy within 256) but carries him more than 256 past it along PosX, and he stays beyond TalkRange + SolidRange + 256. 450 and 600 frames give the same signs, so he may stall there as well (a hypothesis).
- No window was open after any walk.

### Owner-hint attempt, run 5 plan (`touch-s2i-go-*`, two legs)
The run 4 walks are replaced by five two-leg routes from the stall: up-right, then a correcting leg back along −x. The right drag moved Cloud +x −y (run 3), so left is taken to move −x +y (inferred, not measured in md1_1).

| route | legs |
|---|---|
| ur450-l60 / l120 / l200 | up-right 450, then left 60 / 120 / 200 |
| ur600-l120 | up-right 600, then left 120 |
| ur450-ul100 | up-right 450, then up-left 100 |

Each leg is dragged with no Interact, then 10 still frames, Interact for 4 frames, and 40 still frames. No step waits on a condition. Metrics: n3, n3p256, ax3_256, ay3_256, w0, w1, and **sx3, sy3** (the sign of model 3's PosX / PosY minus Cloud's), which take the place of cx and cy, so the side of any remaining gap is known.

What it decides:
- **n3 −1 and a window at 6:** model 3's talk opened. Next, press through it and drag up to the exit.
- **n3 −1 and no window:** in range but no talk (facing, or no talk at this progress value). Try models 2 and 4, or start the third budget (line triggers and walkmesh).
- **n3 +1:** the sides show which way the gap is. One more corrective run at most; if model 3 still can't be reached, the hint attempt ends and the third budget (walkmesh-aware routing, which #168 also needs) starts.

### Owner-hint attempt, run 5 results (`3df6efc`, tier2 run 475: 116 pass, 5 fail; the fails are the routes)
Recorded 2026-11-24 from the `eval` job log. `touch-playthrough` (stretch 1) and `touch-s2i-a-stall` passed unchanged. Eval step 12.1 min, with main's scenarios included.

All five routes (up-right 450 then left 60, 120 or 200; up-right 600 then left 120; up-right 450 then up-left 100) gave **identical** values: n3 +1, n3p256 +1, ax3_256 +1, ay3_256 −1, **sx3 −1, sy3 +1**, w0 0, w1 0.

Reading:
- After up-right, model 3 lies on Cloud's −x side, more than 256 away along PosX and within 256 along PosY. That matches run 4.
- The correcting leg changes nothing, at any length or direction. Left 60 and left 200 end with the same signs, and so does up-left 100. Up-right 450 and 600 already agreed in run 4. So **Cloud is pinned after up-right**, most likely against walkmesh edges, and no pad leg from there closes the x gap. This is a hypothesis: no position was reported.
- No window opened.

### Conclusion of the owner-hint attempt (2026-11-24)
Model 3 (and models 2 and 4, in the same band, run 3) can't be brought into talk range with straight or two-leg pad walks from the stall. Up is walled, up-left and right move away, and up-right pins Cloud more than 256 short along x. So the hint (talk to a party member) is **not tested**: the talk can't be reached by these walks. It is not refuted either.

**Next: the owner's third budget** (owner, 2026-11-23: "a third budget reads md1_1's line triggers and walkmesh"). Plan for its attempt 1:
- Inside the sandbox, read md1_1's walkmesh triangles and gateway/line triggers from field memory (addresses from the decomp, reference only). Search a path on the mesh from Cloud's position to (a) the md1_2 gateway line and (b) a point within model 3's talk range.
- Report **only** the pad legs (direction and frames), the path's triangle count and pass/fail. No mesh coordinates leave.
- If an off-device search is too much for one attempt, start smaller: report which neighbour triangle each of the stall triangle's three edges leads to (−1 for a wall). That is enough to choose legs by hand.
- #168 (blocked) needs the same routing for mds7st1, so build it once in a reusable runner module.

## Third budget (owner, 2026-11-23): route over md1_1's walkmesh

### Attempt 1 (2026-11-24): the format 2 `route` step
Blind pad sweeps can't tell a wall from a lock, and they can't steer round corners. So the sandbox now does the routing itself. A new script step, `{ "route": { "to": { "gateway": k } | { "model": k }, "timeout": n, "report": {...}, "leg": [...] } }`, works in three parts:
- `semantic/walkmesh.js` (pure, synced to `runner/semantic/` and `web/js/semantic/`) reads the walkmesh, adjacency and locks, finds a triangle path (A*), and picks pad directions;
- `runner/route.js` runs the closed loop. Each frame it reads Cloud's triangle and position, steers at the next portal midpoint (or at the goal in the last triangle), presses one of the 8 pad directions, and re-plans if Cloud leaves the path;
- it stops when the goal is reached, after 60 frames without moving (stuck), on leaving field mode (a random battle, say), or at the timeout.

**Only numbers leave:**
- the outcome code;
- the path length in triangles with and without blocked accesses (`path`, `free`);
- the locked-triangle count;
- frames;
- the pad legs, packed as code × 10000 + frames.

The emulator is deterministic, so a reported leg list replays exactly as ordinary drags from the same snapshot. That is how the playthrough will use it: touch-layer drags only.

**Layout (reference only, no code):** Xeeynamo/ff7-decomp@33ce78c94021b2e1705785347da58a2ca30ba705.
- `src/field/field_private.h`: `FieldWalkmesh` is a u16 triangle count and a u16 pad, then count × 3 SVECTOR (s16 x, y, z, pad), then count × `FieldWalkmeshAccess` (3 × s16, −1 is a wall). `D_8009A044` is a `FieldWalkmesh**`.
- `src/field/field_loop.c` and `config/symbols.field.us.txt`: `g_WalkmeshTriangles` (0x800E4274) is the vertex data, and `g_WalkmeshAccesses` (0x80114458) follows it. The reader requires both pointers to agree with the header's, or it reports no walkmesh.
- `src/field/field_entity.c`:
  - `FieldEntityWalkmeshCross`: a point is inside when all three edge cross products are ≥ 0, and edge k (vertex k → k+1) leads to access k. A set bit `access` in `g_FieldState.blockedAccesses` (IDLCK) also stops the move.
  - `FieldEntityMovementUpdate`: the pad sets MoveDir to up 0, up-left 32, left 64, …, up-right 224, then adds `FieldTriggers.controlDirection`.
  - `FieldEntityMove`: the player stops dead on contact with a solid model, and slides along walkmesh edges.
- `include/game.h`: `FieldState.blockedAccesses` is at +0xB2 (64 bytes) of 0x8009ABF4 (offsets counted from the struct; `modelCount` at +0x28 checks the count). `FieldTriggers.controlDirection` is at +0x09, and `FieldEntity.PosI` (the triangle a model stands in) at +0x72.

**Probes (Tier 2):** these replace the s2i hint probes and the stall segment. All boot from `touch-md1-1`.
- `touch-s2r-gw1`: route to gateway 1 (md1_2). `path` = 0 with `free` > 0 means IDLCK locks close the way.
- `touch-s2r-m2`, `-m3`, `-m4`: route to the talk range of models 2, 3 and 4, then one Interact press. `w0` and `w1` show whether a message opened.
- `touch-s2r-m3-gw1`: route to model 3, tap Interact through any message, then route to gateway 1. Compare `locked_g` with s2r-gw1's `locked`: did the talk unlock triangles?

Untested hypotheses: the field updates the player every frame (closed-loop steering doesn't depend on it), and the md1_1 snapshot is settled with the walkmesh loaded.

**Run 1 of attempt 1 (`832691f`; tier2-eval 45485806546, eval took 19 min): no route data.** 110 pass, 0 fail, 13 error. The sandbox stopped starting scenarios at its deadline, after `save-boot-7h`. The 13 cut were everything from `save-boot-8-world-midgar` on, including `touch-playthrough` and all five `touch-s2r-*` probes, so none of them ran. Recent tier2-eval runs on main took 13 to 20 minutes for the same set, so runner speed varies a lot. This run was on the slow side; whether the new step costs anything before the touch scenarios is unknown. It isn't counted as an attempt: there is no result. Next: let the next push's run report them. If the deadline cuts them again, trim probes (s2r-m2 and s2r-m4 first), because the sandbox time limit is a protected path.
