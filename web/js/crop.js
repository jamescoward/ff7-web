// Automatic picture crop (issue #24): find the non-black part of the frame
// and pick a stable crop rectangle that reclaims black borders.
// Original project code, GPL-2.0-or-later. Pure functions on RGBA pixels;
// it reads only the current frame and stores nothing but the rectangle.
//
// Rules (notes/24-border-crop.md):
//   - a row or column is content when at least MIN_PIXELS of its pixels have
//     a channel above BLACK_MAX;
//   - widen at once: any content outside the crop widens it on the same frame,
//     so real content is never cut off, even in dark or fading frames;
//   - narrow slowly: only to the widest box seen over the last STABLE_FRAMES,
//     and only when every frame in that window was a usable sample: some
//     content, not mostly black, and steady brightness (no fade);
//   - keep the crop symmetric when the content is nearly centred;
//   - never crop more than MAX_SIDE of the frame from any side.

export const CROP_DEFAULTS = Object.freeze({
  blackMax: 16, // channel values 0..16 count as black (15-bit levels 0-2 of 31)
  minPixels: 2, // content pixels a row or column needs to count as content
  stableFrames: 60, // narrowing needs this many frames (~1 s) of agreement
  minFraction: 0.1, // frames with less content than this are not evidence for narrowing
  levelTolerance: 0.15, // brightness may vary this much (relative) in the window
  symmetricTolerance: 8, // px: opposite insets closer than this are made equal
  maxSide: 0.25, // never crop more than this fraction of the frame from one side
  minStep: 4, // px: smaller narrowing steps are not applied (no 1 px size jitter)
  sampleStep: 4, // grid step for the content fraction and brightness level
});

const isContent = (p, t) => (p & 0xff) > t || ((p >>> 8) & 0xff) > t || ((p >>> 16) & 0xff) > t;

function rowHasContent(px, w, y, x0, x1, t, need) {
  let n = 0;
  for (let i = y * w + x0, end = y * w + x1; i < end; i++) {
    if (isContent(px[i], t) && ++n >= need) return true;
  }
  return false;
}

function colHasContent(px, w, x, y0, y1, t, need) {
  let n = 0;
  for (let i = y0 * w + x, end = y1 * w + x; i < end; i += w) {
    if (isContent(px[i], t) && ++n >= need) return true;
  }
  return false;
}

/**
 * The content box of one frame as insets from each edge, with the share of
 * content pixels and the mean brightness on a sampling grid.
 *
 * @param {Uint32Array} px  RGBA pixels, little-endian (0xAABBGGRR), w*h
 * @returns {{top,right,bottom,left,fraction,level}|null}  null: no content
 */
export function contentBounds(px, w, h, opts = {}) {
  const { blackMax: t, minPixels: need, sampleStep: step } = { ...CROP_DEFAULTS, ...opts };
  let top = 0;
  while (top < h && !rowHasContent(px, w, top, 0, w, t, need)) top++;
  if (top === h) return null;
  let bottom = h - 1;
  while (bottom > top && !rowHasContent(px, w, bottom, 0, w, t, need)) bottom--;
  let left = 0;
  while (left < w && !colHasContent(px, w, left, top, bottom + 1, t, need)) left++;
  if (left === w) return null; // content rows, but too sparse in every column
  let right = w - 1;
  while (right > left && !colHasContent(px, w, right, top, bottom + 1, t, need)) right--;

  let samples = 0;
  let hits = 0;
  let sum = 0;
  for (let y = step >> 1; y < h; y += step) {
    for (let x = step >> 1; x < w; x += step) {
      const p = px[y * w + x];
      const r = p & 0xff;
      const g = (p >>> 8) & 0xff;
      const b = (p >>> 16) & 0xff;
      samples++;
      sum += Math.max(r, g, b);
      if (r > t || g > t || b > t) hits++;
    }
  }
  return {
    top,
    right: w - 1 - right,
    bottom: h - 1 - bottom,
    left,
    fraction: samples ? hits / samples : 0,
    level: samples ? sum / samples : 0,
  };
}

const SIDES = ['top', 'right', 'bottom', 'left'];
const zero = () => ({ top: 0, right: 0, bottom: 0, left: 0 });

/** Make nearly centred content symmetric, and cap each side. */
function shape(b, w, h, o) {
  const s = { top: b.top, right: b.right, bottom: b.bottom, left: b.left };
  if (Math.abs(s.top - s.bottom) <= o.symmetricTolerance) s.top = s.bottom = Math.min(s.top, s.bottom);
  if (Math.abs(s.left - s.right) <= o.symmetricTolerance) s.left = s.right = Math.min(s.left, s.right);
  const capY = Math.floor(h * o.maxSide);
  const capX = Math.floor(w * o.maxSide);
  s.top = Math.min(s.top, capY);
  s.bottom = Math.min(s.bottom, capY);
  s.left = Math.min(s.left, capX);
  s.right = Math.min(s.right, capX);
  return s;
}

/**
 * Track the crop over a stream of frames.
 *
 * update(px, w, h, frame) takes each frame (frame: a frame counter that
 * only goes up) and returns the crop to show for it as { x, y, w, h }.
 */
export function createCropTracker(opts = {}) {
  const o = { ...CROP_DEFAULTS, ...opts };
  let fw = 0;
  let fh = 0;
  let applied = zero();
  let window = []; // { frame, insets, level } usable samples, oldest first
  let windowStart = -1; // frame of the first sample in the current run

  const rect = () => ({
    x: applied.left,
    y: applied.top,
    w: fw - applied.left - applied.right,
    h: fh - applied.top - applied.bottom,
  });
  const breakRun = () => {
    window = [];
    windowStart = -1;
  };

  return {
    update(px, w, h, frame) {
      if (w !== fw || h !== fh) {
        fw = w;
        fh = h;
        applied = zero();
        breakRun();
      }
      const b = contentBounds(px, w, h, o);
      if (!b) {
        breakRun(); // black frame: a fade or loading, no evidence either way
        return rect();
      }
      // Widen at once wherever content shows outside the crop.
      for (const s of SIDES) applied[s] = Math.min(applied[s], b[s]);

      if (b.fraction < o.minFraction) {
        breakRun(); // mostly black: a dark scene must not shrink to its bright spot
        return rect();
      }
      const levels = window.map((x) => x.level).concat(b.level);
      const hi = Math.max(...levels);
      const lo = Math.min(...levels);
      if (hi > 0 && (hi - lo) / hi > o.levelTolerance) breakRun(); // a fade: start over
      if (windowStart < 0) windowStart = frame;
      window.push({ frame, insets: shape(b, w, h, o), level: b.level });
      while (window.length && window[0].frame <= frame - o.stableFrames) window.shift();

      if (frame - windowStart >= o.stableFrames) {
        // The widest box over the window: content seen anywhere in the last
        // second keeps its edge.
        const target = {};
        for (const s of SIDES) target[s] = Math.min(...window.map((x) => x.insets[s]));
        for (const s of SIDES) {
          if (target[s] - applied[s] >= o.minStep) applied[s] = target[s];
        }
      }
      return rect();
    },
    get rect() {
      return rect();
    },
    reset() {
      fw = 0;
      fh = 0;
      applied = zero();
      breakRun();
    },
  };
}

/**
 * Display aspect ratio of a crop of a w*h frame. The whole frame is shown at
 * 4:3 whatever its pixel size (320, 368, 512 or 640 wide), so a crop keeps
 * the pixel aspect ratio by taking its share of that 4:3.
 */
export function cropAspect(crop, w, h) {
  return (4 / 3) * (crop.w / w) / (crop.h / h);
}
