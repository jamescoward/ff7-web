# Agent-led delivery: automation design

## Goal
Run this project with as little manual intervention as possible. Agents plan, implement, test against the real game and review. GitHub merges automatically when the checks pass. The owner sets direction and reviews milestone outcomes, not individual PRs or test runs.

The constraint that shapes everything: agents must be able to test against the owner's FF7 disc **without the game data ever being able to leave the test sandbox**. Safety comes from isolation, not from a human approving each run.

## Pipeline overview

```
 Milestone (PHASE0.md)
        │  planner agent breaks it down
        ▼
 GitHub issues (task contracts)  ──►  implementer agent session per issue
                                              │ pushes branch, opens PR
                                              ▼
                     ┌──────────── CI on the PR ───────────────┐
                     │ Tier 1  public checks (no game data)    │
                     │ Tier 2  private eval (FF7, sandboxed)   │
                     │ Tier 3  owner's iPhone check (async)    │
                     │ Reviewer agent                          │
                     └─────────────────────────────────────────┘
                                              │ all required checks green
                                              ▼
                                agent merges (squash)  
                     — except PRs touching protected paths → owner review
```

## Test tiers

### Tier 1: public checks (every push, no game data)
- **Headless runner:** the PCSX ReARMed Wasm core in Node. It loads a program, plays an input script, and emits selected memory values and frame hashes as JSON.
- **Homebrew PS1 test programs** with expected frame hashes and memory values. Each one's licence is verified before use.
- **Hook-layer unit tests** against synthetic memory images and simulated menu state machines.
- **Touch UI tests** in Playwright (Chromium and WebKit) against a fake backend.
- **Asset guard:** fails the build on disc-image extensions, large binaries, or known FF7 file hashes in the tree.

### Tier 2: private eval (every PR, uses the owner's disc, fully automatic)
Runs on GitHub-hosted runners. No owner machine is involved.

1. **Untrusted build job** (`pull_request` trigger, no secrets): builds the Wasm core, the runner and the scenario files from the PR, then uploads them as a build artifact.
2. **Trusted eval job** (`workflow_run` trigger): the workflow definition always comes from `main`, so a PR cannot change it.
   1. It obtains short-lived storage credentials through GitHub OIDC. The cloud role trusts only this workflow file on `main`.
   2. It downloads the disc image from private object storage (encrypted at rest).
   3. It runs the PR's build inside a container started with `--network none`, a read-only mount of the disc, CPU, memory and time limits, and a single writable output directory.
   4. Trusted code from `main` validates the output against a strict JSON schema: per scenario, pass/fail, numeric metrics, and small integers such as addresses and coordinates. Anything that doesn't fit the schema is discarded.
   5. It posts a check run with the validated summary. Raw logs from inside the sandbox are never printed.
3. The disc image and the container are discarded when the job ends.

**Why no human approval is needed:**

- The untrusted code is the only thing that touches the game data, and it has no network.
- The only channel out is a bounded, schema-checked result.
- The credentials never enter the sandbox and cannot be obtained by PR code.

**Residual risk, accepted:** a scenario that asserts specific memory values can leak information one bit at a time through pass/fail. Mitigations:

- a cap on scenarios per run;
- results are summarised, not echoed in full;
- **if the repository is public, Actions logs are public, so only the validated summary is ever printed.**

The value of what could leak is low, and the owner accepts this risk for a personal project.

**Scenario format:** a save state or boot point, an input script, and assertions on named memory addresses. This covers mode detection, address confirmation, and checking that a button sequence lands where expected. Agents write scenarios; the trusted job only runs them.

**Save-state fixtures:** these contain game RAM, so they live in private storage alongside the disc and are referenced by ID. Agents create new ones by submitting a "record" scenario; the trusted job stores the resulting state privately and returns only its ID.

### Tier 3: owner's iPhone check (asynchronous, human in the loop)
This is the one deliberate human step. It is kept to a few taps, and agents never sit idle waiting for it.

**When it's needed:**
- PRs that change the emulator core, renderer, audio or input path;
- touch-UX PRs, which need a feel check;
- each milestone review.

Everything else merges without it.

