// Counts for the name tables in a KERNEL.BIN archive (#260 part 1), for the
// format 2 kernelNames check. Original project code, GPL-2.0-or-later.
//
// Only the Tier 2 sandbox runs this on the real disc. It returns numbers
// only (whether the table builds, its entry count, empty and failed
// entries); no name, string, length or byte leaves this module
// (docs/SECURITY.md; issue #260 "Security rules"). Tier 1 tests use a
// synthetic archive of author-made strings.

import { KERNEL_NAME_SECTIONS, NAME_KIND_COUNTS, Ff7TextError, nameTable } from '../semantic/game-text.js';
import { BaselineError, kernelSection } from './savegen/baseline.js';

/** Name kinds a kernelNames check may name. */
export const NAME_KINDS = Object.freeze(Object.keys(KERNEL_NAME_SECTIONS));
/** What a kernelNames check may report as metrics. */
export const NAME_REPORT = Object.freeze(['built', 'count', 'empty', 'failed']);

/**
 * { built, count, empty, failed } for one kind's name section of `kernel`
 * (the archive's bytes, or null): built is 1 when the section unpacks and
 * its offset table reads (nameTable), else 0 with every count 0.
 */
export function nameCounts(kernel, kind) {
  if (!NAME_KINDS.includes(kind)) throw new RangeError(`unknown name kind ${kind}`);
  const none = { built: 0, count: 0, empty: 0, failed: 0 };
  if (!(kernel instanceof Uint8Array)) return none;
  try {
    const t = nameTable(kernelSection(kernel, KERNEL_NAME_SECTIONS[kind]));
    return { built: 1, count: t.count, empty: t.empty, failed: t.failed };
  } catch (e) {
    if (e instanceof BaselineError || e instanceof Ff7TextError) return none;
    throw e;
  }
}

/**
 * Whether counts pass: the table builds, no entry fails to decode, and the
 * entry count lies in [min, max] (defaults: 1 and the kind's ID count).
 */
export function namesHold(counts, kind, { min = 1, max = NAME_KIND_COUNTS[kind] } = {}) {
  return counts.built === 1 && counts.failed === 0 && counts.count >= min && counts.count <= max;
}
