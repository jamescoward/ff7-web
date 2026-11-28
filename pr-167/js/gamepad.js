// The classic virtual gamepad: a PS1 pad laid out for touch.
//
// Multi-touch: every pointer holds at most one control, and a finger can
// slide from one button to another (or around the d-pad) without lifting.
// The d-pad is one control read by angle, so diagonals work. Every target is
// at least 44 px (CLAUDE.md); the CSS sets the sizes.
//
// It reports a pad mask through `onChange` and knows nothing else; the page
// sends the mask to the backend's setPad.

import { PAD } from './pad.js';

const DPAD_DEAD_ZONE = 0.2; // fraction of the d-pad radius

const LAYOUT = `
  <div class="vp-shoulder vp-shl">
    <button type="button" class="vp-btn vp-sh" data-btn="l2" aria-label="L2">L2</button>
    <button type="button" class="vp-btn vp-sh" data-btn="l1" aria-label="L1">L1</button>
  </div>
  <div class="vp-shoulder vp-shr">
    <button type="button" class="vp-btn vp-sh" data-btn="r2" aria-label="R2">R2</button>
    <button type="button" class="vp-btn vp-sh" data-btn="r1" aria-label="R1">R1</button>
  </div>
  <div class="vp-dpad" data-dpad aria-label="Directional pad" role="group">
    <span class="vp-arrow vp-up" data-dir="up"></span>
    <span class="vp-arrow vp-down" data-dir="down"></span>
    <span class="vp-arrow vp-left" data-dir="left"></span>
    <span class="vp-arrow vp-right" data-dir="right"></span>
  </div>
  <div class="vp-face" role="group" aria-label="Face buttons">
    <button type="button" class="vp-btn vp-round vp-triangle" data-btn="triangle" aria-label="Triangle">&#9651;</button>
    <button type="button" class="vp-btn vp-round vp-square" data-btn="square" aria-label="Square">&#9633;</button>
    <button type="button" class="vp-btn vp-round vp-circle" data-btn="circle" aria-label="Circle">&#9675;</button>
    <button type="button" class="vp-btn vp-round vp-cross" data-btn="cross" aria-label="Cross">&#10005;</button>
  </div>
  <div class="vp-center">
    <button type="button" class="vp-btn vp-pill" data-btn="select" aria-label="Select">SELECT</button>
    <button type="button" class="vp-btn vp-pill" data-btn="start" aria-label="Start">START</button>
  </div>`;

/** Directions for a point relative to the d-pad's centre, as a mask. */
export function dpadMask(dx, dy, radius) {
  const dist = Math.hypot(dx, dy);
  if (dist < radius * DPAD_DEAD_ZONE) return 0;
  // 8 sectors of 45 degrees; screen y grows downwards.
  const sector = Math.round(Math.atan2(-dy, dx) / (Math.PI / 4));
  switch ((sector + 8) % 8) {
    case 0: return PAD.right;
    case 1: return PAD.up | PAD.right;
    case 2: return PAD.up;
    case 3: return PAD.up | PAD.left;
    case 4: return PAD.left;
    case 5: return PAD.down | PAD.left;
    case 6: return PAD.down;
    default: return PAD.down | PAD.right;
  }
}

/**
 * Build the gamepad inside `root` and start listening.
 * @param {HTMLElement} root
 * @param {{ onChange: (mask: number) => void }} opts
 */
export function createVirtualGamepad(root, { onChange }) {
  const doc = root.ownerDocument;
  root.classList.add('vpad');
  root.innerHTML = LAYOUT;
  const dpad = root.querySelector('[data-dpad]');
  const pointers = new Map(); // pointerId -> mask
  let mask = 0;

  function controlAt(x, y) {
    const el = doc.elementFromPoint(x, y);
    if (!el || !root.contains(el)) return 0;
    const btn = el.closest('[data-btn]');
    if (btn) return PAD[btn.dataset.btn];
    if (el.closest('[data-dpad]')) {
      const r = dpad.getBoundingClientRect();
      return dpadMask(x - (r.left + r.width / 2), y - (r.top + r.height / 2), r.width / 2);
    }
    return 0;
  }

  function update() {
    let next = 0;
    for (const m of pointers.values()) next |= m;
    if (next === mask) return;
    mask = next;
    for (const el of root.querySelectorAll('[data-btn]')) {
      el.classList.toggle('vp-on', Boolean(mask & PAD[el.dataset.btn]));
    }
    for (const el of root.querySelectorAll('[data-dir]')) {
      el.classList.toggle('vp-on', Boolean(mask & PAD[el.dataset.dir]));
    }
    onChange(mask);
  }

  function down(e) {
    const m = controlAt(e.clientX, e.clientY);
    if (!m) return;
    e.preventDefault();
    // Capture so the finger keeps reporting moves after leaving the button.
    try {
      root.setPointerCapture(e.pointerId);
    } catch {
      // synthetic events in tests have no active pointer to capture
    }
    pointers.set(e.pointerId, m);
    update();
  }

  function move(e) {
    if (!pointers.has(e.pointerId)) return;
    e.preventDefault();
    pointers.set(e.pointerId, controlAt(e.clientX, e.clientY));
    update();
  }

  function up(e) {
    if (!pointers.delete(e.pointerId)) return;
    e.preventDefault();
    update();
  }

  const opts = { passive: false };
  root.addEventListener('pointerdown', down, opts);
  root.addEventListener('pointermove', move, opts);
  root.addEventListener('pointerup', up, opts);
  root.addEventListener('pointercancel', up, opts);
  root.addEventListener('lostpointercapture', up, opts);
  // No long-press menus, selection or double-tap zoom on the controls.
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    get mask() {
      return mask;
    },
    /** Release every control, e.g. when the page is hidden. */
    releaseAll() {
      pointers.clear();
      update();
    },
  };
}
