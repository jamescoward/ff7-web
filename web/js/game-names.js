// Game names (#260 part 2, Labs flag `game-names`, off by default): item,
// weapon, armor, accessory and materia names for the native panels, read
// from the disc the owner imported, on the device.
//
// Security rules (docs/SECURITY.md; issue #260):
// - the tables live in memory only: nothing is cached, stored in
//   localStorage or IndexedDB, logged, or sent anywhere;
// - the worker reads INIT/KERNEL.BIN only after the hash gate has passed;
// - errors carry no byte values or decoded text (counts and fixed messages).
//
// The FF7 knowledge (archive layout, sections, encoding) is in semantic/
// (bin-gzip.js, game-text.js, game-names.js); this file only does the
// browser's gzip step, the disc read and the flag.
// Original project code, GPL-2.0-or-later.

import { KERNEL_PATH, kernelNameTables } from './semantic/game-names.js';
import { openIso } from './semantic/iso9660.js';

export const NAMES_FLAG = 'game-names';

/** Read a ReadableStream of byte chunks; stops at `limit` bytes or the first error. */
async function drain(stream, limit) {
  const reader = stream.getReader();
  const chunks = [];
  let n = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      n += value.length;
      if (n > limit) break;
    }
  } catch {
    // A stream error after some output: the caller checks the length.
  } finally {
    reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

const streamOf = (bytes) => new Blob([bytes]).stream();

/**
 * Decompress one gzip section in the browser to exactly `unpacked` bytes.
 * As runner/savegen/baseline.js unpackSection: if the gzip member does not
 * check out, inflate the deflate stream after a plain 10-byte header (flags
 * 0) and let the length decide. Throws a fixed message (no byte values).
 */
export async function gunzipSection(gz, unpacked, DS = globalThis.DecompressionStream) {
  if (typeof DS !== 'function') throw new Error('this browser cannot decompress');
  const whole = await drain(streamOf(gz).pipeThrough(new DS('gzip')), unpacked);
  if (whole.length === unpacked) return whole;
  if (gz.length < 10 || gz[0] !== 0x1f || gz[1] !== 0x8b || gz[2] !== 8 || gz[3] !== 0) throw new Error('not gzip data');
  let raw;
  try {
    raw = await drain(streamOf(gz.subarray(10)).pipeThrough(new DS('deflate-raw')), unpacked);
  } catch {
    throw new Error('does not decompress');
  }
  if (raw.length !== unpacked) throw new Error('not the length its header gives');
  return raw;
}

/**
 * Build { tables, counts } from a raw disc image reached through a
 * synchronous readAt (the worker's FileReaderSync over the imported file).
 */
export async function namesFromImage(readAt, size, unpack = gunzipSection) {
  const kernel = openIso(readAt, size).read(KERNEL_PATH);
  return kernelNameTables(kernel, unpack);
}

/**
 * The page side: registers the flag and asks the worker for the tables once
 * the hash gate is active and the flag is on. names() is what the panels
 * call: the tables while the flag is on and they built, else null (ID labels).
 *
 * @param {object} o
 * @param {object} o.labs     labs.js
 * @param {(s: string) => void} [o.onStatus]  one short notice when reading fails
 */
export function createGameNames({ labs, onStatus = () => {} }) {
  labs.registerFlag(NAMES_FLAG, {
    label: 'Game names',
    description: 'Show item, weapon, armor and materia names in the native Item, Equip and Materia screens, read from your disc on this device. Nothing is stored or sent.',
    pr: null,
    checklist: [
      'Turn on Game names and Native Equip, open Equip: do the weapon, armor and accessory rows show names?',
      'Native Materia: do the weapon slots and the materia list show names?',
      'Native Item: does each item row show its name and count?',
      'Turn the flag off: are the rows back to #numbers straight away?',
      'Do not post screenshots with names to GitHub.',
    ],
  });
  let gate = null;
  let backend = null;
  let tables = null;
  let state = 'idle'; // idle | loading | ready | failed
  const listeners = new Set();
  const emit = () => { for (const cb of listeners) cb(); };

  function maybeLoad() {
    if (state !== 'idle' || !labs.isOn(NAMES_FLAG) || !gate?.active || !backend?.gameNames) return;
    state = 'loading';
    backend.gameNames().then((v) => {
      if (v && v.tables && typeof v.tables === 'object' && Object.keys(v.tables).length) {
        tables = Object.freeze(v.tables);
        state = 'ready';
      } else {
        state = 'failed';
        onStatus('Game names: could not read the names from this disc.');
      }
      emit();
    }, () => {
      state = 'failed';
      onStatus('Game names: could not read the names from this disc.');
      emit();
    });
  }
  labs.onChange((name) => {
    if (name !== NAMES_FLAG) return;
    maybeLoad();
    emit();
  });

  return {
    names: () => (state === 'ready' && labs.isOn(NAMES_FLAG) ? tables : null),
    get state() { return state; },
    setGate(g) { gate = g; maybeLoad(); },
    setBackend(b) { backend = b; maybeLoad(); },
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  };
}
