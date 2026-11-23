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
### Attempt 1: `cc46212`, tier2 check 136981239018 (100 pass, 0 fail; eval job 136981176738)
| scenario | metrics |
|---|---|
| 22a materia-screen-open | row_wait 1, ovl_wait 61, menu_ovl 3, menu_prev 0, wm0 4294967295 (0xFFFFFFFF, empty), game_state 5, frames 1155, load_done 371 |
| 22b materia-equip-plan | ovl_wait 61, eq_wait 1, mat_ok 1, wm0 49 (0x31), mat0 4294967295 (empty), menu_ovl 3, match 1, load_done 371 |

What this shows:
- **`menuOverlay` value 3 is the Materia screen.** It is asked for at the second Circle, as for Equip: `ovl_wait` 61 is the press at frame 60 plus one frame. The first Circle is the party pick. This matches `YAMA_EQIPMENU_MATERIA`, and it checks the label order Item, Magic, Materia through the overlay id (row 2 gives id 3).
- **The acceptance passes on the first attempt.** Two Circles, 120 and 180 frames after the overlay was asked for, put the materia into Cloud's weapon materia slot 0. `wm0` reads 0x31 on the first frame checked (`eq_wait` 1). Inventory materia slot 0 is now empty: the materia moved, it was not copied. A rerun matches.

  So, **for this save**, the Materia screen opens with the cursor on weapon slot 0, and the list's first entry is inventory slot 0. No Materia-screen cursor address is read.

### Confirmation push (determinism run): `f30a7ff`, tier2 check 136985713201 (100 pass, 0 fail; eval job 136985637062)
22a and 22b report **identical metrics** to attempt 1, field for field, and 22b's rerun matched. So the overlay id and the materia equip are deterministic over two runs. The reviewer passed it on `f30a7ff`, and it merged as PR #242 (`982cd0b`).

- `semantic/addresses.js` gains:
  - `MENU_OVERLAY_MATERIA = 3`;
  - `values[3] = 'materia'`;
  - `confirmedValues[3]` = save-boot-22a.
- The scenarios' descriptions now say 3 is confirmed. Inputs and checks are unchanged.
- `semantic-equip-screen.test.js` used 3 as its example of an unconfirmed overlay value. It now uses 2 (Magic, still unread), and 3 joins the "closed, confirmed" list. The coverage is the same; the behaviour change is intended.

## Limits
- One save, with Cloud alone and one materia. Weapon slots other than 0, armor slots and the list order beyond entry 0 are not read.
- The Materia screen's cursors have no source. A track search, as #216 did for Equip, is a follow-up.
