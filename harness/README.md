# harness/ — test scenarios

A **scenario** is a JSON file that says how to boot, what to press on which frames, and what must be true afterwards. `runner/scenario.js` runs it on the Wasm core and prints a deterministic JSON result.

```sh
core/build.sh && runner/build.sh                       # once
node runner/scenario.js harness/scenarios/pad-echo-buttons.json
```

Exit status: `0` pass, `1` fail, `2` invalid scenario or usage error. stdout holds only the result JSON, which is byte-identical across runs with the same scenario and core build. Notes and logs go to stderr.

| Directory | What | Protected |
|---|---|---|
| `schema/` | `scenario.schema.json`, format 1 | no |
| `scenarios/` | Tier 1 scenarios (homebrew only); the file name is `<name>.json` | no |
| `fixtures/` | homebrew test programs and `fixtures.json`, the registry recording each one's licence, origin and SHA-256 | no |
| `baselines/` | expected frame hashes, `<scenario name>.json` | **yes**: owner review |
| `private-eval/` | the trusted Tier 2 job (`docs/AUTOMATION.md`) | **yes** |

## Scenario format 1

```jsonc
{
  "$schema": "../schema/scenario.schema.json",
  "format": 1,
  "name": "pad-echo-buttons",          // [a-z0-9-], also the baseline file name
  "tier": 1,                           // only tier 1 runs here; tier 2 is the private job
  "boot": { "fixture": "pad-echo" },   // a program in fixtures/fixtures.json, booted from power-on
  "frames": 60,                        // frames are counted from 1
  "coreOptions": {},                   // libretro core options, string values
  "memory": {                          // named main-RAM locations
    "buttons": { "addr": "0x800f0008", "type": "u16" },
    "reply":   { "addr": "0x800f000c", "type": "bytes", "len": 3 }
  },
  "input": [                           // held during from..to (inclusive); overlaps are OR-ed
    { "from": 10, "to": 20, "buttons": ["cross"] },
    { "from": 30, "buttons": ["up", "circle"], "port": 0 }
  ],
  "assert": [
    { "at": 10, "mem": "buttons", "equals": "0xbfff" },       // value at the end of frame 10
    { "at": 5,  "mem": "reply",   "equals": "ff415a" },       // bytes: hex in memory order
    { "at": 20, "frameHash": { "sameAs": 15 } },              // or "differsFrom"
  ],
  "checkpoints": [10, 30, 60]          // hashes compared with baselines/<name>.json
}
```

- **Values:** `u8`/`u16`/`u32` are little-endian unsigned and take an integer or a `0x` hex string; `bytes` takes `2×len` hex digits in memory order.
- **Addresses** are PS1 main-RAM addresses (KUSEG, KSEG0 or KSEG1). Scratchpad and I/O are rejected.
- **Timing:** the pad state for frame *f* is set before frame *f* runs, and memory and hashes are read after it ends.
- **Frame hashes** (`runner/backend.js` `frameHash`) are SHA-256 over the format, size and visible pixels. `frameHash` assertions compare frames within one run, so they need no stored hashes.
- **Checkpoints** compare against `baselines/<name>.json`. If that file doesn't exist, the hashes are reported with `"baseline": "absent"` and the result lists the gap under `unverified`. The scenario's other assertions still decide pass or fail. `--record` adds a `record` object in baseline-file form; adding it to `baselines/` is a separate PR labelled `needs-owner`. The runner never writes baselines.
- **Validation:** `runner/schema.js` checks the schema. It implements only the keywords the schema uses and throws on any other, so no check is silently skipped. `runner/scenario.js` then checks what the schema can't express: memory names exist, frames are inside the run, values fit their type, and addresses are in RAM.

- **Metrics** (optional): `"metrics": ["fps", "buttons"]` lists up to 8 numbers to report. A key is a built-in (`frames`, `failed_assertions`, `run_ms`, `fps`) or the name of a `u8`/`u16`/`u32` memory location, read at the end of the last frame. A key that is both, a `bytes` location, or anything else is refused when the scenario loads. `run_ms` and `fps` are wall-clock measurements, so they differ between runs; the others are deterministic.

### Tier 2 scenarios

A scenario with `"tier": 2` uses the same format, but only the private eval runs it (`docs/AUTOMATION.md`, `notes/35-tier2-workflows.md`); `runner/scenario.js` refuses it. Its file name must be `<name>.json`. The trusted job reads `name` and `metrics` from these files *before* the run, and the summary may hold nothing else: per scenario, `pass`, `fail` or `error`, plus the listed metrics as numbers. Assertion details, values and hashes never leave the sandbox.

Inside the sandbox, `runner/tier2.js` runs every tier 2 scenario, each in its own process, and writes `/out/results.json` (`schema/tier2-result.schema.json`):

```sh
node runner/tier2.js --disc /disc/disc.bin --out /out   # the fixed command (#35)
node runner/tier2.js --disc /dev/null --out /tmp/out --scenarios DIR --fixtures DIR   # locally, for homebrew
```

A scenario that crashes, hangs past the deadline (1140 s by default, `--deadline-s`) or fails to load reports `error`. Metrics with values the validator would refuse are dropped, so one scenario can't get the whole output rejected.

Save-state boot points, and fixtures fetched by pinned URL and hash, are not in format 1. They will be added when a scenario needs them.

## Fixtures

Every entry in `fixtures/fixtures.json` records `licence`, `origin`, `redistributable` and a pinned `sha256`, which is checked on every run. `kind` is `generator` (an original program built from source at test time) or `file`. Only freely redistributable homebrew goes here, never game data (`docs/SECURITY.md`).

| Fixture | Licence | What it does |
|---|---|---|
| `pad-echo` | GPL-2.0-or-later, original | Polls the port 1 pad over SIO0 every VBLANK (no BIOS pad code), stores the reply and button word in RAM at `0x800f0000`–`0x800f000e`, and fills the screen with a colour made from the pressed buttons |
