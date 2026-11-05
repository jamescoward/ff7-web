# Project status

_Update this when an issue closes or a blocker appears. Fine-grained progress lives in GitHub issues and PR Handoff sections; see `docs/CONTINUITY.md`._

**Current milestone:** M1.5, private eval (`docs/PHASE0.md`). It was rescoped on 2026-11-04 and ends when #36 passes (`notes/m1.5-rescope.md`).

**State:** Phase 0 merged (PR #2). M1 issues #3–#8 and #14 are filed. #3 is done: `core/build.sh` builds the pinned core to a reproducible Wasm archive (PR #9). #4 is done: `runner/` links it into a headless Node runner with the backend interface and deterministic JSON output. #5 is done: scenario format 1 (`harness/README.md`), `runner/scenario.js`, and the `pad-echo` homebrew, which shows injected input reaching a PS1 program. #6 is done: `tools/asset-guard/check.js` fails on disc images, saves, game executables, oversize binaries and deny-listed hashes. #7 is done (PR #21): `web/` runs the core in the browser (Worker + WORKERFS file import, canvas, AudioWorklet, virtual gamepad and keyboard, memory card in IndexedDB with export/import); Tier 1 on Chromium and WebKit, and the owner's iPhone 14 Pro / iOS 27 check passed.

**Next:** implement the M1 issues in order:
1. ~~#3 pin the toolchain and build PCSX ReARMed for Wasm~~ (done);
2. ~~#4 a minimal headless Node runner~~ (done);
3. ~~#5 the scenario format and the first homebrew test~~ (done; its baseline was merged in #13);
4. ~~#6 the asset-guard check~~ (done; CI wiring is a separate `needs-owner` PR);
5. ~~#14 per-PR preview deployment on GitHub Pages~~ (merged in #16);
6. ~~#7 the browser wrapper with file import~~ (done in #21; the preview builds the core and CI runs `web/test` since #20);
7. ~~#8 the iPhone benchmark page~~ (done in #27; iPhone 14 Pro full run passed every Experiment 01 threshold: 5.89× unthrottled, p99 7 ms, 0 underruns, 64 MB; `notes/perf-history.md`).

**M1 is complete.** The owner has also booted the FF7 disc from a preview link on the iPhone, and it ran flawlessly (2026-11-04). That covers M1's private "boot the disc" step.

**M1.5 (private eval)** was filed as #31–#40 (reasoning in `notes/m1.5-issue-drafts.md`) and **rescoped on 2026-11-04** (`notes/m1.5-rescope.md`, owner-approved). It ends when the disc boot smoke test (#36) passes.
- **Done:** #31 (card slot + snapshots), #32 (save generator; its checksum and some header fields are hypotheses for #38), #33 (sandbox and attack tests: the stop condition is met), #34 (validator), #35 (Tier 2 workflows, #54), #39 (reviewer subagent: merging needs a PASS marker comment on the head commit), #40 (CI benchmark tests), #43 (pad-echo baseline), #55 (in-sandbox entry point `runner/tier2.js` and scenario `metrics`, #56; test follow-ups #57 and #59).
- **Tier 2 works end to end on GitHub** (2026-11-05). The throwaway bootstrap PR #58 gave a red `tier2` check whose log held only the validator's summary. The gate, the artifact round trip, the R2 fetch of `disc-1.bin`, the sandbox and the cleanup all ran for the first time (details in #55).
- **Ready:** #36 (disc boot smoke test), the last M1.5 issue. It still needs disc mounting in `runner/`. The eval fetches only `disc-1.bin`; fetching the `.cue` as well would be a `needs-owner` change to `.github/` and `harness/private-eval/`.
- **Moved to M2:** #37 (format 2: disc boot, title snapshot, input scripts with `wait.until`), blocked on #36; #38 (boot from a generated save + first boot point), blocked on #37 and confirmed title, mode and field addresses.

**Next for agents:** #36 (closes M1.5), then #23 (drag-to-walk) and #24 (border crop). #50 (flaky WebKit audio test) is done (#53).

Wiring checks into CI (`.github/workflows/`) and adding baselines (`harness/baselines/`) touch protected paths. Each goes in its own PR labelled `needs-owner`.

**Merged:** preview deploys (#16), CI `unit` + `tier1` (#17), CODEOWNERS (#18), core in previews + CI `web` on Chromium and WebKit (#20). The owner still needs to make `unit`, `tier1` and `web` required checks, and to have Pages serving `gh-pages` (Settings → Pages → `gh-pages`, root).

**Touch plan (owner decision, 2026-11-04):** field controls are drag-to-walk plus Interact/Menu buttons (#23, ready), border cropping (#24, ready), and context-aware actions once M2 exists (#25, blocked). Tap-to-walk is a stretch goal (`docs/PHASE0.md`, M3).

**Owner involvement:** the iPhone checks (Tier 3) are requested by agents through a PR comment with a preview link. Expect one short request at a time.

**Blocked / needs owner:**
- Before M1.5:
  - ~~private storage~~: done. The R2 bucket `ff7-web-assets` holds `disc-1.bin` to `disc-3.bin`, and the read-only token is set as secrets in an environment (owner, 2026-11-04; #35 checks the names);
  - a `main` ruleset (PR required with 0 approvals, no force push or deletion, linear history, required checks once #17 merges). The repo is now public, so this is available on the free plan;
  - a separate GitHub identity for agents (bot account or App), so code-owner review can be enforced.
- Agent sessions' egress proxy blocks github.com archive (codeload) downloads; `git` over HTTPS works. The core build avoids archive downloads (see `notes/3-core-build.md`). The proxy also blocks `*.github.io`, so agents can't load previews themselves; they check the `gh-pages` branch instead. The exceptions are `ff7-mods.github.io` and `sithlord48.github.io`, which are allowed for save-format research, but only in sessions started after 2026-11-04.
