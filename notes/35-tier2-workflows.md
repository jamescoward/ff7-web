# #35: Tier 2 workflows

Two workflows and one trusted script. PR code meets the disc only inside the sandbox (#33), and only the validator's summary (#34) comes out.

| File | Trust | Runs |
|---|---|---|
| `.github/workflows/tier2-build.yml` | untrusted (the PR's own copy runs) | `pull_request` and pushes to `main`; no secrets, read-only token |
| `.github/workflows/tier2-eval.yml` | trusted (`workflow_run` always uses `main`'s copy) | after `tier2-build` completes; `workflow_dispatch` with a PR number |
| `harness/private-eval/eval/` | trusted, owner-reviewed | called by `tier2-eval.yml`; every decision is a tested function in `lib.js` |

## Flow

1. **tier2-build** (PR code, no secrets):
   - `private-eval-tests` builds the core and the runner, then runs the sandbox, validator and eval tests with `SANDBOX_REQUIRE=1`. This covers the check that `notes/33-sandbox.md` asked for: the attack tests run on GitHub's `ubuntu-24.04` (cgroup v2), on every PR.
   - `build` (same-repo PRs only) builds the core and the runner. It assembles `runner/` and `harness/{scenarios,fixtures,schema,saves,baselines}` into one directory, runs the asset guard on it, and uploads it as the `tier2-build` artifact (kept for 1 day).
2. **tier2-eval / gate** (no secrets, `actions: read`, `pull-requests: read`):
   - `workflow_run`: the run must be `completed` and `success`, from `.github/workflows/tier2-build.yml`, for event `pull_request`. The head repository must be this repository, by name and id. The run must have exactly one PR, whose head and base are this repository and whose head is still the built commit.
   - `workflow_dispatch`: it must run from `refs/heads/main`. The PR must be open, with its head in this repository. The build is the newest successful same-repo `pull_request` run of `tier2-build.yml` for the PR's head.
   - Every actor involved needs `write` or `admin` on the repository (`GET /collaborators/{user}/permission`; `maintain` reports as `write`). For `workflow_run` that is the actor and the triggering actor; for `workflow_dispatch`, the dispatcher and the PR author. A 404 means not a collaborator, so the run is skipped.
   - The run must have exactly one live artifact named `tier2-build`, of at most 256 MiB. That is checked from the API before downloading.
   - A skipped run posts no `tier2` check. If `tier2` becomes a required check, a fork PR then stays blocked, which is the safe default.
3. **tier2-eval / eval** (environment `tier2-private`, `checks: write`):
   1. Creates the `tier2` check run (in progress) on the PR head.
   2. `prepare` creates `$RUNNER_TEMP/tier2/{work,disc}` and refuses if it already exists. `download-artifact` (by name and run id) unpacks into the empty `work/`.
   3. `check-work` accepts only regular files and directories, rejecting symlinks, hard links, FIFOs and devices. Caps: 8192 entries, 512 MiB, depth 24. It then sets files to 0644 and directories to 0755, so nothing in the build is executable on the host and the sandbox user can read it. It reads the tier 2 scenarios into `expect.json`. A rejection writes an error summary instead.
   4. **Trusted checkout unchanged**: `git status` must be clean. This is defence in depth against an archive that writes outside its directory.
   5. **Fetch the disc**, only if there is at least one tier 2 scenario. It is the only step with secrets. `aws s3 cp` writes to `disc/disc.part`, then renames it to `disc/disc.bin` only on success.
   6. `evaluate` runs `node runner/tier2.js --disc /disc/disc.bin --out /out` in the sandbox, then the validator as root, then releases the output mount. It writes and prints the summary, which is the only thing in the log that comes from the run.
   7. `check-finish` completes the check: `success` for `pass` and `no-scenarios`, otherwise `failure`. A missing summary is `failure` (`internal`).
   8. **Delete the disc and the build** (`if: always()`) releases the mount and removes `$RUNNER_TEMP/tier2`.

## Contracts this PR fixes for later issues

- **Entry point.** `SANDBOX_COMMAND` is `node runner/tier2.js --disc /disc/disc.bin --out /out`, with `/work` (the artifact) as the working directory. It writes `/out/results.json` in the #34 format. **It doesn't exist yet.** It is untrusted runner code, outside this issue's allowed paths: #55, before #36. Until then every PR gets a green `tier2` ("no tier 2 scenarios").
- **Tier 2 scenarios.** A file `harness/scenarios/<name>.json` with `"tier": 2`, `name` equal to the file name, and an optional `metrics` array of up to 8 metric keys. `buildExpect` reads only `tier`, `name` and `metrics`. Adding `metrics` (and tier 2) to `harness/schema/scenario.schema.json` belongs to #55.
- **Disc.** Only `disc-1.bin` is fetched. Discs 2 and 3, and the cue files, aren't used yet.
- **Limits.** `SANDBOX_LIMITS` is 1200 s, 2 GiB of memory, 2 CPUs, 64 processes, 4 MiB of output and 64 MiB of `/tmp`. #36 may need to change them, which is a protected-path PR.

## Tests (Tier 1)

`harness/private-eval/eval/test/`:
- `eval.test.js` has 34 tests:
  - **Gate:** sample payloads in `payloads/`, plus 16 mutations of the same-repo payload, the fork payload, dispatch cases, permissions, build-run and artifact picking.
  - **Gate CLI against a fake GitHub API on localhost:** the full same-repo path; a fork skipped before any API call; non-collaborators (404, `read`, `none`); an oversized artifact; dispatch from `main`, and from a branch.
  - **Artifact checks:** symlinks (file, directory, dangling), FIFO, hard link, empty, sparse file over the cap, depth, the work directory itself a symlink; execute bits cleared.
  - **Expect builder:** name and file mismatch, patterns, more than 8 metrics, duplicates, bad JSON, size cap, more than 32 scenarios.
  - **Check-run output, and the check-finish CLI** against the fake API.
  - **Clean-up:** a normal run, a repeat, a job that failed halfway, and a mounted read-only output.
  - **End to end with Docker:** the dry run (a scenario made to fail gives a red summary; stdout is exactly one line, the summary; the program's stdout and stderr markers never appear), a passing run, free text rejected by the validator, a missing entry point counted as `missing`, no scenarios, and a missing disc.
- `workflows.test.js` has 8 static checks on the YAML:
  - actions pinned by commit;
  - no `${{ }}` in `run:` blocks;
  - no secrets, environment or write token in the build workflow;
  - eval triggers;
  - secrets only in the disc step;
  - no cache or upload, and clean-up `if: always()` as the last step;
  - the step order, with every `run:` line being trusted code;
  - `persist-credentials: false`.
- Mutation check: injecting `${{ }}` into a `run:` block, dropping `if: always()` from clean-up, adding a secret to the gate, or adding a `pull_request_target` trigger each makes `workflows.test.js` fail.

## Not verified (needs GitHub)

`workflow_run` only fires for workflow files already on the default branch, so none of this has run on GitHub yet. These are open until the bootstrap PR after merge:
- that `GET /collaborators/{user}/permission` works with the job's `GITHUB_TOKEN`. If it doesn't, the gate fails closed (skip, `not-a-collaborator`);
- the AWS CLI on `ubuntu-24.04`, and the R2 checksum settings (`AWS_REQUEST_CHECKSUM_CALCULATION` / `AWS_RESPONSE_CHECKSUM_VALIDATION=when_required`);
- that `download-artifact` v8.0.2, by `name` + `run-id`, unpacks straight into `path` (not `path/<name>`). If it doesn't, `check-work` finds no `runner/` or `harness/`; the build passes as "no scenarios" or the check is red;
- the sandbox suite on GitHub's runner (`private-eval-tests` runs it on this PR, since `tier2-build.yml` is a `pull_request` workflow).

## Residual risks

- **Artifact unpacking.** `download-artifact` unpacks a zip that PR code controls. Path traversal was fixed in v4.1.7; this pins v8.0.2. Afterwards, the trusted checkout must be unchanged and the tree must hold only regular files. A write elsewhere on the runner by a crafted archive isn't fully ruled out. At that point the job holds no disc, and the secrets are only in a later step's environment.
- **Leaks through the summary.** As accepted in #34 (≈8.6 kbit per run, numbers and statuses only).
- **Dispatch from a branch.** A same-repo branch can carry an edited `tier2-eval.yml` and dispatch it. The environment's `main`-only rule is what keeps the secrets out of reach (owner-confirmed, 2026-11-04).
