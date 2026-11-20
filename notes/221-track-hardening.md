# #221: hardening the format 2 `track` check

Follow-up to #216 (PR #220), from the reviewer agent's non-blocking notes. It narrows what the check can reveal; #216's scenarios are unchanged.

## Changes (`runner/format2.js`, `harness/schema/scenario.schema.json`)
- **Count cap.** The count metric is `min(count, 5)` (`TRACK_COUNT_CAP`). 0 to 4 are exact and 5 means "5 or more", so the count is no longer a histogram of a range. `found` still gives the first up to 4 addresses.
- **Search windows.** `[from, from + bytes)` must lie inside one window of `TRACK_WINDOWS`. The check is on RAM offsets, so the KSEG0, KUSEG and KSEG1 views of the same bytes are treated alike.
  - `overlay`: 0x801D0000 to the end of RAM (0x30000 bytes). The menu overlays load here (#135), and #216 found the Equip cursors in it. Every game scenario that uses `track` today (17a–17c) searches exactly this window.
  - `pad-echo`: 0x800F0000, 256 bytes. This is only for scenarios whose `boot` names a fixture, where no game is in memory. It keeps the Tier 1 test on the homebrew counter (`runner/test/tier1/track.test.js`).
  - No other window was justified. #216's attempt 1 also searched main data (0x80060000, 256 KiB) and found nothing; that search is now refused. A new window needs a reason in `TRACK_WINDOWS` and on its issue.
- **`mayMiss: true`** (optional). No match is a passing record, so a negative search can stay in a scenario. A stopped run, a timed-out wait or a missed mark still fails.
- **Wording.** `notes/216-equip-cursors.md` no longer implies that refusing constant sequences stops a scenario from locating a value. With marks around a load, `[0, 0, v]` finds where v sits in the new content.

The validator and `docs/SECURITY.md` are not touched. The result is still numbers only, within the same metric caps.

## Evidence
- Tier 1 unit: `runner/test/unit/track.test.js`, the "hardening (#221)" suite (cap, windows, fixture-only window, KUSEG view, `mayMiss`). `equip-cursor.test.js` checks that the overlay range is the overlay window.
- Tier 2: see the PR. Expected: 17a–18b metrics identical to #216's runs (s_n 1, l_n 1, o8_n 2: all under the cap).
