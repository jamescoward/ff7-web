// Battle command panel (#116), behind the Labs flag `battle-panel` (off by
// default). In a confirmed battle, while a party member's command menu is open,
// a panel below the picture shows the command rows as large buttons ("Command
// 1" to "Command 4": names are game data and are never shown). A row tap runs
// the menu planner (semantic/planner.js) from the confirmed command cursor to
// that row, one game frame at a time, then presses Circle. In target selection
// the panel shows Prev, Next, Confirm and Back instead. Which labels, which
// buttons and the plan itself come from semantic/; this file only draws, reads
// and presses. Input only: no game memory is written.
//
// Stop rules: any executor stop reason (start, moved, stuck, unread, frame),
// or a confirmed read showing the menu has gone ('left'), releases everything
// and sends nothing more, not even Circle. Taps are ignored while a plan or a
// press runs. The plan is cancelled when the flag turns off, the gate closes,
// or the panel hides. Row taps need a confirmed row for the acting slot (only
// slot 0's is confirmed so far, #171): otherwise the rows are disabled.
// Original project code, GPL-2.0-or-later.

import { ADDRESS_TABLE } from './semantic/addresses.js';
import { battlePanelPlan, battlePanelRows, battlePanelView, battlePlanCursor } from './semantic/battle-panel.js';
import { BATTLE_PANEL_ACTIONS, BATTLE_TARGET_ACTIONS } from './semantic/controls.js';
import { createSemantic } from './semantic/layer.js';
import { createPlanExecutor } from './semantic/planner.js';
import { PAD } from './pad.js';

export const BATTLE_PANEL_FLAG = 'battle-panel';
export const PANEL_HZ = 4;
/** Plan loop period: about one game frame (60 Hz). */
export const LOOP_MS = 16;
export const PRESS_MS = 100;
const SOURCE = 'battle-panel';

/** Build the panel's buttons once: a group of command rows and a group of targeting buttons. */
export function buildPanel(root) {
  const doc = root.ownerDocument;
  if (root.querySelector('.bp-grid')) return;
  const rows = doc.createElement('div');
  rows.className = 'bp-grid bp-commands';
  for (const { row, label } of battlePanelRows()) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'btn bp-btn';
    b.dataset.row = String(row);
    b.textContent = label;
    rows.append(b);
  }
  const targets = doc.createElement('div');
  targets.className = 'bp-grid bp-targets';
  for (const id of BATTLE_TARGET_ACTIONS) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'btn bp-btn';
    b.dataset.action = id;
    b.textContent = BATTLE_PANEL_ACTIONS[id].label;
    targets.append(b);
  }
  root.append(rows, targets);
}

export function createBattlePanel({ root, mixer, labs, timers = globalThis, hz = PANEL_HZ, semanticFor = createSemantic }) {
  let gateActive = false;
  let backend = null;
  let source = null; // tests: { battleInput(), frame }
  let semantic = null;
  let handle = null; // battleInput poll
  let busy = false;
  let view = { view: 'hidden', actor: null, row: null }; // last verdict shown
  let run = null; // { exec, actor, row, loop } while a plan runs
  let pressing = null; // timeout handle while a button is held
  let starting = false;
  let last = null; // last outcome, for tests and debugging

  const flagOn = () => labs.isOn(BATTLE_PANEL_FLAG);
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
  const read = async () => {
    try { return await reader()?.battleInput(); } catch { return null; }
  };
  const show = (v) => {
    view = v;
    const on = v.view !== 'hidden';
    root.hidden = !on;
    root.dataset.view = v.view;
    root.ownerDocument.documentElement.toggleAttribute('data-battle-panel-on', on);
    const rowsOk = v.view === 'command' && v.row !== null;
    for (const b of root.querySelectorAll?.('button[data-row]') ?? []) b.disabled = !rowsOk;
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
    const cursor = battlePlanCursor(await read(), r.actor);
    r.busy = false;
    if (run !== r) return; // cancelled while reading
    if (cursor === 'left') {
      release();
      last = { ok: false, row: r.row, error: { reason: 'left' } };
      return;
    }
    r.lastFrame = frame;
    const out = r.exec.step(frame, cursor);
    mixer.set(SOURCE, out.mask);
    if (out.state === 'running') return;
    release();
    if (out.state === 'done') {
      last = { ok: true, row: r.row };
      pressFor(BATTLE_PANEL_ACTIONS.select.button);
    } else {
      last = { ok: false, row: r.row, error: out.error };
    }
  }

  /** A fresh read at tap time; the action goes ahead only if `want` accepts the view. */
  async function fresh(want) {
    if (!shouldRun() || view.view === 'hidden' || !idle() || !reader()) return null;
    starting = true;
    const v = battlePanelView(await read());
    starting = false;
    if (!shouldRun() || !idle() || !v || !want(v)) return null;
    return v;
  }

  /** A tap on command row `row`. Resolves once the plan has started (or been refused). */
  async function tapRow(row) {
    const v = await fresh((x) => x.view === 'command');
    if (!v) return;
    if (v.row === null) { last = { ok: false, row, error: { reason: 'unread' } }; return; }
    let plan;
    try { plan = battlePanelPlan(v.row, row); } catch { last = { ok: false, row, error: { reason: 'range' } }; return; }
    last = null;
    run = { exec: createPlanExecutor(plan), actor: v.actor, row, busy: false, lastFrame: null, loop: null };
    run.loop = timers.setInterval(turn, LOOP_MS);
    turn();
  }

  /** Prev, Next, Confirm, Back: one press, only in a confirmed target selection. */
  async function tapAction(id) {
    const a = BATTLE_PANEL_ACTIONS[id];
    if (!a || a.when !== 'targeting') return;
    const v = await fresh((x) => x.view === 'targeting');
    if (!v) return;
    pressFor(a.button);
  }

  async function tick() {
    if (busy || handle === null) return;
    busy = true;
    try {
      if (!reader()) return;
      const sample = await read();
      if (handle === null || !shouldRun()) return;
      const v = battlePanelView(sample);
      if (!v) return; // a failed read says nothing
      if (v.view === 'hidden') release();
      if (!starting) show(v);
    } finally {
      busy = false;
    }
  }

  function stop() {
    if (handle !== null) timers.clearInterval(handle);
    handle = null;
    release();
    show({ view: 'hidden', actor: null, row: null });
  }
  function sync() {
    if (!shouldRun()) { stop(); return; }
    if (handle !== null) return;
    handle = timers.setInterval(tick, Math.round(1000 / hz));
    tick();
  }

  buildPanel(root);
  root.addEventListener('click', (e) => {
    const b = e.target?.closest?.('button');
    if (!b || !root.contains(b) || b.disabled) return;
    if (b.dataset.row !== undefined) tapRow(Number(b.dataset.row));
    else if (b.dataset.action) tapAction(b.dataset.action);
  });
  labs.onChange((name) => { if (name === BATTLE_PANEL_FLAG) sync(); });
  show(view);
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
    /** Tests: read from `fake` ({ battleInput(), frame }) instead of game memory. Flag and gate still apply. */
    setSource(fake) { source = fake; sync(); },
    stop,
    get running() { return handle !== null; },
    get planning() { return run !== null; },
    get view() { return view; },
    get last() { return last; },
  };
}
