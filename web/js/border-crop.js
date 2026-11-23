// Mode-gated picture crop (#24), behind the Labs flag `border-crop` (off by
// default). The generic detector (crop.js) runs on every posted frame, but only
// while the game is in a confirmed mode that semantic/regions.js allows (field
// and battle to start with), and only within that mode's limits. In a movie,
// the menu, an unknown or unconfirmed mode, or after a failed read, the page
// shows the full frame, at once.
//
// DOM-free: the page passes frames in and draws the rectangle that comes back.
// The mode comes from a 4 Hz mode() poll, the same rate and read-only view as
// auto-controls.js uses (its poll is tied to its own flag, so this one keeps
// its own).

import { ADDRESS_TABLE } from './semantic/addresses.js';
import { createSemantic } from './semantic/layer.js';
import { cropFor } from './semantic/regions.js';
import { createCropTracker } from './crop.js';
import { scaleInsets } from './hi-res.js';

export const CROP_FLAG = 'border-crop';
export const CROP_HZ = 4;

// scaleOf(f): output pixels per PS1 framebuffer pixel for a frame (2x internal
// resolution, #252); the insets in semantic/regions.js are in PS1 pixels.
export function createBorderCrop({ labs, timers = globalThis, hz = CROP_HZ, semanticFor = createSemantic, onChange = () => {}, scaleOf = () => 1 }) {
  let gateActive = false;
  let backend = null;
  let source = null; // tests: async () => mode() sample
  let semantic = null;
  let handle = null;
  let busy = false;
  let sample = null; // the last good mode() sample; null = none, or the poll is off
  let tracker = null;
  let trackerKey = '';

  const flagOn = () => labs.isOn(CROP_FLAG);
  const shouldRun = () => flagOn() && (source !== null || (gateActive && backend !== null));
  const modeOf = (s) => (s?.value && typeof s.value.mode === 'string' ? s.value.mode : 'unknown');
  const policyKey = (s) => (s ? `${modeOf(s)}${s.confirmed === true ? '' : '?'}` : '');

  const sampler = () => {
    if (source) return source;
    if (!gateActive || !backend) return null;
    semantic ??= semanticFor({
      backend: { readMem: (a, l) => backend.readMem(a, l), get frame() { return backend.frame; } },
      exeSha1: ADDRESS_TABLE.exe,
    });
    return () => semantic.mode();
  };

  function setSample(next) {
    const before = policyKey(sample);
    sample = next;
    if (policyKey(sample) !== before) {
      // A new mode starts from the full frame: no crop is carried across.
      tracker = null;
      trackerKey = '';
      onChange();
    }
  }

  async function tick() {
    if (busy || handle === null) return;
    busy = true;
    try {
      const read = sampler();
      if (!read) return;
      let s;
      try { s = await read(); } catch { s = null; }
      if (handle === null || !shouldRun()) return;
      // A failed read says nothing about the mode, so it must not keep a crop.
      setSample(s?.value ? s : null);
    } finally {
      busy = false;
    }
  }

  function stop() {
    if (handle !== null) timers.clearInterval(handle);
    handle = null;
    setSample(null);
  }
  function sync() {
    if (!shouldRun()) { stop(); return; }
    if (handle !== null) return;
    semantic?.clearMovieWindow?.();
    handle = timers.setInterval(tick, Math.round(1000 / hz));
    tick();
  }

  labs.onChange((name) => { if (name === CROP_FLAG) { sync(); onChange(); } });

  return {
    tick,
    /**
     * Take one posted frame ({ frame, width, height, buffer }) and return the
     * rectangle to show, { x, y, w, h } in frame pixels, or null for the full
     * frame (flag off, or a mode without a crop).
     */
    frame(f) {
      if (!flagOn() || !sample || !f?.buffer) return null;
      const s = scaleOf(f);
      const policy = cropFor(modeOf(sample), sample.confirmed, Math.floor(f.width / s), Math.floor(f.height / s));
      if (!policy) return null;
      const key = `${policyKey(sample)}:${f.width}x${f.height}`;
      if (!tracker || key !== trackerKey) {
        tracker = createCropTracker({ maxInsets: scaleInsets(policy.maxInsets, s) });
        trackerKey = key;
      }
      const r = tracker.update(new Uint32Array(f.buffer), f.width, f.height, f.frame);
      return r.x === 0 && r.y === 0 && r.w === f.width && r.h === f.height ? null : r;
    },
    /** True while a crop may be shown (flag on and an allowed, confirmed mode). */
    get allowed() {
      return flagOn() && sample !== null && cropFor(modeOf(sample), sample.confirmed, 320, 240) !== null;
    },
    setGate(gate) {
      gateActive = Boolean(gate?.active);
      if (!gateActive) semantic = null;
      sync();
    },
    setBackend(b) { backend = b; sync(); },
    /** Tests: drive modes from `fn` instead of the semantic layer. The flag still applies. */
    setSource(fn) { source = fn; stop(); sync(); },
    stop,
    get running() { return handle !== null; },
  };
}
