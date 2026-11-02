# Architecture survey (M0)

Survey date: 2026-11-02. Target: **FF7 USA release (SCUS-94163/94164/94165)**, personal use, source code published so others can build it with their own disc.

Evidence labels used throughout:

- **Verified**: read directly from the upstream repository at the commit listed (licence file, config, makefile, source header).
- **Claimed**: stated by the project (README, docs, commit message) but not reproduced here.
- **Unknown**: not established.

Nothing in this survey was built or run, and no game data, BIOS or disc image was downloaded. Repositories were inspected with `git ls-remote` and blobless/shallow clones; the GitHub REST API, recomp.gg and decomp.dev were unreachable from the survey environment.

## Decision summary

| Candidate | Path to complete game | Time to playable | Touch extensibility | iPhone | Licensing | Verdict |
|---|---|---|---|---|---|---|
| **PS1 emulator (PCSX ReARMed) + semantic hooks** | Strong: original code runs unmodified | Shortest | Good (read memory, inject input) | Unmeasured; Wasm build is interpreter-only | GPL-2.0, workable | **Primary route** |
| PS1 static recompilation | Good in principle | Long | Good (same memory layout) | Unmeasured | Generated code is derived from the game; PSXRecomp is non-commercial | Optional later backend |
| Decomp-based native port | Best long-term | Gated on decomp progress | Excellent | Unknown | AGPL-3.0; upstream forbids LLM-written contributions | Reference for symbols only |
| Existing engines (Braver, V-Gears) | Weak | Long | Excellent | Large port | EPL-2.0 / GPL-3.0 | Not pursued |
| Clean Rust/Wasm engine | Weak | Very long | Excellent | Unknown | Clean | Not pursued |

Scores are qualitative judgements, not measurements.

### Key structural finding

Code produced by recompiling FF7's executable is a derived work of the game and cannot be published. For a public repository that users build with their own disc, recompilation must therefore happen on the user's machine. In the browser that means translating MIPS to WebAssembly at runtime and caching it, which is an emulator CPU core. On iOS, native code cannot be generated at runtime outside WebKit, so a native recompiled build only works as a personal Xcode build produced from the user's own disc.

**Consequence:** the emulator is the foundation either way. Recompilation is at most a later performance backend. The semantic hook and touch layers are written against a small interface (read/write guest memory, inject pad input, frame-end callback) so they survive a backend swap. Recompiled code keeps the PS1 memory layout, so the same addresses apply.

## 1. PS1 emulators for the browser

