# Issue #7: browser wrapper notes

2026-11-04.

## Layout
- **`web/` is the whole static site** and nothing else. `tools/preview/build.js` copies `web/` as-is and refuses file types outside its allow-list (`.sh`, `.c`, `.md` would break the preview). So:
  - the browser link step is `core/web/link.sh` + `core/web/frontend.c` (the issue allows link-step changes under `core/`);
  - its output goes to `web/core/` (gitignored): `core.mjs`, `core.wasm` (861,626 bytes), `BUILD_INFO.json`, `COPYING.pcsx_rearmed.txt`;
  - tests are `web/test/*.test.js`. They get published with the preview but do nothing in a browser (they are Node test files). Docs live here, not in `web/`.
- `web/js/pad.js` repeats the `runner/pad.js` table, because the site can't import from `runner/`. A unit test keeps them equal.

## Design
| Part | Choice | Why |
|---|---|---|
| Where the core runs | Dedicated module Worker (`emu-worker.js`) | A long frame never blocks touch input or drawing. And **WORKERFS** works only in workers: it reads the chosen `File` with `FileReaderSync` slices, so a 700 MB disc is never copied into the ≤256 MB heap. |
| Link flags | `ENVIRONMENT=worker`, `-lworkerfs.js`, 64 MB initial heap, 256 MB max, no threads | Same heap ceiling as the runner; no SharedArrayBuffer, so no COOP/COEP (GitHub Pages can't set them). |
| Frame pacing | The worker paces itself against `performance.now()` at the core's fps (59.94 for NTSC); at most 4 frames of catch-up, then re-anchors | Simple and drift-free for video. Audio drift is absorbed by the worklet's buffer (drops the oldest on overflow, re-buffers on underrun). #8 measures whether this is good enough. |
| Video | The worker converts RGB565/0RGB1555/XRGB8888 to RGBA and transfers the buffer; main thread draws the latest on `requestAnimationFrame` with `putImageData`, then hands the buffer back for reuse | Works on every browser; OffscreenCanvas needs Safari 16.4+. Upgrade later if #8 shows the copy matters. |
| Audio | `AudioWorklet` ring buffer (0.5 s), started after 50 ms buffered, linear resampling if the context isn't at 44.1 kHz; underrun/overflow counters | iOS starts audio only in a gesture: `unlock()` is called on the tap on "Load disc". |
| Input | `createInputMixer` ORs the touch pad and the keyboard, and calls `setPad` only on change | Both inputs work at once; keyboard for desktop and hardware keyboards. |
| Virtual pad | Pointer Events with capture; each pointer holds one control; fingers can slide between buttons; the d-pad is a single control read by angle (8 sectors, 20 % dead zone) | Diagonals and sliding work, which a button-per-direction pad gets wrong. Every target is ≥ 44 px (the test measures them). |
| Memory card | Core option `pcsx_rearmed_memcard1=libretro`; after `retro_load_game` the page copies the stored card into `RETRO_MEMORY_SAVE_RAM`, as every libretro frontend does. The worker checks every 30 frames (and on pause) with FNV-1a, and posts the card when it changed; the page stores it in IndexedDB (`ff7-web`/`cards`/`card1`) and asks for persistent storage | Export downloads the raw 128 KiB card as `ff7-web-card1.mcr`. Import checks the size and the `MC` header, stores it, and writes it into the running core. |

Writing the imported card into the core's save RAM writes the memory card device, not main RAM. `readMem` is read-only; there is no `writeMem` in the browser backend.

## Tests (`web/test/`)
- `unit.test.js` (no browser): the pad table equals the runner's, the mixer, d-pad angles, the key map, boot-file choice, card validation, and the blank card's checksums.
- `browser.test.js` (Playwright, Chromium and WebKit; `WEB_BROWSERS` picks):
  1. boot `vblank-counter` through the file input; the canvas shows ≥3 different pictures, and the VBLANK counter in RAM advances;
  2. the virtual pad against a **fake backend**: multi-touch, sliding, d-pad diagonal, cancel; all targets ≥44×44;
  3. card import → export (download) → import round trip with a synthetic card, byte-identical; a bad file is refused and storage is untouched;
  4. the stored card is in core slot 1 at boot, and an import reaches the running core;
  5. end to end: holding the on-screen Cross (and the Enter key) changes `pad-echo`'s button word in PS1 RAM.

A missing browser is reported as a skip, never a pass. `WEB_REQUIRE_BROWSERS=1` turns that into a failure, for CI.

A mutation check was run: moving `cross` to the wrong bit in `web/js/pad.js` fails the table test and the end-to-end test.

## Not verified here
- **WebKit**: Playwright's WebKit isn't installed in the agent sandbox, and agents must not run `playwright install` there. The WebKit runs were skipped locally. They need the CI job (protected `.github/`, separate `needs-owner` PR).
- **The preview doesn't build the core yet.** The preview workflow copies `web/` without running `core/build.sh` + `core/web/link.sh`, so until that change is merged (protected, separate PR) the preview page shows "The emulator core did not start". The Tier 3 check needs that first.
- Real iPhone behaviour: audio unlock, touch feel, landscape layout, IndexedDB persistence, WORKERFS reading a real disc. That's the Tier 3 check.
