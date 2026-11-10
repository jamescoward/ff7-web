# 119: suspend and resume (Labs flag `suspend`)

Status: implemented behind the Labs flag `suspend` (off by default). With the flag off nothing is created, stored or shown.

## Design
- On `visibilitychange` to hidden (primary: iOS fires it before `pagehide`) the page asks the worker for the whole emulator state (`getState`), then pauses. `pagehide` also triggers a save; it is skipped when no frame ran since the last save.
- The state goes into IndexedDB, in its own database `ff7-web-states` (store `states`, one record per disc key: bytes, core build id, SHA-256, time). The card database is not touched.
- After a disc boots with the flag on, the page looks up the key. If a record exists (and its core build matches, or either side has no build id) it shows "Resume" and "Start fresh" in the top bar.
- Resume loads the state and keeps the stored record until the next suspend replaces it. "Start fresh" deletes it. While an offer is waiting, a suspend does not overwrite it (otherwise hiding the page right after loading would replace the old state with a fresh boot).
- Card menu: "Export state" / "Import state" (the elements exist only while the flag is on; the menu scrolls when taller than the safe area). Import needs the disc loaded.
- The memory card is not part of resume: `fe_state_load` also replaces the core's card bytes, so the worker snapshots the card before a load and puts it back after (the player's current card wins). The card digest is updated so no spurious card write happens.
- Failure safety: the worker takes a backup state first and, if the core refuses the load, loads the backup. Import validates everything (magic, version, length, checksum, disc key, core build, state size) before calling the worker.
- After a load the worker re-anchors real time (`baseTime`/`baseFrame`) and clears queued audio; the `frame` counter keeps counting (it is a wall-clock pacing counter, not part of the state).
- Core: `fe_state_size`, `fe_state_save`, `fe_state_load` added to `core/web/frontend.c` and the EXPORTS list, copied from `runner/frontend.c` (size guards included).

## Disc key
SHA-256 over: 8-byte little-endian file size, then the whole file if at most 8 MiB (homebrew), else its first 4 MiB and last 64 KiB. The file is the raw image (`.bin/.iso/.img`) for a `.cue` boot, otherwise the boot file itself. Weakness: two images that differ only in the middle and have the same size share a key; a state would then be offered for the wrong image (the core's size check and checksum still apply). The key stays on the device: it is not logged or sent anywhere (it is stored inside the state record and export header only).

## Export format (`.f7s`)
`"FF7WSTAT"` (8 bytes), u32le header length, UTF-8 JSON header `{version:1, discKey, build, stateLength, sha256}`, then the state bytes. `build` is `wasm_sha256` of `BUILD_INFO.json`, or `unknown`.

## Verified (Tier 1, real core on homebrew)
See `web/test/suspend.test.js`: suspend, reload, resume gives the same RAM counter and canvas hash; another disc's state is not offered; export/import round trip; corrupt, truncated, wrong-file and other-disc imports are rejected with a message and leave the game state byte-identical; the card bytes (core and stored) are unchanged; flag off creates no database and shows nothing.

Note: two saves of an untouched core differ in about 3 bytes (volatile bytes inside the core), so the tests treat 'unchanged' as at most 16 differing bytes of ~4.4 MB.

## Not verified
- UNVERIFIED (Tier 3): whether the IndexedDB write after `visibilitychange` completes on real iOS Safari before the page is frozen. If it does not, Export state is the fallback. Playwright WebKit is not iOS Safari.
- Not tested on a real disc image (no game data in tests). State size and save time for the real disc are unmeasured.
- Playing on from a resumed real game (audio, FMV, disc reads) is unverified.

## Running
```
core/build.sh fetch && core/build.sh && core/web/link.sh   # once; outputs web/core/ (not committed)
node --test web/test/suspend.test.js
```
Real-core tests skip when `web/core/` is missing; WebKit tests skip when WebKit is not installed.
