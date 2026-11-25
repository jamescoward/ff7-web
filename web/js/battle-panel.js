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
// or the panel hides. Row taps need a confirmed row for the acting slot (every
// slot's row is confirmed since #171): a sample without one disables the rows.
// The game skips rows with no command (#171); the plan counts a press that
// lands on a later planned row as progress (#189, semantic/menus.js `skips`),
// and a tap on a skipped row stops with 'moved' once the cursor lands past it.
//
// List view (#253 part 2): while a confirmed Magic or Item list is open
// (battleList()), the panel shows the list's entries as buttons (spell ids;
// item ids and counts; no names). A tap plans the list cursor from its
// confirmed read to that entry (semantic/battle-lists.js battleListPlan),
// checks the read list index after every press, then presses Circle; the
// game's target selection follows, which the targeting view covers. The same
// stop rules apply: a read showing the list gone ('left') or any executor
// stop sends nothing more. Entries are disabled while the list cursor is not
// a confirmed read (Tier 2 confirmed party slot 0 only).
// Original project code, GPL-2.0-or-later.

import { ADDRESS_TABLE } from './semantic/addresses.js';
import { battleListLabel } from './semantic/battle-lists.js';
import { battleListPlanCursor, battleListTapPlan, battleListView, battlePanelPlan, battlePanelRows, battlePanelView, battlePlanCursor } from './semantic/battle-panel.js';
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
  const list = doc.createElement('div');
  list.className = 'bp-list-wrap';
  const note = doc.createElement('p');
  note.className = 'bp-note';
  const grid = doc.createElement('div');
  grid.className = 'bp-grid bp-list';
  list.append(note, grid);
  root.append(rows, targets, list);
}

/** Draw a list view's entries (only when they changed, so a tap target never moves under a finger). */
export function renderList(root, v, entries) {
  const grid = root.querySelector?.('.bp-list');
  const note = root.querySelector?.('.bp-note');
  if (!grid?.replaceChildren || !note) return;
  const key = JSON.stringify([v.list, v.actor, entries]);
  if (grid.dataset.key !== key) {
    grid.dataset.key = key;
    grid.dataset.list = v.list;
    const doc = root.ownerDocument;
    grid.replaceChildren(...entries.map((e) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'btn bp-btn';
      b.dataset.index = String(e.index);
      b.textContent = battleListLabel(v.list, e);
      return b;
    }));
  }
  const ok = v.index !== null;
  for (const b of grid.querySelectorAll('button[data-index]')) b.disabled = !ok;
  note.textContent = !ok ? 'List cursor not confirmed for this party member' : entries.length === 0 ? 'No entries' : '';
  note.hidden = note.textContent === '';
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
  const readList = async () => {
    try { const r = reader(); return r?.battleList ? await r.battleList() : null; } catch { return null; }
  };
  const readEntries = async (v) => {
    try {
      const r = reader();
      if (!r?.battleListEntries || v.actor === null) return null;
      const out = await r.battleListEntries(v.list, v.actor);
      return out?.value && out.confirmed === true ? out.value : null;
    } catch { return null; }
  };
  let entries = []; // the list view's last confirmed entries
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
    const cursor = r.list ? battleListPlanCursor(await readList(), r.actor, r.list) : battlePlanCursor(await read(), r.actor);
    r.busy = false;
    if (run !== r) return; // cancelled while reading
    if (cursor === 'left') {
      release();
      last = { ok: false, ...r.target, error: { reason: 'left' } };
      return;
    }
    r.lastFrame = frame;
    const out = r.exec.step(frame, cursor);
    mixer.set(SOURCE, out.mask);
    if (out.state === 'running') return;
    release();
    if (out.state === 'done') {
      last = { ok: true, ...r.target };
      pressFor(BATTLE_PANEL_ACTIONS.select.button);
    } else {
      last = { ok: false, ...r.target, error: out.error };
    }
  }

  /** A fresh read at tap time; the action goes ahead only if `want` accepts the view. */
  async function fresh(want, list = false) {
    if (!shouldRun() || view.view === 'hidden' || !idle() || !reader()) return null;
    starting = true;
    const v = list ? battleListView(await readList()) : battlePanelView(await read());
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
    run = { exec: createPlanExecutor(plan), actor: v.actor, row, target: { row }, list: null, busy: false, lastFrame: null, loop: null };
    run.loop = timers.setInterval(turn, LOOP_MS);
    turn();
  }

  /** A tap on list entry `index` (#253). Resolves once the plan has started (or been refused). */
  async function tapEntry(index) {
    const v = await fresh((x) => x.view === 'list', true);
    if (!v) return;
    const target = { list: v.list, index };
    if (v.index === null || v.actor === null) { last = { ok: false, ...target, error: { reason: 'unread' } }; return; }
    let plan;
    try { plan = battleListTapPlan(v, index); } catch { last = { ok: false, ...target, error: { reason: 'range' } }; return; }
    last = null;
    run = { exec: createPlanExecutor(plan), actor: v.actor, row: null, target, list: v.list, busy: false, lastFrame: null, loop: null };
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
      let v = battlePanelView(sample);
      if (!v) return; // a failed read says nothing
      if (v.view === 'hidden') {
        const lv = battleListView(await readList());
        if (handle === null || !shouldRun()) return;
        if (lv?.view === 'list') {
          const got = await readEntries(lv);
          if (handle === null || !shouldRun()) return;
          if (got) entries = got;
          else if (view.view !== 'list' || view.list !== lv.list || view.actor !== lv.actor) entries = [];
          v = lv;
          if (!starting) renderList(root, v, entries);
        }
      }
      if (v.view === 'hidden' || (run && run.list === null && v.view === 'list')) release();
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
    else if (b.dataset.index !== undefined) tapEntry(Number(b.dataset.index));
    else if (b.dataset.action) tapAction(b.dataset.action);
  });
  labs.onChange((name) => { if (name === BATTLE_PANEL_FLAG) sync(); });
  show(view);
  return {
    tick,
    turn,
    tapRow,
    tapEntry,
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
