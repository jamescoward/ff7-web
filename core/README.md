# core/ — PCSX ReARMed built for WebAssembly

This directory builds the emulator core layer: the **PCSX ReARMed** libretro core, compiled with Emscripten to a static Wasm archive (`core/dist/pcsx_rearmed_libretro.a`). Later layers (the headless runner, the browser wrapper) link that archive with their own libretro frontend.

Upstream source is **fetched at build time at a pinned commit**, not vendored. Nothing under `core/.src/` or `core/dist/` is committed.

## Usage

```sh
core/build.sh fetch   # network: pinned pcsx_rearmed + pinned emsdk (~360 MB download)
core/build.sh build   # offline: patch, compile, write core/dist/
core/check.sh         # verify exports; link to Wasm and call the core under Node
```

`core/build.sh` with no argument does both steps. Overrides: `CORE_SRC_DIR`, `CORE_DIST_DIR`, `JOBS`.

Outputs in `core/dist/`:

- `pcsx_rearmed_libretro.a`: an LLVM bitcode/Wasm object archive (upstream names it `pcsx_rearmed_libretro_emscripten.bc`);
- `BUILD_INFO.json`: the pins, the `emcc` version, the patches applied and the archive's SHA-256;
- `COPYING.pcsx_rearmed`: the upstream GPL-2.0 licence text.

## Pins (`pins.env`)

| What | Pin |
|---|---|
| `libretro/pcsx_rearmed` | `7b0e8f8fadfbce3d170d195b9d9eecaabfa08c8e` (the survey baseline) |
| Emscripten SDK | `4.0.23` (emsdk commit `c0bb220cb6e6f4e0fabb6f6db9efd53390ef5e56`) |

`build.sh` fails if the emsdk tag no longer resolves to the pinned commit, or if `emcc` reports a different version.

## Build configuration

These come from upstream's `platform=emscripten` in `Makefile.libretro`, and `build.sh` restates them explicitly:

- **CPU:** interpreter only. `DYNAREC=` (empty), compiled with `-DDRC_DISABLE`.
- **Threads:** off (`USE_RTHREADS=0`, `USE_ASYNC_CDROM/GPU/SPU=0`), so no `SharedArrayBuffer` and no COOP/COEP headers are needed.
- **BIOS:** the HLE BIOS (`libpcsxcore/psxbios.c`) is always compiled in. The core uses it when no BIOS file is provided.
- **GPU:** `gpu_neon` software renderer (upstream's choice for emscripten), built with `-msimd128`.
- **Compression:** the in-tree miniz instead of the Emscripten zlib port (see patches).
- **Optimisation:** `-O2`; no physical CD-ROM support; static linking.

The build is bit-for-bit reproducible: `SOURCE_DATE_EPOCH` is set to the pinned commit's timestamp, because upstream embeds `__DATE__`/`__TIME__`.

## Patches (`patches/`)

| Patch | Why |
|---|---|
| `0001-emscripten-use-in-tree-miniz.patch` | Upstream's emscripten platform requests `-sUSE_ZLIB=1`, which downloads zlib from github.com archive URLs while compiling. This patch keeps the in-tree miniz, which is upstream's default for every other platform. The build then needs no network after `fetch`. |

Each patch starts with a provenance header. Patches are applied with `git apply` onto a freshly reset upstream tree on every build.

## Licence and provenance

PCSX ReARMed is GPL-2.0 (see `core/dist/COPYING.pcsx_rearmed` after a build, or upstream's `COPYING`). The patches in this directory are derived from it, so they are GPL-2.0 as well. The build scripts here are original project code. No game data, BIOS or homebrew is involved in building the core.
