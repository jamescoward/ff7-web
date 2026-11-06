# #88: a snapshot restored mid-run differs from running on

Status (2026-11-06): cause found and fixed in the core's save-state code, demonstrated on Tier 1 with homebrew. Tier 2 (the disc) is in progress: results are logged at the end.

## Summary
- **Cause (demonstrated on Tier 1):** `retro_unserialize` does not put the CPU and root counter timing back exactly.
  - Root counters clocked at a rate above 1 (counter 0 on the dot clock, counter 2 at sysclk/8) lose the part of a tick elapsed since their last increment. After a restore they read up to one lower than in a core that never restored, and the loss adds up over chained restores.
  - The interpreter's fractional cycle count (`psxRegs.subCycle`) is not saved and is zeroed on load, so a restored core runs up to one cycle behind. A sysclk counter (rate 1) read by the program shows this.
  - A program that reads a root counter and keeps the value in RAM (games do this for timing and random seeds) then has different RAM within one frame.
- **Why the old evidence looked the way it did:** homebrew `pad-echo` reads no timer, so its chains equalled scratch on Tier 1. A single restore at the title boot point then 732 frames matched (`title-snapshot-equals-boot`), while a chain restored at title + 60 and played one frame did not. The likely reason is that the loss is at most one tick per restore, and whether it changes RAM depends on whether the game reads the counter at that moment and keeps the value. This is a hypothesis about FF7; the Tier 2 runs below test the chains themselves.
- **Fix:** `core/patches/0002-savestate-round-trip.patch` (four small changes in the pinned core's save-state code; see below). The pinned core build changes.

## The 3-byte difference between two saves (#31), explained
Two `saveState` calls at the same moment differ in:
- `misc_save_data.save_counter` (offset 2,719,817): +1 on every save, by design;
- the high bytes of the MDEC `rl_end` pointer, stored as an offset from RAM (4,379,417-418): the core stores `pointer - RAM base`, and before the first MDEC use the pointer is NULL, so the "offset" is garbage until the first save re-bases it.
Neither is read by the emulated program. `runner/stateparts.js` leaves both out of comparisons.

## Method (Tier 1, homebrew only)
- Byte diff of whole states, a core restored at frame N and run M frames versus a core run N + M frames with no save. The state layout was taken from `libpcsxcore/misc.c` `SaveState`, and struct sizes were measured by compiling the struct definitions with the pinned emcc (`psxRegisters` saved part 792 bytes, `GPUFreeze_t` 1032, `cdr` 35,288 with `freeze_ver` at 2,360, `sio` 286, root counters 128, MDEC 1,312).
- With `pad-echo`, only bytes outside RAM differed: an event start cycle off by one (`intCycle[PSXINT_SIO]`: the lost sub-cycle), GP1 register copies, `cdr.Prev[0]`, `cdr.FifoSize`.
- A probe that reads the root counters (`runner/synth/timer-probe.js`) showed RAM differences at once. On the unpatched core, after one restore counter 2 (sysclk/8) read one lower and counter 0 (dot clock) one lower; after two restores, two lower. With counter 2 on sysclk (rate 1), it read one lower from the lost `subCycle`. The busy-wait count did not change in these runs.
- An SPU probe (four voices keyed on, envelope volumes and ENDX read every frame) matched after restores, and so did the SPU part of the state. It is folded into `timer-probe`.

## The patch (`core/patches/0002-savestate-round-trip.patch`)
1. `psxRcntFreeze` (load): skip re-deriving a counter's start through `_psxRcntWcount` when the mode gives the rate the state was saved with. The saved `cycleStart`, `cycle` and `counterState` are then already exact. The old path stays for states whose rate differs.
2. `psxRegs.subCycle`: saved in a reserved word of the misc block and put back after `R3000ACPU_NOTIFY_AFTER_LOAD_STATE`, which zeroes it. Old states hold 0 there, which gives the old behaviour.
3. `mdecFreeze`: the partial-block position was reset to the block start on **save** as well as on load. A save in the middle of an MDEC block therefore changed the running core, and a load lost the position. It is now kept on save and restored to the saved offset on load. This was found by reading the code and is not demonstrated: no homebrew drives the MDEC yet. The movie diagnostic in Tier 2 exercises it on the disc.
4. `cdrFreeze` (load): keep the saved data FIFO size (0, 2060 or 2340) instead of re-deriving it from the current mode.

State format: compatible both ways. A patched core loads old states with the old behaviour, and an unpatched core ignores the new reserved word.

## Known remaining differences (not game-visible as far as is known)
`runner/stateparts.js` leaves these out of part comparisons:
- `save_counter` and the MDEC pointers (above).
- The top byte of the GPU's GP1 register copies `ulControl[0..8]`. The load replays the registers as GP1 writes, which records the command number in registers the program never wrote. The picture is compared separately (`frameHash`).
- `cdr.Prev`: the MSF of the sector in the host-side read buffer, which is not in the state. A load re-reads that sector and sets `Prev[0]` to 0xff if it can't, as before any read, when `Prev` is 00:00:00.

Also seen in the code, not changed (outside this issue's evidence): the GPU loses a partly received GP0 command on load (`cmd_len = 0`); `GP1(02)` replayed on load acknowledges a pending GPU IRQ; `McdFlag |= 8` on load marks the cards "new". With the blank card the runner uses, no write ever clears the flag, so this is the same with or without a restore. A game that writes the card would see a difference.

## Tier 1 (`runner/test/tier1/restore-equals-run.test.js`)
- timer-probe as an EXE and booted from a synthetic disc. Restores at 30, 31, 33 and 37, chains 30+7, 30+60 and 30+1+1+1+1, then 1 to 60 frames. Each must equal one core run from power-on with no save: root counters, main RAM and every state part. On the unpatched core all 14 fail on the root counters (checked by swapping in the main branch's `core.wasm`). On the patched core all 14 pass.
- A core that saved 7 times and ran on equals one that never saved.
- `pad-echo`: a chain equals running on, part by part.
- `stateparts`: the parts cover the state without overlap except the 25 bytes left out, and two saves of one moment have equal parts.
- `same_PART` metrics (format 2): 1 for every part on a pad-echo chain, 0 where they should be on a broken chain, and a load error without a `boot` check.

## Tier 2 plan (attempt 1)
Diagnostics, each reporting `match_boot` and seven `same_PART` metrics (RAM, CPU, I/O, GPU, SPU, CD-ROM, timers) as 0/1:
- `diag-88-title-a-keep` → `diag-88-title-b-equals-scratch`: #74's failing title chain, title + 60, then 1 frame.
- `diag-88-title-c-equals-scratch`: the same snapshot, 732 frames with presses.
- `diag-88-movie-a-keep` → `diag-88-movie-b-equals-scratch`: a snapshot kept 30 s after the New Game minute, hypothesised to be mid-movie (MDEC and CD streaming), then 2 s.
- `reactor-entrance-equals-scratch`: from `reactor-entrance` (frame 11095), 2 s.

## Results
(Tier 2 attempt 1: pending.)
