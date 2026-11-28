// Context-aware Interact label (#25), behind the Labs flag `interact-label`
// (off by default). While the field controls are shown, the page polls
// semantic.nearby() (#112) at 4 Hz and relabels the field Interact button:
// what it says comes from interactLabel() in semantic/controls.js. A tap
// still presses the same button: only the text and a dimmed look change.
// Input injection only: memory is read, never written.
// Original project code, GPL-2.0-or-later.

import { ADDRESS_TABLE } from './semantic/addresses.js';
import { interactLabel } from './semantic/controls.js';
import { createSemantic } from './semantic/layer.js';

export const INTERACT_FLAG = 'interact-label';
export const INTERACT_HZ = 4;

/** Show `result` (interactLabel's) on `button`. */
export function renderInteract(button, result) {
  if (button.textContent !== result.label) button.textContent = result.label;
  button.dataset.interact = result.id;
  button.classList.toggle('field-dim', result.dim);
}

/**
 * @param {object} o
 * @param {HTMLElement} o.fieldRoot  the field controls (#field); its Interact
 *                                   button is [data-id="interact"]
 * @param {object} o.labs            labs.js
 */
export function createInteractLabel({ fieldRoot, labs, timers = globalThis, hz = INTERACT_HZ, semanticFor = createSemantic }) {
  let gateActive = false;
  let backend = null;
  let source = null; // tests: an object with nearby()
  let semantic = null;
  let handle = null;
  let busy = false;

  const button = () => fieldRoot.querySelector('[data-id="interact"]');
  const flagOn = () => labs.isOn(INTERACT_FLAG);
  const reader = () => {
    if (source) return source;
    if (!gateActive || !backend) return null;
    // Read-only view, as the other Labs panels use (#146, #181).
    semantic ??= semanticFor({
      backend: { readMem: (a, l) => backend.readMem(a, l), get frame() { return backend.frame; } },
      exeSha1: ADDRESS_TABLE.exe,
    });
    return semantic;
  };
  const shouldRun = () => flagOn() && gateActive && (source !== null || backend !== null);
  // Flag off or stopped: the button as field-controls.js made it.
  const reset = () => {
    const b = button();
    if (!b) return;
    renderInteract(b, interactLabel(null));
    delete b.dataset.interact;
  };

  async function tick() {
    if (busy || handle === null) return;
    // Nothing to label while the classic pad is shown.
    if (fieldRoot.hidden) return;
    busy = true;
    try {
      const sem = reader();
      if (!sem) return;
      let sample;
      try { sample = await sem.nearby(); } catch { sample = null; }
      if (handle === null || !shouldRun()) return;
      const b = button();
      if (b) renderInteract(b, interactLabel(sample));
    } finally {
      busy = false;
    }
  }

  function stop() {
    if (handle !== null) timers.clearInterval(handle);
    handle = null;
    reset();
  }
  function sync() {
    if (!shouldRun()) { stop(); return; }
    if (handle !== null) return;
    handle = timers.setInterval(tick, Math.round(1000 / hz));
    tick();
  }

  labs.onChange((name) => { if (name === INTERACT_FLAG) sync(); });
  return {
    tick,
    /** { active } from the worker's hash gate. */
    setGate(gate) {
      gateActive = Boolean(gate?.active);
      if (!gateActive) semantic = null;
      sync();
    },
    setBackend(b) { backend = b; sync(); },
    /** Tests: read from `fake` ({ nearby() }) instead of game memory. Flag and gate still apply. */
    setSource(fake) { source = fake; sync(); },
    stop,
    get running() { return handle !== null; },
  };
}
