#!/usr/bin/env node
// Keep web/js/semantic/ identical to semantic/*.js and runner/iso9660.js.
//
//   node semantic/sync-web.js           copy them into web/js/semantic/
//   node semantic/sync-web.js --check   exit 1 if any copy differs or is missing
//
// Why a copy: web/ is published as-is and the preview refuses symlinks, so
// the browser can import only files under web/. The files in semantic/ (and
// runner/iso9660.js) are the source; the copies are byte-identical, and a Tier 1 unit test
// (runner/test/unit/semantic-sync.test.js) fails when they drift.
// Original project code, GPL-2.0-or-later.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEST = path.resolve(HERE, '../web/js/semantic');

// The ISO9660 reader lives in runner/ because Tier 2 ships only runner/ and
// harness/ into the sandbox, and runner/disc.js imports it.
const SOURCES = new Map([
  ...readdirSync(HERE)
    .filter((f) => f.endsWith('.js') && f !== 'sync-web.js')
    .map((f) => [f, path.join(HERE, f)]),
  ['iso9660.js', path.resolve(HERE, '../runner/iso9660.js')],
]);

/** Files that go to the browser: the layer's modules and the disc reader, not this tool. */
export const SHARED = [...SOURCES.keys()].sort();

/** Names of the copies that are missing or differ from their source. */
export function drift() {
  return SHARED.filter((f) => {
    try {
      return !readFileSync(SOURCES.get(f)).equals(readFileSync(path.join(DEST, f)));
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
    for (const f of SHARED) writeFileSync(path.join(DEST, f), readFileSync(SOURCES.get(f)));
    console.log(`copied ${SHARED.length} files to web/js/semantic`);
  }
}
