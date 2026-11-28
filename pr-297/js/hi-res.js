// 2x internal resolution (#252), behind the Labs flag `hi-res` (off by default).
// Original project code, GPL-2.0-or-later.
//
// The core's GPU (gpu_neon's psx_gpu) has an enhancement mode upstream exposes
// as libretro core options. The page passes them to the worker before the core
// loads a program; core/web/frontend.c answers GET_VARIABLE from that table and
// reports no variable updates, so the core reads them once, at load. The flag
// therefore takes effect at the next page load, never live. With the flag off
// no option is added, so the core is started exactly as before.
//
// Upstream (frontend/libretro_core_options.h and plugins/gpulib/vout_pl.c at
// the pinned commit): enhancement is active only for display modes up to
// 512x256 that are not 24-bit, and then the core outputs 2x width and 2x
// height. Other modes (480i, 640 wide, 24-bit movies) come out at native size.
//
// The core does not report the native mode size, so the page infers the
// scale from the frame (agent default, notes/252-hi-res.md): with hi-res
// active, a frame taller than 256 lines is taken as 2x. A native interlaced
// mode (480 or 512 lines) would be taken as 2x as well. That only affects
// border-crop insets, which then scale with the picture's height, as they
// would need to for any 480-line picture.

export const HIRES_FLAG = 'hi-res';

/** Core options the flag adds (names and values checked at the pinned commit). */
export const HIRES_CORE_OPTIONS = Object.freeze({
  pcsx_rearmed_neon_enhancement_enable: 'enabled',
  // The speed hack stays off: upstream says it reduces compatibility.
  pcsx_rearmed_neon_enhancement_no_main: 'disabled',
  // Upstream's default; named so the choice is explicit.
  pcsx_rearmed_neon_enhancement_tex_adj_v2: 'enabled',
});

/** Highest native line count enhancement applies to (vout_pl.c). */
export const MAX_ENHANCED_SOURCE_HEIGHT = 256;

/** Extra core options for this page load: {} with the flag off. */
export function hiResCoreOptions(on) {
  return on ? { ...HIRES_CORE_OPTIONS } : {};
}

/**
 * Output pixels per PS1 framebuffer pixel for one posted frame: 1, or 2 when
 * hi-res is active for this load and the frame is taller than a native
 * non-interlaced mode.
 *
 * @param {{width:number,height:number}} f  a posted frame
 * @param {boolean} active  hi-res was on when the core started
 */
export function frameScale(f, active) {
  if (!active || !f || !Number.isInteger(f.height)) return 1;
  return f.height > MAX_ENHANCED_SOURCE_HEIGHT ? 2 : 1;
}

/** Insets ({ top, right, bottom, left }) times s, integers. */
export function scaleInsets(insets, s) {
  if (s === 1 || !insets) return insets;
  return {
    top: insets.top * s,
    right: insets.right * s,
    bottom: insets.bottom * s,
    left: insets.left * s,
  };
}
