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

### Results: `eb75975`, tier2 check 138313188835 (eval job 138313122159)
103 pass, 1 fail, 12 error. The 12 errors are scenarios that never started: the run reached the runner's 1140 s
deadline (`runner/tier2.js --deadline-s`) after `save-boot-5`. See "Tier 2 time budget" below.

| scenario | status | metrics |
|---|---|---|
| 29 lists-battle | pass | battle_wait 5236, map_cur 117, match 1 |
| 29a magic-cursor | pass | cmd_magic 1, mw_wait 1, r_right 1, d_row2 1, d_off1 1, u_row 1, **widget 6**, match 1 |
| 29b magic-cast | **fail** | w_plan 1, tgt_wait 0, cast_wait 0, mp_wait 0, **e0 0, e3 255**, match 0 |
| 29c item-cursor | pass | iw_wait 1, i_d1 1, i_d2 1, i_s1 1, i_row 2, **i_scroll 1**, **widget 5**, match 1 |
| 29d item-use | pass | w_plan 1, tgt_wait 1, use_wait 1, count_wait 1, bi2 4, match 1 |

What this shows:
- **H1, H2 hold** (29a): the Magic list opens at column 0, row 0, offset 0; Right/Left move the column one a press;
  Down moves the row to 2 and then scrolls (offset 1, row 2); Up moves the row back to 0, then scrolls back
  (offset 0). Each read lands within 30 frames. The Magic list's widget id is **6**.
