// Native Materia screen (#250), behind the Labs flag `native-materia` (off
// by default). While the game's Materia screen is open (materiaCursors():
// a confirmed menu mode, the Materia overlay and a read slot cursor), a
// native panel covers the picture: the member's weapon materia slots and
// every materia in the inventory (IDs and AP from materia(), no names).
//
// Tap an empty weapon slot (columns 0-1, the ones Tier 2 planned), then a
// materia. The panel runs what save-boot-27a ran (#248), one game frame at
// a time, checking the cursors at every step:
//   1. materiaColumnPlan from the read column to the tapped one;
//   2. Circle, then MATERIA_LIST_OPEN_FRAMES frames (the list opens);
//   3. materiaListPlan from the read list cursor to the materia's slot;
//   4. a check that the slot cursor still reads the weapon row and the list
//      cursor reads that slot, then Circle.
// Afterwards it reads the inventory slot and the weapon slot to confirm the
// move ("Equipped"), or says something else, or no change, was seen.
//
// Only a party of one is offered: the main-menu party pick is confirmed on
// the Equip screen (#215), not here, so with more members which member's
// slots are shown is not known. Back presses Cross; Hide uncovers the
// picture until the Materia screen closes. Facts, rules, plans and buttons
// come from semantic/; this file only draws, reads and presses. Input only:
// no game memory is written.
//
// Stop rules (as the native Item screen, #135): any executor stop or failed
// check releases everything and sends nothing more, Circle included.
// Leaving the Materia screen, the flag or the gate cancels and releases.
// Original project code, GPL-2.0-or-later.

import { ADDRESS_TABLE } from './semantic/addresses.js';
import { MATERIA_SCREEN_ACTIONS } from './semantic/controls.js';
import { EQUIP_PARTY_SLOTS, equipMemberSlot } from './semantic/equip-screen.js';
import {
  MATERIA_CONFIRMED_COLUMNS, MATERIA_LIST_OPEN_FRAMES, MATERIA_TAP_ROW, materiaColumnLabel, materiaColumnPlan,
  materiaEquipOutcome, materiaLabel, materiaListPlan, materiaListSlot, materiaTapAllowed,
} from './semantic/materia-screen.js';
import { createSemantic } from './semantic/layer.js';
import { createPlanExecutor } from './semantic/planner.js';
import { PAD } from './pad.js';

export const MATERIA_FLAG = 'native-materia';
export const MATERIA_HZ = 4;
/** Loop period while a tap runs: about one game frame (60 Hz). */
export const LOOP_MS = 16;
export const PRESS_MS = 100;
/** Polls (at MATERIA_HZ) to wait for the move to show before saying no change was seen. */
export const CONFIRM_POLLS = 8;
const SOURCE = 'native-materia';

const REASON_TEXT = Object.freeze({
  'party pick not read': 'Use the pad: with more than one member, whose slots these are is not read',
  'slot not empty': 'Only empty weapon slots can be filled here',
  'cursor not read': 'Move the game\'s cursor back to the weapon row to use the panel',
  settling: '',
});

/** Build the panel's fixed parts once: a header, the member line, weapon slot buttons, a materia list, Back and Hide. */
export function buildMateriaScreen(root) {
  const doc = root.ownerDocument;
  if (root.querySelector('.nm-list')) return;
  const el = (tag, cls, text) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const head = el('div', 'nm-head');
  head.append(el('span', 'nm-title', 'Materia'), el('span', 'nm-msg'));
  const member = el('div', 'nm-member', '');
  const slots = el('div', 'nm-slots');
  for (let column = 0; column < MATERIA_CONFIRMED_COLUMNS; column++) {
    const b = el('button', 'btn nm-slot', '');
    b.type = 'button';
    b.dataset.column = String(column);
    slots.append(b);
  }
  const list = el('div', 'nm-list');
  const nav = el('div', 'nm-nav');
  const back = el('button', 'btn nm-back', MATERIA_SCREEN_ACTIONS.back.label);
  back.type = 'button';
  back.dataset.action = 'back';
  const hide = el('button', 'btn nm-hide', 'Hide');
  hide.type = 'button';
  hide.dataset.action = 'hide';
  nav.append(back, hide);
  root.append(head, member, slots, list, nav);
}

