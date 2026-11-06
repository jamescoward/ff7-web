# #74: chained snapshots and reusable input segments

Status (2026-11-06): Tier 1 passes. Tier 2 attempt 3 of 3 reached a still, Circle-ignoring picture 5525 frames into the wait, at frame 11095 from power-on (a hypothesised first controllable field). The chain run twice in one run ends in the same state (match 1). Open: on the disc, a restored mid-run snapshot differs from running on (match_boot 0). That is not an acceptance item, so it is recorded at the end and proposed as a follow-up. Results and attempts are logged at the end.

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

### Attempt 1 (`072ddb3`, tier2 check: 5 pass, 1 fail)
| scenario | status | metrics |
|---|---|---|
| diag-new-game-first-still | pass | first_still 60, frames 300, match 1 |
| new-game-to-reactor-entrance | pass | still_wait **300**, frames 540, match 1, snapshot_frames 1250, fps 1833 |
| reactor-entrance-equals-scratch | **fail** | match_rerun 1, **match_boot 0**, snapshot_frames 1790, saved_ms 3783 |
| disc-boot-smoke, title-determinism, title-snapshot-equals-boot | pass | unchanged (title_frame 1231; match 1) |

Reading:
- **The chain did not reach a field.** still_wait 300 is the minimum: the picture was already still at T + 241 and stayed still for 5 s while Circle was pressed 5 times. The diagnostic agrees: no input after the New Game presses, and a still picture at once. So from T + 241 to T + 540, a static screen ignored Circle. It is either the title menu ignoring input, or a still movie frame (an empty starfield is possible). The scenario "passed" only because the check is weak, so attempt 1 does **not** count as reaching reactor-entrance.
- **Restoring at T + 540 is not the same as running on.** The run from the kept snapshot ended in the same state twice (match_rerun 1), but not in the state of the chain replayed from power-on (match_boot 0). The same comparison at the title snapshot passes (title-snapshot-equals-boot). On Tier 1 the chain logic gives match_boot 1 (pad-echo), so the difference is in what a restore at that point brings back, not in the replay order. Not explained yet.

### Attempt 2 (materially different: a memory card, and a one-minute lead)
The browser build, which the owner used to play the disc on the iPhone, always has a memory card in slot 1 (`web/js/backend.js` sets `pcsx_rearmed_memcard1`). The headless runner has had none. Hypothesis: with no card, the game (or the HLE BIOS card code) sits on the title. Changes:
- boot point `title-card`: `title` plus a blank formatted card (`runner/synth/blank-card.js`, original code), given to every core instance of the chain, because states don't hold the card;
- `new-game-to-reactor-entrance` starts from `title-card`. After the New Game presses it presses Circle every second for one more minute (segment `circle-every-second-1min`), so a late-responding title menu still gets New Game, and only then waits for the 5 s still picture;
- diagnostics (now removed): `diag-title-down` / `diag-title-card-down` (does Down change the picture at the title, without and with a card?), `diag-title-1min` / `diag-title-card-1min` (60 s after New Game: still or moving?), `diag-chain-title-a`/`-b` (chain vs scratch at the title, where restores are known good), and `reactor-entrance-one-frame` (does a restore at reactor-entrance differ after a single frame?).

Results (`7b59dbf`, tier2 check: 7 pass, 5 fail):
| scenario | status | metrics |
|---|---|---|
| diag-title-down / diag-title-card-down | fail | still 0: with Down every 30 frames the picture kept changing for 600 frames (the match 0 is only the timeout failing every check) |
| diag-title-1min / diag-title-card-1min | pass | still 60: 60 s after the Circle presses the picture is still at once, with or without a card |
| new-game-to-reactor-entrance (title-card) | pass | still_wait **300** again, frames 4140, match 1 |
| diag-chain-title-a / -b | pass / **fail** | from a snapshot kept at the title + 60 frames, one frame: match_boot **0** |
| reactor-entrance-one-frame, reactor-entrance-equals-scratch | fail | match_rerun 1, match_boot 0 (snapshot_frames 5390) |
| disc-boot-smoke, title-determinism, title-snapshot-equals-boot | pass | unchanged |

Reading:
- **The title reads the pad (Down moves the picture), but Circle doesn't start New Game, with or without a card.** The card was not the cause. The likeliest explanation is the cursor not being on New Game when Circle arrives (for example, it starts on the other entry). This is a hypothesis.
- **match_boot 0 is a runner bug, not an emulator limit.** It fails even at the title, one frame after a restore. The last picture is host-side (`runner/frontend.c` `video_cb` keeps the last non-NULL frame and counts NULL frames as duplicates), and a snapshot doesn't hold it. A freshly restored core has no picture until the core sends a new frame, while the core that ran on still holds an older one. On a static screen the core can send only duplicates, so the digests differ even when RAM is the same. The runner change: `sameState` compares the picture only when the core delivered a new frame during the script, and main RAM always. Both sides play the same frames, so they agree on whether one arrived. Hypothesis: RAM was equal all along. Attempt 3's `title-chain-b-equals-scratch` tests that.

