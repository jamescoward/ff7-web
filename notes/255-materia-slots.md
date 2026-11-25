# #255: Materia screen: armor row, columns ≥2, scroll-back, list end

Follow-up to #248 (`notes/248-materia-planner.md`, "Limits").

## Planner additions (`semantic/materia-screen.js`)
- `materiaRowPlan(from, to)`: the slot cursor between the weapon row (0) and the armor row (1), Down/Up, no wrap. #244 25a already read Down → 1 and Up → 0.
- `materiaColumnPlan(from, to, timing, columns)`: an optional slot count for a caller that knows the item's slots, from 1 to `MATERIA_MAX_COLUMNS` (8, the savemap's materia words per weapon or armor). The default stays `MATERIA_CONFIRMED_COLUMNS` (2) until Tier 2 shows more.
- `materiaListStep` already plans Up at row 0 with offset > 0 as a scroll back. 30c runs it.

## Save
`harness/saves/disc1-md1stin-materia-slots.json` is `disc1-md1stin-materia-plan` with these changes:
- Cloud's weapon is 4 and his armor 8. These numbers are author-chosen. That they have 8 and at least 1 materia slots is a **source claim** from general knowledge of the game, not from any data;
- materia 49 sits in inventory slots 2, 7, 13 and 199, with AP = slot.

## Scenarios (`runner/test/unit/materia-slots-scenarios.js`)
| scenario | what | hypothesis |
|---|---|---|
| 30a columns-measure | 8 blind Rights on the weapon row; reports `col`, `srow` | measures H3 |
| 30b column-far | `materiaColumnPlan(0, 7, columns 8)`, then list plan to slot 7, then Circle → weapon slot 7 holds 0x731 | H3: 8 columns, no wrap |
| 30c armor-scroll-back | `materiaRowPlan(0, 1)`, list plan to slot 13 then back to slot 2 (the last two Ups scroll back at row 0), Circle → armor slot 0 holds 0x231 | H4 (armor list fills armor materia), H2b (scroll-back) |
| 30d list-end | Down every 12 frames until the offset is 190 (only slot 199 gets there), row 9 checked, one more Down; reports `l_row`, `l_off` | measurement: stop (9, 190) or wrap (0, 0) |

How to read the results:
- **30a `col`:** 7 means 8 columns and a stop at the last. n − 1 means n columns. A smaller value after 8 Rights means a wrap.
- **30b pass:** H3 holds. Raise `MATERIA_CONFIRMED_COLUMNS`? No: slot counts differ per item and no reader exists. Instead, record that the cursor walks every slot an item has. Then `materiaColumnPlan` with a known count is confirmed up to 8.
- **30b fail and 30a `col` < 7:** weapon 4 has fewer slots. Use that count, or pick another weapon.
- **30c pass:** H4 and H2b hold.
- **30d:** record the measured end behaviour in `materiaListStep`'s comment. Plans already stop at 199.

## Tier 2 run 1 (`ae77e86`): rejected before it ran
The inspect job rejected the build with `bad-scenario`: 30d was 88 KB, over the sandbox's 64 KiB scenario file limit (`MAX_SCENARIO_BYTES` in `harness/private-eval/eval/lib.js`, a protected path; not changed). No scenario ran, so this is not an attempt.

Fix (`30d` only): the 199 plan steps, each with its own waits, are replaced by one wait that presses Down every 12 frames (4 held) until `l_off` is 190, then checks `l_row` 9. Only the press onto slot 199 reaches offset 190, so the wait stops there and can't overshoot into a wrap. The plan itself is still proved step by step by 30b (slot 7) and 30c (slot 13 and back). The file is now 8 KB, and a Tier 1 test keeps every 30x file under 64 KiB.

## Tier 2 run 2 (`f5909f2`; tier2-eval 45617725022): 30a-30d pass
Recorded 2026-11-25 from the `eval` job log. 110 pass, 0 fail, 12 error.

| scenario | metrics |
|---|---|
| 30a columns-measure | col 7, srow 0 |
| 30b column-far | pass: w_col 1, w_list 1, took_ok 1, wm7 1841 (0x731) |
| 30c armor-scroll-back | pass: w_row 1, w_far 1, w_back 1, took_ok 1 |
| 30d list-end | l_row 9, l_off 190, w_last 2380 |

- **H3 holds:** 8 Rights on weapon 4 end on column 7, which is a stop at the last of 8 columns and not a wrap. The 7-Right plan fills weapon slot 7. So `materiaColumnPlan` with a known slot count is confirmed up to 8 (comment updated).
- **H4 and H2b hold:** the armor row is reached with one Down. The armor list fills armor materia slot 0, and Up at row 0 with offset > 0 scrolls back.
- **List end:** Down at slot 199 leaves the cursor at row 9, offset 190. It stops and doesn't wrap. `materiaListStep`'s comment records this, and the plans already never go past 199.
- **The 12 errors are the deadline, not these scenarios.** This runner ran at about half the usual speed (new-game-to-reactor-entrance took 47.9 s against 27-28 s), and the sandbox stopped starting scenarios after `save-boot-5`. The cut set (`save-boot-6` onwards, `title-*`, `touch-playthrough`) is unchanged by this PR. #269 tracks the deadline. Tier 2 is not green yet: the next push's run must have no errors, and it also serves as the determinism run for 30a-30d.

## Tier 2 run 3 (`dd4a9ca`; tier2-eval 45622232120): green, deterministic
122 pass, 0 fail, 0 error. 30a-30d gave the same metrics as run 2: 30a col 7, srow 0; 30b wm7 1841; 30c w_row, w_far, w_back and took_ok all 1; 30d l_row 9, l_off 190, w_last 2380. So the results repeat across two runs.

## Reviewer FAIL on `8774d97`, and the fix
The reviewer found that 30d checked no savemap result. #255 asks each scenario to run the plan's steps, check the cursors at each step, and confirm the moved materia in the savemap. The PR had claimed the whole contract was proved.
- Fix: after the measured Down, 30d now checks that the cursor stopped (row 9, offset 190; `w_stop`). Runs 2 and 3 measured that stop, so it is now an acceptance check. Then it takes slot 199's materia with Circle. Checks: slot 199 empty and changed since the mark, weapon slot 0 holds 0xc731, and slots 2, 7 and 13 unchanged. 30d is 9.3 KB.
- Gap that remains (agent default, recorded on #255): 30d reaches slot 199 by held Downs, not by the plan's 199 checked steps, because that file would pass the sandbox's 64 KiB limit. The plan is proved step by step over 7 steps (30b), and over 13 steps out and 11 back with scrolling both ways (30c). Every step of `materiaListPlan` uses the same `materiaListStep` rule, so the long plan adds no new case.
- Needs a new Tier 2 run for 30d: this is a change to its input.

## Tier 2 run 4 (`d938f4a`; tier2-eval 45627460198): green
122 pass, 0 fail, 0 error. 30a-30c repeat runs 2 and 3 exactly (30a col 7, srow 0; 30b wm7 1841; 30c all 1). 30d: w_stop 1, eq_wait 1, took_ok 1, wm0 50993 (0xc731, materia 49's word from slot 199), w_last 2380 (as in runs 2 and 3). So Circle at the stopped cursor took slot 199's materia, confirmed in the savemap. The next push's run (notes only) is the repeat for 30d's new checks.
