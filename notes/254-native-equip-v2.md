# #254: native Equip v2

## Decision (agent default, Trip mode rule 11)
Option (a) from the issue: the panel offers the game's list rows **by index** (one row per spare of that kind in the inventory, an upper bound) and reads the savemap after the press to say what was equipped. Equip masks are kernel data and are not read. A plan past the real end of the list stops at the first press that does not move the cursor.

The member is the one the game opened Equip for (`partyPick`, confirmed on the Equip screen by #215). Switching member means Back and a pick in the game's menu; no in-screen member switch is planned.

## Panel (`web/js/native-equip.js`)
v2 replaces v1's spare-weapon rows: three slot buttons (the game's slot is chosen first), then one list row per spare of that kind. A tap runs `equipSlotPlan`, Circle, 60 frames, `equipListPlan`, a final cursor check, Circle, each step checked against `equipCursors()`; any stop releases everything and sends nothing more. The outcome reads the whole party's equipment (`equipV2Outcome`).

**Page not read.** #216 found no variable for "list open". So taps need `slotPage`: the screen's opening state (#121: it opens on the slots), or the panel's own tap that ended "Equipped", with no other input since (v1's mixer watch). After a stop, "something else changed", "no change seen" or Back, taps stay off until Equip is closed and reopened. That Circle on a list entry returns to the slot page is a **hypothesis** from #216 18b (the slot cursor reads 0 afterwards); it only decides whether the next tap is offered without reopening.

With the slot cursor on Weapon and list row 1, the presses are v1's (Circle, 60 frames, Circle; save-boot-15c).

## Semantic (`semantic/equip-screen.js`)
- `EQUIP_SLOT_KINDS` (0 weapon, 1 armor, 2 accessory), `equipSlotPlan(from, to)` (Up/Down, no wrap).
- `EQUIP_LIST_PAGE` = 8, `equipListIndex`, `equipListStep`, `equipListPlan(from, to)`: as the Materia list (#248), over index = offset + row. `equipListPlan({0,0}, 9)` gives exactly the path #216 18b observed.
- `equipListRows`, `equipV2TapAllowed`, `equipV2Outcome`, labels.

## Tier 2 (`runner/test/unit/equip-plan-scenarios.js`)
Save `harness/saves/disc1-md1stin-party3-gear.json`: #215's party3 save plus armor 1-3 (slots 3-5) and accessories 0-2 (slots 6-8), author-chosen.

- **H1:** slot cursor 1 is Armor, 2 is Accessory.
- **H2:** those lists open at row 0, offset 0 and follow `equipListStep`, for members other than Cloud.
- **H3 (reported as `e_idx`):** the Armor and Accessory lists hold every spare of that kind in inventory order.

- `save-boot-28a-equip-plan-armor`: pick party slot 1 (Barret), `equipSlotPlan(0, 1)`, Circle, `equipListPlan({0,0}, 2)`, Circle. Barret's armor changes (H3: to 3), nothing else does.
- `save-boot-28b-equip-plan-accessory`: pick party slot 2 (Tifa), `equipSlotPlan(0, 2)`, Circle, `equipListPlan({0,0}, 1)`, Circle. Tifa's accessory changes (H3: to 1).

## Results: `2d28dbd` (tier2 check 138118011187) and `eef8a54` (138121368113), 111 pass, 0 fail each
The scenario files are the same in both commits, and every 28a/28b metric is identical across the two runs:
| scenario | metrics |
|---|---|
| 28a equip-plan-armor | ovl_wait 1, w_slot 1, w_list 1, e_chg 1, e_idx 1, match 1 |
| 28b equip-plan-accessory | ovl_wait 1, w_slot 1, w_list 1, e_chg -1, e_idx 1, match 1 |

What this shows:
- **H1 holds.** For both members, the slot plan's Downs read slot 1 and slot 2, and Circle there opened the Armor and Accessory lists. The list entry that Circle then took went into Barret's armor and Tifa's accessory. Their other equipment and the other members' armor or accessory were unchanged (checked).
- **H2 holds.** Both lists opened on row 0, offset 0. Each list-plan step read the expected row with the offset unchanged, for party slots 1 and 2.
- **H3 holds for this save.** Barret's armor became 3, the third spare armor in inventory order. Tifa's accessory became 1, the second spare accessory. `e_chg` -1 in 28b only means the value went down: from the baseline (none, 0xFF) to 1. This is observed for this save only. The panel still reads the savemap rather than relying on H3.
- All earlier scenarios (15-18 Equip, 25-27 Materia) passed with their earlier metrics.

## Limits
- List rows are an upper bound. A row past the member's real list makes the plan stop at the first press that doesn't move the cursor.
- Up in the Equip list (the scroll-back rule) is planned but not run. Plans from the opening state press only Down.
- That Circle on a list entry returns to the slot page is still a hypothesis. It only decides whether the next tap is offered without reopening Equip.

## Test tightening (#267)
- `disabledRow(page, index)` in `web/test/native-equip-browser.test.js` asserts that the row is drawn (count 1) before it checks that it is disabled. The four "not offered" checks use it; before, `enabled() === false` also passed with no rows at all.
- Mutation check (Chromium, local): with `render()` changed to draw no rows, "nothing offered…" fails at `list row 1 is drawn` (expected 1, actual 0); reverted.
- New tests: after a stop (weapon row 2, stuck list cursor) and after an unexpected change (row 1, another member's weapon changes), closing Equip and opening it again clears `last`, sets `slotPage` and offers the row again, and the offered tap equips.
