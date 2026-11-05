# Issue 36: disc boot smoke test — plan and findings

Status: research done, implementation not started (2026-11-05). The cue
delivery prerequisite is PR #61 (#62), which is waiting for the owner to merge it.

## Sources (reference only, nothing copied)
- Xeeynamo/ff7-decomp @ `9411173034bde2ae4c9b0312167e79c3645ca1be`
  (2026-11-04), fetched with `git clone` (HTTPS git works through the proxy).
  AGPL, and its maintainers forbid LLM contributions: we cite facts (hashes,
  addresses, layouts) with attribution and copy no code.
- ff7-mods/ff7-flat-wiki (git clone). Not yet used for this issue.
- Every `*.github.io` page and redump.org returned 403 from this session's
  proxy. The owner has made a new environment that allows the research hosts.

## Expected executable hash (source claim)
`config/us.yaml` pins `disks/us/SCUS_941.63` at
**SHA-1 `a95e8b16b97071203b953bb81a33980509262f30`**. This is an
independently published value. The decomp targets one USA release, so a
"not matched" result could mean another revision (the original release vs.
a Greatest Hits pressing), not a bad disc. Record that in the result notes.

Plan: the runner reads ISO9660 from the MODE2/2352 bin (or the cue's
track), finds `SYSTEM.CNF`, takes its `BOOT` path, reads that file and SHA-1s
it inside the sandbox. Only `pass`/`fail` leaves (an assertion), never the hash.
Tier 1 tests use a synthetic ISO built in the test from the pad-echo homebrew.

## Title screen detection (hypothesis, unverified)
- `g_GameState` (s16) is at `0x8009C560` and `g_PrevGameState` at `0x800965EC`
  (`config/symbols.main.us.txt`). Field = 1, battle = 2, world = 3, menu = 5, …
  The title screen has **no** game state. The main loop calls
  `HandleTitle()` (0x80024E5C) before `g_GameState` is set for the field.
- `HandleTitle` loads the SAVEMENU overlay (`MENU/SAVEMENU.MNU`, decomp
  SHA-1 `430d54dbe01d9a0c670b1d2d2b5c642bdd1b3199`, vram_start `0x801D0000`) through
  `LoadMenuOvl` to the address held in `D_80062DEC`, then runs
  `SAVEMENU_Title` (0x801D4CC0). The file's `.bss` starts at offset 0x13698.
- Candidate detector A: the SHA-1 of RAM `[0x801D0000, +filesize)` equals the
  file SHA-1 on the first frame after the overlay load. Risks: the load
  address may differ, `.data` may change before the check, and the file size
  is not yet known exactly (0x13698 is the `.bss` start).
- Candidate detector B: a game-agnostic one. Frames from boot to the first
  frame from which the picture hash stays constant for K frames. This is weaker:
  it does not prove the title screen.
- Prefer a memory signal and confirm it on Tier 2 with metrics only (a frame
  number and a 0/1 match). Do not export memory values beyond what #55 allows.

## Runner work (allowed paths: runner/, harness/scenarios/, notes/, STATUS.md)
1. Format 1 `boot: { "disc": "disc-1" }` as an alternative to `fixture`. This
   needs a small `harness/schema/scenario.schema.json` change. That file is
   outside #36's allowed paths but not protected, so call it out in the PR
   report as a scope addition.
2. `runner/tier2.js` passes `--disc` to `runScenario`. When the disc's
   directory holds `disc-1.cue`, boot the cue; otherwise boot the given bin.
   The bin alone may boot FF7, because it is a single data track. That allows Tier 2
   iteration before #61 merges, but acceptance needs the cue.
   `backend.loadProgram` already mounts the file's directory, so a
   cue's `FILE "disc-1.bin"` resolves.
3. A missing or unreadable disc fails with a ScenarioError "no disc". The Tier 1
   test runs the tier 2 scenario with `--disc /nonexistent`.
4. A new assertion kind or boot check for the executable SHA-1 (match only).
5. A title detector and metrics `fps` and a title frame (≤ 8 metrics).
6. Scenario `harness/scenarios/disc-boot-smoke.json` (`tier: 2`).
