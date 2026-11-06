# Model delegation record

One row per delegated issue (`docs/CONTINUITY.md`, Model delegation). It decides whether more issues get the `model:sonnet` label.

The trial was set up by the owner on 2026-11-04: #31 and #39 are labelled. Security-critical and protected-path issues stay on Opus: #33, #34, #35, and #40 (`.github/`).

| Issue | Implemented by | Attempts | Reviewer blocking findings | Fixes Opus had to make | Outcome |
|---|---|---|---|---|---|
| #31 runner card slot + snapshots (PR #42) | Sonnet subagent | 1 of 3 | 1: notes claimed baselines were unchanged, but the new exports change `core.wasm`, so the pad-echo baseline now reports `unverified` (follow-up #43) | Corrected the notes; added a size guard in the C state wrappers (a non-blocking reviewer note); README and notes wording | Acceptance met, and re-verified by Opus (84/84 Tier 1). Merge pending CI |
| #39 reviewer subagent (PR #45) | Sonnet subagent | 1 of 3 | None (PR-mode review: PASS, no blocking findings; its non-blocking notes were fixed, then reviewed again) | Added an author check for marker comments, since on a public repo anyone can post a PASS marker; ran the three dry runs (a subagent can't start subagents) | Dry runs as expected: FAIL, FAIL, PASS |
| #75 semantic layer skeleton, address table, hash gate (PR #83) | Sonnet subagent | 1 of 3 | Light class: no reviewer required | Moved the shared ISO9660 reader from `semantic/` to `runner/iso9660.js`: Tier 2 and the sandbox ship only `runner/` and `harness/`, so CI `private-eval-tests` and `tier1` failed (the subagent couldn't run Docker locally). Opus re-ran acceptance: unit 251/251, runner 222 pass + 1 skip (Docker sandbox, as on main), web 38 pass + 24 WebKit skips (WebKit not installed locally; CI covers it), asset guard 0 violations, sync check clean | Merged (#83) after CI green |
| #79 debug overlay (PR pending) | Sonnet subagent | 1 of 3 | Light class: no reviewer required | Merged `main` after #83's squash (add/add conflicts resolved to the branch side; tree checked identical to #75's head plus #79). Opus re-ran: web 48 pass + 31 WebKit skips, bench 20 pass + 3 skips, runner/unit 365 pass + 1 Docker skip, sync and asset guard clean | Awaiting CI and the owner's Tier 3 check |
