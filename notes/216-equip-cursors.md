# #216: Equip screen slot and list cursors

## Why a new method
The EQIPMENU overlay is not decompiled in Xeeynamo/ff7-decomp@33ce78c (`notes/121-native-equip.md`), so its cursor variables have no source. #135 found the Item overlay's cursors in `MenuTable` structs (0x12 bytes, row at +0x0B, rowOffset at +0x02) in the overlay's data at 0x801D0000+; the Equip overlay may follow the same layout, but nothing confirms it.

## The track check (format 2)
`{ "track": { "from", "bytes", "marks", "values", "found" }, "metric" }` in `assert` (`runner/format2.js`, `harness/schema/scenario.schema.json`).

- Inside the run, the main run's script reads `[from, from + bytes)` at each listed mark, and keeps the offsets whose byte equals that mark's value at every mark.
- Reported: the number of matches (`metric`) and the addresses of the first up to 4 matches (`found`), as metrics. No memory value leaves; the values are the ones the scenario chose.
- Bounds:
  - at most 256 KiB;
  - 3 to 16 marks;
  - values 0 to 63, with at least two different, so it can't ask "where are the zero bytes" (or any constant);
  - in main RAM only (the loader checks the range).
- The check passes when at least one byte matches. A stopped run, a timed-out wait or a missed mark gives 0 matches.

Security: this is an oracle for "which bytes in a range read this sequence of small numbers at these moments". Its output is addresses and a count, inside the existing caps (128 scenarios × 8 metrics, `docs/SECURITY.md`). An `expect` check on one address already gives the same 1/0 information per address; the search just covers a range in one scenario.

## Attempt 1, step 1: search scenarios (`runner/test/unit/equip-cursor-scenarios.js`)
- Save `harness/saves/disc1-md1stin-equip12.json`: Cloud alone (weapon 0), spare weapons 1-12, one each, in inventory slots 0-11. All author-chosen. That Cloud can equip all of them is a **hypothesis**: weapon 1 is confirmed (#121); #215 saw 17 and 33 go to Tifa and Barret.
- Each scenario opens the Equip screen as #121's 15b does: the planned move to Equip, then Circle until `menuOverlay` reads 4, then 120 frames. Each press is 4 frames, followed by 30 frames before the mark.
- `17a-equip-slot-track`: mark, then Down, Down, Up, Up, with a mark after each. The search is for 0, 1, 2, 1, 0, over the overlay area (0x801D0000, 0x30000 bytes, to the end of RAM) and over main data (0x80060000, 0x40000 bytes).
- `17b-equip-list-track`: as 17a, after one Circle opens the Weapon list.
- `17c-equip-list-offset-track`: in the Weapon list, marks after 0, 4, 5, …, 10 Downs. The search is for offset min(max(0, d − (P − 1)), 12 − P), for page sizes P = 6, 7 and 8.

## Results
### Attempt 1: `0bc1fb7`, tier2 check 136092624109 (86 pass, 3 fail: the three diagnostics)
| scenario | metrics |
|---|---|
| 17a slot-track | ovl_wait 61; overlay: s_n 1, s_a1 0x801D8AAB; main data: m_n 0 |
| 17b list-track | ovl_wait 61; overlay: l_n 1, l_a1 0x801D8ABD; main data: m_n 0 |
| 17c list-offset-track | page 6: 0 matches; page 7: 0; page 8: o8_n 2, first 0x801D8AB4 |

All three failed only because some of their searches found nothing (main data in 17a and 17b; pages 6 and 7 in 17c).

What this shows:
- **One candidate each, in the overlay, laid out like MenuTables.** The candidates sit as the Item overlay's do (#135: 0x12-byte tables, rowOffset at +0x02, row at +0x0B):
  - the list cursor is 0x12 bytes after the slot cursor: two consecutive tables, at 0x801D8AA0 (slots) and 0x801D8AB2 (list);
  - the page-8 offset match is 9 bytes before the list row, the list table's rowOffset.
- **The list shows 8 rows** and scrolls by one at the bottom: only the page-8 hypothesis matched.
- Nothing in main data (0x80060000, 256 KiB) followed the slot or list sequence.
- 17c's second match was not reported (only the first address was asked for).

### Attempt 1, step 2: acceptance (`save-boot-18a`, `18b`)
The three diagnostics keep only the searches that matched, so they pass as records of attempt 1. Two acceptances read the candidates with plain waits:
- **18a:** the slot cursor reads 0, then 1, 2, 1, 0 after Down, Down, Up, Up. The list row and offset read 0 throughout.
- **18b:** in the Weapon list, the row reads 1 to 7 after 7 Downs. Two more Downs move the offset to 1 and 2 while the row stays at 7. Circle then equips the entry at index 9. That it is weapon 10 is a list-order **hypothesis** (inventory order).
