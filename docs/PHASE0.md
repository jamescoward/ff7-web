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
*Stop condition:* cannot sustain full speed with headroom on the target iPhone → evaluate a faster CPU core before anything else.

### M2 — Game-state layer
Detect mode (field / battle / menu / world map / minigame / movie), read player position, field ID, menu cursor and party data. Debug overlay showing live values. Addresses recorded with provenance and verified against the USA executable hash.
*Stop condition:* mode detection is not reliable across a scripted set of private save states.

### M3 — Touch UX tier 1–2
Context-aware controls; tap-to-select in menus and battle commands; tap-to-walk on one field, then generalised. Input injection only, no memory writes.

### M4 — Native screens and polish
Battle command panel with cropped scene; native menu screens starting with Materia/Equip; speed toggle, suspend, save export/import; optional native shell.

### Longer-term acceptance target
A continuous run from new game through the first reactor mission and back — field transitions, dialogue, menus, battles, boss, saves — using touch controls without a gamepad, on the owner's iPhone.

## Working rules
- Use verified evidence; mark unknowns as unknown. A test not run is not verified.
- Repository contains only original code, synthetic/homebrew fixtures and documentation. No game data, BIOS, screenshots, save states or code derived from the game executable — see `docs/SECURITY.md`.
- Tests that need the owner's disc run on the owner's machine/device; results are summarised without game-derived artefacts.
- Small reviewable PRs; each PR follows the report format in `CLAUDE.md`.
- Gameplay coverage is measured by what can be played end to end, not by screens rendered.
