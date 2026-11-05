# #55: Tier 2 in-sandbox entry point

`runner/tier2.js` is the untrusted program that the Tier 2 eval runs inside the sandbox. #35 fixed the command (`SANDBOX_COMMAND` in `harness/private-eval/eval/lib.js`):

```sh
node runner/tier2.js --disc /disc/disc.bin --out /out    # cwd: the tier2-build artifact, read-only
```

## Design

- **Discovery** uses the trusted expect builder's rules (`buildExpect`): `*.json` in `harness/scenarios`, a regular file of at most 64 KiB, a JSON object with `"tier": 2`, and `name` matching the pattern and the file name. A file the builder refuses stops the eval before this program runs; here it is skipped. A unit test compares the two on the same trees.
- **One child process per scenario** (`tier2.js --one FILE`). A JS exception, a Wasm abort, an OOM kill or a `SIGKILL` in one scenario becomes `error` for that scenario, and the rest still run. A child result counts only on exit 0 with no signal and a JSON last line. Child stderr is discarded.
- **Deadline.** Children get the time left until `--deadline-s` (default 1140 s, under the sandbox's 1200 s). They are killed at that point. A scenario that never starts because the deadline has passed reports `error`.
- **Atomic, incremental results.** `results.json` is rewritten through a temporary file and `rename` after every scenario. If the sandbox kills the whole run, the scenarios that finished still count, and the rest show as `missing` in the summary.
- **Results always pass the validator's rules.** Statuses other than `pass`/`fail` become `error`. Metrics are kept only for listed keys with values the validator accepts (finite; integers within ±2³²; otherwise ≤ 3 decimals within ±10⁶). So one bad value can't get the whole output rejected. The artifact holds no `harness/private-eval/`, so the rules are restated in `tier2.js`, and a unit test checks they match `validate.js`.
- **stdout stays empty.** stderr gets `<name>: <status>` lines, which the sandbox and the trusted side never use. No error message from a scenario is passed on.
- **`--disc`** is required, as the contract says, and passed to children. Format 1 boots fixtures, so nothing reads it yet. Disc boot belongs to #36.

## Scenario schema

- `"tier": 2` was already allowed by `scenario.schema.json`. `loadScenario(doc, { allowTier2: true })` accepts it; `runner/scenario.js` still calls it without the flag, so it refuses tier 2 (tested).
- New optional `metrics`: up to 8 unique keys matching `^[a-z][a-z0-9_]{0,31}$`, the same limits as `buildExpect` and the validator. A key is either a built-in or the name of a `u8`/`u16`/`u32` memory location, read at the end of the last frame:
  - `frames`: the frames run;
  - `failed_assertions`: failed assertions plus failed checkpoints;
  - `run_ms`: wall time of the frame loop;
  - `fps`: unthrottled frames per second, 3 decimals. #36 wants this.

  A key that is both a built-in and a memory name is refused as ambiguous (pad-echo has a memory location called `frames`). So is a `bytes` location, or an unknown key.
- Format 1 scenarios without `metrics` behave as before. The committed example is unchanged and still valid.

## Evidence (this session)

Built with `core/build.sh && runner/build.sh`; the archive SHA-256 is `80971bdb…`, and `core.wasm` is `354ee8a4…`.

| Command | Result |
|---|---|
| `node --test 'runner/test/unit/**/*.test.js'` | 138 pass |
| `node --test runner/test/tier1/tier2.test.js` | 3 pass (about 21 s; the hang scenario waits for a 20 s deadline) |
| `SANDBOX_REQUIRE=1 node --test runner/test/tier1/tier2-sandbox.test.js` (Docker 29.9.2, root) | 1 pass |
| `SANDBOX_REQUIRE=1 node --test 'runner/test/**/*.test.js'` | 174 pass, 0 skipped |
| `node --test 'harness/private-eval/**/*.test.js'` | 91 pass |
| `node tools/asset-guard/check.js` | 0 violations |

- `tier2.test.js` checks the Tier 1 acceptance criteria. A `results.json` from passing, failing, crashing (`SIGKILL`), hanging and invalid homebrew tier 2 scenarios is `accepted` by `summarize()` against `buildExpect()` of the same tree, with counts pass 1, fail 1, error 4, missing 0. stdout is empty, and `/out` holds only `results.json`.
- `tier2-sandbox.test.js` assembles a work tree the way `tier2-build.yml` does. It then runs the trusted `prepare → checkWork → buildExpect → evaluate → cleanup` with the real `tier2.js` in the Docker sandbox: read-only `/work`, no network, uid 65534, pids 64. The result is `fail`, with output `accepted` and counts 1/1/1/0.

## CI note

The `tier1` job runs `node --test 'runner/test/**/*.test.js'`. On `ubuntu-24.04`, Docker and passwordless sudo are present, so `tier2-sandbox.test.js` runs there too, and pulls the pinned sandbox image. Without them it is skipped, the same convention as `harness/private-eval/sandbox/test/`.

## Not verified yet

- **Tier 2 bootstrap** (acceptance, from #35's contract). This needs a throwaway PR after this merges: a homebrew scenario marked tier 2 and made to fail should give a red `tier2` check whose log holds only the summary. Then the PR is closed. It is also the first real run of the `workflow_run` path, the R2 fetch and the gate's permission call (the "Not verified" list in `notes/35-tier2-workflows.md`).
- A disc-booting scenario: #36.
