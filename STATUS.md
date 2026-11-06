# Project status

_Update this when an issue closes or a blocker appears. Fine-grained progress lives in GitHub issues and PR Handoff sections; see `docs/CONTINUITY.md`._

**Current milestone:** M2 (`docs/PHASE0.md`). **M1.5 (private eval) is complete:** the disc boot smoke test #36 passes in Tier 2 (2026-11-05, PR #64).

**M2 plan (owner-approved, 2026-11-05; `notes/m2-issue-drafts.md`).** This replaces the order given under "Next for agents" below. **Done:** #37 (format 2: title boot point T = 1250, a shared in-memory snapshot, ordered scripts with `wait.until`; PR #84; `notes/37-format2.md`) and #75 (semantic layer, address table with provenance, hash gate; PR #83; `notes/75-semantic-layer.md`). Runner code must import only from inside `runner/`: the Tier 2 build and the sandbox ship only `runner/` and `harness/` (that is why the shared disc reader is `runner/iso9660.js`). **In flight:** #74 (chained snapshots and input segments, PR #85); #79 (debug overlay, PR #86, `needs-owner-device`: the iPhone checklist is on the PR). Then #76 (mode) → #77 (field ID, position) and #78 (cursor, party) → #38 (generated saves) → #80 (world map, minigame) → #81 (M2 exit). #24 and #25 become ready for M3 when #81 is done.

**#74 (chained snapshots, segments) in PR #85.** On Tier 2 the chain title → New Game → the first still, Circle-ignoring picture after the opening (frame 11095, kept as `reactor-entrance`) is deterministic. Open finding for a follow-up: on the disc, a snapshot kept mid-run and restored is not identical to running on (`match_boot` 0; `notes/74-chained-snapshots.md`).

**#74 (chained snapshots, segments) in PR #85.** On Tier 2 the chain title → New Game → the first still, Circle-ignoring picture after the opening (frame 11095, kept as `reactor-entrance`) is deterministic. Open finding for a follow-up: on the disc, a snapshot kept mid-run and restored is not identical to running on (`match_boot` 0; `notes/74-chained-snapshots.md`).

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
- **Done:** #31 (card slot + snapshots), #32 (save generator; its checksum and some header fields are hypotheses for #38), #33 (sandbox and attack tests: the stop condition is met), #34 (validator), #39 (reviewer subagent: merging needs a PASS marker comment on the head commit), #40 (CI benchmark tests), #43 (pad-echo baseline), #55 (in-sandbox entry point `runner/tier2.js` and scenario `metrics`, #56; test follow-ups #57 and #59).
- **#35 (Tier 2 workflows):** merged in #54. The owner closed it (2026-11-05) after the bootstrap passed (evidence on #35 and #55).
- **Tier 2 works end to end on GitHub** (2026-11-05). The throwaway bootstrap PR #58 gave a red `tier2` check. The only output from the sandboxed run in its log was the validator's summary; the other lines were the trusted steps' fixed words. The gate, the artifact round trip, the R2 fetch of `disc-1.bin`, the sandbox and the cleanup all ran for the first time (details in #55).
- **Done:** #36 (PR #64). Disc 1 boots in Tier 2, the boot executable matches the USA hash, and the title code is resident at frame 1231 with Start pressed every 2 s. Unthrottled speed is about 1000 fps on GitHub's runner. Details are in `notes/36-disc-boot.md`.
  - The scenario boots the bin, not the cue: the R2 `disc-1.cue` names another file. **The project no longer uses cue files** (owner decision, 2026-11-05): FF7's discs are single data tracks, so the bin is enough. The private eval still fetches and mounts `disc-1.cue`. Removing that is PR #71 (`needs-owner`, `.github/` and `harness/private-eval/`). Until it merges, keep `disc-1.cue` in R2, or the eval's disc fetch fails.
  - Format 1 gained `boot.disc`, disc file checks, `within`/`stillFrames` checks, `probes` and the `boot_stage`/`disc_error` metrics.
- **Moved to M2:** #37 (format 2: disc boot, title snapshot, input scripts with `wait.until`), now unblocked. Frames to the title depend on input: without input the intro holds the game for more than 5400 frames; #38 (boot from a generated save + first boot point), blocked on #37 and confirmed title, mode and field addresses.

**Next for agents:** #24 (border crop) is **parked** (`status:blocked`, owner decision, 2026-11-05). A pixel-based crop can't tell borders apart from scenes where black is the picture (text on black, Cloud alone on black). The attempt is on branch `issue-24-border-crop` (closed PR #72) for reuse once mode detection exists. Next: #25 (context-aware controls; labelled `status:blocked` until its field, battle and menu addresses are confirmed with Tier 2 probes). #37 (title snapshot) and #38 come in when #25 needs them. A process-by-risk proposal (a lighter process for `web/`-only work) is awaiting the owner in PR #70. #50 (flaky WebKit audio test) is done (#53). #23 (drag-to-walk) is done (#63) and passed the owner's iPhone check. Running latches and the joystick centre trails the thumb, after the owner's feedback. #66 (status notices that never cleared) is done (#67).

Wiring checks into CI (`.github/workflows/`) and adding baselines (`harness/baselines/`) touch protected paths. Each goes in its own PR labelled `needs-owner`.

**Merged:** preview deploys (#16), CI `unit` + `tier1` (#17), CODEOWNERS (#18), core in previews + CI `web` on Chromium and WebKit (#20), and skipping tier 2 scenarios in the `tier1` scenario loop (#65). The owner has set up the `main` ruleset and Pages serves `gh-pages` (2026-11-05). Every change to `main`, `STATUS.md` included, goes through a PR.

**Touch plan (owner decision, 2026-11-04):** field controls are drag-to-walk plus Interact/Menu/Back buttons (#23, done), border cropping (#24, parked until mode detection exists), and context-aware actions once M2 exists (#25, blocked). Tap-to-walk is a stretch goal (`docs/PHASE0.md`, M3).

**Owner involvement:** the iPhone checks (Tier 3) are requested by agents through a PR comment with a preview link. Expect one short request at a time.

**Blocked / needs owner:**
- ~~private storage~~: done. The R2 bucket `ff7-web-assets` holds `disc-1.bin` to `disc-3.bin`, and the read-only token is set as secrets in an environment (owner, 2026-11-04; #35 checks the names).
- ~~a `main` ruleset~~: done (owner, 2026-11-05).
- **Optional, undecided:** a separate GitHub identity for agents (bot account or App), so code-owner review can be enforced. Until then, agents post as the owner, and a reviewer marker counts only when it comes from that account.
- Agent sessions' egress proxy blocks github.com archive (codeload) downloads; `git` over HTTPS works. The core build avoids archive downloads (see `notes/3-core-build.md`). The proxy also blocks `*.github.io`, so agents can't load previews themselves; they check the `gh-pages` branch instead. The exceptions are `ff7-mods.github.io` and `sithlord48.github.io`, which are allowed for save-format research, but only in sessions started after 2026-11-04.
