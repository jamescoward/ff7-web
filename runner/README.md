# runner/ — headless Node runner for the Wasm core

Runs a PS1 program on the PCSX ReARMed Wasm core without a browser and prints deterministic JSON: one SHA-256 frame hash per sampled frame, plus requested RAM values. It is the base for the Tier 1 harness (`docs/AUTOMATION.md`) and for private eval scenarios.

## Build

```sh
core/build.sh      # pinned core archive (see core/README.md)
runner/build.sh    # links runner/frontend.c + the archive -> runner/dist/core.{mjs,wasm}
```

`runner/dist/` is not committed. The link is reproducible: the same archive gives the same `core.wasm` hash, which `runner/dist/BUILD_INFO.json` records and every run reports.

## CLI

```sh
node runner/cli.js --frames N [--hash-every K] [--peek ADDR[:LEN]]... \
  [--pad FROM[-TO]=BUTTONS]... [--option KEY=VALUE]... [--verbose] <program>
```

- `--peek 0x800f0000:4` reports those RAM bytes (hex, in memory order) in every sample. Addresses are PS1 main-RAM addresses in KUSEG, KSEG0 or KSEG1; anything else is rejected.
- `--pad 10-20=start,cross` holds Start and Cross during frames 10 to 20 (1-based, inclusive).
- `<program>` is a PS-X EXE or a disc image. It is read in place through Emscripten's NODEFS, not copied into the 256 MB heap.

stdout holds only deterministic data, so two runs with the same program, flags and core build are byte-identical. Logs go to stderr.

## Scenarios

```sh
node runner/scenario.js [--record] [--baselines DIR] [--fixtures DIR] <scenario.json>
```

Runs a JSON test scenario: a boot fixture, an input script, and assertions on named memory and frame hashes. The format, fixtures and baselines are described in `harness/README.md`. `schema.js` is the dependency-free validator for the scenario schema.

