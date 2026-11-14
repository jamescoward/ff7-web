// Automatic controls (#113): behind the Labs flag `auto-controls`, the page
// shows drag-to-walk in the field and the classic pad everywhere else, when the
// game's mode changes. The Controls button still overrides until the next
// change. DOM-free: it talks to `controls.setAuto` and polls a semantic layer.
//
// Only a confirmed field mode gives drag-to-walk. Battle, menu, world map,
// minigame, movie, unknown and unconfirmed modes all get the classic pad.
// With the semantic gate closed (not the USA disc) nothing switches.
//
// #134: with the Labs flag `world-drag` also on, a confirmed world map gets
// drag-to-walk too, with the same stick vectors as the field (field-drag.js):
// #140 showed Down+Left moves the player on the world map. World-map buttons
// the field controls lack stay on the classic pad, through the Controls button.

import { ADDRESS_TABLE } from './semantic/addresses.js';
import { createSemantic } from './semantic/layer.js';

export const AUTO_FLAG = 'auto-controls';
export const WORLD_DRAG_FLAG = 'world-drag';
export const AUTO_HZ = 4; // one mode() call is one movie-window sample: keep it steady

/**
 * UI policy over a mode() result: 'field' or 'gamepad'. `worldDrag` (#134)
 * adds the confirmed world map to the modes that get drag-to-walk.
 */
export function controlsForMode(sample, { worldDrag = false } = {}) {
  if (sample?.confirmed !== true) return 'gamepad';
  const m = sample.value?.mode;
  return m === 'field' || (worldDrag && m === 'world') ? 'field' : 'gamepad';
}

// The mode as the page sees it: changes of this string are what switch controls.
const modeKey = (sample) => {
  const m = sample?.value?.mode;
  const base = typeof m === 'string' ? m : 'unknown';
  return sample?.value && sample.confirmed !== true ? `${base}?` : base;
};

export function createAutoControls({ controls, labs, timers = globalThis, hz = AUTO_HZ, semanticFor = createSemantic }) {
  let gateActive = false;
  let backend = null;
  let source = null; // test source: async () => mode() sample
  let semantic = null;
  let handle = null;
  let busy = false;
  let last = null; // mode key of the last sample, null = none yet

  const flagOn = () => labs.isOn(AUTO_FLAG);
  const sampler = () => {
    if (source) return source;
    if (!gateActive || !backend) return null;
    // Read-only view: readMem plus the last frame the worker posted, so mode()'s
    // movie window counts game frames, whatever the polling rate (#146, #181).
    semantic ??= semanticFor({
      backend: { readMem: (a, l) => backend.readMem(a, l), get frame() { return backend.frame; } },
      exeSha1: ADDRESS_TABLE.exe,
    });
    return () => semantic.mode();
  };
  const shouldRun = () => flagOn() && gateActive && (source !== null || backend !== null);

  async function tick() {
    if (busy || handle === null) return;
    busy = true;
    try {
      const read = sampler();
      if (!read) return;
      let sample;
      try { sample = await read(); } catch { sample = null; }
      // Stopped, or the flag/gate changed, while the read was in flight.
      if (handle === null || !shouldRun()) return;
      // A failed read says nothing about the mode: keep the controls (and any
      // manual override) as they are rather than treat it as a change.
      if (!sample?.value) return;
      const key = modeKey(sample);
      if (key === last) return;
      last = key;
      controls.setAuto(controlsForMode(sample, { worldDrag: labs.isOn(WORLD_DRAG_FLAG) }));
    } finally {
      busy = false;
    }
  }

  function stop() {
    if (handle !== null) timers.clearInterval(handle);
    handle = null;
  }
  function sync() {
    if (!shouldRun()) { stop(); return; }
    if (handle !== null) return;
    last = null;
    // Old movie samples would make the first new ones read as a movie (#107).
    semantic?.clearMovieWindow?.();
    handle = timers.setInterval(tick, Math.round(1000 / hz));
    tick();
  }

  labs.onChange((name) => {
    if (name === AUTO_FLAG) sync();
    // A new world-map policy applies at the next poll, even in the same mode.
    if (name === WORLD_DRAG_FLAG) last = null;
  });
  return {
    tick,
    /** { active } from the worker's hash gate. */
    setGate(gate) {
      gateActive = Boolean(gate?.active);
      if (!gateActive) semantic = null;
      sync();
    },
    setBackend(b) { backend = b; sync(); },
    /** Tests: drive modes from `fn` instead of the semantic layer. Flag and gate still apply. */
    setSource(fn) { source = fn; last = null; sync(); },
    stop,
    get running() { return handle !== null; },
  };
}
