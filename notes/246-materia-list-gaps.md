# #246: Materia list order when the inventory has empty slots

Follow-up to #244 (`notes/244-materia-cursors.md`), which confirmed the list cursors and that list index 11 is inventory slot 11, for a save with slots 0-11 all filled.

## Save
`harness/saves/disc1-md1stin-materia-gaps.json`: as `disc1-md1stin-materia12` (Cloud alone at md1stin, materia slots empty), but author-chosen materia 49 only in inventory slots 0, 3 and 5, with AP 0, 3 and 5, so each slot's packed word (AP << 8 | ID) is distinct: 0x31, 0x331, 0x531.

## Hypotheses
- **H1** (tested first): the list shows every inventory slot in order, empty ones included; list index (`materiaListOffset + materiaListRow`) = inventory slot.
- **H2**: the list is compacted to filled slots only. Under H2, 26a's third Down finds no entry (the row stops at 2), and 26b's single Down lands on slot 3.

## Attempt 1 (`save-boot-26a`, `26b`)
- **26a:** open the list (as #244 25b), Down ×3, waiting for the list row to read 1, 2, 3. Circle should empty slot 3 and put 0x331 into Cloud's weapon slot 0; slots 0 and 5 stay unchanged.
- **26b:** Down ×1 (row 1, an empty slot under H1), then Circle: no materia moves. The final list row and offset are reported, to show where the cursor went.

### Attempt 1 results: `cb87d9f` (tier2-eval run 45024378569), 107 pass, 0 fail
| scenario | metrics |
|---|---|
| 26a list-gap | w_row3 1, eq_wait 1, took_ok 1, wm0 817 (0x331), l_row 3, match 1 |
| 26b empty-entry | w_row1 1, wm0_empty 1, l_row 1, l_off 0, match 1 |

What this shows:
- **H1 holds.** The list row reaches 3 with only three materia in the inventory, so the list is not compacted. Circle at index 3 empties inventory slot 3 and puts its word (0x331) into Cloud's weapon slot 0. Slots 0 and 5 are unchanged, so index 3 is slot 3, past two empty slots.
- **Circle on an empty entry moves nothing.** Weapon slot 0 stays empty, slots 0, 3 and 5 are unchanged, and the cursor stays on list row 1 with offset 0. The reported row and offset do not show whether the list closed.
- 25a/25b (#244) passed in the same run with their earlier metrics.

## Semantic
`semantic/materia-screen.js`: `materiaListSlot(listRow, listOffset)` = offset + row, and `materiaPageRows(listOffset, materia)` gives the visible page with empty slots in place (`MATERIA_PAGE_ROWS` = 10, from #244).

## Limits
- One layout (slots 0, 3, 5) and offset 0. Scrolling past empty slots was not run, but #244's offset steps are by one entry, so offset + row should hold there too (hypothesis).
- Whether the list stays open after Circle on an empty entry is not read.