export function createMateriaScreen({ root, mixer, labs, timers = globalThis, hz = MATERIA_HZ, semanticFor = createSemantic }) {
  let gateActive = false;
  let backend = null;
  let source = null; // tests: { materiaCursors(), materia(), equipment(slot), frame }
  let semantic = null;
  let handle = null; // poll
  let busy = false;
  let open = false;
  let openFrame = null; // game frame when the open screen was first seen
  let cursors = null; // the last materiaCursors() value
  let members = [null, null, null];
  let materia = []; // the last confirmed materia() value
  let column = null; // the weapon column chosen for the next tap
  let peek = false;
  let run = null; // the running tap: { phase, exec, loop, column, slot, before, waitFrom, busy, lastFrame }
  let pressing = null;
  let check = null; // { memberSlot, column, slot, before, polls } while confirming
  let last = null;

  const doc = root.ownerDocument;
  const msg = () => root.querySelector('.nm-msg');
  const flagOn = () => labs.isOn(MATERIA_FLAG);
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
  const idle = () => run === null && pressing === null && check === null;
  const setMsg = (text) => { const m = msg(); if (m) m.textContent = text; };
  const memberSlot = () => equipMemberSlot(members);
  const weaponMateria = () => members[memberSlot()]?.weaponMateria ?? null;
  const framesOpen = () => {
    const f = frameNow();
    return Number.isInteger(f) && Number.isInteger(openFrame) ? f - openFrame : null;
  };
  const tapState = () => ({ open, framesOpen: framesOpen(), memberSlot: memberSlot(), cursors, weaponMateria: weaponMateria(), materia });
  const inventoryAt = (slot) => materia.find((m) => m.slot === slot) ?? null;

  function show(on) {
    root.hidden = !on;
    doc.documentElement.toggleAttribute('data-native-materia-on', on);
  }
  function release() {
    if (run) { timers.clearInterval(run.loop); run = null; }
    if (pressing !== null) timers.clearTimeout(pressing);
    pressing = null;
    mixer.set(SOURCE, 0);
  }
  function pressFor(button) {
    mixer.set(SOURCE, PAD[button]);
    pressing = timers.setTimeout(() => { pressing = null; mixer.set(SOURCE, 0); render(); }, PRESS_MS);
  }
  function reset() {
    release();
    open = false;
    openFrame = null;
    cursors = null;
    peek = false;
    check = null;
    column = null;
    members = [null, null, null];
    materia = [];
  }

  /** The first empty, offered weapon column, if the chosen one is not usable. */
  function pickColumn() {
    const wm = weaponMateria();
    if (!Array.isArray(wm)) { column = null; return; }
    const usable = (c) => Number.isInteger(c) && c < MATERIA_CONFIRMED_COLUMNS && wm.length > c && wm[c] === null;
    if (usable(column)) return;
    column = null;
    for (let c = 0; c < MATERIA_CONFIRMED_COLUMNS; c++) if (usable(c)) { column = c; return; }
  }

  function render() {
    const st = tapState();
    const ms = st.memberSlot;
    const wm = st.weaponMateria;
    const m = root.querySelector('.nm-member');
    if (m) m.textContent = ms === null ? (members.some(Boolean) ? 'Party member: not read' : '—') : `Slot ${ms + 1}`;
    for (const b of root.querySelectorAll('.nm-slot')) {
      const c = Number(b.dataset.column);
      b.textContent = Array.isArray(wm) && wm.length > c ? materiaColumnLabel(c, wm[c]) : `Wpn ${c + 1}: ?`;
      b.disabled = !(idle() && Array.isArray(wm) && wm.length > c && wm[c] === null);
      b.toggleAttribute('data-chosen', column === c);
      b.toggleAttribute('data-cursor', cursors?.row === MATERIA_TAP_ROW && cursors?.column === c);
    }
    const list = root.querySelector('.nm-list');
    const want = materia.length;
    while (list.children.length < want) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'btn nm-materia';
      list.append(b);
    }
    while (list.children.length > want) list.lastChild.remove();
    let why = null;
    materia.forEach((mt, i) => {
      const b = list.children[i];
      b.dataset.slot = String(mt.slot);
      b.textContent = `${mt.slot + 1}. ${materiaLabel(mt)}`;
      const a = materiaTapAllowed(st, column, mt.slot);
      b.disabled = !(a.ok && idle());
      if (!a.ok && why === null) why = a.reason;
    });
    if (idle() && !last) setMsg(why ? REASON_TEXT[why] ?? '' : (column === null && materia.length ? 'No empty weapon slot' : ''));
  }

  async function readMembers(sem) {
    const out = [];
    for (let slot = 0; slot < EQUIP_PARTY_SLOTS; slot++) {
      let r;
      try { r = await sem.equipment(slot); } catch { r = null; }
      out.push(r?.confirmed === true ? r.value ?? null : null);
    }
    return out;
  }
  async function readMateria(sem) {
    let r;
    try { r = await sem.materia(); } catch { r = null; }
    return r?.confirmed === true && Array.isArray(r.value) ? r.value : null;
  }
  async function readCursors(sem) {
    let r;
    try { r = await sem.materiaCursors(); } catch { r = null; }
    if (!r || r.value === null || r.value === undefined) return undefined; // failed read
    return r;
  }

  function confirmMove() {
    const c = check;
    const wm = members[c.memberSlot]?.weaponMateria;
    const after = {
      inventory: inventoryAt(c.slot),
      weapon: Array.isArray(wm) && wm.length > c.column ? wm[c.column] : undefined,
    };
    c.polls += 1;
    const out = materiaEquipOutcome(c.before, after);
    if (out === 'none' && c.polls < CONFIRM_POLLS) return;
    check = null;
    last = { ok: out === 'equipped', outcome: out, column: c.column, slot: c.slot, before: c.before, after };
    if (out === 'equipped') setMsg(`Equipped: materia #${c.before.inventory.id} → weapon slot ${c.column + 1}`);
    else if (out === 'other') setMsg('Something else changed; check the game\'s screen');
    else setMsg('No change seen');
  }

  async function tick() {
    if (busy || handle === null) return;
    busy = true;
    try {
      const sem = reader();
      if (!sem) return;
      const r = await readCursors(sem);
      if (handle === null || !shouldRun()) return;
      if (r === undefined) return; // a failed read changes nothing
      const isOpen = r.confirmed === true && Number.isInteger(r.value.row) && Number.isInteger(r.value.column);
      if (!isOpen) {
        // Inside the list the slot cursor still reads; anything else is closed.
        if (open || !root.hidden) { reset(); last = null; show(false); }
        return;
      }
      if (!open) {
        open = true;
        openFrame = frameNow();
        last = null;
      }
      cursors = r.value;
      members = await readMembers(sem);
      const inv = await readMateria(sem);
      if (inv) materia = inv;
      if (check) confirmMove();
      if (run === null) pickColumn();
      render();
      show(!peek);
    } finally {
      busy = false;
    }
  }

  function fail(reason, extra = {}) {
    const r = run;
    release();
    last = { ok: false, column: r?.column ?? null, slot: r?.slot ?? null, error: { reason, ...extra } };
    setMsg('Stopped: the cursor did not move as planned');
    render();
  }

  /** One turn of a running tap: read the frame and cursors, then advance its phase. */
  async function turn() {
    const r = run;
    if (!r || r.busy) return;
    if (!shouldRun() || !open) { release(); return; }
    const frame = frameNow();
    if (!Number.isInteger(frame) || frame === r.lastFrame) return;
    r.busy = true;
    const c = await readCursors(reader());
    r.busy = false;
    if (run !== r) return;
    r.lastFrame = frame;
    const cur = c?.confirmed === true ? c.value : null;
    if (r.phase === 'column') {
      if (cur && cur.row !== MATERIA_TAP_ROW) { fail('row', { actual: cur.row }); return; }
      const out = r.exec.step(frame, cur ? cur.column : null);
      mixer.set(SOURCE, out.mask);
      if (out.state === 'running') return;
      if (out.state !== 'done') { fail(out.error.reason, { phase: 'column' }); return; }
      r.phase = 'open';
      r.waitFrom = frame;
      pressFor(MATERIA_SCREEN_ACTIONS.select.button);
      return;
    }
    if (r.phase === 'open') {
      if (pressing !== null || frame - r.waitFrom < MATERIA_LIST_OPEN_FRAMES) return;
      const from = cur ? { row: cur.listRow, offset: cur.listOffset } : null;
      if (!from || materiaListSlot(from.row, from.offset) === null) { fail('unread', { phase: 'list' }); return; }
      let plan;
      try { plan = materiaListPlan(from, r.slot); } catch { fail('range', { phase: 'list' }); return; }
      r.phase = 'list';
      r.exec = createPlanExecutor(plan);
      // fall through to the first list step on this frame
    }
    if (r.phase === 'list') {
      const index = cur ? materiaListSlot(cur.listRow, cur.listOffset) : null;
      const out = r.exec.step(frame, index);
      mixer.set(SOURCE, out.mask);
      if (out.state === 'running') return;
      if (out.state !== 'done') { fail(out.error.reason, { phase: 'list' }); return; }
      // The final check before the press that moves the materia.
      if (!(cur && cur.row === MATERIA_TAP_ROW && cur.column === r.column && index === r.slot)) { fail('check', { phase: 'take' }); return; }
      const ms = memberSlot();
      const target = r;
      release();
      check = { memberSlot: ms, column: target.column, slot: target.slot, before: target.before, polls: 0 };
      setMsg('Checking…');
      pressFor(MATERIA_SCREEN_ACTIONS.select.button);
      render();
    }
  }

  /** A tap on weapon materia column `c`: chooses where the next materia goes. */
  function tapColumn(c) {
    if (!shouldRun() || !open || !idle()) return;
    const wm = weaponMateria();
    if (!(Array.isArray(wm) && wm.length > c && wm[c] === null && c < MATERIA_CONFIRMED_COLUMNS)) return;
    column = c;
    last = null;
    render();
  }

  /** A tap on the materia in inventory slot `slot`. */
  function tapMateria(slot) {
    if (!shouldRun() || !idle()) return;
    const st = tapState();
    const a = materiaTapAllowed(st, column, slot);
    if (!a.ok) { last = { ok: false, column, slot, error: { reason: a.reason } }; return; }
    let plan;
    try { plan = materiaColumnPlan(cursors.column, column); } catch { last = { ok: false, column, slot, error: { reason: 'range' } }; return; }
    last = null;
    const before = { inventory: inventoryAt(slot), weapon: st.weaponMateria[column] };
    run = { phase: 'column', exec: createPlanExecutor(plan), loop: null, column, slot, before, waitFrom: null, busy: false, lastFrame: null };
    run.loop = timers.setInterval(turn, LOOP_MS);
    setMsg('Moving…');
    render();
    turn();
  }

  function tapAction(id) {
    if (id === 'hide') {
      if (!open) return;
      peek = true;
      show(false);
      return;
    }
    const a = MATERIA_SCREEN_ACTIONS[id];
    if (!a || !shouldRun() || !open || !idle()) return;
    last = null;
    setMsg('');
    pressFor(a.button);
    render();
  }

  function stop() {
    if (handle !== null) timers.clearInterval(handle);
    handle = null;
    reset();
    show(false);
  }
  function sync() {
    if (!shouldRun()) { stop(); return; }
    if (handle !== null) return;
    handle = timers.setInterval(tick, Math.round(1000 / hz));
    tick();
  }

  buildMateriaScreen(root);
  root.addEventListener('click', (e) => {
    const b = e.target?.closest?.('button');
    if (!b || !root.contains(b) || b.disabled) return;
    if (b.dataset.column !== undefined) tapColumn(Number(b.dataset.column));
    else if (b.dataset.slot !== undefined) tapMateria(Number(b.dataset.slot));
    else if (b.dataset.action) tapAction(b.dataset.action);
  });
  labs.onChange((name) => { if (name === MATERIA_FLAG) sync(); });
  show(false);
  return {
    tick,
    turn,
    tapColumn,
    tapMateria,
    tapAction,
    setGate(gate) {
      gateActive = Boolean(gate?.active);
      if (!gateActive) semantic = null;
      sync();
    },
    setBackend(b) { backend = b; sync(); },
    /** Tests: read from `fake` instead of game memory. Flag and gate still apply. */
    setSource(fake) { source = fake; sync(); },
    stop,
    get running() { return handle !== null; },
    get open() { return open; },
    get busy() { return !idle(); },
    get column() { return column; },
    get last() { return last; },
  };
}
