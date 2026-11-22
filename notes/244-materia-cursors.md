# #244: Materia screen slot and list cursors

## Why a track search
The Materia screen is in the EQIPMENU overlay, which is not decompiled in Xeeynamo/ff7-decomp@33ce78c (`notes/121-native-equip.md`, `notes/241-materia-screen.md`), so its cursors have no source. #216 found the Equip screen's cursors with the format 2 `track` check over the `overlay` window (0x801D0000 to the end of RAM; `TRACK_WINDOWS`, #221). This issue does the same for the Materia screen.

## Attempt 1, step 1: search scenarios (`runner/test/unit/materia-cursor-scenarios.js`)
- Save `harness/saves/disc1-md1stin-materia12.json`: Cloud alone, materia slots empty, materia 49 (AP 0; the ID #241 equipped) in inventory slots 0-11. All author-chosen.
- Each scenario opens the Materia screen as #241's 22a does: the planned move to row 2, Circle every 60 frames until `menuOverlay` reads 3, then 120 frames. Each press is 4 frames, followed by 30 frames before the mark.
- `24a-materia-slot-track`: mark, then Right, Left, Right, Left, Down, Up, with a mark after each.
  - Column search over c0-c4 for 0, 1, 0, 1, 0. **Hypothesis:** Cloud's starting weapon has at least two slots. `mayMiss`.
  - Row search over c0-c6 for 0, 0, 0, 0, 0, 1, 0. **Hypothesis:** Down reaches the armor row (the armor may have no slots). `mayMiss`; a weak sequence, so several matches are possible.
- `24b-materia-list-track`: as 24a, then Circle opens the list (#241 22b) and 60 frames; mark, Down, Down, Up, Up; search for 0, 1, 2, 1, 0.
- `24c-materia-list-offset-track`: in the list, marks after 0, 6, 7, …, 11 Downs. Search for offset max(0, d − (P − 1)) for P = 8, 9 and 10 (each `mayMiss`). With d ≤ 11 the prediction is the same whether the list holds the 12 filled entries or all 200 slots.

## Results
### Attempt 1, step 1: `f7b13b1`, tier2 check 137098840949 (103 pass, 0 fail; eval job 137098800738)
| scenario | metrics |
|---|---|
| 24a slot-track | ovl_wait 61; column: c_n 1, c_a1 0x801DF5AC; row: r_n 1, r_a1 0x801DF5AD |
| 24b list-track | ovl_wait 61; l_n 1, l_a1 0x801DF5D1 |
| 24c list-offset-track | page 8: 0 matches; page 9: 0; page 10: o10_n 2, first 0x801DF5C8 |

What this shows:
- **One candidate each, laid out like MenuTables** (#135, #216: 0x12 bytes, rowOffset at +0x02, row at +0x0B):
  - a slot table at 0x801DF5A2: the column at +0x0A (0x801DF5AC) and the row at +0x0B (0x801DF5AD). The row search was a weak sequence (one 1), but it found a single byte, the one after the column;
  - a list table two tables later, at 0x801DF5C6: the row at +0x0B (0x801DF5D1) and rowOffset at +0x02 (0x801DF5C8).
- **The list shows 10 rows** and scrolls by one at the bottom: only the page-10 hypothesis matched.
- So Cloud's starting weapon has at least two slots, and Down reaches the armor row (hypotheses of 24a, now observed).
- As in #216's 17c, the offset search's second match is not reported (only the first address was asked for).

## Attempt 1, step 2: acceptance (`save-boot-25a`, `25b`)
- **25a:** column and row read 0 when the screen opens; Right reads column 1, Left 0, Down row 1, Up row 0. The list row and offset read 0; no materia moves.
- **25b:** in the list, Downs 1-9 read row 1-9; Downs 10 and 11 read offset 1 and 2 with the row at 9. Circle then takes the entry at index 11: inventory slot 11 reads empty, slot 0 is unchanged, and weapon slot 0 holds the materia. That index 11 is inventory slot 11 is a list-order **hypothesis** (inventory order); every slot holds the same materia, so only the emptied slot shows which entry was taken.

_Pending Tier 2._