| Project | Licence | HEAD at survey | Notes |
|---|---|---|---|
| [libretro/pcsx_rearmed](https://github.com/libretro/pcsx_rearmed) | GPL-2.0 (verified; `libpcsxcore/psxbios.c` header is GPL-2.0-or-later) | `7b0e8f8fadfbce3d170d195b9d9eecaabfa08c8e` (2026-10-29) | Emscripten target sets `DYNAREC =` (interpreter only), `-msimd128`, threads off (verified, `Makefile.libretro`). BIOS HLE: "most games run without proprietary BIOS" (claimed, README). |
| [libretro/beetle-psx-libretro](https://github.com/libretro/beetle-psx-libretro) | GPL-2.0 | `71ee81e77acd49296ecf4a683f5a61568ba80bf9` (2026-11-01) | Emscripten GLES3 target. Needs a real BIOS; no HLE found. |
| [grumpycoders/pcsx-redux](https://github.com/grumpycoders/pcsx-redux) | GPL-2.0 | `2bbd3c1f4e58c445f66199491c731b579ac89332` | Browser build "experimental, not really functional yet" (claimed, README). OpenBIOS free BIOS. Lua scripting and debugger are the best design reference for semantic hooks. |
| [stenzek/duckstation](https://github.com/stenzek/duckstation) | CC-BY-NC-ND 4.0 | `f606b4412ace09fa496cc16680deadc97cdecade` | No-derivatives licence rules out a port. **Rejected.** |
| [EmulatorJS/EmulatorJS](https://github.com/EmulatorJS/EmulatorJS) | GPL-3.0 | `5a65bde5d3b47c75f22e90453c3c14c469411589` (2026-10-21) | Wraps `pcsx_rearmed` / `mednafen_psx_hw`. Exposes input simulation, save states, cheats; no documented guest-RAM API. |
| [js-emulators/wasmpsx](https://github.com/js-emulators/wasmpsx) | MIT | `99a516e1` (2021-05-16) | Prebuilt minified binaries only, no buildable source. **Rejected.** |

**Choice:** PCSX ReARMed driven by a thin custom wrapper (not EmulatorJS), so guest memory and the frame loop are directly accessible.

**Open licence question:** the sampled core file is GPL-2.0-or-later, but every file (plugins, GPU, SPU) has not been audited. Until it has, treat the combined work as GPL-2.0 and avoid mixing in GPL-3.0-only code.

**Unknown:**

- iPhone Safari frame rate for any PS1 core.
- Whether the HLE BIOS is accurate enough for FF7. One native iOS 9 report of FF7 crashes on scene changes exists ([forum](https://forums.libretro.com/t/ra-pcsx-rearmed-crashing-on-final-fantasy-7-ios-9-35/31825)); it is old, native and not the browser.

## 2. PS1 static recompilation

| Project | Licence | HEAD | Notes |
|---|---|---|---|
| [RetroPortingToolKit/psxrecomp](https://github.com/RetroPortingToolKit/psxrecomp) | PolyForm Noncommercial 1.0.0 (not OSI) | `a7b37e079e8c6e98e04cd1cd42ba559e95911ea7` (2026-10-30) | MIPS→C on an emulated-hardware runtime with recompiled OpenBIOS. Overlays: AOT when known, else captured, compiled and cached by content hash, interpreter fallback (claimed). GTE/MDEC/XA "working" (claimed). ~16 titles listed. Merged a branch named `gpu-dma2-correctness-ff7`; no public FF7 port found. |
| [BlackLabelHQ/RecompOne](https://github.com/BlackLabelHQ/RecompOne) | MIT | `b18bec02b18a983228613fd5e3ef9b143fd36fbb` (2026-11-02) | MIPS→C# on .NET 10. Overlay writer/dispatcher, C# GTE/MDEC/XA. Does not accept AI-written PRs. |
| [FermataRest/RepsiMan](https://github.com/FermataRest/RepsiMan) | — | `8fb69b54a037c6c4c699ca9ab3d6b054e6230f51` (2026-07-24) | Pepsiman via PSXRecomp → Emscripten PWA. Safari explicitly not a v1 target. Publishes the generated Wasm, which is the licensing problem described above. |

### PSP precedents from the original Phase 0 brief

Both are real code, not scaffolding, and both appear heavily AI-assisted and only weeks old.

- **[DrummingBird1/gow-psp-recomp](https://github.com/DrummingBird1/gow-psp-recomp)** at `afc345b4033e0f5a1487617832b407ac85b9ad03` (2026-10-30). GPL-3.0-or-later.
  - Windows only (SDL3 GPU). No browser build.
  - Ghidra-seeded discovery; delay-slot capture before branch; jump tables become `switch` statements.
  - Differential testing against Unicorn, plus replay and frame-hash checks.
  - Game results are self-reported, and there has been no full playthrough.
- **[snuri00/psp-web-recomp](https://github.com/snuri00/psp-web-recomp)** at `37826ab881d9a593efb842fe47adfae2e9118b5d` (2026-10-15). MIT.
  - Built on PSPRecomp with local patches. Emscripten, WebGL2 on an OffscreenCanvas worker, COOP/COEP, IDBFS saves, touch UI.
  - Interpreter fallback that captures new code for offline recompilation.
  - No tests. No Safari or iPhone evidence.

**Transferable techniques:**

- Differential CPU testing against Unicorn.
- Capturing branch targets before the delay slot runs.
- Interpreter fallback that captures code.
- Replay and frame-hash testing.
- Browser shell patterns.

**Not transferable:** Allegrex FPU/VFPU, PSP kernel HLE, GE display lists, ATRAC3+ audio. PS1 R3000A load delay slots, the GTE, GPU/SPU/CD/MDEC and raw fixed-address overlays are not addressed by either project.

## 3. FF7 decompilation

- **[Xeeynamo/ff7-decomp](https://github.com/Xeeynamo/ff7-decomp)**
  - AGPL-3.0 (verified). HEAD `8fb1cc0e6605f0a43a2d2bf36dc5d7e7a58fccb5` (2026-11-02). First commit 2025-09-18.
  - **Targets USA only** (verified, `config/us.yaml`):
    - `SCUS_941.63` at 0x80010000;
    - battle `BATTLE.X`, `BROM.X`, `BATINI.X`, `BATRES.X`;
    - field `FIELD.BIN`, `DSCHANGE.X`, `ENDING.X`;
    - menus `BGINMENU`, `CNFGMENU`, `SAVEMENU`, `ITEMMENU`;
    - `WORLD.BIN`;
    - minigames `CHOCOBO`, `JET`, `CONDOR`, `HIGHWAY`;
    - about 13 `MAGIC/*.BIN` files.
  - Matching against SHA-1 per overlay in CI (claimed from CI config, not run).
  - Progress figure unconfirmed. An undated third-party mirror shows about 6.65%.
  - Experimental native "PsyZ" build reaches a partly working title screen; NEW GAME hangs (claimed, commit `94e1620`).
  - **The README forbids LLM-written decomp code and hostile forks.** This project uses it only as a reference for addresses and structure layouts, with attribution. It does not copy its code or contribute agent-written code to it.
- **[2ez4gcx/ff7-ps1-decomp](https://github.com/2ez4gcx/ff7-ps1-decomp)**: GPL-3.0, created 2026-10-22, HEAD `2039ea14eb6d6acd9b7d80a479db333656a2ee70`.
  - Claims byte-matching rebuilds of all 319 executables on three discs, and 82% of functions in C. Unverified.
  - Mostly agent-written; provenance relative to Xeeynamo's work unclear. **Not used.**
- **[Drahsid/ffvii](https://github.com/Drahsid/ffvii)**: dormant since 2021-11-27 (`432306639e67479cf9cb5ef52e10e395d156354e`).

### FF7 technical facts relevant here

- **Overlays share load addresses** (verified layout; addresses claimed by 2ez4gcx):
  - field, battle, world map and minigames at 0x800A0000;
  - menus at 0x801D0000;
  - magic and battle init/results at 0x801B0000.
  - Many overlays are gzip-packed.
  - **Implication:** "which mode is the game in" must be read from state, not from instruction addresses alone.
- **Field and battle AI are bytecode scripts**, which is data, not machine code. Self-modifying code is unknown.
- **Heavy GTE use.** MDEC movies. AKAO sequenced music on the SPU.
- **Regional variants:** about 6–7 distinct code sets (JP, JP International, USA, PAL in several languages). **Only USA is targeted.** Whether the Greatest Hits reprint is byte-identical to the original USA release is unknown, so the importer must hash and report the executable version.

## 4. Existing FF7 engines

- **[ficed/Braver](https://github.com/ficed/Braver)**: EPL-2.0. HEAD `6cff433479925def0a5f3811232db56798625c4b` (2023-12-04), dormant.
  - C# `net7.0-windows`, MonoGame WindowsDX, NAudio.
  - Consumes PC data.
  - "Early beta" (claimed).
- **[InigoValentin/V-Gears](https://github.com/InigoValentin/V-Gears)**: GPL-3.0, C++. HEAD `ac6bd06deff1285e313c2ec947bdb8f8a7aea463` (2026-07-02).
  - Self-described as heavily work-in-progress.
  - Latest commit adds ISO input.
- **[q-gears/q-gears](https://github.com/q-gears/q-gears)**: GPL-2.0. Last commit 2015. Dead.
- **[julianxhokaxhiu/FFNx](https://github.com/julianxhokaxhiu/FFNx)** (GPL-3.0) and **7th Heaven** (MS-PL) are PC-version hooking tools, useful only as references.

None plausibly reaches complete-game coverage in a browser on a reasonable timescale.

## 5. iPhone platform constraints

| Constraint | Status | Source |
|---|---|---|
| Wasm threads need COOP/COEP; supported since iOS 15.2 | Verified | [WebKit 15.2](https://webkit.org/blog/12140/new-webkit-features-in-safari-15-2/) |
| Wasm memory | No published limit; reports of ~300–500 MB reliable, more if reserved up front. Plan for ≤256 MB. | [WebKit 269777](https://bugs.webkit.org/show_bug.cgi?id=269777), [222097](https://bugs.webkit.org/show_bug.cgi?id=222097) |
| OPFS, including sync access handles | Supported since 15.2; not in Private Browsing. Use `<input type=file>` for import (no `showOpenFilePicker`). | WebKit |
| Storage eviction | Script-writable storage is cleared after 7 days of Safari use without visiting the site; home-screen apps are counted separately. Source is 2020-era, so re-check. **Saves must be exportable.** | [report](https://searchengineland.com/what-safaris-7-day-cap-on-script-writeable-storage-means-for-pwa-developers-332519) |
| Element fullscreen on iPhone | Unsupported (video only). Use a home-screen web app in standalone mode. | Apple forums / caniuse |
| Native runtime code generation | Not allowed for ordinary iOS apps. WebKit's Wasm compiler is allowed, including in an embedded `WKWebView`. | Platform policy |
| Gamepad API, AudioWorklet latency | Unknown; to be measured | — |

**Distribution:** web-first, as a Safari home-screen app. Optionally, the same build inside a thin native `WKWebView` shell built with Xcode for personal installs, which gives app-container saves, real fullscreen and haptics. App Store distribution is not a goal.

## 6. Semantic touch layer: feasibility notes

The emulator gives full control over presentation, but the game always runs underneath. Three presentation techniques, cheapest first:

1. **Crop and place.** The game's 320×240 output is a texture. In battle, the command window occupies the bottom of the frame, so crop it off and draw a native panel below.
2. **Cover.** When menu mode is detected, hide the picture and show a native screen built from party and inventory data in guest RAM. The real menu stays open, hidden.
3. **Suppress drawing.** Filter specific GPU primitives (windows, text) in the emulator's GPU layer, or apply RAM patches similar to cheat codes. This is only needed when part of the scene must stay visible.

**Input path:** native UI actions compile to pad-input sequences that the unmodified game consumes, replayed at high speed while hidden, then confirmed by reading memory. Direct memory writes are avoided by default because they risk corrupting game state and saves. Anything drawn inside the 3D scene (damage numbers, spell effects) remains the game's own.

## 7. Risks

1. iPhone performance of an interpreter-only Wasm core. Measured by Experiment 01.
2. HLE BIOS accuracy for FF7 (scene changes, CD streaming, movies).
3. Per-screen mapping cost of the touch layer, and the long tail of minigames. A virtual gamepad is always available as a fallback.
4. Save loss from browser eviction, mitigated by export/import and the home-screen app.
5. Verification gaps: an agent cannot test on a real iPhone (Playwright WebKit is not iOS Safari) and cannot use private game data. Both run on the owner's devices.
6. Legal: bring-your-own-files does not settle trademark or copyright questions. No game names or logos in public branding; no game data, screenshots or derived code in the repository.
