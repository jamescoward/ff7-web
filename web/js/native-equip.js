// Native Equip screen (#121), behind the Labs flag `native-equip` (off by
// default). While the game's Equip screen is open (semantic equipScreen():
// a confirmed menu mode and the Equip overlay), a native panel covers the
// picture: each party member's weapon, armor and accessory (IDs from
// equipment(), no names) and the spare weapons in the inventory (IDs and
// counts from inventory()).
//
// Only what Tier 2 showed is offered (#121 part 1, save-boot-15c): from the
// screen's opening state, with one party member, Circle and then Circle 60
// frames later equips the first weapon in the game's list. So the first
// spare weapon is tappable only when exactly one party slot is occupied,
// the screen has been open EQUIP_SETTLE_FRAMES, and no other input has been
// seen since it opened (the opening Circle's release aside). The tap presses
// Circle, waits EQUIP_STEP_FRAMES game frames, presses Circle, then reads
// the member's weapon to confirm the change, or to say no change, or a
// different one, was seen. After one tap the opening state is gone, so taps
// stay off until the Equip screen is closed and opened again. Back presses
// Cross; Hide uncovers the picture until the Equip screen closes. Facts,
// rules and buttons come from semantic/; this file only draws, reads and
// presses. Input only: no game memory is written.
//
// Stop rules (as the native Item screen, #135): leaving the Equip screen,
// the flag or the gate cancels a running tap and releases its buttons.
// Original project code, GPL-2.0-or-later.

import { ADDRESS_TABLE } from './semantic/addresses.js';
import { EQUIP_SCREEN_ACTIONS } from './semantic/controls.js';
import {
  EQUIP_FIRST_WEAPON_PRESSES, EQUIP_PARTY_SLOTS, equipMemberLabel, equipMemberSlot, equipOutcome,
  equipTapAllowed, spareWeaponLabel, spareWeapons,
} from './semantic/equip-screen.js';
import { createSemantic } from './semantic/layer.js';
import { PAD } from './pad.js';

export const EQUIP_FLAG = 'native-equip';
export const EQUIP_HZ = 4;
/** Loop period while a tap runs: about one game frame (60 Hz). */
export const LOOP_MS = 16;
export const PRESS_MS = 100;
/** Polls (at EQUIP_HZ) to wait for the weapon to change before saying no change was seen. */
export const CONFIRM_POLLS = 8;
/** Spare weapon rows shown. */
export const WEAPON_ROWS = 6;
const SOURCE = 'native-equip';

const REASON_TEXT = Object.freeze({
  'party pick not read': 'Equip with the pad: the party pick is not read yet',
  'not the opening state': 'Equip with the pad: close and reopen Equip to use the panel again',
  'list order not read': '',
  settling: '',
});

/** Build the panel's fixed parts once: a header, three member rows, weapon rows, Back and Hide. */
export function buildEquipScreen(root) {
  const doc = root.ownerDocument;
  if (root.querySelector('.ne-weapons')) return;
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
  const weapons = el('div', 'ne-weapons');
  for (let row = 0; row < WEAPON_ROWS; row++) {
    const b = el('button', 'btn ne-weapon', '—');
    b.type = 'button';
    b.dataset.row = String(row);
    weapons.append(b);
  }
  const nav = el('div', 'ne-nav');
  const back = el('button', 'btn ne-back', EQUIP_SCREEN_ACTIONS.back.label);
  back.type = 'button';
  back.dataset.action = 'back';
  const hide = el('button', 'btn ne-hide', 'Hide');
  hide.type = 'button';
  hide.dataset.action = 'hide';
  nav.append(back, hide);
  root.append(head, members, weapons, nav);
}

