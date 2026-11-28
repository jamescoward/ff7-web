// Name tables from the kernel archive (#260 part 2): build the item, weapon,
// armor, accessory and materia names from INIT/KERNEL.BIN bytes the caller
// read from the owner's disc. Pure; no DOM, Worker, Node or timer
// dependencies (platform-neutral rule, CLAUDE.md). The caller supplies the
// gzip step, so a native frontend can use its own inflate.
// Original project code, GPL-2.0-or-later.
//
// No game text is in this file or its tests. Tables exist at runtime, in
// memory, on the device (docs/SECURITY.md; issue #260 security rules).

import { KERNEL_PATH, parseBinGzip, sectionGzip } from './bin-gzip.js';
import { KERNEL_NAME_SECTIONS, nameTable } from './game-text.js';

export { KERNEL_PATH };
/** The kinds that have a name section, in archive order. */
export const NAME_KINDS = Object.freeze(Object.keys(KERNEL_NAME_SECTIONS));

/**
 * Build { tables, counts } from a KERNEL.BIN archive.
 *
 * unpack(gzipBytes, unpackedLength) returns the section's bytes (or a
 * promise of them), and throws or rejects when they do not decompress.
 *
 * tables[kind] is nameTable's names[] for each kind whose section splits,
 * decompresses to the header's length and has a readable table; a kind that
 * fails is left out, so nameFor falls back to the ID label for it. counts
 * holds numbers only: { kind: { built, count, empty, failed } }.
 * Throws only when the archive itself does not split (BinGzipError).
 */
export async function kernelNameTables(kernel, unpack) {
  const sections = parseBinGzip(kernel);
  const tables = {};
  const counts = {};
  for (const kind of NAME_KINDS) {
    const sec = sections[KERNEL_NAME_SECTIONS[kind]];
    counts[kind] = { built: 0, count: 0, empty: 0, failed: 0 };
    if (!sec) continue;
    let data;
    try {
      data = await unpack(sectionGzip(kernel, sec), sec.unpacked);
    } catch {
      continue;
    }
    if (!(data instanceof Uint8Array) || data.length !== sec.unpacked) continue;
    let t;
    try {
      t = nameTable(data);
    } catch {
      continue;
    }
    tables[kind] = Object.freeze(t.names);
    counts[kind] = { built: 1, count: t.count, empty: t.empty, failed: t.failed };
  }
  return { tables: Object.freeze(tables), counts };
}
