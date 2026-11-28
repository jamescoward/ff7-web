// Memory card files: validation, browser storage, export and import.
//
// The card is the raw 128 KiB image of a PS1 memory card (the ".mcr" layout
// most emulators read). It lives in IndexedDB, which Safari may evict, so the
// page always offers export to a file and import back.

export const CARD_SIZE = 128 * 1024;
const DB_NAME = 'ff7-web';
const STORE = 'cards';
export const CARD_KEY = 'card1';

/**
 * Check that `bytes` is a raw PS1 memory card image. Returns null when it is,
 * otherwise a sentence saying why not.
 */
export function cardProblem(bytes) {
  if (!(bytes instanceof Uint8Array)) return 'not a byte array';
  if (bytes.length !== CARD_SIZE) {
    return `a memory card file is exactly ${CARD_SIZE} bytes; this one is ${bytes.length}`;
  }
  if (bytes[0] !== 0x4d || bytes[1] !== 0x43) return 'missing the "MC" header of a PS1 memory card';
  return null;
}

/** A freshly formatted, empty card: what a PS1 writes when it formats one. */
export function blankCard() {
  const c = new Uint8Array(CARD_SIZE);
  const frame = (n) => c.subarray(n * 128, n * 128 + 128);
  const checksum = (f) => {
    let x = 0;
    for (let i = 0; i < 127; i++) x ^= f[i];
    f[127] = x;
  };
  const h = frame(0);
  h[0] = 0x4d; // 'M'
  h[1] = 0x43; // 'C'
  checksum(h);
  for (let n = 1; n <= 15; n++) {
    const d = frame(n);
    d[0] = 0xa0; // free block
    d[8] = 0xff; // no next block
    d[9] = 0xff;
    checksum(d);
  }
  for (let n = 16; n <= 35; n++) {
    const d = frame(n);
    d.fill(0xff, 0, 4); // no broken sector
    d[8] = 0xff;
    d[9] = 0xff;
    checksum(d);
  }
  frame(63).set(h); // write-test frame mirrors the header
  return c;
}

/** FNV-1a over the card: cheap change detection, not integrity. */
export function cardDigest(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function openDb(idb = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    if (!idb) {
      reject(new Error('this browser has no IndexedDB'));
      return;
    }
    const req = idb.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/** Browser storage for the card. */
export function createCardStore(idb) {
  let dbp;
  const db = () => (dbp ??= openDb(idb));
  return {
    /** The stored card, or null. */
    async load(key = CARD_KEY) {
      const rec = await tx(await db(), 'readonly', (s) => s.get(key));
      return rec ? new Uint8Array(rec.bytes) : null;
    },
    async save(bytes, key = CARD_KEY) {
      const problem = cardProblem(bytes);
      if (problem) throw new Error(problem);
      const copy = bytes.slice().buffer;
      await tx(await db(), 'readwrite', (s) => s.put({ bytes: copy, updated: Date.now() }, key));
    },
  };
}

/** Read an imported card file; throws with a readable reason if it isn't one. */
export async function readCardFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const problem = cardProblem(bytes);
  if (problem) throw new Error(`${file.name}: ${problem}`);
  return bytes;
}

/** Offer the card as a file download. */
export function downloadCard(bytes, name = 'ff7-web-card1.mcr', doc = document) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const a = doc.createElement('a');
  a.href = url;
  a.download = name;
  doc.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
