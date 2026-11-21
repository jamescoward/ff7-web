// Picture crop regions (#24): in which game modes the page may crop black
// borders from the picture, and how far. Plain data plus a pure function;
// platform-neutral (no DOM, Worker, Node or timers).
// Original project code, GPL-2.0-or-later.
//
// The pixel detector itself (web/js/crop.js) is generic image code with no FF7
// facts. This module decides when it may run: only in a confirmed mode listed
// here. Everywhere else (movie, menu, unknown, an unconfirmed mode, a failed
// read) the full frame is shown, so FF7's black-is-content scenes (text on
// black, a dialogue box on black) can only meet the detector inside an
// allowed mode.
//
// Values are an agent default (Trip mode rule 11, 2026-11-19), not measured on
// the disc: field and battle only, to start with. `world` and `minigame` stay
// null until checked. Every value is reversible behind the Labs flag
// `border-crop`.

/** The mode() labels this table covers (semantic/layer.js, mode()). */
export const MODE_LABELS = Object.freeze(['field', 'battle', 'world', 'menu', 'minigame', 'movie', 'unknown']);

/**
 * Per mode: null (no crop) or { detect: true, maxInsets }.
 * maxInsets: the most the detector may remove from each side, in PS1
 * framebuffer pixels. The crop always keeps the rectangle inside these
 * insets, whatever the detector finds. Hypothesis, not measured on the disc:
 * field rooms smaller than the screen can have black on every side; a battle
 * fills the width, so only top and bottom padding may go.
 */
export const CROP_REGIONS = Object.freeze({
  field: Object.freeze({ detect: true, maxInsets: Object.freeze({ top: 48, right: 64, bottom: 48, left: 64 }) }),
  battle: Object.freeze({ detect: true, maxInsets: Object.freeze({ top: 16, right: 0, bottom: 16, left: 0 }) }),
  world: null,
  menu: null,
  minigame: null,
  movie: null,
  unknown: null,
});

/** No side may lose more than this share of the frame, whatever the table says. */
export const MAX_SIDE_SHARE = 0.25;

/**
 * The crop policy for one moment: null (show the full frame) or
 * { detect: true, maxInsets } with insets in framebuffer pixels, capped to
 * MAX_SIDE_SHARE of this frame's size.
 *
 * @param {string} mode       mode()'s label
 * @param {boolean} confirmed mode()'s `confirmed`; only `true` allows a crop
 * @param {number} displayWidth  framebuffer width of the frame shown
 * @param {number} displayHeight framebuffer height of the frame shown
 */
export function cropFor(mode, confirmed, displayWidth, displayHeight) {
  if (confirmed !== true) return null;
  if (!Object.hasOwn(CROP_REGIONS, mode)) return null;
  const region = CROP_REGIONS[mode];
  if (!region) return null;
  const w = Number.isInteger(displayWidth) && displayWidth > 0 ? displayWidth : 0;
  const h = Number.isInteger(displayHeight) && displayHeight > 0 ? displayHeight : 0;
  if (!w || !h) return null;
  const capX = Math.floor(w * MAX_SIDE_SHARE);
  const capY = Math.floor(h * MAX_SIDE_SHARE);
  const m = region.maxInsets;
  return {
    detect: true,
    maxInsets: {
      top: Math.min(m.top, capY),
      right: Math.min(m.right, capX),
      bottom: Math.min(m.bottom, capY),
      left: Math.min(m.left, capX),
    },
  };
}

// Battle scene crop (#136, Labs flag `battle-crop`): in a confirmed battle the
// picture may show only the battle scene, leaving out the game's own command
// and status windows along the bottom, so the page's command panel (#116) and
// status strip (#133) take their place.
//
// The rectangle is in PS1 framebuffer pixels of the reference frame
// (SCENE_REF), and scales with the frame shown. Agent default (Trip mode rule
// 11, 2026-11-21), a hypothesis NOT measured on the disc: the bottom windows
// are taken to start no higher than row 160 of a 320x240 frame, so the crop
// keeps rows 0-159 at full width. If the windows start lower, part of the
// scene is lost; if higher, part of a window shows. Tier 3 checks it.
/** The frame size the scene rectangles are written for. */
export const SCENE_REF = Object.freeze({ width: 320, height: 240 });

/** Per mode: null (show the full frame) or { x, y, w, h } in SCENE_REF pixels. */
export const SCENE_REGIONS = Object.freeze({
  field: null,
  battle: Object.freeze({ x: 0, y: 0, w: 320, h: 160 }),
  world: null,
  menu: null,
  minigame: null,
  movie: null,
  unknown: null,
});

/** A scene crop never keeps less than this share of the frame's height or width. */
export const MIN_SCENE_SHARE = 0.5;

/**
 * The fixed scene rectangle for one moment: null (the full frame) or
 * { x, y, w, h } in the shown frame's pixels, integers inside the frame.
 *
 * @param {string} mode       mode()'s label
 * @param {boolean} confirmed mode()'s `confirmed`; only `true` allows a crop
 * @param {number} displayWidth  framebuffer width of the frame shown
 * @param {number} displayHeight framebuffer height of the frame shown
 */
export function sceneRectFor(mode, confirmed, displayWidth, displayHeight) {
  if (confirmed !== true) return null;
  if (!Object.hasOwn(SCENE_REGIONS, mode)) return null;
  const r = SCENE_REGIONS[mode];
  if (!r) return null;
  const W = displayWidth;
  const H = displayHeight;
  if (!Number.isInteger(W) || !Number.isInteger(H) || W <= 0 || H <= 0) return null;
  const sx = W / SCENE_REF.width;
  const sy = H / SCENE_REF.height;
  const x = Math.round(r.x * sx);
  const y = Math.round(r.y * sy);
  const w = Math.min(W - x, Math.round(r.w * sx));
  const h = Math.min(H - y, Math.round(r.h * sy));
  if (w < W * MIN_SCENE_SHARE || h < H * MIN_SCENE_SHARE) return null;
  return { x, y, w, h };
}
