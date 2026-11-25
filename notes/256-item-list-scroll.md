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
