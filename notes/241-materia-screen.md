# #241: Materia screen (game-state half)

This follows #121 part 1 (`notes/121-native-equip.md`).

## Sources (facts only, no code copied)
- **Xeeynamo/ff7-decomp @ `33ce78c`** (reference only, AGPL), `src/main/1F6B4.c`, enum `YamadaOvl`: **3 `YAMA_EQIPMENU_MATERIA`**, 4 `YAMA_EQIPMENU_EQUIP`. #121 confirmed 4 (save-boot-15b). The EQIPMENU overlay is not decompiled, so the Materia screen's cursors have no source.
- #117 confirmed the savemap words: `characterWeaponMateria` (record +0x40, AP << 8 | ID, 0xFFFFFFFF empty) and `materiaSlot` (+0x77C).

## Attempt 1: Tier 2 scenarios
- `harness/saves/disc1-md1stin-materia.json` (Cloud alone, weapon 0):
  - A `characters` entry for record 0 empties all 16 of its materia slots (#117/#130 behaviour).
  - Materia inventory slot 0 holds ID 49 with AP 0. This is author-chosen; #117's 13a read it back with other AP.
- `runner/test/unit/materia-scenarios.js` generates two scenarios. `materia.test.js` checks them.
  - `save-boot-22a-materia-screen-open` (acceptance 1): the planned move to row 2, then Circle every 60 frames until `menu_ovl` reads 3, then 120 frames. It checks:
    - `menu_ovl` reads 3;
    - weapon materia slot 0 is still empty;
    - the menu is still open and the field is unchanged.

    It reports the raw `menu_ovl` and `menu_prev`, so a different id would refute the source claim.
  - `save-boot-22b-materia-equip-plan` (acceptance 2): as 22a, then mark, Circle, 60 frames, Circle, and wait until `wm0` reads 0x31. It checks:
    - `wm0` reads 0x31 and changed since the mark;
    - the overlay is still 3;
    - a rerun matches.

    It reports the raw `wm0`, `mat0` and `menu_ovl`. **Hypotheses:** the screen opens with the cursor on weapon slot 0, and the materia list shows inventory slot 0 first.

## Results
(pending)
