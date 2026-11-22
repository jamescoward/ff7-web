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

Results: pending (Tier 2).
