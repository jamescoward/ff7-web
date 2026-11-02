# Experiment 01 — iPhone emulator baseline

**Question:** can PCSX ReARMed, compiled to WebAssembly with its interpreter CPU and HLE BIOS, run PS1 software at full speed with headroom in iPhone Safari?

This decides whether the emulator foundation is viable as-is, or whether a faster CPU core is needed first.

## Setup
- **Core:** `libretro/pcsx_rearmed`, pinned to an exact commit (survey baseline `7b0e8f8fadfbce3d170d195b9d9eecaabfa08c8e`). Emscripten target from `Makefile.libretro`, with no dynarec and threads off.
- **Toolchain:** Emscripten SDK pinned to an exact version and recorded in the repo.
- **Wrapper:** a minimal custom libretro frontend in JS/Wasm. It handles video to a canvas, audio via AudioWorklet, pad input, and loading files from `<input type=file>`. No EmulatorJS.
- **Hosting:** a static site. COOP/COEP headers are not required while threads are off.
- **Test programs:** freely distributable PS1 homebrew only. Candidates are PS1 hardware test suites and PSYQo/PCSX-Redux example programs. **Each candidate's licence is verified before it is committed**; if a licence is unclear, the file is fetched at test time rather than committed.
- **Device:** the owner's iPhone, with its model and iOS version recorded. Safari tab and home-screen app are tested separately.

## Measurements
Each run outputs a JSON report that can be downloaded or copied from the page, with no game-derived content.

| Metric | How |
|---|---|
| Unthrottled speed | Run N emulated frames as fast as possible and report emulated frames per second as a multiple of real time (NTSC ≈ 59.94 Hz) |
| Frame-time distribution | In real-time mode, record p50 / p95 / p99 host time per emulated frame |
| Audio | Count AudioWorklet underruns over 10 minutes |
| Memory | Peak Wasm heap size, plus whether the tab was reloaded or killed |
| Sustained/thermal | A 20-minute real-time run, comparing first-minute and last-minute frame times |
| Startup | Time from page load to the first emulated frame |

## Proposed thresholds (to be agreed before running)
- Unthrottled speed ≥ 1.5× real time on the homebrew GPU/GTE stress program.
- Real-time p99 frame time ≤ 16.7 ms.
- Zero audio underruns in 10 minutes.
- Peak heap ≤ 256 MB, and no tab reloads.

## Part B — private FF7 smoke test (owner's device only)
Load the owner's USA disc 1 locally. The checklist records pass/fail and metrics only, with no screenshots or recordings committed:

1. The executable's hash is reported and matches a known USA version.
2. Boot to the title screen; start a new game; the opening movie plays.
3. Walk through the first fields and complete the first battle.
4. Open the menu, save to the virtual memory card, reload the page, then load the save.
5. Export the memory card file and re-import it.

## Stop conditions
- Unthrottled speed < 1.0× real time on the stress program: stop, and evaluate a faster CPU path (for example a Wasm-emitting dynarec, or a cached block translator) before any touch work.
- The FF7 smoke test fails because of HLE BIOS behaviour: retry with a user-supplied BIOS to isolate the cause, then decide.
- Three materially different build attempts fail: report the blockers.

## Not covered by this experiment
- Touch UX and semantic hooks.
- Any other region of the game.
- Android or desktop performance, beyond noting it.