export function createEquipScreen({ root, mixer, labs, timers = globalThis, hz = EQUIP_HZ, semanticFor = createSemantic }) {
  let gateActive = false;
  let backend = null;
  let source = null; // tests: { equipScreen(), equipment(slot), inventory(), frame }
  let semantic = null;
  let handle = null; // poll
  let busy = false;
  let open = false;
  let openFrame = null; // game frame when the open screen was first seen
  let pristine = false; // still in the opening state: no tap and no other input since it opened
  let armed = false; // the opening press has been released, so later input counts
  let ours = 0; // the mask this screen holds in the mixer
  let members = [null, null, null];
  let weapons = [];
  let peek = false;
  let run = null; // { loop, start, next, memberSlot, wanted, before } while a tap's presses run
  let pressing = null;
  let check = null; // { memberSlot, wanted, before, polls } while confirming
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
  const tapState = () => ({ open, framesOpen: framesOpen(), pristine, memberSlot: equipMemberSlot(members), weapons });

  function show(on) {
    root.hidden = !on;
    doc.documentElement.toggleAttribute('data-native-equip-on', on);
  }
  function release() {
    if (run) { timers.clearInterval(run.loop); run = null; }
    if (pressing !== null) timers.clearTimeout(pressing);
    pressing = null;
    ours = 0;
    mixer.set(SOURCE, 0);
  }
  function pressFor(button) {
    ours = PAD[button];
    mixer.set(SOURCE, ours);
    pressing = timers.setTimeout(() => { pressing = null; ours = 0; mixer.set(SOURCE, 0); }, PRESS_MS);
  }
  function reset() {
    release();
    open = false;
    openFrame = null;
    pristine = false;
    armed = false;
    peek = false;
    check = null;
    weapons = [];
    members = [null, null, null];
  }

  /**
   * Every change of the pad mask: while pristine, input from another source
   * (after the opening press is released) ends the opening state.
   */
  function onPad(mask) {
    if (!open || !pristine) return;
    const others = mask & ~ours;
    if (!armed) { if (others === 0) armed = true; return; }
    if (others !== 0) {
      pristine = false;
      render();
    }
  }

  function render() {
    const st = tapState();
    for (const d of root.querySelectorAll('.ne-member')) {
      const slot = Number(d.dataset.slot);
      d.textContent = equipMemberLabel(slot, members[slot]);
      d.toggleAttribute('data-chosen', st.memberSlot === slot);
    }
    let why = null;
    for (const b of root.querySelectorAll('.ne-weapon')) {
      const row = Number(b.dataset.row);
      const w = weapons[row];
      b.textContent = spareWeaponLabel(w);
      const a = equipTapAllowed(st, row);
      b.disabled = !(a.ok && idle());
      if (row === 0 && w) why = a.reason;
    }
    if (idle() && !last) setMsg(why ? REASON_TEXT[why] ?? '' : '');
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
  async function readInventory(sem) {
    let r;
    try { r = await sem.inventory(); } catch { r = null; }
    return r?.confirmed === true && Array.isArray(r.value) ? r.value : null;
  }

  function confirmChange() {
    const c = check;
    const after = members[c.memberSlot]?.weapon ?? null;
    c.polls += 1;
    const out = equipOutcome(c.before, after, c.wanted);
    if (out === 'none' && c.polls < CONFIRM_POLLS) return;
    check = null;
    last = { ok: out === 'equipped', outcome: out, before: c.before, after, wanted: c.wanted };
    if (out === 'equipped') setMsg(`Equipped: weapon #${c.before} → #${after}`);
    else if (out === 'other') setMsg(`Changed to weapon #${after}, not #${c.wanted}`);
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
        pristine = canWatch;
        armed = false;
        last = null;
        armed = (mixer.mask & ~ours) === 0;
      }
      members = await readMembers(sem);
      const inv = await readInventory(sem);
      if (inv) weapons = spareWeapons(inv).slice(0, WEAPON_ROWS);
      if (check) confirmChange();
      render();
      show(!peek);
    } finally {
      busy = false;
    }
  }

  /** One turn of a tap: press each planned button once its game frame has come. */
  function turn() {
    const r = run;
    if (!r) return;
    if (!shouldRun() || !open) { release(); return; }
    const f = frameNow();
    if (!Number.isInteger(f)) return;
    r.start ??= f;
    const p = EQUIP_FIRST_WEAPON_PRESSES[r.next];
    if (!p || pressing !== null || f - r.start < p.at) return;
    pressFor(EQUIP_SCREEN_ACTIONS[p.action].button);
    r.next += 1;
    if (r.next < EQUIP_FIRST_WEAPON_PRESSES.length) return;
    timers.clearInterval(r.loop);
    run = null;
    check = { memberSlot: r.memberSlot, wanted: r.wanted, before: r.before, polls: 0 };
    setMsg('Checking…');
  }

  /** A tap on spare-weapon row `row`. */
  function tapWeapon(row) {
    if (!shouldRun() || !idle()) return;
    const st = tapState();
    const a = equipTapAllowed(st, row);
    if (!a.ok) { last = { ok: false, row, error: { reason: a.reason } }; return; }
    const before = members[st.memberSlot]?.weapon;
    if (!Number.isInteger(before)) { last = { ok: false, row, error: { reason: 'unread' } }; return; }
    pristine = false;
    last = null;
    run = { loop: null, start: null, next: 0, memberSlot: st.memberSlot, wanted: weapons[row].number, before };
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
    // Any press of ours leaves the opening state too.
    pristine = false;
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
    if (b.dataset.row !== undefined) tapWeapon(Number(b.dataset.row));
    else if (b.dataset.action) tapAction(b.dataset.action);
  });
  labs.onChange((name) => { if (name === EQUIP_FLAG) sync(); });
  // Without a way to see other input, the opening state can't be trusted: never pristine.
  const canWatch = typeof mixer.onChange === 'function';
  if (canWatch) mixer.onChange(onPad);
  show(false);
  return {
    tick,
    turn,
    tapWeapon,
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
    get pristine() { return pristine; },
    get busy() { return !idle(); },
    get last() { return last; },
  };
}
