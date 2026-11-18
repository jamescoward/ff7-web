# #135: native Item screen

Split by PR (one session does both lanes, overflow under Trip mode rule 9):
1. **PR 1 (game state):** find out how to tell the Item screen is open and where its cursors are, confirm them in Tier 2, and show that a planner-made pad sequence uses an item on a party slot below max HP.
2. **PR 2 (UI):** the `native-item` Labs screen on top of it.

## Sources (facts only, no code copied)
**Xeeynamo/ff7-decomp @ `33ce78c`** (reference only, AGPL): `config/symbols.itemmenu.us.txt`, `src/menu/itemmenu.c`, `include/game.h` (MenuTable).
- The Item screen is an overlay that the menu loads at 0x801D0000. Its variables are only meaningful while it is open.
- `g_ItemMenuCurrentScreen` (0x801D3E48, s32): 0 is the tab row (Use / Arrange / Key Items); 1 is the item list; 2 means an item has been chosen and a party member is being picked; 3 is key items; 4 and 5 are arrange. `ITEMMENU_Init` sets it to **1**, so choosing Item opens straight onto the list.
- `g_ItemMenuWidgets` (0x801D3DDC) holds three MenuTables of 0x12 bytes each:
  - [0] the tabs: 3 columns, wrap X;
  - [1] the list: 10 rows a page, 320 rows in all, no wrap (it scrolls). `g_ItemListOffet` = [1].rowOffset (0x801D3DF0), and `g_ItemUseListCursorPos` = [1].row (0x801D3DF9);
  - [2] the party cursor: 3 rows, wrapModeY 1. `g_PartySlotSelected` = [2].row (0x801D3E0B).
- `ITEMMENU_Main` handles the buttons through the table for the current screen. On screen 1, Circle on a usable slot goes to screen 2 (with a target delay of 0). On screen 2, Circle on item 0 calls `SystemMenuAddHpByPartyId(slot, 100)` when HP is neither full (baseHp ≠ hp) nor 0, and removes one item. The screen stays at 2 while any of that item is left.
- The list indexes `Savemap.inventory[row + offset]` directly, so list row r on the first page is inventory slot r.

## Changes (PR 1)
- `semantic/addresses.js`: `itemMenuScreen`, `itemListRow`, `itemListOffset`, `itemTargetSlot`, as hypotheses until Tier 2 confirms them.
- `semantic/menus.js`: `itemList` (10 visible rows, no wrap, scrolling not planned) and `itemTarget` (3 rows). Wrapping is a source claim, so plans never wrap.
- `harness/saves/disc1-md1stin-potion.json`: the #130 stats save (party Cloud, Barret, Tifa; Barret at HP 300/333) plus inventory slots 0 (index 1 ×2), 1 (index 3 ×2) and 2 (index 0 ×5). All values are author-chosen.
- `runner/test/unit/item-use-scenarios.js` generates the two Tier 2 scenarios, and `item-use.test.js` checks the committed files:
  - `save-boot-14a-item-screen-open` (diagnostic): opens Item and reports the raw screen, list row, list offset and party row after 90 frames, with no waits that could stop it early.
  - `save-boot-14b-item-use-plan` (acceptance): opens Item and waits for screen 1, then plans list 0 → 2 and presses Circle (screen 2). It plans the party cursor 0 → 1, presses Circle and waits for slot 2's quantity to read 4. It checks that the count is one lower, slot 1's HP is 333 (and rose since the mark), slot 0's HP and inventory slots 0 and 1 are unchanged, it is still on screen 2 in the menu, and a rerun matches.

## Results
_Pending the first Tier 2 run._
