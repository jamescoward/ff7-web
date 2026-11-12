# harness/ — test scenarios

A **scenario** is a JSON file that says how to boot, what to press on which frames, and what must be true afterwards. `runner/scenario.js` runs it on the Wasm core and prints a deterministic JSON result.

```sh
core/build.sh && runner/build.sh                       # once
node runner/scenario.js harness/scenarios/pad-echo-buttons.json
```

Exit status: `0` pass, `1` fail, `2` invalid scenario or usage error. stdout holds only the result JSON, which is byte-identical across runs with the same scenario and core build. Notes and logs go to stderr.

| Directory | What | Protected |
|---|---|---|
| `schema/` | `scenario.schema.json`, formats 1 and 2 | no |
| `scenarios/` | Tier 1 scenarios (homebrew only); the file name is `<name>.json` | no |
| `scenarios/segments/` | input segments for format 2 scripts (#74), `<name>.json` | no |
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

Save-state boot points are format 2 (below). Fixtures fetched by pinned URL and hash are not supported yet; they will be added when a scenario needs them.

## Scenario format 2

Format 2 (#37) starts from a **boot point** instead of power-on, plays an **ordered script** whose waits can depend on memory, and checks the end state. Format 1 is unchanged; `"format"` picks the form.

```jsonc
{
  "format": 2,
  "name": "pad-echo-script",
  "tier": 1,
  "boot": { "fixture": "pad-echo", "from": "pad-echo-ready" },   // or { "disc": 1, "from": "title" }
  "memory": { "counter": { "addr": "0x800f0000", "type": "u32" }, "buttons": { "addr": "0x800f0008", "type": "u16" } },
  "input": [                                         // steps run in order; frames count from 1 after the boot point
    { "wait": { "frames": 5 } },                     // hold nothing for 5 frames
    { "buttons": ["circle"], "frames": 3 },          // hold Circle for 3 frames (default 1; "port" 0 or 1)
    { "wait": { "until": { "mem": "buttons", "equals": "0xffff" }, "timeout": 10 }, "metric": "release_wait" },
    { "wait": { "until": { "mem": "counter", "in": [60, 70] }, "timeout": 120 } }
  ],
  "assert": [                                        // made at the end of the script
    { "expect": { "mem": "counter", "differs": 0 } },
    { "sameState": "rerun", "metric": "same_rerun" },  // played again from the same start: same RAM + picture
    { "sameState": "boot" }                            // played after a fresh boot with no snapshot: same state
  ],
  "metrics": ["release_wait", "same_rerun", "snapshot_frames", "saved_ms"]
}
```

- **Boot points** live in `runner/bootpoints.js`: a source (disc or fixture), a fixed press script from power-on to frame T, and a check that T was reached. `title` is FF7 disc 1 at the title screen (#36's Start script, T = 1250, verified with #36's title-code check); `pad-echo-ready` is the homebrew one. `"from": "power-on"` starts with no boot point. A scenario must name the boot point's own source.
- **Snapshots.** `runner/tier2.js` boots each boot point once per run, keeps its snapshot in memory and restores it for every scenario (passed between processes on a pipe, never written to a file). `runner/scenario.js` run on one scenario boots the boot point itself, takes the snapshot and restores it.
- **Conditions** compare a named `u8`/`u16`/`u32` location: `equals`, `differs`, or `in: [low, high]` (inclusive). A `wait.until` is checked at the end of each frame, so it waits at least one frame; its metric is the frames waited, 0 on a timeout. **A timeout fails the scenario and stops the script there**; every check then fails.
- **`sameState`** compares SHA-256 of main RAM and the picture inside the run. Only 1/0 (pass/fail) is reported, never the state or a hash.
- **`change`** (#77) compares a named `u8`/`u16`/`u32` location at the end of the script with its value at the start: `{ "change": { "mem": "pos_x", "is": "increased", "signed": true }, "metric": "x_dir" }`. `is` is `increased`, `decreased`, `unchanged` or `changed`; `signed` compares as two's complement of the location's size. Neither value leaves the run: its metric is the sign of end − start (−1, 0 or 1), whether or not the check passes, and 0 if a wait timed out. So a position can be checked for direction without reporting coordinates.
- **`compare`** (#112) compares two named `u8`/`u16`/`u32` locations at the end of the script: `{ "compare": { "mem": "gw0_x1", "with": "pos_x", "shift": 12, "signed": true, "is": "less" }, "metric": "x1s" }`. The metric is the sign of `mem − (with >> shift)` (−1, 0 or 1), whether or not the check passes; `is` is `less`, `greater`, `equal` or `unequal`; `signed` reads both as two's complement first, so the shift is arithmetic. As with `change`, neither value leaves the run.
- **`deref`** (#112, format 2 only): a `u8`/`u16`/`u32` location `{ "addr": "0x800716c4", "deref": "0x4a", "type": "u16" }` reads the u32 pointer at `addr` and then the value at pointer + `deref`, again at every read. When that is not in main RAM the value is missing: a condition on it is false, a `change` or `compare` on it fails with metric 0, and a metric of the location itself is 0. This reaches structures the game allocates at runtime (a field's gateways) without committing where they are.
- **Metrics:** the format 1 built-ins (`frames` is the script's frames), plus `snapshot_frames` (frames from power-on to the start point: T, or for a named snapshot T plus the chain's script frames; 0 from power-on or when T was not reached) and `saved_ms` (wall time a restore saves over getting to the start point without it, at least 0). A boot point that isn't reached fails the scenario at `boot_stage` 5.

### Chains, segments and still waits (#74)

```jsonc
// harness/scenarios/new-game-to-reactor-entrance.json (tier 2)
{
  "format": 2, "name": "new-game-to-reactor-entrance", "tier": 2,
  "boot": { "disc": 1, "from": "title" },
  "input": [{ "segment": "title-to-new-game" }, { "segment": "opening-to-reactor-entrance" }],
  "assert": [{ "sameState": "rerun", "metric": "match" }],
  "snapshot": "reactor-entrance",                 // keep the end state in memory under this name
  "metrics": ["still_wait", "frames", "match", "snapshot_frames"]
}
// harness/scenarios/reactor-entrance-from-snapshot.json: a later scenario in the same run
{ "boot": { "from": "reactor-entrance" }, "input": [{ "wait": { "frames": 120 } }],
  "assert": [{ "sameState": "rerun", "metric": "match_rerun" }], ... }
```

- **Named snapshots.** `"snapshot": NAME` keeps the state at the end of the script **in memory** under NAME, if the scenario passes. A later scenario in the same run starts from it with `"boot": { "from": NAME }` (no `disc` or `fixture`: the source is the chain's). `runner/tier2.js` runs scenarios in **file name order**, and that order decides what exists: a scenario from a snapshot that no earlier scenario kept is not started and reports `error` ("no snapshot"). A later scenario that keeps the same name replaces it. Snapshots pass between processes on pipes, are never written to a file, and are dropped when the run ends. A snapshot name can't be a boot point name or `power-on`. `runner/scenario.js` on one scenario from a named snapshot exits 2 ("no snapshot").
- **`sameState` in a chain.** `rerun` restores the named snapshot again. `boot` replays the whole chain with no snapshot: power-on, the root boot point's presses, every earlier scenario's script in order, then this one. So "a chain equals the same scripts from scratch" is a check, reported as 1/0. It holds for homebrew on Tier 1. **On the FF7 disc it does not yet:** a snapshot kept mid-run and restored differs from running on (match_boot 0, even one frame after a restore at the title), while a boot point snapshot restored at T equals a fresh boot. So committed Tier 2 chains check `rerun` only, until that is explained (`notes/74-chained-snapshots.md`). The picture is host-side and not in a snapshot: a restored core has none until the core sends a new frame (a static screen can send only duplicates). So `sameState` compares the picture only when the core delivered a new one during the script, and main RAM always.
- **Memory card.** A boot point with `"card": "blank"` (`title-card`, `pad-echo-ready-card`) puts a blank, formatted card in slot 1 of every core instance of the chain, as the browser build always has one. Snapshots don't hold the card.
- **Segments.** `{ "segment": NAME }` includes the steps of `segments/NAME.json` beside the scenario file (`harness/scenarios/segments/`, `$defs/segment` in the schema: `{ "name", "description", "steps" }`). Segments may include segments. They are expanded before the run, to at most 16384 steps; a missing, invalid or recursive segment is a load error. Conditions in a segment use the including scenario's memory names, and metrics it names must be listed by that scenario. The trusted job reads only `*.json` directly in `scenarios/`, so segment files are never taken for scenarios; the Tier 2 build copies the whole `scenarios/` directory, segments included.
- **Still waits.** `{ "wait": { "stillFrames": N, "timeout": T } }` waits until the picture has stayed the same, and not a single colour, for N frames in a row (checked at the end of each frame, by frame hash). Its metric is the frames waited, 0 on a timeout; a timeout fails the scenario and stops the script, as for `until`.
- **Presses during a wait.** Any `until` or still wait may hold `"press": { "buttons", "every", "hold", "port" }`: the buttons are held for `hold` frames (default 1, less than `every`) at the start of every `every` frames, from the wait's first frame, until the wait ends.

### Boot from a generated save (#38)

```jsonc
{ "boot": { "disc": 1, "save": "disc1-md1stin", "slot": 1 },        // optional: "from" (default "title-card"), "checksum": "wrong"
  "input": [{ "wait": { "until": { "mem": "game_state", "equals": 1 }, "timeout": 3600, "press": { "buttons": ["circle"], "every": 30, "hold": 4 } } },
            { "segment": "field-loaded" }, { "mark": "loaded" }, ...],
  "assert": [{ "change": { "mem": "pos_x", "is": "changed", "since": "loaded" } }] }
```

- **`save`** names a description in `saves/` (`schema/save.schema.json`). Inside the run, the runner reads `INIT/KERNEL.BIN` from the disc, rebuilds the New Game savemap from it (`runner/savegen/baseline.js`), applies the description with the #32 generator and puts the card in slot 1 in place of the boot point's blank card, as the title snapshot is restored. The card is never written to a file and nothing read from the disc leaves the run. `"checksum": "wrong"` stores the savemap checksum inverted. The boot point must have a card (`title-card`).
- **Loading it** is input: from the title, Circle every 30 frames until field mode (the title cursor starts on Continue, so no press reaches New Game), then the segment `field-loaded` (#77's rule; `notes/38-generated-save-boot.md`).
- **`mark`** steps record every numeric memory location at that point (no frames); a `change` check with `"since": MARK` compares with that value instead of the start of the script. A mark the script never reached fails the check.

## Fixtures

Every entry in `fixtures/fixtures.json` records `licence`, `origin`, `redistributable` and a pinned `sha256`, which is checked on every run. `kind` is `generator` (an original program built from source at test time) or `file`. Only freely redistributable homebrew goes here, never game data (`docs/SECURITY.md`).

| Fixture | Licence | What it does |
|---|---|---|
| `pad-echo` | GPL-2.0-or-later, original | Polls the port 1 pad over SIO0 every VBLANK (no BIOS pad code), stores the reply and button word in RAM at `0x800f0000`–`0x800f000e`, and fills the screen with a colour made from the pressed buttons |
