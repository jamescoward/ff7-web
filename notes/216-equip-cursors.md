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

## Attempt 1: scenarios (`runner/test/unit/equip-cursor-scenarios.js`)
- Save `harness/saves/disc1-md1stin-equip12.json`: Cloud alone (weapon 0), spare weapons 1-12, one each, in inventory slots 0-11. All author-chosen. That Cloud can equip all of them is a **hypothesis**: weapon 1 is confirmed (#121); #215 saw 17 and 33 go to Tifa and Barret.
- Each scenario opens the Equip screen as #121's 15b does: the planned move to Equip, then Circle until `menuOverlay` reads 4, then 120 frames. Each press is 4 frames, followed by 30 frames before the mark.
- `17a-equip-slot-track`: mark, then Down, Down, Up, Up, with a mark after each. The search is for 0, 1, 2, 1, 0, over the overlay area (0x801D0000, 0x30000 bytes, to the end of RAM) and over main data (0x80060000, 0x40000 bytes).
- `17b-equip-list-track`: as 17a, after one Circle opens the Weapon list.
- `17c-equip-list-offset-track`: in the Weapon list, marks after 0, 4, 5, …, 10 Downs. The search is for offset min(max(0, d − (P − 1)), 12 − P), for page sizes P = 6, 7 and 8.

## Results
(pending: Tier 2)
