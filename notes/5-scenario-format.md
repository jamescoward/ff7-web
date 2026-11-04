# Issue #5: scenario format notes

Measured on a Linux cloud container (Node 22), 2026-11-04, core `core.wasm` SHA-256 `1b4f66b4…5306` (the same as #4).

## Decisions
- **Homebrew program:** `pad-echo` is original project code (GPL-2.0-or-later), hand-assembled by `runner/synth/mips.js` and built at test time. Its licence is unambiguous and it is freely distributable, and it reads the pad, which #4 left unproven. No third-party binary was needed. Third-party suites (hardware tests, PSYQo/PCSX-Redux examples) are still useful later for GPU/GTE stress (#8). Each needs its own licence check.
- **No validator dependency:** `runner/schema.js` implements only the keywords the scenario schema uses. It throws on any keyword it doesn't know, so the schema can't drift into using an unchecked feature.
- **Baselines:** frame hashes that need stored expectations go in `harness/baselines/` (protected). Until a baseline file is reviewed in, checkpoints are reported as `absent` and listed under `unverified`, never counted as passing. Relational `frameHash` assertions (`sameAs` / `differsFrom`) need no stored hashes, so the scenario proves the picture follows input today.
- The MIPS assembler moved from `vblank-counter.js` to `runner/synth/mips.js`. The vblank-counter EXE is byte-identical (SHA-256 `4e7a6088…11a7` before and after).

## Facts measured (pad-echo-buttons)
- **Injected pad input reaches the PS1 program's own SIO0 read on the frame it is set.** The program sees `setPad` for frame *f* during frame *f*, and the button is released on frame *f+1* after the step ends.
- The pad on port 1 answers the `01 42 00 00 00` poll with `FF 41 5A lo hi`: a digital pad (ID `0x41`), because `frontend.c` sets both ports to `RETRO_DEVICE_JOYPAD`. The core's default without that call is no pad (`in_type` = NONE).
- In this core's SIO emulation (`libpcsxcore/sio.c`), RX-ready is set as soon as a byte is written, so the program's status poll never waits. Real hardware needs ACK delays. The program polls status anyway, so it is not relying on that shortcut more than it has to.
- Button word, active low: cross `0xbfff`; cross + start `0xbff7`; up + circle `0xdfef`.
- `node runner/scenario.js harness/scenarios/pad-echo-buttons.json` gave byte-identical stdout on two runs (exit 0, 17 assertions). The full suite (72 tests) passed three runs in a row.

## Checkpoint hashes (for the baseline PR; core `1b4f66b4…5306`)
| Frame | SHA-256 |
|---|---|
| 10 | `c198c86f655882a9cba95fe9b82fe006164a39a89c9a593270bb3933555c51d7` |
| 15 | `ce7bc3b28e1a001dd088273db92bb933647f3406e973305123852bcc21fe7842` |
| 30 | `f161162eee397fce7223958ad3854233af45a65925c233de27a44c175facc827` |
| 60 | `f8237ed278dc4bd5ba75e524de4d9e9c466300695aea63cb9fd589c775d08d5e` |
