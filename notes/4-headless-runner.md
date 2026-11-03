# Issue #4: headless runner notes

Measured on a Linux cloud container (4 vCPU, Node 22.23.4), 2026-11-03.

## What was built
- `runner/frontend.c`: a minimal libretro frontend in C, linked with the core archive by `runner/build.sh` (emsdk 4.0.23, `-O2`, Node ES module, 64 MB initial heap, 256 MB maximum, 1 MB stack, NODEFS).
- `runner/backend.js`: the backend interface (`readMem` / `writeMem` / `setPad` / `onFrameEnd`).
- `runner/cli.js`: the JSON CLI.
- `runner/synth/vblank-counter.js`: an original synthetic test program.

The first approach worked, so no attempts from the budget were spent on dead ends.

## Measurements
- The link is reproducible. Two links of the same archive gave the same `core.wasm` SHA-256, `1b4f66b4…5306` (861,701 bytes).
- Determinism: two CLI processes, 300 frames each, with pad input on frames 10–20, gave byte-identical JSON. All 28 tests passed in three consecutive runs.
- Speed: 3600 frames of the synthetic program took 21.5 s, about 167 frames/s or 2.8× real time, with the interpreter CPU and hashing every frame. Hashing every frame versus every 600th made no measurable difference. The program busy-waits on VBLANK, so the CPU interpreter is fully loaded; real game load will differ.
- Startup plus loading plus one frame takes about 0.12 s.
- The core reports 60 fps for the synthetic EXE (`retro_get_system_av_info`).

## Facts for later issues
- The core picks RGB565 output and produces a 320×240 picture for the synthetic program's display mode.
- With `GET_CAN_DUPE` false, the core passes a frame pointer every frame (`duplicateFrames` stays 0), so every frame can be hashed. It logs `CAN_DUPE reports false` at warning level; that is expected.
- With `GET_INPUT_BITMASKS` true, the core reads the pad once per frame through `RETRO_DEVICE_ID_JOYPAD_MASK` (`inputPolls` goes up 1 per frame). Analog-button queries fall back to the digital bits.
- **Not yet shown:** that a pad bit reaches a PS1 program's view of the controller. The tests prove the mask reaches the callback that the core polls, and that the core polls every frame, but the synthetic program does not read the pad. A homebrew pad-reading program belongs in #5.
- `retro_get_memory_data(SYSTEM_RAM)` is valid as soon as `retro_init` runs, but it holds nothing meaningful before a program loads, so the backend refuses RAM access until then.
- With the HLE BIOS, a PS-X EXE runs from `pc0` straight after `retro_load_game`. The synthetic program sets COP0 SR = 0 and I_MASK = 0, and polls I_STAT bit 0 to pace itself to VBLANK.
