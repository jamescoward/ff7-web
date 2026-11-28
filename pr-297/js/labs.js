// Labs (#105): off-by-default feature flags for touch features that have not
// had the owner's device check yet. With every flag off the page behaves as
// before. A flag is on when the owner switched it on (kept in localStorage) or
// when the URL says `?labs=a,b` (this visit only; nothing is written).
//
//   import { registerFlag, isOn } from './labs.js';
//   registerFlag('my-feature', { label: 'My feature', description: 'What it does',
//     pr: 123, checklist: ['First thing to check on the iPhone', '...'] });
//   if (isOn('my-feature')) { ... }

export const STORAGE_KEY = 'ff7web.labs';
// One optional choice per flag (#251), such as the CRT filter's strength:
// { [flag]: value }, kept apart from the on/off list so that format is unchanged.
export const SETTINGS_KEY = 'ff7web.labs.settings';

const flags = new Map(); // name -> { name, label, description, pr, checklist }
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
// `pr` and `checklist` (#137) are the PR that added the flag and its Tier 3
// checklist (at most 5 lines, the same as on the trip log #123), shown under the
// toggle so the owner can check a flag on the iPhone without going to GitHub.
//
// `setting` (#251) is an optional choice shown under the toggle while the flag
// is on: { label, choices: [{ value, label }], initial }. Read it with getSetting().
export function registerFlag(name, { label = name, description = '', pr = null, checklist = [], setting = null } = {}) {
  if (flags.has(name)) return;
  const lines = Array.isArray(checklist) ? checklist.filter((l) => typeof l === 'string' && l).slice(0, 5) : [];
  flags.set(name, { name, label, description, pr: Number.isInteger(pr) ? pr : null, checklist: lines, setting: cleanSetting(setting) });
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
export const listFlags = () => [...flags.values()].map((f) => ({
  ...f, checklist: [...f.checklist], on: isOn(f.name), thisVisit: visit.has(f.name),
  ...(f.setting && { setting: { ...f.setting, choices: f.setting.choices.map((c) => ({ ...c })), value: getSetting(f.name) } }),
}));

function cleanSetting(s) {
  if (!s || !Array.isArray(s.choices)) return null;
  const choices = s.choices.filter((c) => c && typeof c.value === 'string' && c.value)
    .map((c) => ({ value: c.value, label: typeof c.label === 'string' && c.label ? c.label : c.value }));
  if (!choices.length) return null;
  const initial = choices.some((c) => c.value === s.initial) ? s.initial : choices[0].value;
  return { label: typeof s.label === 'string' && s.label ? s.label : 'Setting', choices, initial };
}
function readSettings() {
  try {
    const v = JSON.parse(window.localStorage.getItem(SETTINGS_KEY));
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch { /* Blocked storage or junk: every setting at its initial value. */ }
  return {};
}
const settings = readSettings();
// The flag's chosen value, or its initial one; null for a flag with no setting.
export function getSetting(name) {
  const s = flags.get(name)?.setting;
  if (!s) return null;
  const v = settings[name];
  return s.choices.some((c) => c.value === v) ? v : s.initial;
}
export function setSetting(name, value) {
  const s = flags.get(name)?.setting;
  if (!s || !s.choices.some((c) => c.value === value)) return;
  settings[name] = value;
  try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* Optional. */ }
  emit(name);
}
// "Reset all flags" (#137): every flag off, the stored choice removed (unknown
// names too), and ?labs= dropped from the address so a reload stays off.
export function resetFlags() {
  const wasOn = [...flags.keys()].filter(isOn);
  stored.clear();
  visit.clear();
  for (const k of Object.keys(settings)) delete settings[k];
  try { window.localStorage.removeItem(SETTINGS_KEY); } catch { /* Optional. */ }
  storedNames.clear();
  urlNames.clear();
  try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* Optional. */ }
  try {
    const url = new URL(location.href);
    if (url.searchParams.has('labs')) {
      url.searchParams.delete('labs');
      history.replaceState(history.state, '', url);
    }
  } catch { /* Not in a page. */ }
  for (const name of wasOn) emit(name);
}
export function onChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// A harmless flag so the panel and its tests have something to toggle.
registerFlag('labs-demo', { label: 'Test flag', description: 'Does nothing. For checking the Labs panel.' });

// The panel: a button in the top bar and a floating list, kept off the pad.
export function createLabsPanel({ button, panel }) {
  const list = panel.querySelector('.labs-list');
  const reset = panel.querySelector('.labs-reset');
  reset?.addEventListener('click', () => resetFlags());
  function render() {
    list.replaceChildren();
    for (const f of listFlags()) {
      const item = document.createElement('div');
      item.className = 'labs-item';
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
      item.append(row);
      if (f.setting && f.on) {
        const pick = document.createElement('label');
        pick.className = 'labs-setting';
        const name = document.createElement('small');
        name.textContent = f.setting.label;
        const select = document.createElement('select');
        select.className = 'btn';
        select.dataset.setting = f.name;
        for (const c of f.setting.choices) {
          const o = document.createElement('option');
          o.value = c.value;
          o.textContent = c.label;
          o.selected = c.value === f.setting.value;
          select.append(o);
        }
        select.addEventListener('change', () => setSetting(f.name, select.value));
        pick.append(name, select);
        item.append(pick);
      }
      if (f.checklist.length) {
        const check = document.createElement('div');
        check.className = 'labs-checklist';
        check.dataset.flag = f.name;
        const head = document.createElement('small');
        head.textContent = f.pr ? `iPhone check (PR #${f.pr}):` : 'iPhone check:';
        const ol = document.createElement('ol');
        for (const line of f.checklist) {
          const li = document.createElement('li');
          li.textContent = line;
          ol.append(li);
        }
        check.append(head, ol);
        item.append(check);
      }
      list.append(item);
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
