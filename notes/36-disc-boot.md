# Issue 36: disc boot smoke test — plan and findings

Status: attempt 2 of 3 (2026-11-05). The first Tier 2 run gave `error` with no metrics; attempt 2 makes the run say where it stops. The cue
delivery prerequisite (#62) is merged in #61, so private eval now mounts
`/disc/disc-1.cue` and `/disc/disc-1.bin` read-only (plus the `/disc/disc.bin` alias).

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
   `backend.loadProgram` already mounts the file's directory, so a
   cue's `FILE "disc-1.bin"` resolves.
3. A missing or unreadable disc fails with a ScenarioError "no disc". The Tier 1
   test runs the tier 2 scenario with `--disc /nonexistent`.
4. A new assertion kind or boot check for the executable SHA-1 (match only).
5. A title detector and metrics `fps` and a title frame (≤ 8 metrics).
6. Scenario `harness/scenarios/disc-boot-smoke.json` (`tier: 2`).

## Implementation (2026-11-05)
- `runner/disc.js`: ISO9660 on MODE1/2048, MODE1/2352 and MODE2/2352, through a
  cue's first FILE/TRACK or a bare image; `bootPath()` reads SYSTEM.CNF.
  A cue's FILE is resolved only next to the cue.
- Format 1 additions (`harness/schema/scenario.schema.json`, a scope addition:
  not protected, but outside #36's listed paths):
  - `boot: { "disc": "disc-N" }`. `resolveDisc` picks `<name>.cue` next to
    `--disc`, then `<name>.bin`, then the `--disc` image. Otherwise it throws
    the ScenarioError "no disc" (no path in the message).
  - assertion `discFile` + `sha1`: reported only as pass/fail (metric 1/0).
    `SYSTEM.CNF:BOOT` means the boot executable.
  - assertions `within` + `mem` + `equals`, or + `equalsDiscFile {path, offset}`:
    the first frame (≤ within) at which RAM matches. Disc bytes are read and
    compared in the sandbox and never reported.
  - `within` + `stillFrames`: the first run of K identical frames that are not a
    single colour (`backend.frameIsUniform`).
  - `probes`: the same checks, but metric only. They never change the status.
  - Any check may name a `metric`, which must be listed in `metrics`.
- `runner/tier2.js` passes `--disc` to each scenario.
- Detector A, refined: the scenario compares the **title module's code**
  (SAVEMENU file offset 0x2B58, linked at 0x801D2B58, the first 4 KiB) with
  the same bytes read from `MENU/SAVEMENU.MNU` on the disc. Code is not
  modified at run time, unlike `.data`, so the open "data changes before the
  check" risk goes away, and no hash of the overlay is needed for the
  detector. The overlay's SHA-1 is still checked as a probe
  (`savemenu_match`), so we learn whether the offsets fit the disc.
- Detector B is the `still_frame` probe (60 frames), for comparison.

## Tier 1 evidence (local, 2026-11-05)
`node --test 'runner/test/**/*.test.js' 'tools/asset-guard/**/*.test.js'`:
253 pass, 0 fail, 1 skipped (the Docker sandbox test). The new tests:
- `runner/test/unit/disc.test.js`: the reader on all three modes, bare and
  through a cue, plus the loader's rules.
- `runner/test/tier1/disc-boot.test.js`: the real core boots a synthetic
  MODE2/2352 disc whose boot executable is pad-echo, through `disc-1.cue`
  (HLE BIOS). The boot hash, code residency and marker checks pass, and the
  result holds no disc hash or bytes. Without a disc the smoke scenario fails
  with "no disc", and `tier2.js` reports it as `error`.

## Reading the Tier 2 result
| metric | meaning |
|---|---|
| boot_stage | how far the run got: 1 disc found, 2 image opened, 3 ISO9660 found, 4 disc checks done, 5 core accepted the disc, 6 every frame ran |
| disc_cue | 1: booted `disc-1.cue` (expected), 0: fell back to a bin |
| frames | frames actually run (5400 unless the core crashed part-way) |
| boot_exe_match | 1: SYSTEM.CNF's executable has the SHA-1 published for SCUS_941.63 |
| title_frame | first frame with the title code resident; 0 = not within 5400 frames |
| savemenu_match | 1: SAVEMENU.MNU is the revision the decomp describes |
| still_frame | first frame of the first 1 s still, non-blank picture; 0 = none |
| fps, run_ms | unthrottled speed of the frame loop |

If title_frame is 0 but savemenu_match is 1, the overlay is loaded elsewhere
or not by frame 5400. If savemenu_match is 0, the offsets don't apply to this disc.

## Tier 2 attempt 1 (`f309278`, 2026-11-05): error
- Summary: `disc-boot-smoke: error`, `limits_hit: []`. The whole sandbox step
  took 10 s (job step timings), so the run stopped during setup or in the
  first few seconds of boot, nowhere near 5400 frames.
- An error result carries no metrics by design. So nothing showed which step
  failed: the cue read, the image, the ISO9660 parse, the core's load, or a
  crash in the first frames.
- The browser build boots FF7 on the iPhone with the same HLE BIOS
  (`core/web/frontend.c`), so the BIOS is an unlikely cause.
- Candidates fixed blind: the cue sheet read raised a plain error (e.g.
  EACCES) rather than a DiscError, and a UTF-8 BOM at the start of the cue
  would have hidden its FILE line.

## Attempt 2: staged boot
After the disc is found, a failure no longer errors. The run stops at its
`boot_stage`, the scenario fails, and every assertion fails. The metrics
still leave, numbers only: `boot_stage`, `disc_cue` and `frames`
(the frames actually run). A missing disc is still the ScenarioError
"no disc" (status error), as #36 requires. A Wasm trap during the frame loop
is caught as stage 5, with the number of frames that ran.

## Tier 2 attempt 2 (`7c002b2`, 2026-11-05): fail at boot_stage 1
Metrics: `boot_stage 1`, `disc_cue 1`, `frames 0`, every check 0. So
`/disc/disc-1.cue` exists, but `openDisc` failed before it had the image
open: the cue can't be read or parsed, or the image its FILE line names is
not next to it under that name. Both files are fetched as 0644
(`tier2-eval.yml`), so permissions are an unlikely cause.

Next (`disc_error`, replacing `disc_cue` in the scenario's metrics, which
attempt 2 showed is 1): 1 cue unreadable, 2 no FILE line, 3 no TRACK line,
4 unsupported first-track mode, 5 the image the cue names is missing,
6 the image is unreadable, 7 no ISO9660 file system. 5 would mean the cue's
FILE line names a file other than `disc-1.bin`. The trusted job stores the
image as `disc-1.bin` whatever the cue says, so only the owner can confirm
that.

## Tier 2 on `3be29f7` (2026-11-05): disc_error 5
The cue is read and parses, but the image its FILE line names is not next to
it. The trusted job always stores the image as `disc-1.bin`, so the R2 cue
names another file. **Blocked on the owner**: re-upload `disc-1.cue` with
`FILE "disc-1.bin" BINARY` (see #36). The runner will not rewrite or generate
a cue, as #36 says. Then re-run Tier 2 on PR #64. Attempts used: 2. The
`disc_error` refinement diagnosed attempt 2 and was not a new approach.

## Owner decision (2026-11-05): boot the bin, not the cue
The owner asked to boot `disc-1.bin` directly instead of fixing the R2 cue.
FF7 disc 1 is a single MODE2/2352 data track, so the cue adds nothing. The
reader detects the layout from the sync pattern, and the core boots a bare
.bin. `resolveDisc` now picks `<name>.bin` next to `--disc`, else the
`--disc` image, and never uses a cue. This changes #36's acceptance from
"booted from disc-1.cue + disc-1.bin" to "booted from disc-1.bin", with the
owner's approval. The Tier 1 test puts a cue that names another file next to
the bin and checks that it is ignored. Cue parsing stays in `runner/disc.js`
(unit-tested) for discs that ever need one; scenarios don't use it. The
`disc_cue` metric is gone, and `disc_error` codes 1–5 can't occur from a
scenario now.

## Tier 2 on `4523902` (2026-11-05): boots, hashes match, no title
Metrics: `boot_stage 6`, `frames 5400`, `boot_exe_match 1`,
`savemenu_match 1`, `disc_error 0`, `still_frame 268`, `title_frame 0`,
`fps 1282.998`.
- **Demonstrated:** the disc boots and all 5400 frames run.
  SYSTEM.CNF's executable has the SHA-1 published for SCUS_941.63, and
  MENU/SAVEMENU.MNU has the decomp's SHA-1, so the offsets apply.
- The title code was never resident at 0x801D2B58.
- The fps looks wrong: 1283 fps is about 10× pad-echo's 126 fps locally, on
  an interpreter CPU. This suggests the emulated machine is not doing the
  game's normal work.
- **Cause found in the pinned core:** `libpcsxcore/cdriso.c` `parsecue()`
  swaps a `.bin`'s extension for `.cue` and parses that file when it exists
  (`parsetoc` does the same for .toc, and the core also looks for .ccd and
  .mds). Booting `/disc/disc-1.bin` therefore still read the R2 cue whose FILE
  line names another file, despite the owner's decision. Fix: `resolveDisc`
  takes the first candidate without a same-named .cue/.toc/.ccd/.mds. In the
  sandbox that is `/disc/disc.bin`, the eval's alias of the same image.
- Probes for the next run: `overlay_frame` (any SAVEMENU code resident) and
  `frozen_frame` (a 30 s still picture). `savemenu_match` and `disc_error`
  leave the metric list, since both are known now.
- This fixes how the owner's decision was carried out. It is not a new title
  detector, so attempts used are still 2 of 3.

## Tier 2 on `8aa966c` (2026-11-05): still no title, and no overlay at all
Booting `/disc/disc.bin` (no cue beside it): `boot_stage 6`, `frames 5400`,
`boot_exe_match 1`, `fps 1084.429`, `still_frame 268`, `frozen_frame 0`,
`overlay_frame 0`, `title_frame 0`. No byte of SAVEMENU appears at its link
address in 90 s, and the picture never holds still for 30 s. So the cue was
not the (only) cause: the game does not reach HandleTitle's overlay load in
this runner, yet the iPhone build reaches the title with the same core and HLE
BIOS.
- **Ruled out:** the memory card option. The core's default
  `pcsx_rearmed_memcard1` is `libretro`, the same value the browser sets.
- **Next run (diagnostic, not a new detector):** `exe_frame` (the boot
  executable's first 4 KiB resident at 0x80010000, compared with the disc
  file at offset 0x800), `game_state` (u16 at 0x8009C560 at the end) and
  `ovl_dest` (u32 at 0x80062DEC at the end, the overlay load address).
  Readings:
  - exe_frame 0: the executable never loaded (an HLE BIOS or disc read problem);
  - exe_frame > 0 and ovl_dest 0: running, but not yet at the title;
  - ovl_dest set: the overlay should be resident there.

## Tier 2 on `6ab3780` (2026-11-05): the game runs, but stays before the title
`exe_frame 1` (the executable is resident from frame 1), `game_state 0`,
`ovl_dest 2149384192` (0x801D0000, which is probably just initialised data),
`overlay_frame 0`, `still_frame 268`, `fps 735`.

The decomp's `main()` (src/main/110B8.c, reference only) runs the ENDING
overlay's `ENDING_SceaLoop()` and then `ENDING_Loop(0)` before
`HandleTitle()`. These are the pre-title logos and intro. The scenario
injected no input, while the iPhone run had a person pressing buttons.

## Attempt 3 (materially different): drive the boot with input
10800 frames (3 min). Start is held for 4 frames every 120 frames from frame
300. New probe `ending_frame`: the ENDING overlay (FIELD/ENDING.X, linked at
0x800A0000) is resident, showing the intro loops run. Start is used because
FF7's title confirms with Circle, so Start should not leave the title. If
this fails, stop and report blockers (attempt budget).

## Tier 2 attempt 3 (`880f059`, 2026-11-05): PASS
`boot_exe_match 1`, `boot_stage 6`, `ending_frame 82`, `overlay_frame 1228`,
`title_frame 1231`, `still_frame 268`, `game_state 0`, `fps 989.352`.
- **Demonstrated (Tier 2):**
  - disc 1 boots from `/disc/disc.bin` (no cue);
  - the boot executable matches the published USA SCUS_941.63 SHA-1, reported
    as matched only;
  - the ENDING intro overlay is resident from frame 82;
  - the SAVEMENU overlay is resident from frame 1228;
  - the title module's code is resident from frame **1231** (20.5 s at 60 Hz),
    with Start pressed for 4 frames every 120 frames from frame 300;
  - unthrottled speed: **989 fps** (about 16.5× real time) on the GitHub runner.
- **For #37:** the frames-to-title figure depends on the input script. Without
  input, the title was not reached within 5400 frames. A title snapshot would
  save about 1231 frames (about 1.2 s at this speed) per scenario.
- `game_state` stays 0 on the title, as the decomp says (no state for the title).
- The earlier fps readings (735 to 1283) were with the game sitting in the
  intro. The high fps was not a sign of a broken boot: the intro is light work.
