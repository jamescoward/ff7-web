# Phase 0 — FF7 browser runtime: architecture feasibility

## Product objective
Make the original Final Fantasy VII enjoyable on an iPhone in Safari: bring-your-own legally obtained game files, offline-capable where practical, complete-game compatibility, and eventually semantic tap-to-walk and a portrait/one-handed UI. **Shipping the complete playable game matters more than writing a new engine.**

## Key finding and hypothesis (requires verification)
Two PSP static-recompilation projects offer relevant *architectural precedents*, not proof of PS1 FF7 compatibility:
- [DrummingBird1/gow-psp-recomp](https://github.com/DrummingBird1/gow-psp-recomp): candidate reference for PSP static recompilation, native runtime integration and testing.
- [snuri00/psp-web-recomp](https://github.com/snuri00/psp-web-recomp): candidate reference for a PSP-to-browser/Wasm compilation pipeline, browser runtime, graphics, input and test harness.
Their claimed game coverage, performance, browser/iPhone support, implementation details and licences **must be verified from current source, commits and reproducible tests**; they are not independently established by this document.

Static recompilation preserves executable game logic rather than reimplementing every script and mechanic. It may reduce compatibility work, but PS1 R3000A differs from PSP Allegrex, PS1 GPU/CD/audio/DMA/timing are distinct, and FF7 may load overlays or use dynamically generated code. C/C++ generated for desktop or PSP is not automatically browser-compatible. Static recompilation does **not** itself solve semantic touch controls or licensing/distribution.

## Four competing architecture candidates
1. **PS1 static recompilation → C/C++ or IR → Wasm + PS1 hardware runtime** (research priority). Investigate existing PS1 recompilers and PS1-specific FF7 executable/overlay behaviour. First prove equivalence on a tiny *homebrew* PS1 program; then an authorised FF7 slice in private testing. Avoid writing a full PS1 runtime until evidence warrants it.
2. **PS1 emulator in Wasm + FF7 semantic hooks** (compatibility baseline and viable product route). Demonstrate genuine end-to-end gameplay first; prototype input mapping and observe game state without relying solely on pixel recognition.
3. **Existing FF7 engine adaptation**. Verify current source, licence, build status and coverage for Braver, V-Gears, Q-Gears and alternatives; port a narrow field slice only if promising.
4. **Clean Rust/Wasm FF7 engine**. Keep as bounded comparison or fallback; a synthetic field renderer is not evidence of whole-game compatibility.

Research-only: investigate [ff7-decomp listing](https://recomp.gg/g/final-fantasy-vii) and its actual upstream repository, licence, provenance, code coverage methodology and usefulness. Do not treat any percentage-matched figure as a percent-complete playable port.

## Phase 0 workstreams and gates
### M0 — Evidence-based architecture survey
Produce `docs/ARCHITECTURE_SURVEY.md` with primary-source URLs, commit SHAs/dates, licences, reproducible build instructions, architecture diagrams, game coverage *claims vs verified facts*, iPhone Safari constraints, and risks for each candidate. Inspect the two PSP projects in depth: recompiler frontend, generated output, memory model, indirect jumps, overlays, graphics, audio, headless testing, asset handling and browser build. Clearly distinguish PSP-specific parts from transferable techniques. Include a threat model for private game data.

### M1 — Shared verification harness
Pin toolchains. Implement a small synthetic PS1-like instruction/memory fixture and browser automation where appropriate; record deterministic input/state traces, frame/audio hashes where meaningful, JSON results, crash logs and runtime metrics. Keep protected acceptance baselines outside agent-writable paths. Establish a reference emulator comparison path. No proprietary game data in CI artifacts.

### M2 — Recompilation feasibility gate
Use a freely distributable/homebrew PS1 test executable. Translate a bounded MIPS subset, including control-flow edge cases, into a runnable native/Wasm target. Compare register/memory/observable output traces against a reference interpreter/emulator. Explicitly test delay slots, load delays, exceptions, unaligned memory and indirect control flow as applicable. Report unsupported instructions and code-discovery limitations. **Do not infer full FF7 viability from a successful homebrew demo.**

### M3 — Emulator baseline
Compile or integrate a legally compatible PS1 emulator for browser use; demonstrate reproducible boot and synthetic/homebrew execution, browser-local file import and mobile constraints. If user-provided FF7 assets are available in an approved private environment, verify genuine gameplay and save/load without exposing data.

### M4 — Targeted touch experiment
On whichever path reaches real FF7 gameplay, test tap-to-walk on one real field. Measure screen-to-world mapping, walkmesh/pathfinding or equivalent state hooks, interaction triggers, camera transitions and fallback virtual controls. Prototype portrait composition without cropping essential original 4:3 scenery.

### M5 — Decision and product gate
Choose architecture based on measured progress toward *complete-game compatibility*, not visual prototype polish. Longer-term acceptance target: a continuous first-reactor mission playthrough including field transitions, dialogue, menus, combat, boss, saves and return journey without developer intervention.

## Evaluation rubric (100 points)
- Credible path to complete-game correctness: 35
- Time to genuinely playable FF7 slice: 20
- Semantic touch extensibility: 15
- Safari/iPhone performance and deployment: 10
- Maintenance, debugging and autonomous testability: 10
- Licensing, provenance and asset security: 10

Use verified evidence; mark unknown as unknown. Avoid precise probability or performance claims without measurements. Keep a fallback plan and explicit stop conditions.

## Deliverables
- `docs/ARCHITECTURE_SURVEY.md` — source-grounded four-way comparison and PSP precedent analysis
- `docs/RECOMP_FEASIBILITY.md` — PS1 MIPS, overlays, runtime dependencies and smallest executable test
- `harness/` — synthetic fixtures and independent deterministic checks (when implemented)
- `docs/DECISION.md` — evidence, scores, rejected alternatives and next milestone
- README — phone-friendly progress, exact build/test commands and blockers

## Agent task contract
For each task define outcome, allowed files, prohibited changes, acceptance criteria, attempt/time budget and evidence. Do not alter protected baselines to pass tests. A test not run is **not verified**. Keep private assets inaccessible to untrusted PR code; consult `docs/SECURITY.md`.

## Suggested first Claude Code task
Read `CLAUDE.md`, this file and `docs/SECURITY.md`. **Research before implementation**: audit `gow-psp-recomp` and `psp-web-recomp` at pinned commits, verify their licences and reported capabilities, identify actual reusable mechanisms and PSP-to-PS1 gaps, investigate PS1 static recompilers, and compare against an emulator baseline, existing FF7 engines and Rust rewrite. Write `docs/ARCHITECTURE_SURVEY.md` and a small, falsifiable PS1 homebrew recompilation experiment proposal. Do not download copyrighted game data, implement a full engine, or assert iPhone performance without testing. Open a reviewable PR with citations and clear unknowns.
