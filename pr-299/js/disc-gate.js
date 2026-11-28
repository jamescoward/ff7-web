// The hash gate in the browser: read the boot executable of the player's own
// disc file in place and decide whether the semantic layer may switch on.
// Everything happens on the device; the hash is compared and dropped, and
// only { active, reason } is returned.
//
// Runs in a dedicated worker (FileReaderSync is not available elsewhere).

import { ADDRESS_TABLE } from './semantic/addresses.js';
import { openIso } from './semantic/iso9660.js';
import { bootExeSha1, evaluateGate } from './semantic/layer.js';

const IMAGE_EXTENSIONS = ['.bin', '.iso', '.img'];

/** The raw disc image among the chosen files, or null (a .cue is not needed: see notes/75). */
export function pickImage(files) {
  return IMAGE_EXTENSIONS.map((ext) => files.find((f) => f.name.toLowerCase().endsWith(ext))).find(Boolean) ?? null;
}

/** A synchronous readAt over a File or Blob (worker only). */
export function blobReadAt(blob) {
  const reader = new FileReaderSync();
  return (offset, length) => new Uint8Array(reader.readAsArrayBuffer(blob.slice(offset, offset + length)));
}

/**
 * The gate for the chosen files: { active, reason }. The layer stays off for
 * anything that is not a raw ISO9660 image of the disc in the table.
 */
export async function gateForFiles(files, table = ADDRESS_TABLE) {
  const image = pickImage(files);
  if (!image) return { active: false, reason: 'no raw disc image (.bin, .iso, .img) among the files' };
  let sha1;
  try {
    sha1 = await bootExeSha1(openIso(blobReadAt(image), image.size));
  } catch (e) {
    return { active: false, reason: `cannot read the boot executable: ${e.message}` };
  }
  return evaluateGate(table, sha1);
}
