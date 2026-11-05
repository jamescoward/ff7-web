# #74: chained snapshots and reusable input segments

Status (2026-11-05): Tier 1 passes locally. Tier 2 attempt 1 is on CI. Results and attempts are logged at the end.

## Design decisions (made without the owner, inside the contract)

- **The syntax names its source.** A boot point start keeps #37's form, `{ disc: 1, from: "title" }`. A named snapshot start has no source, `{ from: "reactor-entrance" }`, as the issue writes it. So the two namespaces never mix:
  - `{ fixture, from: "nowhere" }` is still a load error ("no boot point named"), as #37's tests expect;
  - `{ from: "title" }` is a load error that says how to start from the boot point;
  - a snapshot can't be named after a boot point or `power-on`.
- **What exists is decided by run order.** `tier2.js` runs scenario files in file name order (as since #55), so chain files are named to sort in chain order: `new-game-to-reactor-entrance` keeps the snapshot, and `reactor-entrance-equals-scratch` uses it. A scenario from a snapshot that no earlier scenario kept is **not started**. The parent reports it as `error` with no metrics, like "no disc", and logs `NAME: error (no snapshot)` to stderr, which the trusted side never reads. A unit test checks that the committed keeper sorts before its user.
- **A snapshot is kept only when its scenario passes.** If the script timed out or a check failed, the end state isn't the one the scenario describes, so later scenarios get "no snapshot" and don't run on it. If two scenarios keep the same name, the later one replaces it.
- **Snapshots stay in memory.** The child that keeps one (`--save-snapshot`) writes its result line, `{ status, metrics, snapshot: { frames, boot_ms, bytes } }`, then the raw bytes, to its stdout pipe. The parent holds the bytes, plus the list of scenario files that led to them, until the run ends. A later child gets the bytes on stdin and the chain as `--chain FILE` arguments. Nothing is written to a file. A snapshot that is malformed or the wrong length is dropped.
- **`sameState: "boot"` in a chain replays the whole chain from scratch.** That is power-on, the root boot point's presses, each earlier scenario's script in order, then this one, all in one core instance with no snapshot. This turns "chain equals scratch" into a check reported as 1/0, on Tier 1 and on the disc. `rerun` restores the named snapshot again. `snapshot_frames` for a named start is the number of frames from power-on: T plus the chain's script frames.
- **Segments live in `segments/` beside the scenario file.** That is `harness/scenarios/segments/`. The checks:
  - The Tier 2 build copies `harness/scenarios` with `cp -r`, so the subdirectory is shipped. The trusted `buildExpect` and `tier2.js` read only `*.json` directly in `scenarios/`, so a segment is never taken for a scenario.
  - CI's tier1 loop globs `harness/scenarios/*.json` and also ignores segments.
  - Segments are expanded before `loadScript`. The expanded list is what the scenario would have written out, and a unit test checks that a segmented scenario loads the same as its flat form.
  - Missing, invalid (`$defs/segment`), misnamed and recursive segments are load errors, and so is an expansion over 16384 steps. Segment files are capped at 64 KiB, like scenario files.
- **Two wait features, needed for a game-agnostic "first controllable field".**
  - **Still waits:** `{ wait: { stillFrames, timeout } }` is format 1's `withinStill` (same frame hash for N frames, not one colour) as a format 2 wait. Its metric is the frames waited.
  - **Presses during a wait:** an optional `press: { buttons, every, hold, port }` on any `until` or still wait.
  - Together they give the reactor-entrance test, "a picture that stays still for 5 s while Circle is pressed every second". Circle is ignored in the movie. It advances dialogue, picks Attack and its target in a battle, and closes result screens. A field where Cloud stands under player control ignores it. A still picture that ignores 4–5 presses is the best game-agnostic sign of control available without an address. It is still a **hypothesis**: a scripted pause over 5 s, or a screen that ignores Circle, would also pass. #76/#77 can confirm the mode and field with addresses.
- **#84 review notes fixed in passing:** `saved_ms` is clamped at 0, and the parent no longer passes `--snapshot-frames` for boot point snapshots, because the child takes T from the boot point. The flag is still used for named snapshots, whose frame count depends on the chain's waits.
- **Changed existing test:** in `runner/test/unit/format2.test.js`, the "unknown property" case used `snapshot`, which is now a valid property. It now uses `snapshots`. The test still checks that an unknown property is refused, so it is not weakened.

## Tier 2 plan (first chain)
- `title-to-new-game` (segment, 240 frames): Circle three times, one second apart. With no memory card, the title menu's first entry, New Game, is the starting cursor position. This is a hypothesis judged by what follows.
- `opening-to-reactor-entrance` (segment): the still wait above. It needs a still picture for 300 frames, presses Circle for 4 frames every 60, and times out after 30000 frames (8 min 20 s).
- `new-game-to-reactor-entrance` (scenario): starts from `title` and plays both segments. `rerun` replays the chain from the title snapshot, which gives the "chain run twice in one run ends in the same state" acceptance (`match`). It keeps `reactor-entrance`.
- `reactor-entrance-equals-scratch` (scenario): starts from `reactor-entrance` and waits 2 s. It reports `match_rerun` and `match_boot`: the same state as the chain replayed from power-on with no snapshot.
- `diag-new-game-first-still` (temporary, removed before merge): New Game, then no input until the first 1 s still picture. If the value is small, New Game did not start.

## Results
(Filled in after each Tier 2 run.)
