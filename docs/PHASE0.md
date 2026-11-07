# Phase 0 — plan

## Product objective
Play the original **Final Fantasy VII (USA, PS1)** on an iPhone with touch controls designed for the game rather than an on-screen gamepad. Personal hobby project; source published so others can build and run it with their own legally obtained disc. Shipping a complete, playable game matters more than writing a new engine.

## Architecture decision (from `docs/ARCHITECTURE_SURVEY.md`)
- **Foundation:** PCSX ReARMed (GPL-2.0) compiled to WebAssembly, interpreter CPU, HLE BIOS so no BIOS file is required, driven by a thin custom wrapper.
- **Semantic layer:** reads game state from guest memory (mode, player position, walkmesh, camera, cursor, party, inventory) and injects pad input. Written against a small backend interface — `readMem`, `writeMem`, `setPad`, `onFrameEnd` — so a faster CPU core or a recompiled backend could replace the emulator later without rewriting it.
- **Touch UI:** web technology, layered over or around the game picture (crop / cover / suppress, see survey §6). The classic virtual gamepad is always available as a fallback.
- **Distribution:** Safari home-screen web app first; optional thin native `WKWebView` shell for personal Xcode builds.
- **Not pursued now:** static recompilation (possible later backend), existing engines, clean rewrite. Xeeynamo/ff7-decomp is a reference for addresses and structure layouts only; its code is not copied (AGPL-3.0, and its maintainers forbid LLM-written contributions).

## Milestones
Each milestone has a stop condition; failing one is reported, not worked around.

### M1 — iPhone emulator baseline (`docs/EXPERIMENT_01_IPHONE_BASELINE.md`)
Build PCSX ReARMed for the browser, run freely distributable homebrew PS1 test programs, measure frame pacing, audio and memory on the owner's iPhone. Then, privately, boot the owner's FF7 disc and play the opening.
Harness deliverables in the same milestone (see `docs/AUTOMATION.md`): Tier 1 headless Node runner and scenario format, asset-guard check, per-PR preview deployment and the Tier 3 owner's-iPhone check flow.
*Stop condition:* cannot sustain full speed with headroom on the target iPhone → evaluate a faster CPU core before anything else.

### M1.5 — Private eval and agent loop
Tier 2 private eval (private storage + read-only token in a `main`-only environment + network-less sandbox + schema-validated results), CODEOWNERS and branch protection for protected paths, reviewer agent, agent merge gated on required checks, scheduled sessions running the continuity protocol. One-off owner setup: storage bucket, read-only token, `main`-only environment, repo settings.
*Done when:* the disc boot smoke test (#36) passes in Tier 2. Booting from scripted input and from generated saves moved to M2 (owner, 2026-11-04; `notes/m1.5-rescope.md`).
*Stop condition:* the sandbox cannot be shown to block network egress and credential access in an adversarial test scenario.

### M2 — Game-state layer
First the harness it runs on: Tier 2 scenarios that boot the disc to a title snapshot and drive the game by input script, waiting on memory conditions (#37). Then: detect mode (field / battle / menu / world map / minigame / movie), read player position, field ID, menu cursor and party data. Debug overlay showing live values. Addresses recorded with provenance and verified against the USA executable hash. Once the title, mode and field addresses are confirmed, scenarios can also boot from generated saves (#38).
*Stop condition:* mode detection is not reliable across a scripted set of private save states.

### M3 — Touch UX tier 1–2
Field controls: drag-to-walk (an invisible floating joystick under the picture) with large Interact and Menu buttons (#23), then context-aware actions and automatic switching between control modes (#25). Reclaim black borders so the picture is as large as possible (#24). Tap-to-select in menus and battle commands. Input injection only, no memory writes.
*Stretch goal:* tap-to-walk on the picture, with or without snapping to points of interest. Deferred (owner decision, 2026-11-04): the portrait picture is small for precise taps, and drag-to-walk with context actions avoids the walkmesh and pathfinding work tap-to-walk needs.

### M4 — Native screens and polish
Battle command panel with cropped scene; native menu screens starting with Materia/Equip; speed toggle, suspend, save export/import; optional native shell.

### Longer-term acceptance target
A continuous run from new game through the first reactor mission and back — field transitions, dialogue, menus, battles, boss, saves — using touch controls without a gamepad, on the owner's iPhone.

## Stretch goal after the initial build — optional graphics polish
Once the original game and touch controls are solid on iPhone, experiment with **2× internal rendering resolution plus an optional subtle CRT filter**. This is deferred polish, not a requirement for M1–M4 or the initial playable build.

- Try the existing PCSX ReARMed enhanced-resolution option to sharpen 3D edges; it does not add detail to the original background images.
- Offer a light CRT effect with restrained scanlines and softness, tuned for the small iPhone screen. Keep web menus and touch controls crisp.
- Keep both options off by default and independently switchable, so the original presentation remains easy to restore.
- Compare original, 2×, CRT and combined modes on the target iPhone across fields, battles, menus and movies. Keep them only if readability, frame pacing, audio and sustained performance remain acceptable.

The first step is a small visual/performance experiment; appearance and performance on iPhone are not yet verified.

## Working rules
- Use verified evidence; mark unknowns as unknown. A test not run is not verified.
- Repository contains only original code, synthetic/homebrew fixtures and documentation. No game data, BIOS, screenshots, save states or code derived from the game executable — see `docs/SECURITY.md`.
- Tests that need the owner's disc run only in the Tier 2 private eval sandbox; results are schema-validated summaries without game-derived artefacts.
- Work flows through issues → agent PRs → automated checks → agent merge; owner reviews milestones and protected paths only (`docs/AUTOMATION.md`).
- Any agent can resume from the repo and GitHub alone (`STATUS.md`, `docs/CONTINUITY.md`).
- Gameplay coverage is measured by what can be played end to end, not by screens rendered.
