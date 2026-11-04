# #34: Tier 2 result schema and trusted validator

`harness/private-eval/validate/validate.js` reads what the sandbox (#33, PR #46) left in its output directory. From that it builds the only Tier 2 data ever printed or posted: a bounded summary.

## Input and output

**Input:** one file, `<out>/results.json`, documented by `harness/schema/tier2-result.schema.json`:

```json
{"format":1,"scenarios":[{"name":"pad-echo-buttons","status":"pass","metrics":{"frames":60,"fps":59.94}}]}
```

**Summary:** one line on stdout:

```json
{"format":1,"ok":false,"output":"accepted","reason":null,"truncated":false,"limits_hit":[],
 "counts":{"pass":1,"fail":1,"error":1},"scenarios":[…]}
```

When the output is rejected, `output` is `"rejected"`, `reason` is a fixed code, and `scenarios` is empty. `ok` is true only when the output was accepted, nothing was truncated, no limit was hit, and every scenario passed.

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
| Symlinks | `results.json` opened with `O_NOFOLLOW`; the directory itself is checked with `lstat` | reject `not-regular-file` / `bad-directory` |
| FIFOs, devices, directories | Opened with `O_NONBLOCK`; `fstat` must be a regular file | reject `not-regular-file` |
| More than 32 scenarios | Keep the first 32; the rest are never inspected | `truncated: true`, `ok: false` |
| Duplicate names | — | reject `duplicate-name` |
| Other files in the directory | Never opened | ignored |
| Sandbox report | Only `limits_hit` names from a fixed list | other fields dropped |

**Summary size:** at most `SUMMARY_MAX_BYTES` = 16 KiB, checked at run time. A test builds the worst case (32 scenarios with 64-character names, 8 metrics each, all 4 limits) and measures it under the cap.

**What can leak:** the worst-case bandwidth is bounded by 32 scenarios × (status + 8 metrics of about 33 bits) ≈ 8.5 kbit per run. This is the "numbers and small integers" channel the issue allows. If it's too wide, tighten `MAX_METRICS` or `MAX_INT`. That is a one-line change, and the size test follows it.

## Why the validator doesn't use `runner/schema.js`

The issue suggested reusing it. The validator is trusted code that runs from `main`, but `runner/` and `harness/schema/` are not protected paths: an agent PR could change them without the owner's review, and so weaken the trust boundary. So the rules are written out in `validate.js`, which depends on nothing outside `harness/private-eval/validate/`. `runner/schema.js` is used only by the tests, which check that:
- whatever the validator accepts is schema-valid;
- whatever the schema rejects, the validator rejects.

The fuzz test checks this on 3000 inputs.

## Fuzzing

A seeded PRNG (mulberry32, seed `0x34`) generates 3000 inputs per run. Half are structural mutations of a valid document (hostile values in random fields, scenario floods). Half are byte-level corruptions (deletions, insertions, random bytes, duplicated slices).

Invariants checked on every input:
- the validator never throws;
- the summary has fixed keys;
- every string is fixed vocabulary or a pattern-checked name or key;
- the summary fits the size cap;
- a planted `PAYLOAD` string never appears in a rejected summary;
- the validator agrees with the schema.

## Measured

- **Command:** `node --test harness/private-eval/validate/test/validate.test.js`
- **Result:** 21 pass, 0 fail, 1 skipped, on two runs.
- **The skip:** "an unreadable results file is rejected" doesn't run here, because this agent container runs as root, which can read a mode-000 file. It will run on a non-root runner such as GitHub's.

## For #35

- Run the validator as root (`sudo`) or as uid 65534. The sandbox's `/out` is mode 0700, owned by 65534.
- Pass the sandbox's report with `--sandbox-report`, so limit hits show up.
- Print only this summary.
- Call `sandbox.js release` afterwards.
- **Reviewer note on #46:** `limit_counters` can be empty when a program exits before the host finds its cgroup, so a pids hit by a very short program can go unreported. The limit itself still applies. The validator doesn't depend on `limit_counters`.
