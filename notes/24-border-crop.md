# #24: automatic picture crop (reclaim black borders)

> **Attempt 2 (2026-11-19, PR for branch `issue-24-mode-gated-crop`): mode-gated crop.** Sections 1–4 below are attempt 1 (PR #72, closed unmerged, parked by the owner on 2026-11-05). What changed is in section 0. Where section 0 disagrees with sections 2–3, section 0 wins.

## 0. Attempt 2: the mode gate

**Why:** a pixel-only crop can't tell borders from scenes where black is the picture (text on black, a dialogue box on black). Now that `mode()` is reliable (#81), the crop runs only in modes where that risk is small.

- **`semantic/regions.js`** (platform-neutral, copied to `web/js/semantic/`) holds `CROP_REGIONS`, one row per `mode()` label. A row is either `null` or `{ detect: true, maxInsets }`, with `maxInsets` in PS1 framebuffer pixels. It also holds `cropFor(mode, confirmed, w, h)`. Only `confirmed === true` field and battle crop. Insets are capped at 25 % of the frame.
  - **Agent default** (Trip mode rule 11): field may lose up to 48 px top/bottom and 64 px left/right; battle up to 16 px top/bottom and nothing at the sides. This is a **hypothesis, not measured on the disc**. Tier 3, or a later Tier 2 probe returning only the rectangle, would check it.
- **`web/js/crop.js`** is PR #72's generic detector, unchanged except for the new `maxInsets` option. It holds no FF7 facts.
- **`web/js/border-crop.js`** polls `mode()` at 4 Hz, using the same read-only view as `auto-controls.js`. It has its own poll, because auto-controls' poll runs only under its own flag. The detector runs on every posted frame, but only while the mode is allowed. When the mode changes, the tracker is dropped and the page redraws the last frame in full straight away, even while paused. Re-entering an allowed mode starts again from the full frame and needs ~1 s to narrow.
  - **Known gap:** the poll is 4 Hz. For up to 250 ms after a switch into the menu (or a movie), the old crop can still apply. "Widen at once" still holds in that window, so any lit pixel outside the crop widens it on that frame.
- **The detector runs in the page, not the worker** (a change from PR #72). The worker, renderer and input path are untouched. With the flag off, nothing runs and the draw path is the same as on main.
- **Display:** `main.js` draws only the crop and sets `--screen-aspect` on `.stage`. `<html data-border-crop-on>` caps the landscape width, as in PR #72. With the flag off, neither is set, and the CSS falls back to `4 / 3`.
- **Toggle:** the Labs flag replaces PR #72's top-bar Crop button.

### Tests (attempt 2)
- `runner/test/unit/semantic-regions.test.js`: every mode label × confirmed/unconfirmed (6 values) × 7 display sizes; labels outside the table; bad sizes; caps; the table is frozen.
- `web/test/crop-unit.test.js` (PR #72's 15 cases, plus one for `maxInsets`).
- `web/test/border-crop-browser.test.js` (iPhone 14 Pro profile, stubbed backend with synthetic frames, fake `mode()` source):
  - flag off: no poll, full frame, 4:3;
  - field: full frame, then the box after ~1 s; widening is immediate;
  - battle: the limits apply;
  - menu, movie, world, unknown, unconfirmed field and a failed read: the full frame at once, then the crop again on return to the field;
  - switching the flag off: the full frame at once;
  - portrait letterbox: same width, shorter box;
  - landscape: stays in the viewport.
- `web/test/iphone-profile.test.js` picks the new flag up automatically, so the layout checks run with it on.
- **Not ported:** the `border-box` real-core fixture test. With the mode gate a homebrew has no FF7 mode (the hash gate is closed), so it would test only the stub path. The synthetic-frame browser tests cover the display path. Follow-up issue if wanted.

## 1. The core's own options (source survey, pinned commit `7b0e8f8`)

I read `frontend/libretro_core_options.h`, `frontend/libretro.c`, `plugins/gpulib/gpu.c` (`update_width`, `update_height`) and `plugins/gpulib/vout_pl.c` (`check_mode_change`).

| Option | What it does | Use for #24? |
|---|---|---|
| `pcsx_rearmed_screen_centering` = `auto` (default) | Re-centres a slightly miscentred display window. The output frame is always `hres × vres` (for example 320×240), with the unused part black (`vout_flip` memsets it). | Keep. |
| `… = borderless` | Vertical only: `y = 0`, and the output height becomes the displayed height (`screen.h`), not 240. Horizontal padding is unchanged. | No: see below. |
| `… = manual` + `_x`, `_y`, `_h_adj` | Fixed offsets, set per game by hand. | No. |
| `pcsx_rearmed_show_overscan` | Shows *more* horizontally (`auto`, `hack`), not less. | No. |

**Conclusion (source reading, not measured on the disc):** no core option removes black that the game itself draws into VRAM, such as letterbox bars or a small room on black. `borderless` removes only the vertical display-range padding. That padding is plain black, so the pixel detector removes it anyway. Changing a core default would also change frame sizes for every program, and Tier 2 boots use the defaults. So the core options stay at their defaults, and `core/web/` is untouched.

## 2. Design

- `web/js/crop.js`: pure functions, unit-tested in Node.
  - `contentBounds(px, w, h)` gives the content box as insets, the content fraction, and the mean brightness on a 4 px grid.
  - `createCropTracker()` applies the stability rules.
  - `cropAspect()` gives the display aspect.
- `web/js/emu-worker.js` runs the tracker on **every posted frame**, not every few frames, and sends `crop: {x, y, w, h}` with the frame. The cost is an edge scan plus a 4,800-point grid per frame, which is small next to the RGBA conversion. Running every frame is what makes "widen at once" exact: the crop is computed from the same pixels it is shown with.
- `web/bench/bench-worker.js` runs it too, so the benchmark measures the app's per-frame work (its header asks for this).
- `web/js/main.js` draws only the crop (`putImageData` with a dirty rectangle, moved to the origin). It sets `--screen-aspect` on `.stage` to `cropAspect`, which is the crop's share of 4:3, so the pixel aspect ratio is kept for 256/320/368/512/640-wide modes.
- Toggle: the `#crop-btn` button ("Crop on"/"Crop off", `aria-pressed`). It is on by default. The choice is remembered in `localStorage` (`ff7web.crop`), wrapped in try/catch, and the page still works without it. Toggling redraws the last frame at once, even while paused.

### Rules (`CROP_DEFAULTS`)

| Rule | Value | Why |
|---|---|---|
| Black | every channel ≤ 16 (15-bit levels 0–2 of 31) | Bars are exactly 0; levels 1–2 are invisible on a phone. |
| Content row or column | ≥ 2 content pixels | One stray pixel doesn't hold a border open. |
| Widen | at once, on any frame, whatever its brightness | Real content is never cut off. |
| Narrow | only to the widest box over the last 60 frames (~1 s), and only if every frame in that run was usable | Stable for 1 s; flicker in a border keeps it open. |
| Usable frame | has content, ≥ 10 % content pixels, brightness within 15 % of the run | A dark scene doesn't shrink to its lamp. A fade restarts the run, so the edges going dark first never narrow it. A black frame (loading) restarts it. |
| Symmetric | opposite insets within 8 px become the smaller of the two | Centred content stays centred. |
| Cap | ≤ 25 % of the frame from any side | Bounds the damage of any misdetection. |
| Hysteresis | narrowing steps < 4 px are not applied | No 1–2 px size jitter. |
| New frame size | start again from the full frame | Mode switches (for example movies) can't inherit a crop. |

### Layout

- **Portrait:** the picture is width-limited. Cropping side borders makes it larger. Cropping top and bottom bars makes the box shorter at the same scale, and the freed height goes to the controls below.
- **Landscape:** the picture is height-limited. It may grow wider than 4:3 only into space the side controls don't need: `max(133dvh, 100vw − 2 × (dpad + gap))`. On an 844×390 phone this is still 520 px, so in landscape a letterbox crop **does not** enlarge the picture there. Letting it run under the translucent controls is the owner's call (Tier 3 question).

## 3. Tests

- `web/test/crop-unit.test.js` (Node): fixed borders (narrows exactly at frame 60, not before); full-screen content (no crop); content at an edge (widens on the same frame); edge flicker (no pumping, 600 frames); fade out, black and fade in on a gradient (crop holds, nothing cut); dark scene with a bright object (stays full); black gap restarts the run; symmetry; the 25 % cap; hysteresis; a frame-size change; the aspect formula.
- `harness/fixtures/border-box.js`: an original homebrew built at test time. It shows black (VBLANK 0–29), then a box with insets 24/32/24/32 (30–239), then a wider box with insets 8/0/8/0 (240 on). `runner/synth/mips.js` gained `sltiu`.
- `web/test/crop-browser.test.js` (Chromium, WebKit, with the real core):
  - every frame message is checked in the page: no lit pixel lies outside its crop, ever;
  - black frames get the full frame;
  - the first box is cropped 60–68 frames after it appears, with the full frame until then;
  - the wider box is shown in full from its first frame;
  - the canvas is 320×224, and the screen box has the crop's aspect;
  - the toggle shows 320×240 at once, even while paused, and survives a reload.
- **Mutation check:** with the "widen at once" line removed, 1 browser test and 2 unit tests fail. With it restored, all pass.

## 4. Open questions and hypotheses

- **Hypothesis:** the thresholds (black ≤ 16, 10 % content, 15 % brightness) suit FF7's field, battle, menu and movies. They are tuned on synthetic frames only. Tier 3 is the check; a Tier 2 probe could later measure the crop on the disc, returning only the rectangle.
- If a dark field scene with letterbox bars has less than 10 % content pixels, it is never cropped. This is safe, and only costs space.
- Landscape growth: see Layout.
