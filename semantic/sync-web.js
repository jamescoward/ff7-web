#!/usr/bin/env node
// Keep web/js/semantic/ identical to semantic/.
//
//   node semantic/sync-web.js           copy semantic/*.js into web/js/semantic/
//   node semantic/sync-web.js --check   exit 1 if any copy differs or is missing
//
// Why a copy: web/ is published as-is and the preview refuses symlinks, so
// the browser can import only files under web/. The files in semantic/ are
// the source; the copies are byte-identical, and a Tier 1 unit test
// (runner/test/unit/semantic-sync.test.js) fails when they drift.
// Original project code, GPL-2.0-or-later.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = HERE;
const DEST = path.resolve(HERE, '../web/js/semantic');

/** Files that go to the browser: the layer's modules, not this tool. */
export const SHARED = readdirSync(SRC).filter((f) => f.endsWith('.js') && f !== 'sync-web.js').sort();

/** Names of the copies that are missing or differ from their source. */
export function drift() {
  return SHARED.filter((f) => {
    try {
      return !readFileSync(path.join(SRC, f)).equals(readFileSync(path.join(DEST, f)));
    } catch {
      return true;
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const bad = drift();
    if (bad.length) {
      console.error(`web/js/semantic is out of date: ${bad.join(', ')} (run node semantic/sync-web.js)`);
      process.exitCode = 1;
    }
  } else {
    mkdirSync(DEST, { recursive: true });
    for (const f of SHARED) writeFileSync(path.join(DEST, f), readFileSync(path.join(SRC, f)));
    console.log(`copied ${SHARED.length} files to web/js/semantic`);
  }
}
