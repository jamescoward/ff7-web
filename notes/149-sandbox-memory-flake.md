# #149: sandbox memory-limit test flake

**Verdict (measured): a reporting race, not a gap in enforcement.** The memory limit killed the hog in every run. The report sometimes missed it because the counter it reads is removed when the container exits.

## Setup
- **Where:** GitHub's `ubuntu-24.04` runner (job `private-eval-tests`, tier2-build run 43558459276, PR #191 at `b68c974`).
- **Host:** Docker 28.0.4, systemd cgroup driver, cgroup v2, kernel 7.0.0-1017-azure.
- **Tool:** `harness/private-eval/sandbox/diag/memflake.mjs`, which only exists on PR #191 (needs-owner, not merged). It ran the test's own `memhog.mjs` at 128 MiB.

## Results
**Part A: `runSandbox` exactly as the test calls it, 60 runs**
- Exit 137 (killed): 60/60.
- `limits_hit` = `["memory"]`: 59/60. It was empty once (run 35).
- `limit_counters` included `memory` in all 60 runs, including run 35. So in run 35 the init Pid was found and the container's `memory.events` path was resolved. The poll still never saw `oom_kill > 0`, and `State.OOMKilled` was false.
- The hierarchical `oom_kill` of `system.slice` rose by 1 in 60/60 runs. That counter can't be pinned to one container, so it isn't used.

**Part B: the same create/start/inspect steps by hand, with a per-run `--cgroup-parent` slice, 30 runs**
- Exit 137: 30/30.
- `docker inspect` returned Pid 0 in 2/30 runs (inspect took 536 and 583 ms). There the old code finds no counters at all.
- `State.OOMKilled` was false in 2/30 runs (different runs from the Pid 0 ones).
- The parent slice still existed after exit, with `oom_kill` = 1, in **30/30** runs, including all four runs above.

## Cause
`runSandbox` reads `oom_kill` from the container's own cgroup (`docker-<id>.scope`). It polls every 100 ms and reads once more after exit. The scope is removed when the container exits. The hog is killed within a few hundred ms of start, so the kill and the removal can both fall between two polls. Two other routes lead to the same miss:
- inspect seeing Pid 0, which means no counters are found at all;
- Docker's `OOMKilled` being false on cgroup v2, so the fallback doesn't catch it.

The earlier hypothesis on #149 named only the Pid 0 route. The failure actually measured came through the cgroup removal.

## Fix (PR #191, needs-owner)
On cgroup v2 hosts, run the container under a per-run parent cgroup:
- `ff7sandbox_<pid>_<ms>.slice` with the systemd driver;
- `/ff7sandbox_<pid>_<ms>` with cgroupfs.

After exit, read the parent's `memory.events` (it counts the whole subtree), then remove the parent. The existing test is unchanged. A new Docker test runs 20 hogs in a row and requires `memory` every time, with no parent left behind.