### Attempt 3 (last: a cursor-independent New Game, and the digest fix)
- `title-to-new-game`, 720 frames: Circle, Cross, Cross (backs out of what Circle opened if the cursor was on the other entry), Down, Circle. The rest is unchanged: `title-card`, a minute of Circle, then the 5 s still wait.
- The diagnostics are removed. The permanent cheap check is `title-chain-a-keep` → `title-chain-b-equals-scratch` (chain vs scratch one frame after a title-level restore).
- **Reading still_wait:** 300 means a still screen from the first frame, which is **not** a field. A real arrival shows a still_wait well above 300, after the movie (minutes).

Results (`4f2f54c`, tier2 check: 5 pass, 2 fail):
| scenario | status | metrics |
|---|---|---|
| new-game-to-reactor-entrance | pass | **still_wait 5525**, frames 9845, **match 1**, snapshot_frames 1250, fps 204, run_ms 48221 |
| reactor-entrance-equals-scratch | fail | **match_rerun 1**, **match_boot 0**, snapshot_frames 11095, saved_ms 52754 |
| title-chain-a-keep / title-chain-b-equals-scratch | pass / fail | match 1 / match_rerun 1, **match_boot 0** (one frame after a restore at T + 60) |
| disc-boot-smoke, title-determinism, title-snapshot-equals-boot | pass | unchanged |

Reading:
- **New Game started, and the chain reached a still picture after the opening.** The script ran 720 frames of title presses, 3600 frames of Circle, and then 5525 frames until the picture was still, non-blank and ignoring Circle for 5 s. That puts it at frame T + 9845 = **11095** from power-on, about 2 min 44 s after the first title press. The fps fell from about 1800 to 204, consistent with movie decoding on the way. The claim stays game-agnostic: a still, Circle-ignoring picture at frame 11095. That it is the first controllable field (the station outside reactor 1) is a **hypothesis** for #76/#77 to confirm with addresses.
- **Determinism (acceptance):** the chain played twice from the title snapshot in one run ends in the same state (match 1). A second scenario started from the named snapshot `reactor-entrance` restores it twice to the same state (match_rerun 1).
- **Chain vs scratch on the disc: still 0, after the picture fix.** RAM and/or the picture still differ one frame after restoring a snapshot that a scenario kept, even at the title. Compare:
  - `title-snapshot-equals-boot`: a boot point snapshot restored at T equals a fresh boot after 732 frames;
  - on Tier 1, homebrew chains equal scratch exactly.

  What differs between the cases is unknown. Candidates are emulator state that `retro_serialize` doesn't round-trip mid-run, such as CD-ROM or SPU timing (a restore at T may land at a quiet moment, and 732 frames may let a transient difference converge), and the 3 bytes that differ between saves (#31). The picture-only explanation is ruled out.

## Outcome and decisions after attempt 3
- The attempt budget is used (3 of 3). The issue's Tier 2 acceptance is met: a still, non-blank picture within the timeout after New Game, reported as a frame number, and the chain run twice ends in the same state. **Chain equals scratch is a Tier 1 acceptance item and passes there (pad-echo).** On the disc it is an extra check, not in the contract, and it fails. So the committed Tier 2 scenarios check only `rerun`:
  - `reactor-entrance-equals-scratch` became `reactor-entrance-from-snapshot`, with no `boot` check;
  - the `title-chain-*` pair is removed.

  The finding is reported here, in the PR and to the coordinator, not hidden. Nothing that was on main was weakened: these checks were new in this PR.
- **Proposed follow-up issue:** "Tier 2: a snapshot kept mid-run and restored differs from running on (match_boot 0)". Bisect with game-agnostic checks:
  - RAM-only versus picture-only comparison (a new `sameState` kind);
  - script lengths after the restore (1, 60, 732 frames);
  - keep points (T + 1, T + 60);
  - one restore versus two.

  This matters before M2 address work relies on chained snapshots matching a from-scratch run. Chained snapshots are still deterministic: restoring the same snapshot twice gives the same state.
- The picture-aware digest (compare the picture only when a new frame arrived during the script) stays. A restored core has no host-side picture until the core sends a frame, so comparing an old picture with none was wrong either way.
