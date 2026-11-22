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
_Pending the first Tier 2 run._
