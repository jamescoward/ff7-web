# Model delegation record

One row per delegated issue (`docs/CONTINUITY.md`, Model delegation). It decides whether more issues get the `model:sonnet` label.

The trial was set up by the owner on 2026-11-04: #31 and #39 are labelled. Security-critical and protected-path issues stay on Opus: #33, #34, #35, and #40 (`.github/`).

| Issue | Implemented by | Attempts | Reviewer blocking findings | Fixes Opus had to make | Outcome |
|---|---|---|---|---|---|
| #31 runner card slot + snapshots (PR #42) | Sonnet subagent | 1 of 3 | 1: notes claimed baselines were unchanged, but the new exports change `core.wasm`, so the pad-echo baseline now reports `unverified` (follow-up #43) | Corrected the notes; added a size guard in the C state wrappers (a non-blocking reviewer note); README and notes wording | Acceptance met, and re-verified by Opus (84/84 Tier 1). Merge pending CI |
