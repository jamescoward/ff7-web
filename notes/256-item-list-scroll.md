# #256: Item list past page 1

Part 1 (game-state lane): Tier 2. Part 2 (UI lane, Labs flag `native-item`) uses the plan once part 1 merges.

## Facts and hypotheses
- **Confirmed (#135):** `itemMenuScreen`, `itemListRow` and `itemListOffset` (offset 0 only) and `itemTargetSlot`; Item opens on list row 0, offset 0. The planned use of slot 2 on party slot 1 passes (14b).
- **Source claim** (Xeeynamo/ff7-decomp@33ce78c, reference only, no code copied; `notes/135-native-item.md`): the list is MenuTable [1], with 10 rows a page and 320 rows in all. It doesn't wrap, it scrolls, and it indexes `Savemap.inventory[row + offset]` directly.
- **H1 (this issue):** as the Materia list does (#244, #246, #248), Down at row 9 scrolls one entry (offset + 1, row stays 9), and list index = offset + row = inventory slot, across empty slots.

## Changes
- `semantic/item-screen.js` (synced): `ITEM_INVENTORY_SLOTS` (320, a source claim), `itemListSlot(row, offset)`, `itemListStep`, and `itemSlotPlan(from, toSlot)`. The plan runs over inventory slots and never wraps; each step carries the { row, offset } it should leave. `itemListPlan` (page 1) is unchanged, so `native-item` is untouched.
- Save `disc1-md1stin-item-scroll`: the #135 potion save, but with items only in inventory slots 0 (index 1 ×2), 5 (index 3 ×2) and 13 (index 0 ×5). Every other slot is empty.
- `runner/test/unit/item-scroll-scenarios.js` generates the scenarios below; `item-scroll.test.js` checks them; `semantic-item-scroll.test.js` checks the planner.

## Scenarios
| scenario | what it does | reading |
|---|---|---|
| 31a measure | 13 blind Downs from row 0 offset 0, 12 frames apart, no checks; reports `list_row`, `list_off` | H1: row 9, offset 4. A wrap or a skip over empty slots shows as other values |
| 31b acceptance | `itemSlotPlan` to slot 13 (9 row moves, 4 scrolls, both cursors checked after each press; `w_far`), Circle, `itemTargetPlan` 0 → 1, Circle | count_ok (slot 13: 5 → 4), hp_ok (333), rerun match |

## Risk
- Tier 2 is near its time limit (#269). These are two short scenarios; if a run is cut by the deadline, the cut scenarios are reported as errors, not failures.

## Tier 2 run 1 (`0f5e258`; tier2-eval 45702445755, check 139516126034): H1 holds
124 pass, 0 fail, 0 error.
| scenario | metrics |
|---|---|
| 31a measure | list_row 9, list_off 4, item_screen 1, ovl_wait 1, frames 1258 |
| 31b acceptance | scr1_wait 13, w_far 1, w_target 1, use_wait 1, count_ok 1, hp_ok 1, match 1 |

What this shows:
- Down at row 9 scrolls one entry: 13 Downs from the top end on row 9, offset 4.
- The plan's 13 steps (9 row moves, 4 scrolls) land on the expected row and offset after every press.
- Circle there chose inventory slot 13: its count fell 5 → 4, and party slot 1's HP rose to 333. So list index = offset + row = inventory slot across empty slots (1-4, 6-12).
- 14a-14f (#135) stay green.
- The next push (comments and notes only) is the determinism run.

## Tier 2 run 2 (`a0ac6d0`; check 139524709904): 31a and 31b deterministic; 12 deadline errors
112 pass, 0 fail, 12 error.
- 31a and 31b report **identical metrics** to run 1, field for field (31a: list_row 9, list_off 4, frames 1258; 31b: scr1_wait 13, w_far, w_target, use_wait, count_ok, hp_ok and match all 1). So the planned use past page 1 is deterministic over two runs.
- **The 12 errors are the deadline, not these scenarios.** This runner was slow: new-game-to-reactor-entrance took 48.2 s, against 28.7 s in run 1. The sandbox stopped starting scenarios after `save-boot-5`. The cut set (`save-boot-6` onwards, `title-*`, `touch-playthrough`) is unchanged by this PR; #269 tracks the deadline, and #275 run 2 hit the same cut. The tier2 check must be green before merging, so this push's run is needed.

## Tier 2 run 3 (`cd54574`; check 139536473320): green
124 pass, 0 fail, 0 error. 31a and 31b are identical to runs 1 and 2. Run 1's check id was 139516126034. Reviewer PASS on `cd54574`; merged as PR #279.

## Part 2 notes
- Call `itemSlotPlan` with the read `{ row: itemListRow, offset: itemListOffset }`. `itemListStep` alone doesn't stop at the list ends.
- Not run: Up at row 0 (scroll back) and the list end.
