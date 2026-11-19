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
### Attempt 1: `3fa3585`, tier2 check 134950071201 (64 pass, 2 fail)
| scenario | metrics |
|---|---|
| 14a item-screen-open | menu_wait 1, item_screen 1131955011 (0x43784343), list_row 255, list_off 5887, party_row 255, screen_ok 0, frames 960 |
| 14b item-use-plan | scr1_wait 0 (timed out), every later metric 0 |

What this shows: 90 frames after one Circle (pressed 30 frames after the menu opened), the hypothesised overlay addresses hold something else. Their values aren't small enumerations; 0x43784343 looks like data. So either the Item overlay wasn't loaded (Item not chosen, or the CD read was still running), or it isn't at 0x801D0000. The save and the menu still behave as before: 10b and 13a pass, and menu_wait is 1 in all of them.

### Attempt 2: diagnostics on the overlay bookkeeping
- `menu_ovl` (D_80062DD4): the menu overlay id last asked for, where 1 means Item.
- `menu_prev` (D_80062DD0): the overlay id before it.
- `ovl_addr` (D_80062DEC): where overlays are read to.

All three come from the decomp's `src/main/1F6B4.c` (reference only). The menu now gets 60 frames before Circle.
- 14a: one Circle, then 300 frames, with no checks between. Reports the three values above, plus item_screen, list_row and row0.
- 14c: Circle every 60 frames until menu_ovl reads 1 (ovl_wait), then 120 frames. Reports item_screen, list_row, list_off and party_row.
- 14b is unchanged apart from the 60-frame settle.

### Attempt 2: `194ee1f`, tier2 check 134958467101 (67 pass, 0 fail)
| scenario | metrics |
|---|---|
| 14a item-screen-open | menu_ovl 1, menu_prev 0, ovl_addr 2149384192 (0x801D0000), item_screen 1, list_row 0, row0 0, game_state 5 |
| 14b item-use-plan | scr1_wait 13, w_list 1, w_target 1, use_wait 1, count_ok 1, hp_ok 1, match 1 |
| 14c item-screen-press | ovl_wait 1, item_screen 1, list_row 0, list_off 0, party_row 0, ovl_addr 0x801D0000, frames 1016 |

What this shows:
- The overlay addresses were right. Attempt 1 failed because **Circle pressed 30 frames after the field menu opens is ignored**; at 60 frames it opens Item.
  - The menu overlay id reads 1 one frame after the press, and the overlay's variables read 1 (list page) within 13 frames.
  - Overlays are read to 0x801D0000.
- The acceptance passes. The planner's list move 0 → 2 and party move 0 → 1 each land on the first frame after the release. One Circle press uses the item: slot 2's count goes 5 → 4 and party slot 1's HP rises to its max, 333. Slot 0's HP and inventory slots 0 and 1 are unchanged, and a rerun matches.
- `itemMenuScreen` (values 1 and 2), `itemListRow`, `itemListOffset` (0 only; scrolling not checked) and `itemTargetSlot` are now confirmed.
- Row counts and wrapping of both lists stay source claims.

### Run 2 (determinism): `6933559`, tier2 check 134985748881 (67 pass, 0 fail)
The scenario files are unchanged since attempt 2. 14a, 14b and 14c report **identical metrics** to attempt 2, field for field, and each run's rerun matched (`match` 1). So the planned item use is deterministic over two runs.

## Limits
- The list cursor is checked only on rows 0-2 of the first page, with the list offset at 0. Scrolling past row 9 and Arrange/Key Items aren't covered.
- The party cursor is checked only on rows 0 and 1. Its 3 rows and wrapping are source claims, so plans never wrap.
- The only item used is index 0; that it restores 100 HP is a source claim. The check is that HP reaches max (333 from 300).
- Choosing Item needs the field menu to have been open for more than 30 frames. A UI should read `itemMenuScreen` after its press rather than assume the press landed.

## Next (PR 2)
The `native-item` Labs screen, off by default. In a confirmed menu with `itemMenuScreen` 1, it covers the picture with inventory slots (IDs and counts from `inventory()`) and party HP/MP. A tap on an item, then a party slot, runs `itemList` and `itemTarget` plans through `createPlanExecutor` with Circle between them. It confirms the use by reading the count and HP.

## Part 2: the `native-item` Labs screen (PR #211)

