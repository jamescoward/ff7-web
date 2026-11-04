#!/usr/bin/env node
// Assemble one preview site.
//
//   node tools/preview/build.js --out DIR --slot main|pr-<n> [--sha SHA] [--repo OWNER/NAME]
//
// Copies web/ when it exists, otherwise writes a placeholder page, and adds
// preview.json. Fails if the result has a file type off the allow-list.
// Run the asset guard on DIR afterwards (the workflow does).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { buildSite } from './lib.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

try {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      slot: { type: 'string' },
      sha: { type: 'string', default: '' },
      repo: { type: 'string', default: '' },
      web: { type: 'string', default: path.join(REPO_ROOT, 'web') },
    },
  });
  if (!values.out || !values.slot) throw new Error('--out and --slot are required');
  const files = buildSite({ out: path.resolve(values.out), webDir: values.web, slot: values.slot, sha: values.sha, repo: values.repo });
  console.log(`preview ${values.slot}: ${files.length} files in ${values.out}`);
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exitCode = 2;
}
