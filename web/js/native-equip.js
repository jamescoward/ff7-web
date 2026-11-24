// Native Equip screen (#121 v1, #254 v2), behind the Labs flag
// `native-equip` (off by default). While the game's Equip screen is open
// (semantic equipScreen(): a confirmed menu mode and the Equip overlay), a
// native panel covers the picture: each party member's weapon, armor and
// accessory (IDs from equipment(), no names), the three slots of the member
// whose screen this is, and the rows of the game's list for the chosen slot.
//
// The member is the one the game opened Equip for: the confirmed party pick
// (#215), or the only member of a party of one. The game's list holds only
// what that member can equip (kernel data, not read), so list rows are
// offered by index, one per spare of that kind in the inventory (an upper
// bound), and the savemap says afterwards what was equipped (#254 option
// (a), notes/254-native-equip-v2.md).
//
// Tap a slot, then a list row. The panel runs, one game frame at a time and
// checking equipCursors() at every step:
//   1. equipSlotPlan from the read slot cursor to the chosen slot;
//   2. Circle, then EQUIP_LIST_OPEN_FRAMES frames (the list opens);
//   3. equipListPlan from the read list cursor (row 0, offset 0) to the row;
//   4. a check that the slot and list cursors read the target, then Circle.
// Afterwards it reads the party's equipment: "Equipped" when only that
// member's slot changed, else "something else changed" or "no change seen".
// With the slot cursor on Weapon and list row 1, this is v1's tap (Circle,
// 60 frames, Circle; save-boot-15c).
//
// No page variable is read (#216), so taps run only while the slot page is
// known: from the screen's opening state, or after the panel's own tap
// equipped something, with no other input since (v1's watch on the mixer).
//
// Facts, rules, plans and buttons come from semantic/; this file only draws,
// reads and presses. Input only: no game memory is written. Stop rules (as
// the native Item and Materia screens): any executor stop or failed check
// releases everything and sends nothing more, Circle included. Leaving the
// Equip screen, the flag or the gate cancels and releases. Back presses
// Cross; Hide uncovers the picture until the Equip screen closes.
// Original project code, GPL-2.0-or-later.

import { ADDRESS_TABLE } from './semantic/addresses.js';
import { EQUIP_SCREEN_ACTIONS } from './semantic/controls.js';
import {
  EQUIP_LIST_OPEN_FRAMES, EQUIP_PARTY_SLOTS, EQUIP_SLOT_KINDS, equipChosenSlot, equipListIndex, equipListPlan,
  equipListRowLabel, equipListRows, equipMemberLabel, equipSlotKind, equipSlotLabel, equipSlotPlan, equipV2Outcome,
  equipV2TapAllowed,
} from './semantic/equip-screen.js';
import { createSemantic } from './semantic/layer.js';
import { createPlanExecutor } from './semantic/planner.js';
import { PAD } from './pad.js';

export const EQUIP_FLAG = 'native-equip';
export const EQUIP_HZ = 4;
/** Loop period while a tap runs: about one game frame (60 Hz). */
export const LOOP_MS = 16;
export const PRESS_MS = 100;
/** Polls (at EQUIP_HZ) to wait for the change to show before saying no change was seen. */
export const CONFIRM_POLLS = 8;
const SOURCE = 'native-equip';

const REASON_TEXT = Object.freeze({
  'party pick not read': 'Equip with the pad: whose screen this is is not read',
  'page not known': 'Equip with the pad: close and reopen Equip to use the panel again',
  'cursor not read': 'Move the game\'s cursor back to the slots, list closed, to use the panel',
  'no entry': '',
  settling: '',
});
const KIND_TEXT = Object.freeze({ weapon: 'weapon', armor: 'armor', accessory: 'accessory' });

