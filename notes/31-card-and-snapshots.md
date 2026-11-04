# Issue #31: memory card in slot 1 and in-memory snapshots

Measured on the same Linux container as #4, 2026-11-04. Pinned core (pcsx_rearmed 7b0e8f8).

## What was built
- `runner/frontend.c`: `fe_card_ptr` / `fe_card_size` (RETRO_MEMORY_SAVE_RAM) and `fe_state_size` / `fe_state_save` / `fe_state_load` (thin wrappers over `retro_serialize_size` / `retro_serialize` / `retro_unserialize`). Exports added to `runner/build.sh`.
- `runner/backend.js`: `createBackend({ memoryCard: true })`, `setCard`, `getCard`, `saveState`, `loadState`, and `heapBytes` (test aid).
- `runner/synth/blank-card.js`: formats a blank 128 KiB card in code (header "MC", 15 free directory frames, 20 broken-sector frames, XOR checksums). Not derived from any real save.
- `runner/synth/card-read.js`: original homebrew that reads one card frame through SIO0 (`81 52 ...` exchange) and stores the reply bytes in RAM.
- `runner/test/tier1/card-and-state.test.js`: 14 tests.

First approach worked; no budget spent on dead ends (1 of 3 attempts).

## Card: what the core does (source reading, then confirmed by tests)
- Slot 1 is exposed through `retro_get_memory_data(SAVE_RAM)` only when core option `pcsx_rearmed_memcard1` is `libretro` (set before `retro_load_game`; `load_memcards()` reads it then). With any other value (the default `serial`/`shared` need a save dir and a disc serial; `none` disables) the pointer is NULL and the size 0. So the backend must opt in: `memoryCard: true` sets the option. It stays off by default so existing runs and baselines are unchanged.
- With `libretro`, the core keeps the card in its static `Mcd1Data` and never opens a file (`LoadMcd` returns on an empty path). Saves by the program go straight to that array, so `getCard()` after a run shows what the program wrote.
- `Mcd1Data` is formatted blank at `retro_init`, and `retro_load_game`/`SysReset` do not clear it. So `setCard` works before or after `loadProgram`; the backend keeps the bytes and copies them after load if called before. The rule is only: set it before the first frame, because programs read it as they run.
- Only slot 1 is reachable (the libretro memory API has no second card), so `slot` must be 0.
- Tests showed: round trip identical both orders; `card-read` sees the exact bytes of card frame 3 (reply: flag 0x08 = "new card", then 0x5A 0x5D, then data), and sees only 0xFF when no card is configured.

## Snapshots
- `retro_serialize_size` is a constant 0x440000 (4,456,448 bytes); the core zero-pads the unused tail. The backend allocates exactly that with `malloc`, frees it in a `finally`, and rejects other lengths. A heap-size test over repeated save/load shows no growth. Actual content is small (about 145 KB non-zero after 30 frames of a tiny program); a real game will fill more. 4.4 MB per snapshot is fine for one per run.
- Save about 2.8 ms, load about 1.7 ms (tiny program, includes the copy to/from JS).
- No path parameter anywhere; the C wrappers take a buffer pointer only. The test checks the temp dir listing is unchanged and that the function signatures take no path.
- **The card is not in the state** (`sioFreeze` stores only the SIO registers/buffers, not `Mcd1Data`). Restoring leaves the card as it is now; the test proves a card changed after the save stays changed after the load. On load the core also sets the "new card" flag (0x08) for both slots so the game rechecks the card. A scenario that needs the card back at its snapshot value must `setCard` again after `loadState`.
- **Two saves of the same moment are not byte-identical**: in a 10-frame pad-echo run, 3 bytes differed (offsets 2,719,817, 4,379,417 and 4,379,418) between consecutive `saveState` calls. Not investigated further. Consequence: do not compare or hash snapshot bytes for equality; compare behaviour. The determinism tests do that (frame hashes and RAM after each restore are identical, twice), and a test shows taking a snapshot does not change later frames.
- `frame` (the host counter) and the last-frame buffer are not part of the state, so after `loadState` the counter keeps increasing and `frameHash()` shows the stale picture until the next frame.
- States are valid only for the same core build (`wasm_sha256` in `BUILD_INFO.json`); the core does no version negotiation beyond its own header.

## Not verified
- Behaviour with a real disc image (no game data used here). State size and timing will differ with a game, and a FF7 card write path (program saving to the card) was not exercised; only reads by a program and host-side set/get.
- The 3-byte non-repeatability above is unexplained.
