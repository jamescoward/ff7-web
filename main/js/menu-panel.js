// Tap-to-select main menu panel (#115), behind the Labs flag `menu-panel` (off
// by default). In a confirmed menu mode a panel of large rows sits below the
// picture: one row per main-menu command, plus Back and Close. A row tap runs
// the menu planner (semantic/planner.js) from the confirmed cursor to that
// row, one game frame at a time, then presses Circle. Back and Close press
// Triangle. The picture is never covered or suppressed. Which labels, which
// buttons and the plan itself come from semantic/; this file only draws,
// reads and presses. Input only: no game memory is written.
//
// Stop rules: any executor stop reason (start, moved, stuck, unread, frame)
// releases everything and sends nothing more, not even Circle. Taps are
// ignored while a plan or a press runs. The plan is cancelled when the flag
// turns off, the gate closes, or mode() stops reporting a confirmed menu.
// Greyed-out rows (PHS, Save) still send input; the game ignores it.
// Original project code, GPL-2.0-or-later.

import { ADDRESS_TABLE } from './semantic/addresses.js';
import { MENU_PANEL_ACTIONS } from './semantic/controls.js';
import { createSemantic } from './semantic/layer.js';
import { menuPanelPlan, menuPanelRows } from './semantic/menu-panel.js';
import { createPlanExecutor } from './semantic/planner.js';
import { PAD } from './pad.js';

export const PANEL_FLAG = 'menu-panel';
export const PANEL_HZ = 4;
/** Plan loop period: about one game frame (60 Hz). */
export const LOOP_MS = 16;
export const PRESS_MS = 100;
const SOURCE = 'menu-panel';

/** UI policy over a mode() result: show the panel only in a confirmed menu. */
export const panelForMode = (sample) => sample?.value?.mode === 'menu' && sample.confirmed === true;

/** Build the panel's buttons once. Rows first (data-row), then Back and Close. */
export function buildPanel(root) {
  const doc = root.ownerDocument;
  if (root.querySelector('.mp-grid')) return;
  const grid = doc.createElement('div');
  grid.className = 'mp-grid';
  for (const { row, label } of menuPanelRows()) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'btn mp-row';
    b.dataset.row = String(row);
    b.textContent = label;
    grid.append(b);
  }
  for (const id of ['back', 'close']) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'btn mp-row mp-nav';
    b.dataset.action = id;
    b.textContent = MENU_PANEL_ACTIONS[id].label;
    grid.append(b);
  }
  root.append(grid);
}

export function createMenuPanel({ root, mixer, labs, timers = globalThis, hz = PANEL_HZ, semanticFor = createSemantic }) {
  let gateActive = false;
  let backend = null;
  let source = null; // tests: { mode(), menuCursor(), frame }
  let semantic = null;
  let handle = null; // mode poll
  let busy = false;
  let menuOn = false; // last confirmed-menu verdict
  let run = null; // { exec, loop } while a plan runs
  let pressing = null; // timeout handle while a button is held
  let starting = false;
  let last = null; // last outcome, for tests and debugging

  const flagOn = () => labs.isOn(PANEL_FLAG);
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
    menuOn = on;
    root.hidden = !on;
    root.ownerDocument.documentElement.toggleAttribute('data-menu-panel-on', on);
  };

  function release() {
    if (run) { timers.clearInterval(run.loop); run = null; }
    if (pressing !== null) timers.clearTimeout(pressing);
    pressing = null;
    mixer.set(SOURCE, 0);
  }
  function pressFor(button) {
    mixer.set(SOURCE, PAD[button]);
    pressing = timers.setTimeout(() => { pressing = null; mixer.set(SOURCE, 0); }, PRESS_MS);
  }
  const idle = () => run === null && pressing === null && !starting;

  /** One turn of the plan loop: read frame and cursor, step the executor, hold its mask. */
  async function turn() {
    const r = run;
    if (!r || r.busy) return;
    const frame = frameNow();
    if (frame === r.lastFrame) return; // the same game frame: nothing new to step
    r.busy = true;
    let cursor = null;
    try {
      const sample = await reader()?.menuCursor();
      if (sample?.confirmed === true && Number.isInteger(sample.value)) cursor = sample.value;
    } catch { /* an unread cursor: the executor counts it */ }
    r.busy = false;
    if (run !== r) return; // cancelled while reading
    r.lastFrame = frame;
    const out = r.exec.step(frame, cursor);
    mixer.set(SOURCE, out.mask);
    if (out.state === 'running') return;
    release();
    if (out.state === 'done') {
      last = { ok: true, row: r.row };
      pressFor(MENU_PANEL_ACTIONS.select.button);
    } else {
      last = { ok: false, row: r.row, error: out.error };
    }
  }

  /** A tap on panel row `row`. Resolves once the plan has started (or been refused). */
  async function tapRow(row) {
    if (!shouldRun() || !menuOn || !idle()) return;
    const sem = reader();
    if (!sem) return;
    starting = true;
    let sample;
    try { sample = await sem.menuCursor(); } catch { sample = null; }
    starting = false;
    if (!shouldRun() || !menuOn || !idle()) return;
    if (sample?.confirmed !== true || !Number.isInteger(sample.value)) { last = { ok: false, row, error: { reason: 'unread' } }; return; }
    let plan;
    try { plan = menuPanelPlan(sample.value, row); } catch { last = { ok: false, row, error: { reason: 'range' } }; return; }
    last = null;
    run = { exec: createPlanExecutor(plan), row, busy: false, lastFrame: null, loop: null };
    run.loop = timers.setInterval(turn, LOOP_MS);
    turn();
  }

  /** Back and Close: Triangle, once. */
  function tapAction(id) {
    const a = MENU_PANEL_ACTIONS[id];
    if (!a || !shouldRun() || !menuOn || !idle()) return;
    pressFor(a.button);
  }

  async function tick() {
    if (busy || handle === null) return;
    busy = true;
    try {
      const sem = reader();
      if (!sem) return;
      let mode;
      try { mode = await sem.mode(); } catch { mode = null; }
      if (handle === null || !shouldRun()) return;
      if (!mode?.value) return; // a failed read says nothing about the mode
      const on = panelForMode(mode);
      if (!on) release();
      show(on);
    } finally {
      busy = false;
    }
  }

  function stop() {
    if (handle !== null) timers.clearInterval(handle);
    handle = null;
    release();
    show(false);
  }
  function sync() {
    if (!shouldRun()) { stop(); return; }
    if (handle !== null) return;
    semantic?.clearMovieWindow?.();
    handle = timers.setInterval(tick, Math.round(1000 / hz));
    tick();
  }

  buildPanel(root);
  root.addEventListener('click', (e) => {
    const b = e.target?.closest?.('button');
    if (!b || !root.contains(b)) return;
    if (b.dataset.row !== undefined) tapRow(Number(b.dataset.row));
    else if (b.dataset.action) tapAction(b.dataset.action);
  });
  labs.onChange((name) => { if (name === PANEL_FLAG) sync(); });
  show(false);
  return {
    tick,
    turn,
    tapRow,
    tapAction,
    setGate(gate) {
      gateActive = Boolean(gate?.active);
      if (!gateActive) semantic = null;
      sync();
    },
    setBackend(b) { backend = b; sync(); },
    /** Tests: read from `fake` ({ mode(), menuCursor(), frame }) instead of game memory. Flag and gate still apply. */
    setSource(fake) { source = fake; sync(); },
    stop,
    get running() { return handle !== null; },
    get planning() { return run !== null; },
    get last() { return last; },
  };
}
