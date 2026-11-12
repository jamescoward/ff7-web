// Tap to advance dialogue (#114), behind the Labs flag `dialogue-taps` (off by
// default). When the game's message window waits for Circle, a tap on the
// picture presses Circle once. The meaning (which button, in which state)
// comes from semantic/controls.js; this file only listens, reads and presses.
//
// Taps are heard on the picture canvas only. Drag-to-walk, the pad and the
// status message sit on their own elements, so they never reach this
// listener and dragging is unchanged. A tap is a pointerup close to its
// pointerdown (little movement, short time). A fresh dialogue() read is made
// at tap time; a failed or unconfirmed read sends nothing. Input only.
// Original project code, GPL-2.0-or-later.

import { ADDRESS_TABLE } from './semantic/addresses.js';
import { dialogueTapButton } from './semantic/controls.js';
import { createSemantic } from './semantic/layer.js';
import { PAD } from './pad.js';

export const TAPS_FLAG = 'dialogue-taps';
export const TAPS_HZ = 4;
export const PRESS_MS = 100;
export const TAP_SLOP_PX = 12;
export const TAP_MAX_MS = 500;
const SOURCE = 'dialogue-taps';

export function createDialogueTaps({ target, mixer, labs, timers = globalThis, hz = TAPS_HZ, semanticFor = createSemantic, now = () => Date.now() }) {
  let gateActive = false;
  let backend = null;
  let source = null; // tests: an object with dialogue()
  let semantic = null;
  let handle = null;
  let pressing = null; // timeout handle while Circle is held
  let reading = false;
  let busy = false;
  let latest = null; // last polled sample (for tests and debugging; a tap reads afresh)
  let down = null;

  const flagOn = () => labs.isOn(TAPS_FLAG);
  const reader = () => {
    if (source) return source;
    if (!gateActive || !backend) return null;
    semantic ??= semanticFor({ backend: { readMem: (a, l) => backend.readMem(a, l) }, exeSha1: ADDRESS_TABLE.exe });
    return semantic;
  };
  const shouldRun = () => flagOn() && gateActive && (source !== null || backend !== null);

  async function tick() {
    if (busy || handle === null) return;
    busy = true;
    try {
      const sem = reader();
      if (!sem) return;
      try { latest = await sem.dialogue(); } catch { latest = null; }
    } finally {
      busy = false;
    }
  }

  function release() {
    if (pressing !== null) timers.clearTimeout(pressing);
    pressing = null;
    mixer.set(SOURCE, 0);
  }

  async function onTap() {
    if (!shouldRun() || pressing !== null || reading) return;
    const sem = reader();
    if (!sem) return;
    reading = true;
    let sample;
    try { sample = await sem.dialogue(); } catch { sample = null; }
    reading = false;
    latest = sample;
    if (!shouldRun() || pressing !== null) return;
    const button = dialogueTapButton(sample);
    if (!button || !(button in PAD)) return;
    mixer.set(SOURCE, PAD[button]);
    pressing = timers.setTimeout(() => { pressing = null; mixer.set(SOURCE, 0); }, PRESS_MS);
  }

  const onDown = (e) => { down = { x: e.clientX, y: e.clientY, t: now(), id: e.pointerId }; };
  const onUp = (e) => {
    const d = down;
    down = null;
    if (!d || d.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP_PX || now() - d.t > TAP_MAX_MS) return;
    onTap();
  };
  const onCancel = () => { down = null; };
  target.addEventListener('pointerdown', onDown);
  target.addEventListener('pointerup', onUp);
  target.addEventListener('pointercancel', onCancel);

  function stop() {
    if (handle !== null) timers.clearInterval(handle);
    handle = null;
    latest = null;
    release();
  }
  function sync() {
    if (!shouldRun()) { stop(); return; }
    if (handle !== null) return;
    handle = timers.setInterval(tick, Math.round(1000 / hz));
    tick();
  }

  labs.onChange((name) => { if (name === TAPS_FLAG) sync(); });
  return {
    tick,
    /** Tests: a tap, as if the picture had been pressed and released. */
    tap: onTap,
    setGate(gate) {
      gateActive = Boolean(gate?.active);
      if (!gateActive) semantic = null;
      sync();
    },
    setBackend(b) { backend = b; sync(); },
    /** Tests: read from `fake` ({ dialogue() }) instead of game memory. Flag and gate still apply. */
    setSource(fake) { source = fake; sync(); },
    stop,
    get running() { return handle !== null; },
    get latest() { return latest; },
  };
}
