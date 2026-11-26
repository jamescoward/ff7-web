# #269: Tier 2 in two shards

Owner decision (2026-11-26, chat): option 1, shard the run.

## Problem
Every tier 2 scenario ran in one sandbox run under the runner's 1140 s deadline (sandbox limit 1200 s). At 124 scenarios, a slow runner (new-game-to-reactor-entrance at 48 s against 29 s) ran out of time after `save-boot-5`, and the last 12 scenarios reported `error`. This happened on PRs #268, #275 and #279.

## Design
- **Split (trusted, `harness/private-eval/eval/lib.js`).** `buildExpect(work, { shard, shards })` reads every tier 2 scenario as before (same checks, same total cap of 128), then keeps only shard `shard`'s names.
  - `shardOf` ties a scenario that boots from a named snapshot (`chainLinks`: a format 2 boot with no disc or fixture and a `from`) to every scenario that keeps a snapshot of that name. Whole groups go, largest first, to the shard with the fewest scenarios.
  - On the committed scenarios this gives 62 and 62, with the reactor chain whole in shard 0.
- **Runner (untrusted, `runner/tier2.js`).** A new `--only A,B,...` runs just those names. It filters before the 128 cap, and names it doesn't find are ignored (the validator counts them missing). The trusted side passes `--only` from the shard's expect file (`sandboxCommand`).
- **Workflow (`.github/workflows/tier2-eval.yml`):**
  - `start` (no secrets) opens the `tier2` check;
  - `eval` is a matrix over shards 0 and 1, each with its own disc fetch, sandbox run and validator. The summary goes out as the job output `summary_<shard>` (no artifact). This job no longer has `checks: write`;
  - `finish` (no secrets) re-checks each shard summary field by field (`checkShardSummary`), merges them (`mergeSummaries`), and completes the check.
- **Merge rules:** the result is error if any shard errored (including a shard whose output never arrived), else fail if any failed, else pass (or no-scenarios when neither shard has any). Counts add up, and scenarios are sorted by name.

## Not changed
- The total cap of 128 scenarios. The check output's 64 KiB limit grows with the summary, so raising the cap needs its own change.
- `SANDBOX_LIMITS`, `--deadline-s`, the validator, the gate and inspect.

## Rollout
- `tier2-eval.yml` and `lib.js` run from main, so this PR's own tier2 check runs the old, single-shard way. Its runner change is compatible: without `--only`, it runs everything.
- After merge, every PR branch needs the runner's `--only`, so open PRs must merge main first. The first run after merge proves the shards end to end.
- Balancing is by scenario count, not time. If one shard turns out much slower, weight the split later.
