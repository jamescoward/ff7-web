// "Use default name" on Cloud's naming screen (#289 part 2), behind the Labs
// flag `naming-confirm` (off by default). While semantic naming() reports the
// naming screen (confirmed), one button sits in the picture's top-right
// corner. A tap plays NAMING_ACTIONS.useDefault (Start, then Circle) on the
// schedule namingPressAt gives, counted in game frames from the tap, until
// naming() reads false (done) or the action's timeout passes (stop). What the
// screen is, which buttons and when all come from semantic/; this file only
// draws, reads and presses. Input only: no game memory is written.
//
// Stop rules: a failed or unconfirmed naming() read during a run, the
// timeout, the flag turning off or the gate closing release every button and
// send nothing more. Taps are ignored while a run is going. The classic pad
// stays usable throughout (its own mixer source), so a name can still be typed.
// Original project code, GPL-2.0-or-later.

import { ADDRESS_TABLE } from './semantic/addresses.js';
import { NAMING_ACTIONS, namingPressAt } from './semantic/controls.js';
import { createSemantic } from './semantic/layer.js';
import { PAD } from './pad.js';

export const NAMING_FLAG = 'naming-confirm';
export const NAMING_HZ = 4;
/** Run loop period: about one game frame (60 Hz). */
export const LOOP_MS = 16;
const SOURCE = 'naming-confirm';
const ACTION = NAMING_ACTIONS.useDefault;

/** UI policy over a naming() result: show the button only on a confirmed naming screen. */
export const buttonForNaming = (sample) => sample?.value === true && sample.confirmed === true;

/** The pad mask for one press group (an array of PAD names), 0 for none. */
export function groupMask(group) {
  if (!group) return 0;
  let m = 0;
  for (const b of group) {
    if (!(b in PAD)) throw new RangeError(`unknown button ${b}`);
    m |= PAD[b];
  }
  return m;
}

/** Build the button once inside `root`. */
export function buildButton(root) {
  const doc = root.ownerDocument;
  if (root.querySelector?.('.nc-btn')) return;
  const b = doc.createElement('button');
  b.type = 'button';
  b.className = 'btn nc-btn';
  b.dataset.action = ACTION.id;
  b.textContent = ACTION.label;
  root.append(b);
}

export function createNamingConfirm({ root, mixer, labs, timers = globalThis, hz = NAMING_HZ, semanticFor = createSemantic }) {
  let gateActive = false;
  let backend = null;
  let source = null; // tests: { naming(), frame }
  let semantic = null;
  let handle = null; // naming() poll
  let busy = false;
  let shown = false;
  let run = null; // { start, lastFrame, busy, loop } while the sequence plays
  let starting = false;
  let last = null; // last outcome, for tests and debugging

  const flagOn = () => labs.isOn(NAMING_FLAG);
  const reader = () => {
    if (source) return source;
    if (!gateActive || !backend) return null;
    semantic ??= semanticFor({
      backend: { readMem: (a, l) => backend.readMem(a, l), get frame() { return backend.frame; } },
      exeSha1: ADDRESS_TABLE.exe,
    });
    return semantic;
  };
  const frameNow = () => (source ? source.frame : backend?.frame);
  const shouldRun = () => flagOn() && gateActive && (source !== null || backend !== null);
  const show = (on) => {
    shown = on;
    root.hidden = !on;
    root.ownerDocument.documentElement.toggleAttribute('data-naming-confirm-on', on);
  };
  const setBusy = (on) => {
    const b = root.querySelector?.('.nc-btn');
    if (b) b.disabled = on;
  };

  function release() {
    if (run) { timers.clearInterval(run.loop); run = null; }
    mixer.set(SOURCE, 0);
    setBusy(false);
  }
  function finish(outcome) {
    last = outcome;
    release();
  }

  /** One turn of the run loop: on a new game frame, check the screen, then hold that frame's group. */
  async function turn() {
    const r = run;
    if (!r || r.busy) return;
    const frame = frameNow();
    if (!Number.isInteger(frame) || frame === r.lastFrame) return;
    r.busy = true;
    let sample;
    try { sample = await reader()?.naming(); } catch { sample = null; }
    r.busy = false;
    if (run !== r) return; // cancelled while reading
    r.lastFrame = frame;
    const f = frame - r.start;
    if (sample?.confirmed !== true || typeof sample.value !== 'boolean') { finish({ ok: false, reason: 'unread', frames: f }); return; }
    if (sample.value === false) { finish({ ok: true, frames: f }); return; }
    if (f >= ACTION.timeout) { finish({ ok: false, reason: 'timeout', frames: f }); return; }
    mixer.set(SOURCE, groupMask(namingPressAt(Math.max(0, f), ACTION)));
  }

  /** A tap on the button. Resolves once the run has started (or been refused). */
  async function tap() {
    if (!shouldRun() || !shown || run !== null || starting) return;
    const sem = reader();
    if (!sem) return;
    starting = true;
    let sample;
    try { sample = await sem.naming(); } catch { sample = null; }
    starting = false;
    if (!shouldRun() || !shown || run !== null) return;
    if (!buttonForNaming(sample)) { last = { ok: false, reason: 'unread', frames: 0 }; return; }
    const start = frameNow();
    if (!Number.isInteger(start)) { last = { ok: false, reason: 'frame', frames: 0 }; return; }
    last = null;
    run = { start, lastFrame: null, busy: false, loop: null };
    setBusy(true);
    // The first group goes out at once, so the press lines up with frame 0.
    mixer.set(SOURCE, groupMask(namingPressAt(0, ACTION)));
    run.lastFrame = start;
    run.loop = timers.setInterval(turn, LOOP_MS);
  }

  async function tick() {
    if (busy || handle === null) return;
    busy = true;
    try {
      const sem = reader();
      if (!sem) return;
      let sample;
      try { sample = await sem.naming(); } catch { sample = null; }
      if (handle === null || !shouldRun()) return;
      if (typeof sample?.value !== 'boolean') return; // a failed read says nothing
      const on = buttonForNaming(sample);
      if (!on && run === null) show(false);
      else if (on) show(true);
    } finally {
      busy = false;
    }
  }

  function stop() {
    if (handle !== null) timers.clearInterval(handle);
    handle = null;
    if (run) last = { ok: false, reason: 'stopped', frames: null };
    release();
    show(false);
  }
  function sync() {
    if (!shouldRun()) { stop(); return; }
    if (handle !== null) return;
    handle = timers.setInterval(tick, Math.round(1000 / hz));
    tick();
  }

  buildButton(root);
  root.addEventListener('click', (e) => {
    const b = e.target?.closest?.('button');
    if (b && root.contains(b)) tap();
  });
  labs.onChange((name) => { if (name === NAMING_FLAG) sync(); });
  show(false);
  return {
    tick,
    turn,
    tap,
    setGate(gate) {
      gateActive = Boolean(gate?.active);
      if (!gateActive) semantic = null;
      sync();
    },
    setBackend(b) { backend = b; sync(); },
    /** Tests: read from `fake` ({ naming(), frame }) instead of game memory. Flag and gate still apply. */
    setSource(fake) { source = fake; sync(); },
    stop,
    get running() { return handle !== null; },
    get playing() { return run !== null; },
    get shown() { return shown; },
    get last() { return last; },
  };
}
