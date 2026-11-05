# #37: scenario format 2 — title snapshot, input scripts, wait.until

Status (2026-11-05): Tier 1 passes locally and in CI; **Tier 2 passes** on the first push (`7f6b94f`). Attempts used: 1 of 3.

## Design decisions (made without the owner, inside the contract)

- **Boot points, not a hard-coded title.** `boot.from` names an entry in `runner/bootpoints.js`. An entry is a source (`{ disc: N }` or `{ fixture }`), a fixed format 2 script from power-on to T, and a `verify` check at T. `title` is the FF7 one; `pad-echo-ready` is the homebrew one used by Tier 1 tests and the committed example. `"from": "power-on"` starts with no snapshot. The scenario repeats the source (`{ disc: 1, from: "title" }`, the contract's syntax), and the loader checks it matches the boot point's.
- **The title boot point.** #36's script (Start for 4 frames every 120 frames from frame 300), stopping after the press at frames 1140–1143, the last before the title code was resident (1231). T = 1250. Frames 1–1250 get exactly the input of #36's run, and a unit test checks that against `disc-boot-smoke.json`. `verify` is #36's title detector: the first 4 KiB of the title module's code in RAM equals `MENU/SAVEMENU.MNU` at offset 0x2B58. That is an address #36 already used and demonstrated, not a new claim. If it fails, the scenarios fail at `boot_stage` 5 with `snapshot_frames` 0.
- **Script steps are ordered, not on absolute frames.** The issue says "input steps, as in format 1, plus waits". With `wait.until`, later steps can't have fixed frame numbers, so format 2 steps run in order: a press `{ buttons, frames, port }` uses format 1's button names and ports, and holds for `frames` frames. Waits hold nothing. This is a deliberate deviation in syntax, not in meaning.
- **Conditions** use named memory (as format 1 does) of type u8/u16/u32: `equals`, `differs`, `in: [low, high]` (inclusive). A wait checks at the end of each frame, so it always runs at least one frame. Its metric is the frames waited, or 0 on a timeout. **A timeout fails the scenario and stops the script**. Every end check then fails too, because the end state isn't the one the scenario describes.
- **State comparison** (`sameState`): SHA-256 over all 2 MiB of main RAM plus the frame hash, at the end of the script. Only 1/0 leaves. `rerun` plays the script again in a new core instance from the same kind of start: the snapshot, or a fresh boot under `fresh`. `boot` plays it after a fresh power-on boot through the boot point's script, with no snapshot.
- **No `coreOptions` in format 2.** The snapshot carries the core's state, so options belong to the boot point. None are needed yet.
- **Sharing one snapshot per run in `tier2.js`.** Each scenario still runs in its own child (crash isolation, #55). Before the first scenario from a boot point, a `--make-snapshot NAME` child boots it and writes `{"ok":true,"frames":T,"boot_ms":…,"bytes":N}\n` and then the N snapshot bytes to its stdout pipe. The parent keeps the bytes in memory and gives them to each scenario child on stdin. **Nothing is written to a file**, not even `/tmp`. If the snapshot can't be made, each scenario boots the boot point itself and reports what went wrong (`boot_stage`, or `error` for "no disc").
- **`saved_ms`** = boot_ms − restore_ms. boot_ms covers new core, load, T frames and verify. restore_ms covers new core, load and `loadState`. In `tier2.js`, boot_ms comes from the snapshot child. A scenario run alone measures both itself.
- **Room for #74.** Chained boot points (a `from` inside a boot point) and named input segments both slot into the same ordered steps. `makeSnapshot` and `runScenario2({ snapshot })` already take any boot point. Neither is built here.

## Evidence

### Tier 1 (local, 2026-11-05; pinned core `354ee8a4…`)
- `node --test 'runner/test/**/*.test.js' 'tools/asset-guard/**/*.test.js'`: 325 pass, 0 fail, 1 skipped (the Docker sandbox test; no Docker here).
- `runner/test/unit/format2.test.js` (62 tests): format 2 schema valid/invalid, format 1 files still valid, loader checks, conditions, boot points (title = #36's presses), the `parseSnapshot` framing, `findTier2Scenarios` boot points.
- `runner/test/tier1/format2.test.js` (9 tests):
  - **Snapshot reuse:** for two scenarios with different scripts, results from one shared snapshot equal results from a boot+snapshot+restore of their own, and results from a fresh boot with no snapshot. Timing metrics are excluded from the comparison.
  - Through `tier2.js`: one snapshot child for two scenarios. The validator accepts the output against `buildExpect`, and the results equal each scenario run alone from scratch.
  - **`wait.until`** passes on pad-echo's button word and VBLANK counter (1 and 21 frames). It times out cleanly on `buttons == 0x0000`: status fail, metric 0, the script stops at frame 17, every check fails. The CLI exits 1 on a timeout, and two CLI runs are byte-identical.
  - **"no disc":** `runScenario` and `makeSnapshot` for `title` throw ScenarioError `no disc…`; `tier2.js` reports `error`.
  - A disc boot point on a synthetic MODE2 disc, verified against disc bytes, passes rerun and boot. With an unreachable verify, it fails at `boot_stage` 5.
  - The state digest separates frames 10 and 11 and matches two runs of 10.
- `node runner/scenario.js harness/scenarios/pad-echo-script.json` passes. CI's `tier1` scenario loop now also runs this format 2 example twice and compares the output.

### Tier 2 (`tier2` check on `7f6b94f`, 2026-11-05): pass, 3/3
| scenario | match | snapshot_frames | frames | saved_ms | run_ms | fps | boot_stage |
|---|---|---|---|---|---|---|---|
| title-determinism (rerun from the snapshot) | 1 | 1250 | 732 | 3312 | 294 | 2492 | 6 |
| title-snapshot-equals-boot (snapshot vs fresh boot) | 1 | 1250 | 732 | 3306 | 295 | 2483 | 6 |

disc-boot-smoke still passes unchanged (title_frame 1231, fps 1513).

- **Demonstrated:** the title boot point is reached at T = 1250 (verify passed, `boot_stage` 6). One input script, run twice from the title snapshot, ends at T+732 in the same RAM + picture state. The same script from the snapshot and from a fresh boot ends in the same state. A restore saves about 3.3 s of wall time per scenario on GitHub's runner.
- The two scenarios shared one snapshot (one `--make-snapshot` child per run). Tier 1 shows this; the Tier 2 log can't show it, because the sandbox's stderr is never read.

## Not verified
- That the 732-frame title script changes the game state much. A frozen game would also "match". No FF7 address is used to show progress, as the contract requires; the title verify only shows T was reached. The fps (≈2490) suggests light work after Circle, so the later frames may be a fade or a loading wait.
- Determinism over longer scripts, or across a disc swap, a card write or an FMV in full: not tested.
- The 3 bytes that differ between two `saveState` calls (#31) are still unexplained. They didn't affect the state comparison here.
- 8 metrics per scenario were enough for #37. No change to the result format is proposed.