- **H3 is not shown yet** (29b): index 0 holds spell id 0 and index 3 holds none (0xFF). Circle on an empty entry
  does not open target selection, so the script stopped at tgt_wait. Which ids sit at indexes 1-2 is read in
  attempt 2. (The layout itself, index = (offset + row) × 3 + column, is what 29a's moves and e0 agree with.)
- **H4 holds** (29c, one run): the Item list opens at row 0, scroll 0; Down moves the row to 2, then the scroll
  reads 1 with the row still 2. So it is one column, 3 rows a page, scrolling by one entry. Its widget id is **5**.
- **H5 holds** (29d): with the plan's two Downs, Circle, Circle uses inventory slot 2's item: its battle count
  goes 5 → 4 on the first frame checked, entries 0 and 1 keep 3 and 2, and HP rises. A rerun matches.

## Attempt 2
- 29b: from index 3 (one Down), the planned Up to index 0, then Circle, Circle casts spell 0; MP must fall and HP
  rise. Reports e1, e2.
- 29c is removed (its result above stands as a single-run observation) and save-boot-29 no longer reruns its
  5236-frame walk from the title, to fit the time budget. 29a, 29b and 29d keep their reruns.

### Attempt 2 (`e5e35fa`, tier2 check 138325109139): success (all pass)
29b passes with the planned Up from index 3 to index 0. The run reached `touch-playthrough`.

## Attempt 3 (`d2cdbb2`, tier2 check 138326785176, eval job 138326716747): 115 pass, 0 fail, in 15 min
- 29d now waits for widget 5 and plans to Item index 3 (Down, Down, Down: row 1, row 2, then scroll 1 with row 2).
- The address table gains the list entries; `battleList()` reads them (semantic/layer.js).

| scenario | metrics |
|---|---|
| 29 lists-battle | battle_wait 5236, map_cur 117 |
| 29a magic-cursor | cmd_magic 1, mw_wait 1, r_right 1, d_row2 1, d_off1 1, u_row 1, widget 6, match 1 (as attempt 1) |
| 29b magic-cast | w_plan 1, tgt_wait 1, cast_wait 1, **mp_wait 365**, **e1 1, e2 2**, match 1 |
| 29d item-use | w_plan 1 (scroll 1), tgt_wait 1, use_wait 1, count_wait 1 (slot 3: 9 → 8), match 1 |

What this shows:
- **H3 holds**: index 0 is enabledMagic slot 0 (spell 0). With the cursor at index 3, the planned Up reads row 0; Circle
  opens target selection (widget 0) one frame later, a second Circle takes the command (0xFFFF), MP leaves 300 after
  365 frames, and 400 frames later MP is lower and HP higher than at the mark. Entries 1 and 2 hold spells 1 and 2;
  entry 3 is empty. Which spell each id is is not read (no game text); the panel shows ids only.
- **H4 and H5 hold through a scroll**: the third Down scrolls (scroll 1, row 2), and Circle, Circle uses inventory slot 3
  (battle count 9 → 8, slots 0-2 unchanged, HP higher). So list index = scroll + row = inventory slot.
- The whole suite ran in 15 min and reached `touch-playthrough` (the run time varies; see below).

## Outcome (part 1)
- **Confirmed** (address table, slot 0): `battleMagicColumn0`, `battleMagicRow0`, `battleMagicOffset0`,
  `battleItemRow0`, `battleItemScroll0`, `battleMagicId0`, `battleItemCount`, and `battleMenuWidget` values 5 (Item
  list) and 6 (Magic list).
- **Hypotheses**: the same cursors for party slots 1 and 2 (the same table at + slot × 0x240, as #171 found for the
  command rows); the Summon list (table36, widget 7 per the decomp; the save has no summon materia).
- **Planner**: `semantic/battle-lists.js` `battleListPlan` (rows first, then columns, never wraps). The presses of
  29b and 29d equal its output (unit test `semantic-battle-lists.test.js`). Up at row 0 with offset 0 is never
  planned; Up at row 0 with offset > 0 scrolls back (29a).
- **Reader**: `battleList()` → `{ actor, list, index, row, offset, column }`. `battleInput()` reports nothing while a
  list is open, so the existing `battle-panel` command view hides there, as before.
- Part 2 (the panel's list view, Labs flag `battle-panel`) is next on this issue.

## Tier 2 time budget
The whole Tier 2 suite now runs close to the deadline: PR #266's tier2 took 18 min 51 s and passed, PR #265's 11 min
20 s (runner speed varies). Attempt 1 added five scenarios, one of them a 5236-frame walk run twice, and the run
stopped starting scenarios after `save-boot-5`. The limit lives in protected paths (`harness/private-eval/`,
`.github/`), so it is filed for the owner as its own issue.

## Part 2: the `battle-panel` list view (UI lane)
Behind the existing Labs flag `battle-panel` (off by default). Tier 3 deferred (#123).

- **What it shows.** While `battleInput()` reports nothing and `battleList()` reports a confirmed Magic or Item
  list, the panel switches to a list view: one button per entry, in list order. Magic entries are the
  `battleMagicId<slot>` ids that are not 0xFF ("Spell #id"). Item entries are the `battleItemCount` entries above 0,
  with the item id of that inventory slot from `inventory()` ("item #n ×count", or "Slot n ×count" without an id).
  IDs and counts only, never names or game text. Two rows of buttons show, the height of the command and targeting
  views, so the pad does not move. More entries scroll inside the panel.
- **A tap.** The panel reads `battleList()` again. With a confirmed cursor it plans with `battleListPlan` (rows
  first, then columns, never wraps) from that cursor to the entry. It steps the plan executor one game frame at a
  time, reading the list index after every press, then presses Circle. The game's target selection then follows,
  and the existing targeting view (Prev, Next, Confirm, Back) covers it.
- **Stops.** Any executor stop (`moved`, `stuck`, `unread`, ...) or a confirmed read showing that list gone for that
  slot (`left`) releases the pad and sends nothing more, not even Circle. A cursor that is not a confirmed read
  (party slots 1 and 2: hypotheses) greys the entries out, with a note, and a tap sends nothing.
- **Code.** Pure facts in `semantic/`: `battleListEntries`, `battleListLabel` (battle-lists.js), `battleListView`,
  `battleListTapPlan`, `battleListPlanCursor` (battle-panel.js). The layer reader is `battleListEntries(list, actor)`,
  one strided `readMem` per array. Drawing and pressing are in `web/js/battle-panel.js`.

Agent defaults (Trip mode rule 11, recorded on #253):
- Only Tier 2's confirmed lists are offered: party slot 0's Magic and Item lists. The Summon list (widget 7) is not
  mapped by `battleList()`, so the panel shows nothing new for it.
- There is no Back button in the list view. Which button closes a list is not checked in Tier 2. The classic pad
  stays available.
- The reviewer's non-blocking notes on PR #268 (the `battleItemCount` source text, the `battleMenuWidget` meaning,
  `battleList()` with an unconfirmed column) touch address-table text and the reader, not the UI. They are left
  for a game-state follow-up, so this PR changes no Tier 2 claim.

Tier 3 checklist (for #123):
1. With `battle-panel` on, in a battle with Restore materia, pick Magic: the panel lists spell ids.
2. Tap the first spell: the cursor moves there and the target cursor appears; Confirm casts it.
3. Pick Item: the panel lists items with counts; tap one and Confirm uses it (its count drops).
4. A long list scrolls inside the panel, and the pad does not move.
5. With the flag off, the battle looks and plays as before.
