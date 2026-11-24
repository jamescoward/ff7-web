# #253: battle sub-lists (Magic, Summon, Item)

Source for candidates: Xeeynamo/ff7-decomp@33ce78c94021b2e1705785347da58a2ca30ba705, used as a reference for
addresses and layouts only. No code is copied (AGPL; see CLAUDE.md).

## Candidates (attempt 1)
The battle menu keeps one 0x240-byte record per party slot at `D_800F90B4` (`BattleMenuSlot`, src/battle/battle_private.h;
#110 confirmed table00 for the command cursor). Its other tables (`MenuTable`, include/game.h: rowOffset +0x02, column
+0x0A, row +0x0B) back the sub-lists (src/battle/battle3.c):

| List | Where (slot 0) | Layout set by | Entry taken |
|---|---|---|---|
| Magic | table24: rowOffset 0x800F90DA, column 0x800F90E2, row 0x800F90E3 | `BattleMenuWidgetSubReset`: 3 columns, 3 rows a page, 0x12 rows, wrapModeY 0 | handler is still asm; hypothesis (offset + row) × 3 + column, the `enabledMagic` slot |
| Summon | table36 (+0x36) | `BattleMenuWidgetSub2Reset`: 1 column, 3 rows a page, 0x10 rows | `BattleMenuInputState7`: column + row + rowOffset, widget id 7 |
| Item | widget at +0x12: scroll 0x800F90C8, cursorRow 0x800F90D1 | `BattleMenuWidgetInit`: 3 rows a page, from `g_BattleItemMenuRowCount` | handler is still asm; hypothesis scroll + row = inventory slot (`BattleInitItemList` copies inventory slot i to `g_BattleItemList[i]`, 0x801671B8, 6 bytes, count at +2) |

`g_ActiveCharacters[i].enabledMagic` (+0x108, 8 bytes an entry, id 0xFF = none) holds the spell each Magic index
offers; its slots follow attack ids (include/game.h).

## Attempt 1 (`7699ba7`)
Save `harness/saves/disc1-md1stin-battle-lists.json` (author-chosen): Cloud alone, HP 200/600, MP 300/300;
materia 53 (AP 40000; expected to be Restore) and 49 (AP 0; #241's materia, expected to be Fire) on the weapon;
inventory slots 0-6 = item 1 ×3, item 3 ×2, item 0 ×5, item 0 ×9 ×4. Boot point `lists-battle` (save-boot-29): a random
battle in md1_1, as save-boot-11.

- **H1** (29a): the Magic list opens at column 0, row 0, offset 0; Right/Left move the column.
- **H2** (29a): Down moves the row to 2, then scrolls (offset 1); Up moves back, then scrolls back.
- **H3** (29b): index 3 = row 1, column 0; Circle, Circle there casts a restorative (MP falls, HP rises).
- **H4** (29c): the Item list opens at row 0, scroll 0; Down moves the row; the third Down scrolls.
- **H5** (29d): Item list index 2 = inventory slot 2: Circle, Circle there uses it (battle count 5 → 4, HP rises).

Results: pending.