/** Build the panel's fixed parts once: a header, three member rows, three slot buttons, a list, Back and Hide. */
export function buildEquipScreen(root) {
  const doc = root.ownerDocument;
  if (root.querySelector('.ne-rows')) return;
  const el = (tag, cls, text) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const head = el('div', 'ne-head');
  head.append(el('span', 'ne-title', 'Equip'), el('span', 'ne-msg'));
  const members = el('div', 'ne-members');
  for (let slot = 0; slot < EQUIP_PARTY_SLOTS; slot++) {
    const d = el('div', 'ne-member', '');
    d.dataset.slot = String(slot);
    members.append(d);
  }
  const slots = el('div', 'ne-slots');
  EQUIP_SLOT_KINDS.forEach((_, s) => {
    const b = el('button', 'btn ne-slot', '');
    b.type = 'button';
    b.dataset.equipSlot = String(s);
    slots.append(b);
  });
  const rows = el('div', 'ne-rows');
  const nav = el('div', 'ne-nav');
  const back = el('button', 'btn ne-back', EQUIP_SCREEN_ACTIONS.back.label);
  back.type = 'button';
  back.dataset.action = 'back';
  const hide = el('button', 'btn ne-hide', 'Hide');
  hide.type = 'button';
  hide.dataset.action = 'hide';
  nav.append(back, hide);
  root.append(head, members, slots, rows, nav);
}

