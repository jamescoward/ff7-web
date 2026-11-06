# #34: Tier 2 result schema and trusted validator

`harness/private-eval/validate/validate.js` reads what the sandbox (#33, PR #46) left in its output directory. From that it builds the only Tier 2 data ever printed or posted: a bounded summary.

Usage: `validate.js --out DIR --expect FILE [--sandbox-report FILE]`.

## The expect file: no run-time text

`--expect` lists, before the run, every scenario name and metric key the summary may contain:

```json
{"format":1,"scenarios":{"pad-echo-buttons":["frames","fps"],"disc-boot":[]}}
```

**The trusted job (#35) builds it from the PR's scenario files.** Those files are public and were written before the disc was read, so a name or key can't carry anything learned from the disc. The validator rejects any name or key not listed, and it sorts scenarios by name and keys alphabetically, so input order carries nothing either.

**Why:** the reviewer found a hole in the first version of this PR. It copied names (up to 64 characters) and keys (up to 32) straight from the sandbox's output. That allowed about 62 kbit of free text per run, about 7× the bound the first version stated.

## Input and output

**Input:** one file, `<out>/results.json`, documented by `harness/schema/tier2-result.schema.json`:

```json
{"format":1,"scenarios":[{"name":"pad-echo-buttons","status":"pass","metrics":{"frames":60,"fps":59.94}}]}
```

**Summary:** one line on stdout:

```json
{"format":1,"ok":false,"output":"accepted","reason":null,"limits_hit":[],
 "counts":{"pass":1,"fail":1,"error":1,"missing":0},"scenarios":[…]}
```

When the output is rejected, `output` is `"rejected"`, `reason` is a fixed code, and `scenarios` is empty. `counts.missing` is the number of expected scenarios that didn't report. `ok` is true only when the output was accepted, no limit was hit, and every expected scenario reported and passed.

## Rules

Each rule has a test in `test/validate.test.js`.

| Hostile input | Rule | Result |
|---|---|---|
| Huge file (also a sparse 4 GiB file) | Read at most 64 KiB + 1 bytes | reject `too-large` |
| Deep nesting | String-aware bracket depth > 6, checked before `JSON.parse` | reject `too-deep` |
| Long strings | Names `^[a-z0-9][a-z0-9-]{0,63}$`, metric keys `^[a-z][a-z0-9_]{0,31}$` | reject `schema` |
| Text hidden in numbers | Integers within ±2³²; other numbers with ≤ 3 decimal places and within ±10⁶; must be finite | reject `schema` |
| Extra fields, wrong types, `__proto__` keys, more than 8 metrics | Exact field sets, checked by hand | reject `schema` |
| Non-UTF-8 bytes (invalid, overlong, surrogates, truncated) | `TextDecoder` with `fatal: true` | reject `not-utf8` |
| Symlinks | `lstat` before opening, then `O_NOFOLLOW`; the directory itself is checked with `lstat` | reject `not-regular-file` / `bad-directory` |
| FIFOs, devices, directories | Opened with `O_NONBLOCK`; `fstat` must be a regular file | reject `not-regular-file` |
| More than 64 scenarios (32 until #109) | — | reject `too-many-scenarios` |
| A name not in `--expect` (free text) | Names must be listed | reject `unexpected-name` |
| A metric key not listed for its scenario | Keys must be listed per scenario | reject `unexpected-metric` |
| Information in the order | Scenarios sorted by name, keys sorted | normalised |
| Duplicate names | — | reject `duplicate-name` |
| Other files in the directory | Never opened | ignored |
| Sandbox report | Only `limits_hit` names from a fixed list | other fields dropped |
| Malformed report or expect file | Error messages never quote the file | exit 2 |

**Summary size:** at most `SUMMARY_MAX_BYTES` = 32 KiB (16 KiB until #109), checked at run time. A test builds the worst case (64 scenarios with 64-character names, 8 metrics each, all 4 limits) and measures it under the cap.

**What can leak:** names, keys and order are fixed before the run. A hostile program controls only these:
- which expected scenarios report, and each one's status (4 outcomes per scenario);
- which expected keys are present, and their values. Integers range over ±2³²; other numbers have 3 decimals within ±10⁶, about 33 bits each.
- a rejection reason, as an alternative outcome.

That is at most 64 × (2 + 8 × 33.3) + log₂(14) ≈ **17.2 kbit per run, all of it numbers and statuses** (32 scenarios and 8.6 kbit until #109, when the owner raised the cap to 64 on 2026-11-06). Add up to 4 bits if the program deliberately hits sandbox limits. Each metric's 33.3 bits is log₂(2³³+1 integers + 2·10⁹ three-decimal floats + absent). A test computes this from the constants and fails above 18 kbit (9 kbit before #109). Reviewer round 2 checked the arithmetic; the first draft of this note said 34.2 bits per metric and 8.8 kbit, which overstated it. To narrow it, lower `MAX_METRICS` or `MAX_INT`.

## Why the validator doesn't use `runner/schema.js`

The issue suggested reusing it. The validator is trusted code that runs from `main`, but `runner/` and `harness/schema/` are not protected paths: an agent PR could change them without the owner's review, and so weaken the trust boundary. So the rules are written out in `validate.js`, which depends on nothing outside `harness/private-eval/validate/`. `runner/schema.js` is used only by the tests, which check that:
- whatever the validator accepts is schema-valid;
- whatever the schema rejects, the validator rejects.

The schema can't know the expect file, so the validator is the stricter of the two.

The fuzz test checks this on 3000 inputs.

## Fuzzing

A seeded PRNG (mulberry32, seed `0x34`) generates 3000 inputs per run. Half are structural mutations of a valid document (hostile values in random fields, scenario floods). Half are byte-level corruptions (deletions, insertions, random bytes, duplicated slices).

Invariants checked on every input:
- the validator never throws;
- the summary has fixed keys;
- every string is fixed vocabulary or a name or key listed in the expect file, in sorted order;
- the summary fits the size cap;
- a planted `PAYLOAD` string never appears in any summary;
- the validator agrees with the schema.

## Measured

- **Command:** `node --test harness/private-eval/validate/test/validate.test.js`
- **Result:** 26 pass, 0 fail, 0 skipped, on two runs.
- **The unreadable-file test:** this container runs as root, which can read anything, so the test drops to uid 65534 to check a mode-000 file and a 0700 directory. As a non-root user it runs directly.

## For #35

- Run the validator as root (`sudo`) or as uid 65534. The sandbox's `/out` is mode 0700, owned by 65534.
- Build `--expect` from the PR's scenario files, in trusted code, before the run. Each Tier 2 scenario needs to declare its metric keys; that belongs to the format 2 work in #37.
- Pass the sandbox's report with `--sandbox-report`, so limit hits show up.
- Pass `--out` as a canonical path with no trailing slash. With a trailing slash, a symlinked directory gets past the `lstat` check (reviewer round 2). `--out` is trusted input, but it costs nothing to pass it cleanly.
- Print only this summary.
- Call `sandbox.js release` afterwards.
- **Reviewer note on #46:** `limit_counters` can be empty when a program exits before the host finds its cgroup, so a pids hit by a very short program can go unreported. The limit itself still applies. The validator doesn't depend on `limit_counters`.
