// Suspend/resume (#119), Labs flag `suspend`: when the page is hidden, store an
// emulator save state in IndexedDB under the disc's key; on the next load of
// the same disc offer "Resume". "Export state" / "Import state" keep a copy
// outside the browser, which Safari may evict. The memory card is not touched
// here: the worker keeps the card as it was across a state load.
//
// Design choices:
//  * Storage is its own database (not the card's), one record per disc key.
//  * Resume keeps the stored state until the next suspend replaces it, or the
//    player taps "Start fresh". While an offer is waiting, a suspend does NOT
//    overwrite it (otherwise hiding the page right after loading would replace
//    the old state with a fresh boot).
//  * UNVERIFIED on real iOS Safari: whether the IndexedDB write that follows a
//    visibilitychange->hidden completes before the page is frozen (Tier 3).

import { decodeStateFile, encodeStateFile, sha256Hex, StateFileError, UNKNOWN_BUILD } from './state-file.js';
import { downloadCard } from './memcard.js';

export const FLAG = 'suspend';
const DB_NAME = 'ff7-web-states';
const STORE = 'states';

function openDb(idb = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    if (!idb) return reject(new Error('this browser has no IndexedDB'));
    const req = idb.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    return undefined;
  });
}

/** Browser storage for suspended states: { bytes, build, sha256, updated } per disc key. */
export function createStateStore(idb) {
  let dbp;
  const db = () => (dbp ??= openDb(idb));
  const tx = async (mode, fn) => {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const r = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(r.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  };
  return {
    get: (key) => tx('readonly', (s) => s.get(key)),
    put: (key, rec) => tx('readwrite', (s) => s.put(rec, key)),
    delete: (key) => tx('readwrite', (s) => s.delete(key)),
  };
}

const buildOf = (backend) => backend?.buildInfo?.()?.wasm_sha256 ?? UNKNOWN_BUILD;

/**
 * Wire the feature. `ui` holds the elements; nothing is shown and no handler
 * acts unless the Labs flag is on.
 */
export function createSuspend({ getBackend, labs, store, ui, setStatus, closeMenu = () => {}, notice = 6000 }) {
  let offer = null; // { key, rec } waiting for Resume / Start fresh
  let lastSavedFrame = -1;
  let saving = null;
  const on = () => labs.isOn(FLAG);
  const live = () => {
    const b = getBackend();
    return b?.loaded ? b : null;
  };
  const say = (text, kind = '') => setStatus(text, kind, { clearAfter: notice });

  // The Export/Import buttons exist in the page only while the flag is on.
  let tools = null;
  function buildTools() {
    const el = document.createElement('div');
    el.className = 'state-tools';
    el.id = 'state-tools';
    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'btn';
    exportBtn.id = 'state-export';
    exportBtn.textContent = 'Export state';
    exportBtn.addEventListener('click', exportState);
    const label = document.createElement('label');
    label.className = 'btn';
    const input = document.createElement('input');
    input.type = 'file';
    input.id = 'state-input';
    input.accept = '.f7s';
    input.hidden = true;
    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) importState(file);
    });
    label.append(input, 'Import state');
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'A state is a snapshot of the running game, kept only on this device. Import works for the same disc only.';
    el.append(exportBtn, label, hint);
    return el;
  }

  function render() {
    if (on() && !tools) {
      tools = buildTools();
      ui.menu.insertBefore(tools, ui.menu.querySelector('.hint'));
    } else if (!on() && tools) {
      tools.remove();
      tools = null;
    }
    ui.resume.hidden = ui.fresh.hidden = !(on() && offer);
  }

  /** Called after a disc has booted (and when the flag is switched on while one runs). */
  async function checkOffer() {
    offer = null;
    render();
    const b = live();
    if (!on() || !b) return;
    try {
      const key = await b.discKey();
      const rec = await store.get(key);
      const build = buildOf(b);
      // A state from another core build may not fit this core: do not offer it.
      if (rec && rec.bytes && (rec.build === UNKNOWN_BUILD || build === UNKNOWN_BUILD || rec.build === build)) offer = { key, rec };
    } catch (e) {
      console.warn(`could not look for a suspended state: ${e.message}`);
    }
    render();
  }

  /** Store a state now (page hiding). Skips when nothing ran since the last save. */
  function saveNow() {
    const b = live();
    if (!on() || !b || offer || saving) return saving ?? Promise.resolve(false);
    if (b.frame === lastSavedFrame) return Promise.resolve(false);
    const frame = b.frame;
    saving = (async () => {
      try {
        const [state, key] = await Promise.all([b.saveState(), b.discKey()]);
        await store.put(key, {
          bytes: state.buffer.slice(state.byteOffset, state.byteOffset + state.length),
          build: buildOf(b),
          sha256: await sha256Hex(state),
          updated: Date.now(),
        });
        lastSavedFrame = frame;
        return true;
      } catch (e) {
        console.warn(`could not store the suspended state: ${e.message}`);
        return false;
      } finally {
        saving = null;
      }
    })();
    return saving;
  }

  async function resume() {
    const b = live();
    if (!offer || !b) return;
    try {
      const state = new Uint8Array(offer.rec.bytes);
      if (offer.rec.sha256 && offer.rec.sha256 !== await sha256Hex(state)) throw new Error('the stored state is damaged');
      await b.loadState(state);
      offer = null;
      lastSavedFrame = -1;
      render();
      say('Resumed where you left off.');
    } catch (e) {
      say(`Could not resume: ${e.message}. The game is unchanged.`, 'error');
    }
  }

  async function startFresh() {
    if (!offer) return;
    try {
      await store.delete(offer.key);
    } catch (e) {
      console.warn(`could not delete the suspended state: ${e.message}`);
    }
    offer = null;
    render();
  }

  async function exportState() {
    closeMenu();
    const b = live();
    if (!b) return say('Load a disc first: a state belongs to the running game.', 'error');
    try {
      const [state, key] = await Promise.all([b.saveState(), b.discKey()]);
      downloadCard(await encodeStateFile({ discKey: key, build: buildOf(b), state }), 'ff7-web-state.f7s');
      return undefined;
    } catch (e) {
      return say(`Export failed: ${e.message}`, 'error');
    }
  }

  async function importState(file) {
    closeMenu();
    const b = live();
    if (!b) return say('Load the disc first, then import its state.', 'error');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { state } = await decodeStateFile(bytes, { discKey: await b.discKey(), build: buildOf(b) });
      await b.loadState(state); // the worker restores its backup if the core refuses
      offer = null;
      lastSavedFrame = -1;
      render();
      return say('State imported. The game continues from it.');
    } catch (e) {
      const why = e instanceof StateFileError ? e.message : e.message;
      return say(`Import failed: ${why}. The game is unchanged.`, 'error');
    }
  }

  ui.resume.addEventListener('click', resume);
  ui.fresh.addEventListener('click', startFresh);
  // pagehide as well as visibilitychange: iOS fires visibilitychange first, and
  // saveNow() skips the second call because no frame ran in between.
  window.addEventListener('pagehide', () => { saveNow(); });
  labs.onChange((name) => {
    if (name !== FLAG) return;
    if (on()) checkOffer(); else { offer = null; render(); }
  });
  render();

  return { checkOffer, saveNow, get offered() { return Boolean(offer); } };
}
