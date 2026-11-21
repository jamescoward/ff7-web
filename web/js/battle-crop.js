// Battle scene crop (#136), behind the Labs flag `battle-crop` (off by
// default). In a confirmed battle the picture shows only the battle scene: the
// fixed rectangle semantic/regions.js gives for battle (sceneRectFor), which
// leaves out the game's own command and status windows along the bottom. The
// freed height goes to the battle command panel (#116) and the status strip
// (#133), which already sit below the picture in portrait.
//
// Agent defaults (Trip mode rule 11, 2026-11-21; notes/136-battle-crop.md):
//   - it crops only while the `battle-panel` flag is on too, so the game's
//     command window is never hidden without the page's panel to replace it;
//   - portrait only: landscape phones have no free space for the panel (it is
//     hidden there, #116), so in landscape the full frame is shown.
// Everywhere else (any other mode, an unconfirmed battle, a failed read) the
// full frame is shown at once. DOM-free apart from the injected media query:
// the page passes frames in and draws the rectangle that comes back. It holds
// no pixel coordinates of its own; they are FF7 knowledge and live in
// semantic/regions.js.

import { ADDRESS_TABLE } from './semantic/addresses.js';
import { createSemantic } from './semantic/layer.js';
import { sceneRectFor } from './semantic/regions.js';

export const BATTLE_CROP_FLAG = 'battle-crop';
export const NEEDS_FLAG = 'battle-panel';
export const BATTLE_CROP_HZ = 4;
/** The page's compact landscape layout (web/css/app.css). */
export const LANDSCAPE_QUERY = '(orientation: landscape) and (max-height: 600px)';

export function createBattleCrop({
  labs,
  timers = globalThis,
  hz = BATTLE_CROP_HZ,
  semanticFor = createSemantic,
  landscape = null, // { matches, addEventListener('change') }, e.g. a MediaQueryList
  onChange = () => {},
}) {
  let gateActive = false;
  let backend = null;
  let source = null; // tests: async () => mode() sample
  let semantic = null;
  let handle = null;
  let busy = false;
  let sample = null; // the last good mode() sample; null = none, or the poll is off
  let lastActive = false;

  const flagOn = () => labs.isOn(BATTLE_CROP_FLAG);
  const shouldRun = () => flagOn() && (source !== null || (gateActive && backend !== null));
  const inBattle = () => sample?.value?.mode === 'battle' && sample.confirmed === true;
  const isActive = () => flagOn() && labs.isOn(NEEDS_FLAG) && !landscape?.matches && inBattle();

  // Tell the page whenever the answer to "crop now?" changes, so it redraws
  // the last frame (full or cropped) at once, even while paused.
  function update() {
    const now = isActive();
    if (now !== lastActive) {
      lastActive = now;
      onChange(now);
    }
  }

  const sampler = () => {
    if (source) return source;
    if (!gateActive || !backend) return null;
    semantic ??= semanticFor({
      backend: { readMem: (a, l) => backend.readMem(a, l), get frame() { return backend.frame; } },
      exeSha1: ADDRESS_TABLE.exe,
    });
    return () => semantic.mode();
  };

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
      sample = s?.value ? s : null;
      update();
    } finally {
      busy = false;
    }
  }

  function stop() {
    if (handle !== null) timers.clearInterval(handle);
    handle = null;
    sample = null;
    update();
  }
  function sync() {
    if (!shouldRun()) { stop(); return; }
    if (handle === null) {
      semantic?.clearMovieWindow?.();
      handle = timers.setInterval(tick, Math.round(1000 / hz));
      tick();
    }
    update();
  }

  labs.onChange((name) => {
    if (name === BATTLE_CROP_FLAG) sync();
    else if (name === NEEDS_FLAG) update();
  });
  landscape?.addEventListener?.('change', update);

  return {
    tick,
    /**
     * The rectangle to show for one posted frame ({ width, height, ... }),
     * { x, y, w, h } in frame pixels, or null for the full frame.
     */
    frame(f) {
      if (!isActive() || !f) return null;
      const r = sceneRectFor(sample.value.mode, sample.confirmed, f.width, f.height);
      if (!r || (r.x === 0 && r.y === 0 && r.w === f.width && r.h === f.height)) return null;
      return r;
    },
    /** True while the scene crop applies (both flags on, portrait, a confirmed battle). */
    get active() { return isActive(); },
    setGate(gate) {
      gateActive = Boolean(gate?.active);
      if (!gateActive) semantic = null;
      sync();
    },
    setBackend(b) { backend = b; sync(); },
    /** Tests: drive modes from `fn` instead of the semantic layer. The flags still apply. */
    setSource(fn) { source = fn; stop(); sync(); },
    stop,
    get running() { return handle !== null; },
  };
}
