# #252: 2× internal resolution (Labs flag `hi-res`)

## What it does
With the Labs flag `hi-res` on **when the page loads**, `web/js/main.js` passes
three extra core options to the worker (`web/js/hi-res.js`,
`HIRES_CORE_OPTIONS`):

| Option | Value | Why |
|---|---|---|
| `pcsx_rearmed_neon_enhancement_enable` | `enabled` | gpu_neon's 2× mode |
| `pcsx_rearmed_neon_enhancement_no_main` | `disabled` | upstream: the speed hack "reduces compatibility" |
| `pcsx_rearmed_neon_enhancement_tex_adj_v2` | `enabled` | upstream's default, made explicit |

The names and values were checked in `frontend/libretro.c` and
`frontend/libretro_core_options.h` at the pinned commit `7b0e8f8f`.

With the flag off, no option is added: `coreOptions` is `{}` (the test checks
this), so the core starts exactly as on main.

**No core change.** `core/web/frontend.c` already has `fe_set_option` and
answers `GET_VARIABLE` from its table. The worker already set options from
`init({ options })`, and `core/build.sh`, `core/web/link.sh` and the Wasm
binary are unchanged.

## When it takes effect
At the next page load. The frontend reports `GET_VARIABLE_UPDATE` = false, so
the core reads its options once, when it starts. The page reads the flag once
(`hiResActive`), and toggling it later shows "2x resolution changes when the
page is reloaded." The Labs description says the same.

## When the core enhances (source claim, upstream `plugins/gpulib/vout_pl.c`)
The core enhances only display modes up to 512×256 that are not 24-bit, and
then outputs 2× width and 2× height. Other modes come out at native size:
interlaced 480/512-line modes, 640-wide modes and 24-bit (movie) modes. So
with the flag on, frame sizes can change between modes.

## Scale rule (agent default, Trip mode rule 11)
The core does not report the native mode size: `retro_get_system_av_info` gives
the output size. So `frameScale(f, active)` infers it. With hi-res active, a
frame taller than 256 lines counts as 2×.

**Known limit:** a native interlaced mode would count as 2× too. That only
matters for the border crop (below), where it makes the insets scale with the
picture's height. That is arguably right for any 480-line picture anyway.
Whether FF7 shows an interlaced mode in field or battle is not measured.
Exposing the native size would need a frontend accessor beyond the option
table, which is outside this issue's allowed paths.

## Regions in PS1 pixels
- **Border crop (#24):** `cropFor()`'s `maxInsets` are PS1 pixels. Under the
  flag, `border-crop.js` asks `cropFor` for the native size and multiplies the
  insets by the scale. The option `scaleOf` defaults to `() => 1`, so the path
  without the flag is unchanged. Tested: content inset 80/100 output pixels in
  a 640×480 field frame is shown in full with the flag on. Without it, the same
  frame keeps today's unscaled 48/64 limits.
- **Battle crop (#136):** `sceneRectFor()` already scales from `SCENE_REF`
  (320×240) to the frame size. Tested: rows 0–319 of a 640×480 battle frame.
- **CRT filter (#251):** one scanline per output line at 2× (the canvas is
  1280×960 then), as #251 allows. Its cost at that size was not measured.
- **Interact label:** it is placed in the field controls, not on the picture,
  so there is nothing to scale.
- `semantic/` is unchanged; regions stay in PS1 pixels there.

## Measurements (Tier 1, headless Chromium in the agent container; not device claims)
Homebrew `runner/synth/vblank-counter.js` (320×240 15-bit mode):

| | flag off | flag on |
|---|---|---|
| frame size | 320×240 | **640×480** |
| Wasm heap (high-water) | 64 MiB | 64 MiB (initial size; no growth) |
| core fps at 1× | 59.9 | 59.9 |
| core fps at 2× speed | 116–118 | 109–112 |

The heap is the worker's `HEAPU8.buffer.byteLength`, now posted with each
frame as `heapBytes` (a Wasm heap only grows, so this is its high-water mark).
The 8 MiB enhancement buffer fits inside the initial 64 MiB.

The test program is a solid fill with no 3D, so these numbers say nothing
about FF7's 3D cost on an interpreter-only CPU. That is Tier 3.

## Save states
- With the flag on, a state saved and loaded back restores RAM (the program's
  counter), and frames stay 640×480.
- A state saved on a page with the flag off loads on a page with the flag on,
  and frames are 640×480 after it.
- Not run: a state from a flag-on page loaded with the flag off. It is the same
  state format, so it is expected to work.

## Tier 3 checklist (#123)
1. Field and battle: are 3D models sharper, and do they still line up with the 2D backgrounds?
2. Does the game run at full speed at 1× (and 2× with the Speed flag), or does it stutter or step down?
3. Play for 10 minutes (field, battle, menu, a movie): no crash or freeze?
4. Suspend and resume (Suspend flag) with 2× on: does Resume land in the same place?
5. Turn it off and reload: is the picture as before?