### Design
- **Gate (`itemScreen()` in `semantic/layer.js`).** The Item screen's variables are overlay memory and hold other data when another page is loaded (attempt 1 read 0x43784343). So the reader returns a page only through a chain of confirmed reads:
  1. `gameState` reads menu (5);
  2. `menuOverlay` (D_80062DD4, new entry) reads 1, the Item overlay;
  3. `itemMenuScreen` reads a confirmed value: 1 is `list`, 2 is `target`.

  Anything else is `page: null`. Diagnostics 14d, 14e and 14f check what `menuOverlay` and `itemMenuScreen` read after the Item screen is left (Cross once, twice) and after another main-menu row is chosen.
- **Pure facts (`semantic/item-screen.js`).** `itemPageRows(listOffset, inventory)` gives the 10 visible rows (slot = offset + row). `itemRowLabel` uses kind, number and count, so no names are shown. `itemListPlan` and `itemTargetPlan` never wrap or scroll. `itemUseOutcome(before, after)` reports a use when the count fell by exactly one. Buttons are in `ITEM_SCREEN_ACTIONS` (`semantic/controls.js`): Circle selects and Back is Cross.
- **UI (`web/js/native-item.js`).** It polls `itemScreen()` at 4 Hz. While a page is open, a panel covers the picture: it sits inside `.screen`, so it has the same box in portrait and landscape and the pad never moves.
  - **List page:** a tap on a non-empty row plans the list cursor there (one game frame at a time, as `menu-panel` does), then presses Circle.
  - **Target page:** a tap on a party row plans the party cursor, reads the item's count and that slot's HP, then presses Circle. The next polls read both again: "Used: ×5 → ×4, HP 300 → 333", or "No change seen" after 8 polls (2 s).
  - **Hide** uncovers the picture until the Item screen closes.
  - **Stops:** any executor stop sends nothing more. A failed read changes nothing.
  - **Writes:** none.
- **Agent defaults (Trip mode rule 11):**
  - the panel covers the picture, as the contract says; it is not a strip below it;
  - Back is Cross;
  - there is a Hide button;
  - item numbers within their kind are shown, not raw indices.

### Tests
- `runner/test/unit/semantic-item-screen.test.js`: the reader's gate chain, and the pure functions.
- `web/test/native-item-browser.test.js`: a simulated Item screen. It covers:
  - show and hide;
  - a failed read;
  - the flag off;
  - item then member, as Down, Down, Circle then Down, Circle, with "Used" confirmed;
  - a refused use, which shows "No change seen";
  - Back, Hide and the classic pad;
  - layout in portrait and landscape, with `safe-layout` on and off.

### Tier 2: `cd09981`, tier2 check 135239378057 (79 pass, 0 fail)
| scenario | metrics |
|---|---|
| 14d item-screen-cross | ovl_wait 1, menu_ovl 1, item_screen 0, list_row 0, row0 0, game_state 5, frames 1141 |
| 14e item-screen-cross-twice | ovl_wait 1, menu_ovl 0, item_screen 0, list_row 0, row0 0, game_state 5, frames 1205 |
| 14f other-submenu | row_wait 1, menu_ovl 0, item_screen 1131955011 (0x43784343), row0 2, game_state 5, frames 1277 |

What this shows:
- **Cross on the list** goes to the Item screen's tab row. `itemMenuScreen` reads 0, which is now a confirmed value, and the overlay id is still 1.
- **A second Cross** returns to the main menu. `menuOverlay` reads **0**, while `itemMenuScreen` keeps its stale 0.
- **Choosing main-menu row 2** also leaves `menuOverlay` at 0. The Item-screen address then holds unrelated data, the same value attempt 1 saw.

So `menuOverlay` is the gate that separates the Item screen from every other page: it is now confirmed, with values 0 and 1. `itemMenuScreen` alone is not enough, because it reads stale or unrelated values outside the Item screen.

The native screen therefore hides on the tab row, because 0 is not a page it shows. One Back press leaves the game's own tab row on screen.

### Run 2 (determinism): `1701a20`, tier2 check 135240928620 (79 pass, 0 fail)
The scenario inputs are unchanged since `cd09981`. 14d, 14e and 14f report **identical metrics** to run 1, field for field, and 14a-c match part 1's runs.
