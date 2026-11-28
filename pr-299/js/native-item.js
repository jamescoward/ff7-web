// Native Item screen (#135), behind the Labs flag `native-item` (off by
// default). While the game's Item screen is open (semantic itemScreen():
// a confirmed menu mode, the Item overlay, page 'list' or 'target'), a native
// panel covers the picture: the game's visible item page (IDs and counts
// from inventory(), no names) and the party's HP/MP (partyStatus()).
//
// The ten item rows show every non-empty inventory slot, ten at a time
// (#256 part 2): Prev and Next page through them, and the panel opens on the
// page holding the game's list cursor. On the list page, a tap on an item
// runs itemSlotPlan from the game's list cursor (row and offset) to that
// slot, scrolling the game's list past page 1 when needed, one game frame
// at a time; every step checks both the row and the offset, and a mismatch
// stops the plan. Then it presses Circle (the game moves to the target page). On the target page, a tap on a party
// slot does the same with the party cursor; before its Circle the item's
// count and the slot's HP are read, and afterwards the panel reads them
// again to confirm the use (the count fell by one) or to say no change was
// seen. Back presses Cross. Hide uncovers the picture until the Item screen
// closes. Facts, buttons and plans come from semantic/; this file only
// draws, reads and presses. Input only: no game memory is written.
//
// Stop rules (as the menu panel, #115): any executor stop releases
// everything and sends nothing more, Circle included. Taps are ignored while
// a plan or a press runs. Leaving the Item screen, the flag or the gate
// cancels and releases.
// Original project code, GPL-2.0-or-later.

import { ADDRESS_TABLE } from './semantic/addresses.js';
import { ITEM_SCREEN_ACTIONS } from './semantic/controls.js';
import { ITEM_PAGE_ROWS, ITEM_TARGET_ROWS, itemEntryPage, itemEntryPageOf, itemEntryPages, itemListEntries, itemListSlot, itemRowLabel, itemSlotCursor, itemSlotPlan, itemTargetPlan, itemUseOutcome } from './semantic/item-screen.js';
import { createSemantic } from './semantic/layer.js';
import { createPlanExecutor } from './semantic/planner.js';
import { PAD } from './pad.js';

export const ITEM_FLAG = 'native-item';
export const ITEM_HZ = 4;
/** Plan loop period: about one game frame (60 Hz). */
export const LOOP_MS = 16;
export const PRESS_MS = 100;
/** Polls (at ITEM_HZ) to wait for a use to show in memory before saying no change was seen. */
export const CONFIRM_POLLS = 8;
const SOURCE = 'native-item';

const confirmedInt = (r, key) => (r?.confirmed === true && Number.isInteger(r.value?.[key]) ? r.value[key] : null);

/** Build the panel's fixed parts once: a header, ten item rows, Prev/Next, three party rows, Back and Hide. */
export function buildItemScreen(root) {
  const doc = root.ownerDocument;
  if (root.querySelector('.ni-items')) return;
  const el = (tag, cls, text) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const head = el('div', 'ni-head');
  head.append(el('span', 'ni-title', 'Items'), el('span', 'ni-msg'));
  const items = el('div', 'ni-items');
  for (let row = 0; row < ITEM_PAGE_ROWS; row++) {
    const b = el('button', 'btn ni-item', '—');
    b.type = 'button';
    b.dataset.row = String(row);
    items.append(b);
  }
  const pager = el('div', 'ni-pager');
  const prev = el('button', 'btn ni-prev', 'Prev');
  prev.type = 'button';
  prev.dataset.action = 'prev';
  const pageNo = el('span', 'ni-page', '1/1');
  const next = el('button', 'btn ni-next', 'Next');
  next.type = 'button';
  next.dataset.action = 'next';
  pager.append(prev, pageNo, next);
  const party = el('div', 'ni-party');
  for (let slot = 0; slot < ITEM_TARGET_ROWS; slot++) {
    const b = el('button', 'btn ni-member', '');
    b.type = 'button';
    b.dataset.slot = String(slot);
    party.append(b);
  }
  const nav = el('div', 'ni-nav');
  const back = el('button', 'btn ni-back', ITEM_SCREEN_ACTIONS.back.label);
  back.type = 'button';
  back.dataset.action = 'back';
  const hide = el('button', 'btn ni-hide', 'Hide');
  hide.type = 'button';
  hide.dataset.action = 'hide';
  nav.append(back, hide);
  root.append(head, items, pager, party, nav);
}

