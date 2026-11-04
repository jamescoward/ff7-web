#!/usr/bin/env node
// Place or remove a preview in a gh-pages working tree.
//
//   node tools/preview/publish.js place  --pages DIR --slot main|pr-<n> --site DIR
//   node tools/preview/publish.js remove --pages DIR --slot pr-<n>
//
// Rewrites the branch's index.html and .nojekyll; touches nothing else.

import path from 'node:path';
import { parseArgs } from 'node:util';

import { placeSlot, removeSlot } from './lib.js';

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      pages: { type: 'string' },
      slot: { type: 'string' },
      site: { type: 'string' },
    },
  });
  const [cmd] = positionals;
  if (!values.pages || !values.slot) throw new Error('--pages and --slot are required');
  const pages = path.resolve(values.pages);
  if (cmd === 'place') {
    if (!values.site) throw new Error('place needs --site');
    placeSlot({ pages, slot: values.slot, site: path.resolve(values.site) });
  } else if (cmd === 'remove') {
    removeSlot({ pages, slot: values.slot });
  } else {
    throw new Error('expected "place" or "remove"');
  }
  console.log(`preview ${values.slot}: ${cmd}d`);
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exitCode = 2;
}
