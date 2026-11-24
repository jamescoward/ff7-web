#!/usr/bin/env node
// Keep web/js/semantic/ identical to semantic/*.js and runner/iso9660.js, and
// runner/semantic/ identical to the semantic/ modules the runner needs.
//
//   node semantic/sync-web.js           copy them into web/js/semantic/ and runner/semantic/
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

// Tier 2 ships only runner/ and harness/ into the sandbox (the eval's
// WORK_TOP_DIRS), so a semantic/ module that runner code imports gets a
// byte-identical copy in runner/semantic/. Only modules with no imports.
const RUNNER_DEST = path.resolve(HERE, '../runner/semantic');
/**
 * semantic/ modules copied to runner/semantic/ (#260: the kernelNames check
 * decodes names; part 2 moved the BIN-GZIP split here from runner/savegen).
 */
export const RUNNER_SHARED = ['bin-gzip.js', 'game-text.js'];

/** Names of the copies that are missing or differ from their source. */
export function drift() {
  const differs = (src, copy) => {
    try {
      return !readFileSync(src).equals(readFileSync(copy));
    } catch {
      return true;
    }
  };
  return [
    ...SHARED.filter((f) => differs(SOURCES.get(f), path.join(DEST, f))),
    ...RUNNER_SHARED.filter((f) => differs(path.join(HERE, f), path.join(RUNNER_DEST, f))).map((f) => `runner/semantic/${f}`),
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const bad = drift();
    if (bad.length) {
      console.error(`web/js/semantic or runner/semantic is out of date: ${bad.join(', ')} (run node semantic/sync-web.js)`);
      process.exitCode = 1;
    }
  } else {
    mkdirSync(DEST, { recursive: true });
    for (const f of SHARED) writeFileSync(path.join(DEST, f), readFileSync(SOURCES.get(f)));
    mkdirSync(RUNNER_DEST, { recursive: true });
    for (const f of RUNNER_SHARED) writeFileSync(path.join(RUNNER_DEST, f), readFileSync(path.join(HERE, f)));
    console.log(`copied ${SHARED.length} files to web/js/semantic and ${RUNNER_SHARED.length} to runner/semantic`);
  }
}