export function createEquipScreen({ root, mixer, labs, timers = globalThis, hz = EQUIP_HZ, semanticFor = createSemantic }) {
  // Without a way to see other input, the page can't be known: taps stay off.
  const canWatch = typeof mixer.onChange === 'function';
  let gateActive = false;
  let backend = null;
  let source = null; // tests: { equipScreen(), equipCursors(), equipment(slot), inventory(), partyPick(), frame }
  let semantic = null;
  let handle = null; // poll
  let busy = false;
  let open = false;
  let openFrame = null; // game frame when the open screen was first seen
  let members = [null, null, null];
  let pick = null; // partyPick() while the Equip screen is open (#215), or null
  let cursors = null; // the last equipCursors() value
  let inventory = [];
  let chosen = null; // the slot row (0-2) the next tap fills
  let slotPage = false; // the slot page is known to show: opening state or after our own tap, no other input since
  let armed = false; // the opening press has been released, so later input counts
  let ours = 0; // the mask this screen holds in the mixer
  let peek = false;
  let run = null; // the running tap: { phase, exec, loop, slot, index, before, memberSlot, waitFrom, busy, lastFrame }
  let pressing = null;
  let check = null; // { memberSlot, kind, before, polls } while confirming
  let last = null;

  const doc = root.ownerDocument;
  const msg = () => root.querySelector('.ne-msg');
  const flagOn = () => labs.isOn(EQUIP_FLAG);
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
  const framesOpen = () => {
    const f = frameNow();
    return Number.isInteger(f) && Number.isInteger(openFrame) ? f - openFrame : null;
  };
  const memberSlot = () => equipChosenSlot(members, pick);
  const rowsFor = (slot) => equipListRows(inventory, equipSlotKind(slot));
  const tapState = () => {
    const ms = memberSlot();
    return { open, framesOpen: framesOpen(), memberSlot: ms, member: ms === null ? null : members[ms], cursors, rows: rowsFor(chosen), slotPage };
  };

  function show(on) {
    root.hidden = !on;
    doc.documentElement.toggleAttribute('data-native-equip-on', on);
  }
  function release() {
    if (run) { timers.clearInterval(run.loop); run = null; }
    if (pressing !== null) timers.clearTimeout(pressing);
    pressing = null;
    hold(0);
  }
  function hold(mask) {
    ours = mask;
    mixer.set(SOURCE, mask);
  }
  function pressFor(button) {
    hold(PAD[button]);
    pressing = timers.setTimeout(() => { pressing = null; hold(0); render(); }, PRESS_MS);
  }
  function reset() {
    release();
    open = false;
    openFrame = null;
    peek = false;
    check = null;
    chosen = null;
    slotPage = false;
    armed = false;
    cursors = null;
    inventory = [];
    members = [null, null, null];
    pick = null;
  }

  /**
   * Every change of the pad mask: input from another source (after the
   * opening press is released) means the page is no longer known.
   */
  function onPad(mask) {
    if (!open || !slotPage) return;
    const others = mask & ~ours;
    if (!armed) { if (others === 0) armed = true; return; }
    if (others !== 0) {
      slotPage = false;
      render();
    }
  }

  function render() {
    const st = tapState();
    const ms = st.memberSlot;
    for (const d of root.querySelectorAll('.ne-member')) {
      const slot = Number(d.dataset.slot);
      d.textContent = equipMemberLabel(slot, members[slot]);
      d.toggleAttribute('data-chosen', ms === slot);
    }
    for (const b of root.querySelectorAll('.ne-slot')) {
      const s = Number(b.dataset.equipSlot);
      b.textContent = equipSlotLabel(s, st.member);
      b.disabled = !(idle() && st.member);
      b.toggleAttribute('data-chosen', chosen === s);
      b.toggleAttribute('data-cursor', cursors?.slot === s);
    }
    const list = root.querySelector('.ne-rows');
    const rows = st.rows;
    while (list.children.length < rows.length) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'btn ne-row';
      list.append(b);
    }
    while (list.children.length > rows.length) list.lastChild.remove();
    let why = null;
    rows.forEach((r, i) => {
      const b = list.children[i];
      b.dataset.index = String(r.index);
      b.textContent = equipListRowLabel(r);
      const a = equipV2TapAllowed(st, chosen, r.index);
      b.disabled = !(a.ok && idle());
      if (!a.ok && why === null) why = a.reason;
    });
    if (idle() && !last) {
      if (why) setMsg(REASON_TEXT[why] ?? '');
      else if (st.member && chosen !== null && rows.length === 0) setMsg(`No spare ${KIND_TEXT[equipSlotKind(chosen)]}`);
      else setMsg('');
    }
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
  async function readPick(sem) {
    if (typeof sem.partyPick !== 'function') return null;
    let r;
    try { r = await sem.partyPick(); } catch { r = null; }
    return r?.confirmed === true && Number.isInteger(r.value) ? r.value : null;
  }
  async function readInventory(sem) {
    let r;
    try { r = await sem.inventory(); } catch { r = null; }
    return r?.confirmed === true && Array.isArray(r.value) ? r.value : null;
  }
  async function readCursors(sem) {
    if (!sem || typeof sem.equipCursors !== 'function') return null;
    let r;
    try { r = await sem.equipCursors(); } catch { r = null; }
    return r?.confirmed === true && r.value ? r.value : null;
  }

  function confirmChange() {
    const c = check;
    c.polls += 1;
    const out = equipV2Outcome(c.before, members, c.memberSlot, c.kind);
    if (out === 'none' && c.polls < CONFIRM_POLLS) return;
    check = null;
    const was = c.before[c.memberSlot]?.[c.kind];
    const now = members[c.memberSlot]?.[c.kind];
    last = { ok: out === 'equipped', outcome: out, memberSlot: c.memberSlot, kind: c.kind, before: was, after: now };
    const n = (v) => (Number.isInteger(v) ? `#${v}` : 'none');
    // Circle on a list entry returns to the slot page (#216 18b: the slot
    // cursor reads afterwards); after anything else the page is not known.
    slotPage = out === 'equipped';
    if (out === 'equipped') setMsg(`Equipped: ${KIND_TEXT[c.kind]} ${n(was)} → ${n(now)}`);
    else if (out === 'other') setMsg('Something else changed; check the game\'s screen');
    else setMsg('No change seen');
  }

  async function tick() {
    if (busy || handle === null) return;
    busy = true;
    try {
      const sem = reader();
      if (!sem) return;
      let s;
      try { s = await sem.equipScreen(); } catch { s = null; }
      if (handle === null || !shouldRun()) return;
      if (!s || s.value === null || s.value === undefined) return; // a failed read changes nothing
      const isOpen = s.confirmed === true && s.value.open === true;
      if (!isOpen) {
        if (open || !root.hidden) { reset(); last = null; show(false); }
        return;
      }
      if (!open) {
        open = true;
        openFrame = frameNow();
        slotPage = canWatch; // the screen opens on the slot page (#121)
        armed = (mixer.mask & ~ours) === 0;
        last = null;
      }
      members = await readMembers(sem);
      pick = await readPick(sem);
      const inv = await readInventory(sem);
      if (inv) inventory = inv;
      if (run === null) cursors = await readCursors(sem);
      if (chosen === null) chosen = Number.isInteger(cursors?.slot) ? cursors.slot : 0;
      if (check) confirmChange();
      render();
      show(!peek);
    } finally {
      busy = false;
    }
  }

  function fail(reason, extra = {}) {
    const r = run;
    release();
    slotPage = false;
    last = { ok: false, slot: r?.slot ?? null, index: r?.index ?? null, error: { reason, ...extra } };
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
    const cur = await readCursors(reader());
    r.busy = false;
    if (run !== r) return;
    r.lastFrame = frame;
    if (r.phase === 'slot') {
      const out = r.exec.step(frame, Number.isInteger(cur?.slot) ? cur.slot : null);
      hold(out.mask);
      if (out.state === 'running') return;
      if (out.state !== 'done') { fail(out.error.reason, { phase: 'slot' }); return; }
      r.phase = 'open';
      r.waitFrom = frame;
      pressFor(EQUIP_SCREEN_ACTIONS.select.button);
      return;
    }
    if (r.phase === 'open') {
      if (pressing !== null || frame - r.waitFrom < EQUIP_LIST_OPEN_FRAMES) return;
      const from = cur ? { row: cur.listRow, offset: cur.listOffset } : null;
      if (!from || equipListIndex(from.row, from.offset) === null) { fail('unread', { phase: 'list' }); return; }
      let plan;
      try { plan = equipListPlan(from, r.index); } catch { fail('range', { phase: 'list' }); return; }
      r.phase = 'list';
      r.exec = createPlanExecutor(plan);
      // fall through to the first list step on this frame
    }
    if (r.phase === 'list') {
      const index = cur ? equipListIndex(cur.listRow, cur.listOffset) : null;
      const out = r.exec.step(frame, index);
      hold(out.mask);
      if (out.state === 'running') return;
      if (out.state !== 'done') { fail(out.error.reason, { phase: 'list' }); return; }
      // The final check before the press that equips.
      if (!(cur && cur.slot === r.slot && index === r.index)) { fail('check', { phase: 'equip' }); return; }
      const target = r;
      release();
      check = { memberSlot: target.memberSlot, kind: equipSlotKind(target.slot), before: target.before, polls: 0 };
      setMsg('Checking…');
      pressFor(EQUIP_SCREEN_ACTIONS.select.button);
      render();
    }
  }

  /** A tap on slot row `s` (0 Weapon, 1 Armor, 2 Accessory): chooses what the next list tap fills. */
  function tapSlot(s) {
    if (!shouldRun() || !open || !idle() || equipSlotKind(s) === null) return;
    chosen = s;
    last = null;
    render();
  }

  /** A tap on list row `index` of the chosen slot. */
  function tapRow(index) {
    if (!shouldRun() || !idle()) return;
    const st = tapState();
    const a = equipV2TapAllowed(st, chosen, index);
    if (!a.ok) { last = { ok: false, slot: chosen, index, error: { reason: a.reason } }; return; }
    let plan;
    try { plan = equipSlotPlan(cursors.slot, chosen); } catch { last = { ok: false, slot: chosen, index, error: { reason: 'range' } }; return; }
    last = null;
    const before = members.map((m) => (m ? { ...m } : null));
    run = { phase: 'slot', exec: createPlanExecutor(plan), loop: null, slot: chosen, index, before, memberSlot: st.memberSlot, waitFrom: null, busy: false, lastFrame: null };
    run.loop = timers.setInterval(turn, LOOP_MS);
    setMsg('Equipping…');
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
    const a = EQUIP_SCREEN_ACTIONS[id];
    if (!a || !shouldRun() || !open || !idle()) return;
    slotPage = false;
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

  buildEquipScreen(root);
  root.addEventListener('click', (e) => {
    const b = e.target?.closest?.('button');
    if (!b || !root.contains(b) || b.disabled) return;
    if (b.dataset.equipSlot !== undefined) tapSlot(Number(b.dataset.equipSlot));
    else if (b.dataset.index !== undefined) tapRow(Number(b.dataset.index));
    else if (b.dataset.action) tapAction(b.dataset.action);
  });
  labs.onChange((name) => { if (name === EQUIP_FLAG) sync(); });
  if (canWatch) mixer.onChange(onPad);
  show(false);
  return {
    tick,
    turn,
    tapSlot,
    tapRow,
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
    get chosen() { return chosen; },
    get slotPage() { return slotPage; },
    /** v1's name for the opening state (#121). */
    get pristine() { return slotPage; },
    get last() { return last; },
  };
}
