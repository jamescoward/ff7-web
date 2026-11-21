// Labs (#105): off-by-default feature flags for touch features that have not
// had the owner's device check yet. With every flag off the page behaves as
// before. A flag is on when the owner switched it on (kept in localStorage) or
// when the URL says `?labs=a,b` (this visit only; nothing is written).
//
//   import { registerFlag, isOn } from './labs.js';
//   registerFlag('my-feature', { label: 'My feature', description: 'What it does' });
//   if (isOn('my-feature')) { ... }

export const STORAGE_KEY = 'ff7web.labs';

const flags = new Map(); // name -> { name, label, description }
const stored = new Set(); // names switched on and persisted
const visit = new Set(); // names switched on by ?labs= for this load
const listeners = new Set();

function readStored() {
  try {
    const v = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(v)) return v.filter((n) => typeof n === 'string');
  } catch { /* Storage may be blocked or hold junk: all flags off. */ }
  return [];
}
function writeStored(keep = []) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...new Set([...keep, ...stored])].sort())); } catch { /* Optional. */ }
}
export function parseUrlFlags(search) {
  try {
    const raw = new URLSearchParams(search).getAll('labs').join(',');
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  } catch { return []; }
}

const storedNames = new Set(readStored());
const urlNames = new Set(parseUrlFlags(typeof location === 'undefined' ? '' : location.search));

const emit = (name) => { for (const cb of listeners) cb(name, isOn(name)); };

// Unknown names (in storage or the URL) are ignored: only registered flags count.
export function registerFlag(name, { label = name, description = '' } = {}) {
  if (flags.has(name)) return;
  flags.set(name, { name, label, description });
  if (storedNames.has(name)) stored.add(name);
  if (urlNames.has(name)) visit.add(name);
}
export const isOn = (name) => flags.has(name) && (stored.has(name) || visit.has(name));
// Switching in the panel persists, and it overrides the URL for this visit.
export function setFlag(name, on) {
  if (!flags.has(name)) return;
  on ? stored.add(name) : stored.delete(name);
  visit.delete(name);
  // Keep names of flags not registered yet, so another page's choice survives.
  const keep = [...storedNames].filter((n) => !flags.has(n));
  writeStored(keep);
  emit(name);
}
export const listFlags = () => [...flags.values()].map((f) => ({ ...f, on: isOn(f.name), thisVisit: visit.has(f.name) }));
export function onChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// A harmless flag so the panel and its tests have something to toggle.
registerFlag('labs-demo', { label: 'Test flag', description: 'Does nothing. For checking the Labs panel.' });

// The panel: a button in the top bar and a floating list, kept off the pad.
export function createLabsPanel({ button, panel }) {
  const list = panel.querySelector('.labs-list');
  function render() {
    list.replaceChildren();
    for (const f of listFlags()) {
      const row = document.createElement('label');
      row.className = 'btn labs-row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = f.on;
      box.dataset.flag = f.name;
      box.addEventListener('change', () => setFlag(f.name, box.checked));
      const text = document.createElement('span');
      text.textContent = `${f.label}${f.thisVisit ? ' (this visit)' : ''}`;
      const hint = document.createElement('small');
      hint.textContent = f.description;
      const col = document.createElement('span');
      col.className = 'labs-text';
      col.append(text, hint);
      row.append(box, col);
      list.append(row);
    }
  }
  function place() {
    const top = Math.round(button.getBoundingClientRect().bottom + 8);
    panel.style.top = `${top}px`;
    // Stay clear of the on-screen pad (portrait: the panel sits above it).
    // (the drag-to-walk field takes the pad's place when it is shown).
    const tops = ['pad', 'field'].map((id) => document.getElementById(id))
      .filter((el) => el && !el.hidden).map((el) => el.getBoundingClientRect().top);
    // In landscape the pad box spans the screen: also stay above any control that sits under the panel.
    const px = panel.getBoundingClientRect();
    for (const el of document.querySelectorAll('#pad button, #pad [data-btn], #pad > * > *, #field button')) {
      const r = el.getBoundingClientRect();
      if (r.width && r.height && r.top > top && r.left < px.right && r.right > px.left) tops.push(r.top);
    }
    const below = tops.filter((y) => y > top + 120); // a box that starts above the panel (landscape) is not a limit
    const padTop = below.length ? Math.min(...below) : Infinity;
    // The body's bottom padding is the home-bar inset: stay above it.
    const inset = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
    const room = (padTop === Infinity ? window.innerHeight - inset : padTop) - top - 8;
    panel.style.maxHeight = `${Math.max(88, Math.floor(room))}px`;
  }
  function setOpen(open) {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) { render(); place(); }
  }
  button.addEventListener('click', () => setOpen(panel.hidden));
  document.addEventListener('pointerdown', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && !button.contains(e.target)) setOpen(false);
  });
  window.addEventListener('resize', () => { if (!panel.hidden) place(); });
  onChange(() => { if (!panel.hidden) render(); });
  return { setOpen };
}
