# #171: battle command rows of slots 1 and 2, and battleActor 2 read directly

Follow-up to #110 (`notes/110-battle-input.md`). Addresses are from Xeeynamo/ff7-decomp@d4db3de3c3aaf61269e048cf3f6a458996290de0,
used as a reference for addresses and layouts only (no code copied): `D_800F90B4[slot].table00` (0x240 bytes per slot),
column at +0x0A, row at +0x0B; `g_BattleMenuPartySlot` 0x800F38A0.

## Tier 2, attempt 1 (`save-boot-11d-battle-command-rows`, run on `eb564e8`: 61 pass, 1 fail)
One metric per check, and the slot read 30 frames after the first menu opens (the suggestion on #171).

| Metric | Value | Reading |
|---|---|---|
| open_wait | 549 | the first command menu opens (as in 11c) |
| slot2 | 1 | **the slot reads 2** within 1 frame, 30 frames after widget 1: the direct read #110 lacked |
| r2_zero | 1 | slot 2's row reads 0 |
| r2_down | 0 | **Down every 20 frames (held 4) did not make slot 2's row read 1 within 200 frames** |
| r2_up, next_wait, slot1, r1_down | 0 | not reached (the timeout stopped the script) |

So #110 attempt 2 most likely failed at the same step: the Down move, not the slot read. Possible causes (hypotheses):
- the cursor skips empty rows: with no materia (the `stats-battle` save has empty materia), Tifa may have no Magic or Summon
  command, so Down may go from Attack straight to Item on a row other than 1;
- the stride or offset for slot 2 is wrong, and 0x800F953F is some other byte that happens to read 0.

## Tier 2, attempt 2 (run on `51f640e`: 63 pass)
Two scenarios that report where one Down press leaves the cursor, instead of waiting for a value:
- `save-boot-11d-battle-command-rows` (rewritten): first menu; slot2, r2_zero, then one Down; reports r2_dir (sign) and the
  end values of row2, col2, row0 and row1.
- `save-boot-11e-battle-command-row-slot1` (new): Attack taken, next menu; slot1, r1_zero, then one Down; reports r1_dir and
  the end values of row1, col1, row2 and row0.

If the active slot's row moves to some value other than 1 while the other rows stay put, the address is right and the
menu skips rows; if nothing moves, the address is wrong for slots 1-2.

Result: both pass.

| Scenario | Metrics |
|---|---|
| 11d (first menu, Tifa) | open_wait 549, slot2 1, r2_zero 1, **r2_dir 1, row2 3**, col2 0, row0 0, row1 0 |
| 11e (next menu, Barret) | next_wait 43, slot1 1, r1_zero 1, **r1_dir 1, row1 3**, col1 0, row0 0, row2 0 |

One Down press moves the active slot's row from 0 straight to **3**. The column stays 0 and the other slots' rows stay 0.
So the addresses are right, and the cursor skips rows with no command. The `stats-battle` save has empty materia, so
Barret and Tifa have no Magic or Summon command, and Down goes from Attack (row 0) to Item (row 3). Attempt 1's
`r2_down` waited for 1, which never comes. (Which command sits on row 3 is a reading of the game's usual layout, not checked.)

## Tier 2, attempt 3 (run on `d2ab510`: 63 pass)
11d and 11e check Down until the row reads 3, then Up until it reads 0. At the end, the other slots' rows must be 0,
and a rerun must match.

| Scenario | Metrics |
|---|---|
| 11d | open_wait 549, slot2 1, r2_zero 1, r2_down 1, r2_up 1, row0 0, row1 0, match 1 |
| 11e | next_wait 43, slot1 1, r1_zero 1, r1_down 1, r1_up 1, row0 0, row2 0, match 1 |

Each move lands one frame after the press. Determinism: the rerun matches in both, and the next push gives a second Tier 2 run.

## Outcome
- **Confirmed:** `battleCommandRow1` (save-boot-11e) and `battleCommandRow2` (save-boot-11d). `battleActor` reads 2 directly at
  the first menu and 1 at the next one. `battleInput().row` is now reported for every slot.
- **Different from the contract's wording:** the contract expected 0 → 1 → 0. With no materia, the moves are 0 → 3 → 0, because
  rows with no command are skipped. Row 1 (with a Magic command) needs a save with materia equipped; not done here.
- **Consequence for the battle panel (#116, UI lane):** its rows are now enabled for slots 1 and 2. It plans over rows 0-3 as if
  every row exists, so with skipped rows a tap stops safely: the executor reads 3 where it expected 1, so 'moved', and no Circle
  is sent. It cannot yet reach Item for a member without materia. Filed as a follow-up.