**How it works:**
1. CI deploys a **preview build** of the PR to a static host, at a per-PR URL.
   - The preview contains only original code and licence-checked homebrew test programs, never game data.
   - FF7 checks use the owner's own disc file, opened from the Files app on the phone and loaded locally.
2. The agent labels the PR `needs-owner-device` and posts **one comment mentioning the owner**, which reaches the phone through GitHub notifications. The comment contains:
   - the preview link;
   - a short checklist (≤5 items, about 2 minutes), for example "run the benchmark", "does tap-to-walk feel responsive?";
   - what changed since the last check.
3. **The benchmark page measures on its own.** When it finishes, it shows a **"Report results"** button.
   - The button opens a pre-filled GitHub comment containing the JSON results and pass/fail against the thresholds.
   - The owner adds a 👍 / 👎 and an optional note for the feel items.
4. **The agent doesn't wait.** It moves on to other issues. The next session to run the start-up protocol picks up the reply, then merges or fixes.

**Keeping requests rare:**
- Agents batch device checks, so at most one request is open at a time. A request can cover several PRs, or a combined preview of stacked changes.
- Performance numbers are recorded in `notes/perf-history.md`, so regressions show as trends.

**Later option to remove the human step for performance:** a device-cloud service running real iPhones (BrowserStack, Sauce Labs; cost unverified), or the owner's Mac with a tethered iPhone via `safaridriver`. Feel checks stay human either way.

## Agent roles

| Role | Trigger | Output |
|---|---|---|
| Planner | Milestone start, or the issue queue running low | Issues with task contracts: outcome, allowed paths, acceptance scenarios, attempt budget |
| Implementer | Scheduled session runs the session-start protocol in `docs/CONTINUITY.md` | Branch, PR, fixes from CI and review feedback |
| Reviewer | PR opened or updated | A review against the `CLAUDE.md` rules; blocks on unverified claims, scope creep or protected-path edits |
| Investigator | Tier 2 address search tasks | Candidate addresses confirmed through scenarios |

## Continuity
Sessions can stop at any time, for example when subscription quota runs out. All state lives in the repo and GitHub: `STATUS.md`, issue labels, and the PR Handoff sections. See `docs/CONTINUITY.md`.

## Merge policy
- **Agents merge their own PRs** (squash) once Tier 1, Tier 2 and the reviewer agent's checks all pass, Tier 3 too where it applies, and the PR is not `[WIP]`. The full conditions are in `docs/CONTINUITY.md`.
- **Owner review is required** for protected paths, enforced by CODEOWNERS and branch protection:
  - `.github/`
  - `CLAUDE.md`
  - `docs/SECURITY.md`
  - `harness/private-eval/`
  - `harness/baselines/`
- Agents may *propose* changes to these paths, but cannot merge them.

## Metrics
To show the process works, and for the project's own steering:

- Lead time from issue to merge.
- Share of PRs merged with no human touch.
- CI re-runs per PR.
- Escaped regressions, meaning tests added after a bug reached `main`.
- Gameplay coverage: scenarios passing along the reference route, the first reactor mission first.

## Build order
1. **M1:** Tier 1 headless runner and asset guard, built alongside Experiment 01.
2. **M1:** a per-PR preview deployment, the benchmark page with its "Report results" button, and the `needs-owner-device` flow.
3. **Before M2:** Tier 2 private eval (the storage bucket and OIDC role are a one-off setup by the owner), CODEOWNERS and branch protection, and the reviewer agent.
4. **M2 onward:** planner and implementer on a schedule.

## Unverified
- Whether a GitHub App review satisfies the required-approval rules in branch protection, or whether the reviewer's verdict should be a required status check instead.
- Preview hosting: GitHub Pages can't set custom headers. That's fine while the core is single-threaded, but threads need COOP/COEP, which means Cloudflare Pages (via a `_headers` file, with PR previews built in) or a service-worker workaround.
- Whether a pre-filled GitHub URL can carry a full JSON result. URL length limits may force a compact encoding.
- How far a free GitHub plan stretches in runner minutes for Tier 2. The disc download is about 700 MB per run.
  - Never cache the disc with the GitHub Actions cache or artifacts. Caches created on `main` can be read by PR workflows.
  - If downloads are too slow, upload only the files the scenarios need, in private storage.
