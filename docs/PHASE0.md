# Phase 0 — FF7 Web Runtime: competing Wasm proofs of concept

## Objective
Determine whether an existing FF7 engine adaptation or a clean Rust/Wasm implementation offers the best route to a compatible browser runtime, eventually supporting touch-native portrait iPhone play. The first deliverable is an evidence-based choice, not a complete game.

## Non-goals
Complete gameplay; native iOS packaging; production touch UI; distributing copyrighted assets; promising App Store approval; reimplementing all PS1 hardware.

## Workstreams
### 0A: Existing-engine feasibility
1. Inventory Braver, V-Gears, Q-Gears and other relevant projects. Verify current source locations, licences, languages, build status, data format coverage, and browser/Wasm feasibility.
2. Choose the strongest candidate based on a written scoring rubric; note why alternatives were rejected.
3. Attempt a reproducible browser build or the smallest representative browser-compatible field subsystem. Record blockers and upstream modifications required.

### 0B: Rust/Wasm feasibility
1. Create a small Rust workspace with parser, scene model, renderer and browser adapter crates/modules.
2. Parse a documented subset of a field format using synthetic fixtures first.
3. Render a field-like background, walkmesh and character proxy in browser; implement deterministic movement and collision on the walkmesh.
4. Validate against the same real-data scenario as 0A only in the approved private environment.

### 0C: Shared harness (starts immediately)
- Pin Rust, Node and browser versions.
- Implement a deterministic test scene with openly created art and synthetic walkmesh geometry.
- Provide browser automation for scene loading, input replay, state assertions and screenshots.
- Export machine-readable results (JSON) and a compact human-readable summary.
- Keep acceptance baselines in a protected workflow, not writable by implementation agents.
- Private-data tests run only in isolated, reviewed workflows; never expose asset bytes in logs/artifacts.

## Identical acceptance scenarios
1. Build to browser/Wasm with documented commands.
2. Load the same synthetic field, display background and character proxy.
3. Parse valid walkmesh triangles; reject malformed inputs safely.
4. Move from point A to B within navigable geometry; avoid a synthetic obstacle.
5. Replay a fixed input sequence and reproduce the same state trace.
6. Report load time, Wasm size, frame time and memory use with device/browser context.
7. Demonstrate one genuine FF7 field using user-provided files in private testing, if lawful and feasible; mark unavailable rather than faking it.

## Scoring rubric (100 points)
- Correctness and compatibility evidence: 30
- Time to working browser prototype: 20
- Extensibility to full game: 20
- Browser/iPhone performance and deployment: 10
- Maintainability and agent-debuggability: 10
- Licensing and security risk: 10

Score each criterion with citations to build logs, code, tests or project documentation. Do not award points for unverified claims. State uncertainty and unresolved blockers.

## Deliverables
- `docs/ENGINE_SURVEY.md`: verified engine inventory, licences and technical assessment.
- Two separately buildable PoCs with shared scenarios.
- `harness/`: synthetic fixtures, test runner, browser automation and JSON reports.
- `docs/DECISION.md`: scoring, evidence, recommendation and fallback plan.
- `README.md`: reproducible setup and a phone-friendly status summary.

## Milestones and stop conditions
M0: security boundary, repository skeleton, synthetic test scene and CI build.
M1: existing-engine feasibility report and reproducible attempt.
M2: Rust/Wasm synthetic scene with movement.
M3: same-scene comparison and private real-file smoke test, if available.
M4: decision record. Stop if both approaches lack credible browser feasibility; recommend narrower next experiment instead of expanding scope.

## Agent task contract
Every task must specify: desired outcome, allowed files, prohibited changes, acceptance tests, budget/attempt limit, and required evidence. The agent may add exploratory tests, but protected acceptance tests and reference baselines are controlled independently. Failed or skipped tests must be disclosed.

## Suggested first Claude task
Read `CLAUDE.md`, `docs/PHASE0.md`, and `docs/SECURITY.md`. Create the project skeleton, pinned toolchain recommendations, synthetic field fixture specification, minimal CI that builds and runs synthetic tests, and an initial engine survey with source links and licence verification. Do not download proprietary game assets. Do not implement either full PoC yet. Open a PR with a concise decision log and precise test results.
