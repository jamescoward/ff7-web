# Project status

_Update this when an issue closes or a blocker appears. Fine-grained progress lives in GitHub issues and PR Handoff sections; see `docs/CONTINUITY.md`._

**Trip mode (2026-11-09 to 2026-12-05):** the owner is away and checks nothing. Scheduled sessions follow `docs/CONTINUITY.md`, "Trip mode": the pause label `agents-paused`, one implementer at a time, touch features behind off-by-default Labs flags labelled `tier3-deferred`, and a weekly digest on #123. The M3/M4 plan (#105–#121, owner-approved 2026-11-06) is in `notes/m3-m4-issue-drafts.md`; after the M2 queue below, take #105 and #106 first.

**Current milestone:** M2 (`docs/PHASE0.md`). **M1.5 (private eval) is complete:** the disc boot smoke test #36 passes in Tier 2 (2026-11-05, PR #64).

**M2 plan (owner-approved, 2026-11-05; `notes/m2-issue-drafts.md`).** Updated 2026-11-06.

**Next for agents, in this order** (each is `status:ready`; take the oldest first, per `docs/CONTINUITY.md`):
1. **#93** (light, Tier 3): the debug overlay covers the game's own menu text. Batch its iPhone check with the next request.
2. **#99**: player position follows `g_PlayerModelId` instead of field model 0.
3. **#101** (unblocked by #38): a boot point with Barret in the party, from a generated save (`notes/38-generated-save-boot.md`, "Barret").

Then **#80** (world map, minigame; builds the boot-point catalogue on #38) → **#81** (M2 exit). #24 and #25 become ready for M3 when #81 is done.

**Done in M2:**
- **#37** (PR #84): scenario format 2, with the title boot point at T = 1250, a shared in-memory snapshot, ordered scripts, and `wait.until`.
- **#75** (PR #83): the semantic layer (`semantic/`), the address table with provenance, and the USA boot-executable hash gate.
- **#74** (PR #85): named snapshots, `boot.from`, input segments and still-picture waits. The chain title → New Game → `reactor-entrance` (frame 11095) is deterministic.
- **#76** (PR #89): `gameState` is confirmed for field 1, menu 5 and battle 2, and `prevGameState` is confirmed. Movies are detected by the new confirmed `movieFrame` entry (Stframe_no), because `gameState` reads field during a movie.
- **#88** (PR #91, owner-merged): a snapshot restored mid-run now equals running on, at title + 60 and at `reactor-entrance`. The cause was root-counter phase and the CPU cycle fraction not round-tripping. It is fixed in `core/patches/0002-savestate-round-trip.patch`. Tier 2 metrics `same_ram`/`same_cpu`/… compare save-state parts.
- **#77** (PR #98): the field ID (`fieldId` = g_FieldCurrentMap: md1stin 0x74, then md1_1 0x75 after walking up-left), the player position (`fieldX`/`fieldY` = g_FieldEntity[0] PosX/PosY, checked by direction only) and the field load state (`fieldLoading`) are confirmed in Tier 2, deterministically over two runs. Format 2 gained a `change` check (end vs start of the script, reported as a sign) so directions are checked without coordinates leaving the sandbox. New snapshot `after-battle`.
- **#78** (PR #100): the main-menu cursor (`menuCursor` = g_PartyMenuTables[0].row, 0x8009A0D3: 0 → 1 → 2 → 1 → 0 with Down, Down, Up, Up), the party slots (`partySlot0..2` = Savemap partyID) and Cloud's current HP (`partyHp0` = g_ActiveCharacters[0].hp, which falls while the guards attack) are confirmed in Tier 2, deterministically over two runs. **Cloud is alone** at reactor-entrance and at the first guard battle (partyID 0x00, 0xFF, 0xFF), not with Barret as the contract expected; Barret was not found in md1_1 within 150 s of exploring, so `partyHp1`/`partyHp2` stay hypotheses (`notes/78-menu-party.md`).
- **#38** (PR #102): scenarios boot from a generated save: `boot: { disc: 1, save, slot: 1 }`. Inside the sandbox the runner rebuilds the New Game savemap from the disc's `INIT/KERNEL.BIN` (`runner/savegen/baseline.js`), generates the card, swaps it in as the title snapshot is restored, and the script loads save 1 by Circle until field mode, then waits for the field to load (#77's rule). The first boot point is `harness/saves/disc1-md1stin.json` (md1stin at progress 6, triangle 12: the values the game holds after the first battle; not a save point, since no reachable source documents save points or progress values). Field ID, triangle and a live walk pass; an inverted checksum leaves the game at the title. The checksum, its range, the directory name and the header are confirmed (`notes/32-save-format.md`). New in format 2: `mark` steps and `change` … `since`.
- **#92** (PR #103): `mode()` is confirmed only for the raw values in `confirmedValues` (field 1, battle 2, menu 5; world 3 is a hypothesis, anything unlabelled is `unknown`), and reports `movie` when `gameState` reads field and `movieFrame` advanced over the last 5 calls, skipping single 0 reads (`notes/76-confirm-mode.md`, "Known limit").
- **#79** (PR #86): the web app's debug overlay. The owner's iPhone check passed, and Mode follows battle, field and menu live.

**Things a new agent must know:**
- Runner code may import only from inside `runner/`. The Tier 2 build and the sandbox ship only `runner/` and `harness/`; that is why the disc reader is `runner/iso9660.js`. `web/js/semantic/` is a byte-identical copy of `semantic/*.js` plus `runner/iso9660.js`: run `node semantic/sync-web.js` after editing either.
- The trusted side reads only top-level `harness/scenarios/*.json` as scenarios. Segments live in `harness/scenarios/segments/`. Scenarios run in file-name order, and a `boot.from` needs an earlier scenario that kept that snapshot.
- Limits: 32 scenarios per run and 8 metrics per scenario. Each Tier 2 try costs a push and a CI run, so batch hypotheses.

**Needs the owner:**
- **Measured values in save descriptions:** `harness/saves/disc1-md1stin.json` holds progress 6 and triangle 12, which were measured in Tier 2. `docs/SECURITY.md` describes description values as numbers "the author chose". Confirm this pattern before #80 builds more boot points the same way.
- **The Tier 2 scenario limit:** Tier 2 is at its limit of 32 scenarios per run. #80 and #101 must replace or split scenarios. Raising the limit would change `harness/private-eval/`, so it needs a `needs-owner` issue.
- **Optional:** the owner accepted #38's boot point (md1stin, not a save point) in the coordinator session. The coordinator recorded this on #38 (comment 6694044922) from the shared account. A reply from the owner there would make it unambiguous.
- Done since the last update: PR #94 (the `web` job in the pinned Playwright image) and the pad-echo baseline re-recording (#97) are both merged.

**Known follow-ups (non-blocking review notes):**
- From #92 (PR #103), for #93 or a small issue:
  - A new game's Mode badge reads "hypothesis" until the first mode change, because prevGameState 0 has no label. Labelling 0 and confirming it would fix this.
  - The movie sample window is not cleared when the overlay is switched off and on.

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