Format 2 scenarios (#37) start from a boot point (`bootpoints.js`) restored from an in-memory snapshot and play an ordered script with `wait.until` conditions; `format2.js` loads and runs them, and `scenario.js` dispatches on `"format"`. Since #74 a format 2 scenario can keep its end state as a named in-memory snapshot (`"snapshot"`) for later scenarios in the same run (`"boot": { "from": NAME }`), include input segments (`segments.js`, `{ "segment": NAME }` from `segments/` beside the scenario file), and wait for a still picture while pressing a button. `format2.js` `runSequence` runs a chain in one process (tests); a scenario from a named snapshot run alone through the CLI reports "no snapshot" (exit 2).

Since #88, a restored snapshot runs on exactly as the core that saved it (`core/patches/0002-savestate-round-trip.patch`; `notes/88-snapshot-divergence.md`). For diagnostics, a format 2 scenario with a `{ "sameState": "boot" }` check may list the built-in metrics `same_ram`, `same_bios`, `same_io`, `same_cpu`, `same_gpu`, `same_spu`, `same_cdrom`, `same_timers` and `same_other`: 1 when that part of the emulator state is the same at the end of the main run and of the boot replay. `stateparts.js` splits a 4,456,448-byte state into those parts (the pinned core's layout, checked by markers) and leaves out the few bytes that differ between two saves of the same moment.

## Tier 2 entry point

```sh
node runner/tier2.js --disc PATH --out DIR [--scenarios DIR] [--fixtures DIR] [--baselines DIR] [--deadline-s N]
```

The program the private eval runs inside the sandbox (#55). It runs every `"tier": 2` scenario in its own child process and rewrites `DIR/results.json` after each one. stdout stays empty: only the results file counts. Format 2 scenarios that start from the same boot point share one snapshot per run: a `--make-snapshot` child boots it once, and each scenario's child gets the bytes on stdin. A scenario that keeps a named snapshot (#74) hands it back on stdout after its result line; the parent keeps it in memory and gives it, with the chain of scenario files, to later scenarios from that name. Scenarios run in file name order; nothing is written to a file. See `harness/README.md` (Tier 2 scenarios) and `notes/55-tier2-entry.md`.

## Backend interface (`backend.js`)

`createBackend(opts)` returns:

| Method | Notes |
|---|---|
| `loadProgram(path)` | once per backend |
| `stepFrame()`, `runFrames(n)`, `frame` | runs `retro_run`, then the `onFrameEnd` listeners |
| `readMem(addr, len)`, `readU8/16/32(addr)` | copies of main RAM, little-endian; `RangeError` outside RAM |
| `writeMem(addr, bytes)` | **off by default**; needs `allowMemoryWrite: true` (CLAUDE.md: input injection only, unless an issue allows writes) |
| `setPad(state, port = 0)` | a 16-bit mask, an array of names, or `"start,cross"`; bit order is libretro's joypad IDs (`pad.js`) |
| `onFrameEnd(fn)` | returns an unsubscribe function |
| `setCard(bytes, slot = 0)`, `getCard(slot = 0)` | slot 1 memory card, 131072 bytes, in core memory (never a file). Needs `createBackend({ memoryCard: true })`. `setCard` works before or after `loadProgram` but must precede the first frame. Only slot 0 exists |
| `saveState()` → `Uint8Array`, `loadState(bytes)` | whole-emulator snapshot via `retro_serialize` / `retro_unserialize` (4,456,448 bytes). Bytes in memory only, no path parameter, nothing written to disk. Same core build only. Does **not** contain the card; `frame` and the last-frame buffer are host-side and not rewound |
| `frameInfo()`, `frameHash()` | the last frame's geometry and SHA-256 (format and size are hashed with the visible pixels) |

The frontend (`frontend.c`) answers the core's environment queries: no frame duping, an empty system directory (so the HLE BIOS is used), input bitmasks, and core options from `opts.coreOptions`. It discards audio and does no rendering.

## Tests

```sh
node --test 'runner/test/**/*.test.js'
```

- `test/unit/`: the address map, the pad bitmask, CLI parsing, the synthetic EXE, the schema validator, the scenario loader, the fixture registry, and `tier2.js`'s discovery and result rules (checked against the trusted validator and expect builder). These need no build.
- `test/tier1/tier2.test.js` runs `tier2.js` on the real core with passing, failing, crashing, hanging and invalid tier 2 scenarios. `test/tier1/tier2-sandbox.test.js` runs it inside the real sandbox through the trusted eval functions. That needs Docker and root or passwordless sudo; it is skipped without them, unless `SANDBOX_REQUIRE=1`.
- `test/tier1/`: the backend interface, CLI determinism and the scenario runner against the real core. These need both build steps. They use `synth/vblank-counter.js`, an original hand-assembled PS-X EXE that counts VBLANKs into RAM and fills the screen with a colour derived from the count. The card tests use `synth/card-read.js`, an original hand-assembled PS-X EXE that reads one slot 1 card frame through SIO0 into RAM, and `synth/blank-card.js`, which formats a blank card in code. None of them contains game, BIOS or SDK code. The scenario tests use the `pad-echo` homebrew (`harness/fixtures/`), built the same way. `format2.test.js` covers format 2: snapshot reuse (in process and through `tier2.js`), `wait.until` passes and timeouts, a disc boot point on a synthetic disc, and "no disc". `chain.test.js` covers chains (#74): a scenario from a kept snapshot gives the same results as the chain's scripts played from scratch, in process and through `tier2.js`, "no snapshot", and segments through the CLI; `test/unit/chain.test.js` covers the schema, segment expansion errors, still waits and presses on a fake backend, and the child's output framing. `restore-equals-run.test.js` (#88) checks that a restored state, once or chained, runs on exactly as a core that never saved, in main RAM and in every state part, with `synth/timer-probe.js` (an original EXE that stores the root counters, a busy-wait count and SPU envelopes in RAM every frame), as an EXE and from a synthetic disc; and the `same_PART` metrics.

## Licence

The runner is original project code, GPL-2.0-or-later, so that it can link the GPL-2.0 core. `frontend.c` includes `libretro.h` (MIT) from the pinned upstream tree; that header is not vendored here.
