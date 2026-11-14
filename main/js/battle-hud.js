// Battle status strip (#133), behind the Labs flag `battle-hud` (off by
// default). In a confirmed battle, a strip below the picture (portrait) shows
// one row per party slot with HP, MP, ATB and limit, read from
// semantic.partyStatus(slot) (#130) and turned into bars by
// semantic/party-gauges.js. A value that is not confirmed is left out, not
// guessed; an empty or unconfirmed slot has no row. The strip never takes a
// touch. Labels are "Slot 1/2/3": no names are read.
// Original project code, GPL-2.0-or-later.

import { ADDRESS_TABLE } from './semantic/addresses.js';
import { createSemantic } from './semantic/layer.js';
import { partyGauges } from './semantic/party-gauges.js';

export const HUD_FLAG = 'battle-hud';
export const HUD_HZ = 4;
const SLOTS = [0, 1, 2];

/** UI policy over a mode() result: show the strip only in a confirmed battle. */
export const hudForMode = (sample) => sample?.value?.mode === 'battle' && sample.confirmed === true;

/**
 * The rows to draw, from three partyStatus results: [{ slot, gauges }] for
 * the slots with a confirmed, non-empty value. DOM-free.
 */
export function hudRows(results) {
  const rows = [];
  results.forEach((r, slot) => {
    if (!r?.value || r.confirmed !== true) return;
    const gauges = partyGauges(r.value);
    if (gauges && Object.values(gauges).some(Boolean)) rows.push({ slot, gauges });
  });
  return rows;
}

const pct = (f) => `${Math.round(f * 100)}%`;

function cell(doc, key, label) {
  const el = doc.createElement('div');
  el.className = 'hud-cell';
  el.dataset.key = key;
  const top = doc.createElement('div');
  top.className = 'hud-top';
  const name = doc.createElement('span');
  name.className = 'hud-name';
  name.textContent = label;
  const num = doc.createElement('span');
  num.className = 'hud-num';
  top.append(name, num);
  const bar = doc.createElement('div');
  bar.className = 'hud-bar';
  const fill = doc.createElement('div');
  fill.className = 'hud-fill';
  bar.append(fill);
  el.append(top, bar);
  return el;
}

/** Draw `rows` (hudRows) into `root`, reusing one element per slot. */
export function renderHud(root, rows) {
  const doc = root.ownerDocument;
  const bySlot = new Map(rows.map((r) => [r.slot, r.gauges]));
  for (const slot of SLOTS) {
    let row = root.querySelector(`.hud-row[data-slot="${slot}"]`);
    if (!row) {
      row = doc.createElement('div');
      row.className = 'hud-row';
      row.dataset.slot = String(slot);
      const label = doc.createElement('span');
      label.className = 'hud-slot';
      label.textContent = `Slot ${slot + 1}`;
      row.append(label, cell(doc, 'hp', 'HP'), cell(doc, 'mp', 'MP'), cell(doc, 'atb', 'ATB'), cell(doc, 'limit', 'Limit'));
      root.append(row);
    }
    const g = bySlot.get(slot);
    row.hidden = !g;
    if (!g) continue;
    for (const key of ['hp', 'mp', 'atb', 'limit']) {
      const el = row.querySelector(`.hud-cell[data-key="${key}"]`);
      const v = g[key];
      el.hidden = !v;
      if (!v) continue;
      const text = key === 'hp' || key === 'mp' ? `${v.value}/${v.max}` : pct(v.fraction);
      el.querySelector('.hud-num').textContent = text;
      el.querySelector('.hud-fill').style.width = pct(v.fraction);
      el.toggleAttribute('data-full', Boolean(v.full));
      el.setAttribute('aria-label', `${el.querySelector('.hud-name').textContent} ${text}`);
    }
  }
}

/**
 * @param {object} o
 * @param {HTMLElement} o.root   the strip (hidden while it is off)
 * @param {object} o.labs        labs.js
 */
export function createBattleHud({ root, labs, timers = globalThis, hz = HUD_HZ, semanticFor = createSemantic }) {
  let gateActive = false;
  let backend = null;
  let source = null; // tests: an object with mode() and partyStatus(slot)
  let semantic = null;
  let handle = null;
  let busy = false;

  const flagOn = () => labs.isOn(HUD_FLAG);
  const reader = () => {
    if (source) return source;
    if (!gateActive || !backend) return null;
    // Read-only view: readMem plus the last frame the worker posted, so mode()'s
    // movie window counts game frames, whatever the polling rate (#146, #181).
    semantic ??= semanticFor({
      backend: { readMem: (a, l) => backend.readMem(a, l), get frame() { return backend.frame; } },
      exeSha1: ADDRESS_TABLE.exe,
    });
    return semantic;
  };
  const shouldRun = () => flagOn() && gateActive && (source !== null || backend !== null);
  const show = (on) => {
    root.hidden = !on;
    root.ownerDocument.documentElement.toggleAttribute('data-hud-on', on);
  };

  async function tick() {
    if (busy || handle === null) return;
    busy = true;
    try {
      const sem = reader();
      if (!sem) return;
      let mode;
      try { mode = await sem.mode(); } catch { mode = null; }
      if (handle === null || !shouldRun()) return;
      // A failed read says nothing about the mode: leave the strip as it is.
      if (!mode?.value) return;
      if (!hudForMode(mode)) { show(false); return; }
      const results = [];
      for (const slot of SLOTS) {
        try { results.push(await sem.partyStatus(slot)); } catch { results.push(null); }
      }
      if (handle === null || !shouldRun()) return;
      const rows = hudRows(results);
      renderHud(root, rows);
      show(rows.length > 0);
    } finally {
      busy = false;
    }
  }

  function stop() {
    if (handle !== null) timers.clearInterval(handle);
    handle = null;
    show(false);
  }
  function sync() {
    if (!shouldRun()) { stop(); return; }
    if (handle !== null) return;
    semantic?.clearMovieWindow?.();
    handle = timers.setInterval(tick, Math.round(1000 / hz));
    tick();
  }

  labs.onChange((name) => { if (name === HUD_FLAG) sync(); });
  show(false);
  return {
    tick,
    setGate(gate) {
      gateActive = Boolean(gate?.active);
      if (!gateActive) semantic = null;
      sync();
    },
    setBackend(b) { backend = b; sync(); },
    /** Tests: read from `fake` ({ mode(), partyStatus(slot) }) instead of game memory. Flag and gate still apply. */
    setSource(fake) { source = fake; sync(); },
    stop,
    get running() { return handle !== null; },
  };
}
