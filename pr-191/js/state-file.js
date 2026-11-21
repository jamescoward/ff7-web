// Suspend/resume (#119), Labs flag `suspend`: the disc key and the state file
// format. Pure functions over bytes and Blobs, no DOM, so the unit tests run
// them in Node. It knows nothing about FF7: a state is an opaque emulator
// snapshot, and it never leaves the player's device unless they export it.
//
// Disc key: SHA-256 over an 8-byte little-endian file size, then the whole
// file when it is at most 8 MiB (homebrew), otherwise its first 4 MiB and its
// last 64 KiB. Hashing a 700 MB image on a phone would take far too long; the
// size plus both ends tells discs apart in practice but is NOT a proof that
// two images are identical. The key only decides which stored state is
// offered; it is never logged, posted or sent anywhere.
//
// State file: "FF7WSTAT" (8 bytes), u32le header length, a UTF-8 JSON header
// { version, discKey, build, stateLength, sha256 }, then the state bytes.

export const MAGIC = 'FF7WSTAT';
export const VERSION = 1;
export const SMALL_FILE = 8 * 1024 * 1024;
export const HEAD_BYTES = 4 * 1024 * 1024;
export const TAIL_BYTES = 64 * 1024;
export const MAX_HEADER = 4096;
export const MAX_STATE_FILE = 32 * 1024 * 1024;
export const UNKNOWN_BUILD = 'unknown';

export class StateFileError extends Error {}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 in plain JS: the fallback where crypto.subtle is missing (non-secure contexts). */
export function sha256Js(bytes) {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const padded = ((bytes.length + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(padded);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(padded - 8, Math.floor(bytes.length / 0x20000000), false);
  dv.setUint32(padded - 4, (bytes.length << 3) >>> 0, false);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, h[i], false);
  return out;
}

const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Lowercase hex SHA-256 of `bytes`. */
export async function sha256Hex(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) return hex(new Uint8Array(await subtle.digest('SHA-256', bytes)));
  return hex(sha256Js(bytes));
}

/** The disc key (hex) for a File or Blob: see the top of this file. */
export async function discKey(blob) {
  const small = blob.size <= SMALL_FILE;
  const head = new Uint8Array(await blob.slice(0, small ? blob.size : HEAD_BYTES).arrayBuffer());
  const tail = small ? new Uint8Array(0) : new Uint8Array(await blob.slice(blob.size - TAIL_BYTES).arrayBuffer());
  const buf = new Uint8Array(8 + head.length + tail.length);
  new DataView(buf.buffer).setBigUint64(0, BigInt(blob.size), true);
  buf.set(head, 8);
  buf.set(tail, 8 + head.length);
  return sha256Hex(buf);
}

/** Wrap `state` (Uint8Array) in the export format. */
export async function encodeStateFile({ discKey: key, build = UNKNOWN_BUILD, state }) {
  const header = new TextEncoder().encode(JSON.stringify({
    version: VERSION, discKey: key, build, stateLength: state.length, sha256: await sha256Hex(state),
  }));
  const out = new Uint8Array(8 + 4 + header.length + state.length);
  out.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(out.buffer).setUint32(8, header.length, true);
  out.set(header, 12);
  out.set(state, 12 + header.length);
  return out;
}

/**
 * Check a state file in full and return { state, header }. Throws a
 * StateFileError whose message says what is wrong; the caller must not touch
 * the running game unless this returns.
 */
export async function decodeStateFile(bytes, { discKey: expectKey, build = UNKNOWN_BUILD, stateLength } = {}) {
  if (!(bytes instanceof Uint8Array)) throw new StateFileError('not a byte array');
  if (bytes.length > MAX_STATE_FILE) throw new StateFileError('this file is too big to be a saved state');
  if (bytes.length < 12 || new TextDecoder().decode(bytes.subarray(0, 8)) !== MAGIC) {
    throw new StateFileError('this is not a saved-state file from this app');
  }
  const hlen = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, true);
  if (hlen < 2 || hlen > MAX_HEADER || 12 + hlen > bytes.length) throw new StateFileError('the saved-state file is damaged (bad header)');
  let header;
  try {
    header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(12, 12 + hlen)));
  } catch {
    throw new StateFileError('the saved-state file is damaged (unreadable header)');
  }
  if (!header || typeof header !== 'object' || header.version !== VERSION) {
    throw new StateFileError(`this saved state is from a different version of the app (format ${header?.version})`);
  }
  const state = bytes.subarray(12 + hlen);
  if (!Number.isInteger(header.stateLength) || header.stateLength !== state.length) {
    throw new StateFileError('the saved-state file is damaged (wrong length; was it cut short?)');
  }
  if (stateLength !== undefined && state.length !== stateLength) {
    throw new StateFileError('this saved state does not fit the running emulator core');
  }
  if (typeof header.sha256 !== 'string' || header.sha256 !== await sha256Hex(state)) {
    throw new StateFileError('the saved-state file is damaged (checksum mismatch)');
  }
  if (typeof header.discKey !== 'string' || header.discKey !== expectKey) {
    throw new StateFileError('this saved state belongs to a different disc');
  }
  if (build !== UNKNOWN_BUILD && header.build !== UNKNOWN_BUILD && header.build !== build) {
    throw new StateFileError('this saved state was made by a different emulator core build');
  }
  return { state: state.slice(), header };
}
