# Issue #3: core build notes

Measured on a Linux cloud container (4 vCPU), 2026-11-03.

## Attempts
1. **Upstream `make -f Makefile.libretro platform=emscripten`, unmodified.** This failed while compiling `libpcsxcore/cdriso.c`: `-sUSE_ZLIB=1` makes `emcc` fetch the zlib port from `https://github.com/madler/zlib/archive/refs/tags/v1.3.1.tar.gz`. The agent's egress proxy returned **403** for github.com archive (codeload) downloads, while `git` over HTTPS to github.com is allowed. No workaround around the blocked host was tried. Even with the download allowed, a compile step that touches the network breaks the issue's offline-build requirement.
2. **Same target plus patch `0001`, which drops the zlib port and keeps the in-tree miniz.** This succeeded, with 0 compiler warnings in the log. It also builds inside `unshare -n` (no network at all).

## Reproducibility
- The first two offline builds produced different archive hashes. The cause is `frontend/main.c:456`, which embeds `__DATE__ " " __TIME__`.
- The fix: `SOURCE_DATE_EPOCH` is set to the pinned commit's timestamp, which clang honours. Two consecutive builds then gave identical SHA-256 hashes.
- Because SIMD and `-ffast-math` are compile-time choices, archive equality covers the output across builds. Emulation determinism at run time is the runner's concern (#4).

## Facts for later issues
- The archive is LLVM bitcode inside an `ar` container, and it links with plain `emcc`. `core/check.sh` links it with `-sMODULARIZE -sENVIRONMENT=node -sMAXIMUM_MEMORY=256MB` and calls these: `retro_api_version` returns 1, `retro_get_system_info` returns `PCSX-ReARMed` (extensions `bin|cue|img|mdf|pbp|toc|cbn|m3u|chd|iso|exe`), then `retro_init`/`retro_deinit`. The environment callback answers 0 for everything, and that is enough for init.
- `.exe` (PS-X EXE) is a valid content type, so homebrew test programs can be loaded directly without a disc image (#5).
- `frontend/libpicofe` (a submodule) is not needed for the libretro build.
- The GPU is `gpu_neon`'s `psx_gpu`, built with `-msimd128`. **iOS Safari has supported Wasm SIMD since 16.4.** That is a source claim, not yet checked on the owner's device; #7 and #8 need to confirm it.
- emsdk 4.0.23 is a 356 MB download.
