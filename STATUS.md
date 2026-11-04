# Project status

_Update this when an issue closes or a blocker appears. Fine-grained progress lives in GitHub issues and PR Handoff sections; see `docs/CONTINUITY.md`._

**Current milestone:** M1, the iPhone emulator baseline and Tier 1 harness (`docs/PHASE0.md`).

**State:** Phase 0 merged (PR #2). M1 issues #3–#8 and #14 are filed. #3 is done: `core/build.sh` builds the pinned core to a reproducible Wasm archive (PR #9). #4 is done: `runner/` links it into a headless Node runner with the backend interface and deterministic JSON output. #5 is done: scenario format 1 (`harness/README.md`), `runner/scenario.js`, and the `pad-echo` homebrew, which shows injected input reaching a PS1 program. #6 is done: `tools/asset-guard/check.js` fails on disc images, saves, game executables, oversize binaries and deny-listed hashes. #7 is done (PR #21): `web/` runs the core in the browser (Worker + WORKERFS file import, canvas, AudioWorklet, virtual gamepad and keyboard, memory card in IndexedDB with export/import); Tier 1 on Chromium and WebKit, and the owner's iPhone 14 Pro / iOS 27 check passed.

**Next:** implement the M1 issues in order:
1. ~~#3 pin the toolchain and build PCSX ReARMed for Wasm~~ (done);
2. ~~#4 a minimal headless Node runner~~ (done);
3. ~~#5 the scenario format and the first homebrew test~~ (done; its baseline was merged in #13);
4. ~~#6 the asset-guard check~~ (done; CI wiring is a separate `needs-owner` PR);
5. ~~#14 per-PR preview deployment on GitHub Pages~~ (merged in #16);
6. ~~#7 the browser wrapper with file import~~ (done in #21; the preview builds the core and CI runs `web/test` since #20);
7. ~~#8 the iPhone benchmark page~~ (done in #27; iPhone 14 Pro full run passed every Experiment 01 threshold: 5.89× unthrottled, p99 7 ms, 0 underruns, 64 MB; `notes/perf-history.md`).

**M1 is complete.** M1.5 (private eval) is filed as #31–#40. The reasoning and the owner's decisions of 2026-11-04 are in `notes/m1.5-issue-drafts.md`: tests start from generated saves read against a baseline taken from the disc, review is done by a reviewer subagent, Tier 2 runs for same-repo branches only, and sessions are run ad hoc.
- **Done:** #31 (runner card slot + in-memory snapshots, PR #42; `notes/31-card-and-snapshots.md`). It changed `core.wasm`, so the pad-echo baseline passes but reports `unverified` until #43 (`needs-owner`) re-records it.
- **Done:** #32 (save descriptions + card generator, Tier 1; `notes/32-save-format.md`). The checksum, the directory file name and some header fields are hypotheses that the Tier 2 scenarios (#37/#38) must confirm.
- **Ready now:** #39 (reviewer subagent). #33, #34 and #40 are also ready, but they touch protected paths, so their PRs need the owner (`needs-owner`).
- **Blocked:** #35 (workflows), on #33, #34 and the owner's R2 secrets; then #36, then #37, then #38.

Wiring checks into CI (`.github/workflows/`) and adding baselines (`harness/baselines/`) touch protected paths. Each goes in its own PR labelled `needs-owner`.

**Merged:** preview deploys (#16), CI `unit` + `tier1` (#17), CODEOWNERS (#18), core in previews + CI `web` on Chromium and WebKit (#20). The owner still needs to make `unit`, `tier1` and `web` required checks, and to have Pages serving `gh-pages` (Settings → Pages → `gh-pages`, root).

**Touch plan (owner decision, 2026-11-04):** field controls are drag-to-walk plus Interact/Menu buttons (#23, ready), border cropping (#24, ready), and context-aware actions once M2 exists (#25, blocked). Tap-to-walk is a stretch goal (`docs/PHASE0.md`, M3).

**Owner involvement:** the iPhone checks (Tier 3) are requested by agents through a PR comment with a preview link. Expect one short request at a time.

**Blocked / needs owner:**
- Before M1.5:
  - ~~private storage~~: done. The R2 bucket `ff7-web-assets` holds `disc-1.bin` to `disc-3.bin`. Still to do: the read-only token as secrets in a `main`-only environment (names proposed in #35);
  - a `main` ruleset (PR required with 0 approvals, no force push or deletion, linear history, required checks once #17 merges). The repo is now public, so this is available on the free plan;
  - a separate GitHub identity for agents (bot account or App), so code-owner review can be enforced.
- Agent sessions' egress proxy blocks github.com archive (codeload) downloads; `git` over HTTPS works. The core build avoids archive downloads (see `notes/3-core-build.md`). The proxy also blocks `*.github.io`, so agents can't load previews themselves; they check the `gh-pages` branch instead. The exceptions are `ff7-mods.github.io` and `sithlord48.github.io`, which are allowed for save-format research, but only in sessions started after 2026-11-04.
