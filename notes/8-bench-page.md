# Issue #8: benchmark page notes

2026-11-04.

## What it is
`web/bench/` (published at `<preview>/bench/`). On load it starts the core and runs the first frame, which measures startup. One tap on **Start** then runs everything else unattended:

1. **Unthrottled:** `frames` emulated frames (default 3000) as fast as possible. No video or audio output. Speed = emulated fps ÷ the core's fps (59.94).
2. **Real time:** `seconds` (default 1200 = the 20-minute sustained run), paced like the app, with video drawn and audio played.
   - Host time per emulated frame: p50/p95/p99/max. Each batch's output work (audio drain, frame conversion, post) is added to its last frame.
   - The first and last `window` seconds (default 60) are compared, for the thermal check.
   - AudioWorklet underruns are counted over the first `audio` seconds (default 600) and over the whole run.
   - Peak Wasm heap is tracked across both phases. `performance.memory` is added where it exists (Chromium only).

**Reloads and kills:** while a run is going, `localStorage` holds a running marker, updated every progress tick with the phase, elapsed time and heap so far. If the page loads and finds the marker, Safari reloaded or killed the tab. The page then shows a "Report the lost run" link, with `status: "lost"`, which fails the `reload` check.

A hidden page (screen lock, app switch) stops the run, and it is reported as `interrupted`. The page asks for a screen Wake Lock, and the report records whether it was granted.

Shortening the run (used by tests): `?frames=120&seconds=4&audio=2&window=1`, plus `tris=` and `auto=1`. A run below the full durations is marked `short`, and its best verdict is `pass-short`, never `pass`.

## Stress program (`web/bench/stress.js`)
This is original homebrew built in the browser, so no binary is committed. It ships with `VERSION`, and its bytes are pinned by SHA-256 in the unit test.

Each VBLANK, it clears the screen. It then runs 1000× the following:
- a xorshift step;
- an RTPT of a 32×32 triangle (rotation 30° about Z, TRZ = H = 1000);
- a Gouraud triangle (GP0 0x30) drawn from the GTE's SXY output.

It also does a one-off RTPS on a probe vertex, which the test checks against the expected projection (221, 213).

**Measured (Node runner, 4 vCPU container):**

| Triangles per frame | fps |
|---|---|
| none (vblank-counter) | 178 |
| 500 | 176 |
| 2000 | 163 |

The interpreter emulates every CPU cycle, including the busy-wait for VBLANK, so the CPU cost is about constant and dominates. GPU work adds little here. **So "stress" mostly measures the interpreter.** That is the cost a real game pays too, but a game's GPU load may differ. FF7 itself is measured only in the private Part B.

The assembler is a subset of `runner/synth/mips.js`, plus the COP2 instructions. It is repeated because the site can't import from `runner/`.

## Report
- **Schema:** `web/bench/report.schema.json`, validated with `runner/schema.js`.
- **Encoding:** the report object is compact by design, so the link carries it whole, with no second, lossy encoding.
- **"Report results"** opens `https://github.com/<repo>/issues/new?title=…&body=…`. The body has a pass/fail table, a link to the PR (which cross-references it on the PR timeline) and the JSON.
  - **Why an issue and not a comment:** GitHub has no URL that pre-fills a PR comment, so the closest thing to one tap is a pre-filled new issue.
  - **Fallbacks:** Copy JSON and Download JSON.
- **Size:** the worst-case report URL is limited to 6000 characters, with a test. GitHub answers 414 past about 8 KB. A typical report is about 2.3 k characters.

## Duplication to remove later
`bench-worker.js` repeats `tick` / `grabFrame` / `drainAudio` from `web/js/emu-worker.js`, because the issue's allowed paths are `web/bench/` only. A follow-up could move them into a shared module under `web/js/` that both workers import.

## Measured here (headless Chromium, 4 vCPU Linux container, not a phone)
600 unthrottled frames: 2.79×. Real-time p99 was 10.5 ms (p50 6.4). There were 0 underruns, and the heap stayed at 64 MB. The first frame came 100 ms after page load.

## Not verified
- ~~The iPhone run (Tier 3).~~ Done: full pass on iPhone 14 Pro, issue #28, `notes/perf-history.md`.
- Whether the GitHub iOS app, if installed, keeps the pre-filled body when it intercepts the link.
- Wake Lock on iOS.
- Whether a jetsam kill really leaves the marker readable after the reload.
- **CI does not run `web/bench/test/`.** The `web` job's glob is `web/test/*.test.js`, and adding `web/bench/test/*.test.js` is a protected `.github/` change, so it needs a separate `needs-owner` PR.
