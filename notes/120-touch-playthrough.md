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
_None yet. The first Tier 2 run is on this PR's first push._

## Next stretches (route still unknown)
md1_1 → md1_2 → the reactor interior → the first save point. Field IDs and exits come from `nearby()` gateways (#112) and the field ID reader. There is only one slot, so exploration diagnostics have to share the scenario's 8 metrics. If that is too slow, record it on #120 as the owner question on the slot cap.
