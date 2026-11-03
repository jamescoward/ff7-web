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
| `frameInfo()`, `frameHash()` | the last frame's geometry and SHA-256 (format and size are hashed with the visible pixels) |

The frontend (`frontend.c`) answers the core's environment queries: no frame duping, an empty system directory (so the HLE BIOS is used), input bitmasks, and core options from `opts.coreOptions`. It discards audio and does no rendering.

## Tests

```sh
node --test 'runner/test/**/*.test.js'
```

- `test/unit/`: the address map, the pad bitmask, CLI parsing and the synthetic EXE. These need no build.
- `test/tier1/`: the backend interface and CLI determinism against the real core. These need both build steps. They use `synth/vblank-counter.js`, an original hand-assembled PS-X EXE that counts VBLANKs into RAM and fills the screen with a colour derived from the count. It contains no game, BIOS or SDK code.

## Licence

The runner is original project code, GPL-2.0-or-later, so that it can link the GPL-2.0 core. `frontend.c` includes `libretro.h` (MIT) from the pinned upstream tree; that header is not vendored here.
