# Project status

_Update this when an issue closes or a blocker appears. Fine-grained progress lives in GitHub issues and PR Handoff sections; see `docs/CONTINUITY.md`._

**Current milestone:** M2 (`docs/PHASE0.md`). **M1.5 (private eval) is complete:** the disc boot smoke test #36 passes in Tier 2 (2026-11-05, PR #64).

**M2 plan (owner-approved, 2026-11-05; `notes/m2-issue-drafts.md`).** Updated 2026-11-06.

**Next for agents, in this order** (each is `status:ready`; take the oldest first, per `docs/CONTINUITY.md`):
1. **#78**: confirm menu cursor and party (including party HP).
2. **#38**: boot from a generated save (unblocked by #77). Use #77's field-loaded condition: field mode, and after the field ID last changed, `fieldLoading` (g_IsFieldLoading) has left 2 and reads 2 again. A single read is not enough (`notes/77-field-position.md`).
3. **#92** (light, `model:sonnet` candidate): `mode()` honours per-value confirmation (world 3 is still a hypothesis) and reports movies from `movieFrame`.
4. **#93** (light, Tier 3): the debug overlay covers the game's own menu text. Batch its iPhone check with the next request.
5. **#99**: player position follows `g_PlayerModelId` instead of field model 0 (not on #38's path).

Then **#80** (world map, minigame) → **#81** (M2 exit). #24 and #25 become ready for M3 when #81 is done.

**Done in M2:**
- **#37** (PR #84): scenario format 2, with the title boot point at T = 1250, a shared in-memory snapshot, ordered scripts, and `wait.until`.
- **#75** (PR #83): the semantic layer (`semantic/`), the address table with provenance, and the USA boot-executable hash gate.
- **#74** (PR #85): named snapshots, `boot.from`, input segments and still-picture waits. The chain title → New Game → `reactor-entrance` (frame 11095) is deterministic.
- **#76** (PR #89): `gameState` is confirmed for field 1, menu 5 and battle 2, and `prevGameState` is confirmed. Movies are detected by the new confirmed `movieFrame` entry (Stframe_no), because `gameState` reads field during a movie.
- **#88** (PR #91, owner-merged): a snapshot restored mid-run now equals running on, at title + 60 and at `reactor-entrance`. The cause was root-counter phase and the CPU cycle fraction not round-tripping. It is fixed in `core/patches/0002-savestate-round-trip.patch`. Tier 2 metrics `same_ram`/`same_cpu`/… compare save-state parts.
- **#77** (PR #98): the field ID (`fieldId` = g_FieldCurrentMap: md1stin 0x74, then md1_1 0x75 after walking up-left), the player position (`fieldX`/`fieldY` = g_FieldEntity[0] PosX/PosY, checked by direction only) and the field load state (`fieldLoading`) are confirmed in Tier 2, deterministically over two runs. Format 2 gained a `change` check (end vs start of the script, reported as a sign) so directions are checked without coordinates leaving the sandbox. New snapshot `after-battle`.
- **#79** (PR #86): the web app's debug overlay. The owner's iPhone check passed, and Mode follows battle, field and menu live.

**Things a new agent must know:**
- Runner code may import only from inside `runner/`. The Tier 2 build and the sandbox ship only `runner/` and `harness/`; that is why the disc reader is `runner/iso9660.js`. `web/js/semantic/` is a byte-identical copy of `semantic/*.js` plus `runner/iso9660.js`: run `node semantic/sync-web.js` after editing either.
- The trusted side reads only top-level `harness/scenarios/*.json` as scenarios. Segments live in `harness/scenarios/segments/`. Scenarios run in file-name order, and a `boot.from` needs an earlier scenario that kept that snapshot.
- Limits: 32 scenarios per run and 8 metrics per scenario. Each Tier 2 try costs a push and a CI run, so batch hypotheses.

**Needs the owner:**
- **PR #94** (#90, `needs-owner`, `.github/`): run the `web` CI job in the pinned Playwright image. A slow Ubuntu mirror cancelled `web` twice during the apt install.
- **The pad-echo baseline:** #91 changed `core.wasm` (`bd639924…`), so `harness/baselines/pad-echo-buttons.json` reports "recorded with a different core build". Its hashes still match. Re-recording it is a separate `needs-owner` PR (`harness/baselines/`).

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
  - The scenario boots the bin, not the cue: the R2 `disc-1.cue` names another file. **The project no longer uses cue files** (owner decision, 2026-11-05): FF7's discs are single data tracks, so the bin is enough. The private eval no longer fetches or mounts `disc-1.cue` (PR #71, merged).
  - Format 1 gained `boot.disc`, disc file checks, `within`/`stillFrames` checks, `probes` and the `boot_stage`/`disc_error` metrics.
- **Moved to M2:** #37 (format 2: disc boot, title snapshot, input scripts with `wait.until`), now unblocked. Frames to the title depend on input: without input the intro holds the game for more than 5400 frames; #38 (boot from a generated save + first boot point), blocked on #37 and confirmed title, mode and field addresses.

**Earlier notes (M1 era):** #24 (border crop) is parked (`status:blocked`, owner decision, 2026-11-05): a pixel-based crop can't tell borders from black scenes. The attempt is on branch `issue-24-border-crop` (closed PR #72), for reuse once mode detection exists; with #76 done, it waits for M3 (#81). #25 (context-aware controls) is also for M3. #23 (drag-to-walk, #63), #50 (#53) and #66 (#67) are done. The process-by-risk proposal (full and light PR classes) merged as #70.

Wiring checks into CI (`.github/workflows/`) and adding baselines (`harness/baselines/`) touch protected paths. Each goes in its own PR labelled `needs-owner`.

**Merged:** preview deploys (#16), CI `unit` + `tier1` (#17), CODEOWNERS (#18), core in previews + CI `web` on Chromium and WebKit (#20), and skipping tier 2 scenarios in the `tier1` scenario loop (#65). The owner has set up the `main` ruleset and Pages serves `gh-pages` (2026-11-05). Every change to `main`, `STATUS.md` included, goes through a PR.

**Touch plan (owner decision, 2026-11-04):** field controls are drag-to-walk plus Interact/Menu/Back buttons (#23, done), border cropping (#24, parked until mode detection exists), and context-aware actions once M2 exists (#25, blocked). Tap-to-walk is a stretch goal (`docs/PHASE0.md`, M3).

**Owner involvement:** the iPhone checks (Tier 3) are requested by agents through a PR comment with a preview link. Expect one short request at a time.

**Blocked / needs owner:**
- ~~private storage~~: done. The R2 bucket `ff7-web-assets` holds `disc-1.bin` to `disc-3.bin`, and the read-only token is set as secrets in an environment (owner, 2026-11-04; #35 checks the names).
- ~~a `main` ruleset~~: done (owner, 2026-11-05).
- **Optional, undecided:** a separate GitHub identity for agents (bot account or App), so code-owner review can be enforced. Until then, agents post as the owner, and a reviewer marker counts only when it comes from that account.
- Agent sessions' egress proxy blocks github.com archive (codeload) downloads; `git` over HTTPS works. The core build avoids archive downloads (see `notes/3-core-build.md`). The proxy also blocks `*.github.io`, so agents can't load previews themselves; they check the `gh-pages` branch instead. The exceptions are `ff7-mods.github.io` and `sithlord48.github.io`, which are allowed for save-format research, but only in sessions started after 2026-11-04.