/** A party row's text from a partyStatus() value: confirmed numbers only. */
export function memberLabel(slot, status) {
  if (!status) return `Slot ${slot + 1}: —`;
  const pair = (a, b) => (a === null || a === undefined ? '?' : b === null || b === undefined ? `${a}` : `${a}/${b}`);
  return `Slot ${slot + 1}  HP ${pair(status.hp, status.maxHp)}  MP ${pair(status.mp, status.maxMp)}`;
}

// `names` (#260, Labs flag `game-names`): a getter for the name tables built on
// the device (game-names.js), or null; with null every label is the ID label.
export function createItemScreen({ root, mixer, labs, timers = globalThis, hz = ITEM_HZ, semanticFor = createSemantic, names = () => null }) {
  let gateActive = false;
  let backend = null;
  let source = null; // tests: { itemScreen(), inventory(), partyStatus(slot), frame }
  let semantic = null;
  let handle = null; // poll
  let busy = false;
  let view = null; // the last confirmed itemScreen() value with a page, or null
  let entries = []; // itemListEntries() of the last confirmed inventory read
  let rows = []; // itemEntryPage() of the last render
  let pageNo = null; // the native page shown; null until the Item screen opens
  let party = [null, null, null]; // partyStatus values of the last render
  let peek = false; // Hide: uncovered until the Item screen closes
  let run = null; // { exec, loop, kind, ... } while a plan runs
  let pressing = null;
  let starting = false;
  let chosen = null; // { slot, quantity } of the item tapped on the list page
  let check = null; // { slot, partySlot, before, polls } while confirming a use
  let last = null; // last outcome, for tests and debugging

  const doc = root.ownerDocument;
  const msg = () => root.querySelector('.ni-msg');
  const flagOn = () => labs.isOn(ITEM_FLAG);
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
  const idle = () => run === null && pressing === null && !starting;
  const setMsg = (text) => { const m = msg(); if (m) m.textContent = text; };

  function show(on) {
    root.hidden = !on;
    doc.documentElement.toggleAttribute('data-native-item-on', on);
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
    render();
  }

  function render() {
    const page = view?.page ?? null;
    // While a plan runs or a press is held, a tap would be dropped (startPlan
    // needs idle()), so the rows say so instead of looking tappable (#25 CI).
    const ready = idle();
    root.dataset.page = page ?? '';
    const cursorSlot = page === 'list' ? itemListSlot(view.listRow, view.listOffset) : null;
    for (const b of root.querySelectorAll('.ni-item')) {
      const r = rows[Number(b.dataset.row)];
      b.textContent = r ? itemRowLabel(r.item, names()) : '—';
      b.disabled = !(ready && page === 'list' && r?.item);
      b.toggleAttribute('data-cursor', cursorSlot !== null && r?.slot === cursorSlot);
      b.toggleAttribute('data-chosen', page === 'target' && chosen !== null && r?.slot === chosen.slot);
    }
    const pages = itemEntryPages(entries);
    const p = pageNo ?? 0;
    const pn = root.querySelector('.ni-page');
    if (pn) pn.textContent = `${p + 1}/${pages}`;
    const prevB = root.querySelector('.ni-prev');
    const nextB = root.querySelector('.ni-next');
    if (prevB) prevB.disabled = !(view && p > 0);
    if (nextB) nextB.disabled = !(view && p < pages - 1);
    for (const b of root.querySelectorAll('.ni-member')) {
      const slot = Number(b.dataset.slot);
      b.textContent = memberLabel(slot, party[slot]);
      b.disabled = !(ready && page === 'target' && party[slot]);
      b.toggleAttribute('data-cursor', page === 'target' && view.targetSlot === slot);
    }
  }

  async function readParty(sem) {
    const out = [];
    for (let slot = 0; slot < ITEM_TARGET_ROWS; slot++) {
      let r;
      try { r = await sem.partyStatus(slot); } catch { r = null; }
      out.push(r?.value ?? null);
    }
    return out;
  }
  async function readInventory(sem) {
    let r;
    try { r = await sem.inventory(); } catch { r = null; }
    return r?.confirmed === true && Array.isArray(r.value) ? r.value : null;
  }
  const quantityIn = (inv, slot) => (inv ? (inv.find((it) => it.slot === slot)?.quantity ?? 0) : null);

  /** A use was pressed: read the count and HP again until the count falls, or give up. */
  async function confirmUse(sem) {
    const c = check;
    const inv = await readInventory(sem);
    let st;
    try { st = await sem.partyStatus(c.partySlot); } catch { st = null; }
    if (check !== c) return;
    const after = { quantity: quantityIn(inv, c.slot), hp: st?.value?.hp ?? null };
    const out = itemUseOutcome(c.before, after);
    c.polls += 1;
    if (out.used) {
      check = null;
      last = { ok: true, used: true, hpRose: out.hpRose, before: c.before, after };
      const hp = Number.isInteger(c.before.hp) && Number.isInteger(after.hp) ? `, HP ${c.before.hp} → ${after.hp}` : '';
      setMsg(`Used: ×${c.before.quantity} → ×${after.quantity}${hp}`);
    } else if (c.polls >= CONFIRM_POLLS) {
      check = null;
      last = { ok: false, used: false, before: c.before, after, error: { reason: 'no change' } };
      setMsg('No change seen');
    }
  }

  async function tick() {
    if (busy || handle === null) return;
    busy = true;
    try {
      const sem = reader();
      if (!sem) return;
      let s;
      try { s = await sem.itemScreen(); } catch { s = null; }
      if (handle === null || !shouldRun()) return;
      if (!s || s.value === null || s.value === undefined) return; // a failed read changes nothing
      const page = s.confirmed === true ? s.value.page : null;
      if (!page) {
        release();
        view = null;
        peek = false;
        chosen = null;
        check = null;
        pageNo = null;
        show(false);
        return;
      }
      view = s.value;
      const inv = await readInventory(sem);
      if (inv) entries = itemListEntries(inv);
      // Open on the page with the game's list cursor; afterwards Prev/Next decide.
      if (pageNo === null && inv) pageNo = itemEntryPageOf(entries, itemListSlot(view.listRow, view.listOffset));
      pageNo = Math.min(pageNo ?? 0, itemEntryPages(entries) - 1);
      rows = itemEntryPage(entries, pageNo);
      party = await readParty(sem);
      if (check) await confirmUse(sem);
      render();
      show(!peek);
    } finally {
      busy = false;
    }
  }

  /**
   * Fresh cursor for a plan of `kind`: the confirmed party slot, or for the
   * list the confirmed { row, offset } (either may be null), or null.
   */
  async function cursorFor(kind) {
    let s;
    try { s = await reader()?.itemScreen(); } catch { s = null; }
    if (s?.confirmed !== true || s.value?.page !== kind) return null;
    if (kind === 'list') return { row: confirmedInt(s, 'listRow'), offset: confirmedInt(s, 'listOffset') };
    return confirmedInt(s, 'targetSlot');
  }

  /** One turn of the plan loop: read frame and cursor, step the executor, hold its mask. */
  async function turn() {
    const r = run;
    if (!r || r.busy) return;
    const frame = frameNow();
    if (frame === r.lastFrame) return;
    r.busy = true;
    const read = await cursorFor(r.kind);
    r.busy = false;
    if (run !== r) return;
    r.lastFrame = frame;
    // The list plan checks the row and the offset: a pair off the plan reads as -1.
    const cursor = r.kind === 'list' ? itemSlotCursor(r.plan, read) : read;
    const out = r.exec.step(frame, cursor);
    mixer.set(SOURCE, out.mask);
    if (out.state === 'running') return;
    release();
    if (out.state !== 'done') {
      last = { ok: false, kind: r.kind, to: r.to, error: out.error };
      setMsg('Stopped: the cursor did not move as planned');
      return;
    }
    if (r.kind === 'list') {
      chosen = r.chosen;
      last = { ok: true, kind: 'list', to: r.to };
      setMsg('Choose who uses it');
      pressFor(ITEM_SCREEN_ACTIONS.select.button);
      return;
    }
    // Target: read the count and HP just before the use, then press.
    const sem = reader();
    const inv = sem ? await readInventory(sem) : null;
    let st = null;
    try { st = sem ? await sem.partyStatus(r.to) : null; } catch { st = null; }
    if (!shouldRun() || view?.page !== 'target') return;
    const before = { quantity: quantityIn(inv, r.chosen?.slot), hp: st?.value?.hp ?? null };
    check = r.chosen && Number.isInteger(before.quantity) ? { slot: r.chosen.slot, partySlot: r.to, before, polls: 0 } : null;
    last = { ok: true, kind: 'target', to: r.to, before };
    setMsg(check ? 'Checking…' : '');
    pressFor(ITEM_SCREEN_ACTIONS.select.button);
  }

  async function startPlan(kind, to, extra) {
    if (!shouldRun() || !view || view.page !== kind || !idle()) return;
    starting = true;
    const from = await cursorFor(kind);
    starting = false;
    if (!shouldRun() || !view || view.page !== kind || !idle()) return;
    if (from === null || (kind === 'list' && (from.row === null || from.offset === null))) { last = { ok: false, kind, to, error: { reason: 'unread' } }; return; }
    let plan;
    try { plan = kind === 'list' ? itemSlotPlan(from, to) : itemTargetPlan(from, to); } catch { last = { ok: false, kind, to, error: { reason: 'range' } }; return; }
    last = null;
    check = null;
    run = { exec: createPlanExecutor(plan), plan, kind, to, ...extra, busy: false, lastFrame: null, loop: null };
    run.loop = timers.setInterval(turn, LOOP_MS);
    render();
    turn();
  }

  /** A tap on panel row `row` (list page only, non-empty rows only): plan to its inventory slot. */
  function tapItem(row) {
    const r = rows[row];
    if (!r?.item) return Promise.resolve();
    return startPlan('list', r.slot, { chosen: { slot: r.slot, quantity: r.item.quantity } });
  }
  /** A tap on party slot `slot` (target page only). */
  function tapMember(slot) {
    if (!party[slot]) return Promise.resolve();
    return startPlan('target', slot, { chosen });
  }
  function tapAction(id) {
    if (id === 'prev' || id === 'next') {
      if (!view) return;
      const p = (pageNo ?? 0) + (id === 'next' ? 1 : -1);
      pageNo = Math.min(Math.max(p, 0), itemEntryPages(entries) - 1);
      rows = itemEntryPage(entries, pageNo);
      render();
      return;
    }
    if (id === 'hide') {
      if (!view) return;
      peek = true;
      show(false);
      return;
    }
    const a = ITEM_SCREEN_ACTIONS[id];
    if (!a || !shouldRun() || !view || !idle()) return;
    check = null;
    setMsg('');
    pressFor(a.button);
  }

  function stop() {
    if (handle !== null) timers.clearInterval(handle);
    handle = null;
    release();
    view = null;
    peek = false;
    chosen = null;
    check = null;
    pageNo = null;
    show(false);
  }
  function sync() {
    if (!shouldRun()) { stop(); return; }
    if (handle !== null) return;
    handle = timers.setInterval(tick, Math.round(1000 / hz));
    tick();
  }

  buildItemScreen(root);
  root.addEventListener('click', (e) => {
    const b = e.target?.closest?.('button');
    if (!b || !root.contains(b) || b.disabled) return;
    if (b.dataset.row !== undefined) tapItem(Number(b.dataset.row));
    else if (b.dataset.slot !== undefined) tapMember(Number(b.dataset.slot));
    else if (b.dataset.action) tapAction(b.dataset.action);
  });
  labs.onChange((name) => { if (name === ITEM_FLAG) sync(); });
  show(false);
  return {
    tick,
    turn,
    tapItem,
    tapMember,
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
    get planning() { return run !== null; },
    get page() { return view?.page ?? null; },
    /** The native list page shown (0-based), or null while closed. */
    get listPage() { return pageNo; },
    get last() { return last; },
  };
}
