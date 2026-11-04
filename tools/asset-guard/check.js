#!/usr/bin/env node
// Asset guard CLI.
//
//   node tools/asset-guard/check.js [--root DIR] [--walk] [--json]
//                                   [--allowlist FILE] [--denylist FILE]...
//                                   [--max-binary-bytes N] [--max-file-bytes N]
//
// Checks the files git would commit when --root (default: the repository
// root) is a git work tree; with --walk, or for a directory that isn't one,
// every file under it (for example an assembled preview site).
//
// Deny-lists: denylist.json here, every --denylist FILE, and every file in
// ASSET_GUARD_DENYLIST (path-delimiter separated), for private lists.
//
// Exit status: 0 clean, 1 violations, 2 usage or configuration error.
// Output names files and rules only, never file contents.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { DEFAULT_ALLOWLIST, DEFAULT_DENYLIST, checkTree, loadAllowlist, loadDenylist } from './guard.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');

function main() {
  let values;
  try {
    ({ values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        root: { type: 'string', default: REPO },
        walk: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        allowlist: { type: 'string', default: DEFAULT_ALLOWLIST },
        denylist: { type: 'string', multiple: true, default: [] },
        'max-binary-bytes': { type: 'string' },
        'max-file-bytes': { type: 'string' },
      },
    }));
  } catch (e) {
    console.error(`error: ${e.message}\nusage: node tools/asset-guard/check.js [--root DIR] [--walk] [--json] [--allowlist FILE] [--denylist FILE]...`);
    return 2;
  }

  let result;
  try {
    const limits = {};
    for (const [flag, key] of [['max-binary-bytes', 'maxBinaryBytes'], ['max-file-bytes', 'maxFileBytes']]) {
      const v = values[flag];
      if (v === undefined) continue;
      if (!/^\d+$/.test(v)) throw new Error(`--${flag} must be a byte count`);
      limits[key] = Number(v);
    }
    const envLists = (process.env.ASSET_GUARD_DENYLIST ?? '').split(path.delimiter).filter(Boolean);
    const allowlist = loadAllowlist(values.allowlist);
    const denylist = loadDenylist([DEFAULT_DENYLIST, ...values.denylist, ...envLists]);
    result = checkTree(path.resolve(values.root), {
      mode: values.walk ? 'walk' : undefined,
      allowlist,
      denylist,
      limits,
    });
  } catch (e) {
    console.error(`error: ${e.message}`);
    return 2;
  }

  const ok = result.violations.length === 0;
  if (values.json) {
    process.stdout.write(`${JSON.stringify({ tool: 'asset-guard', format: 1, ok, ...result }, null, 2)}\n`);
  } else {
    for (const v of result.violations) console.log(`${v.path}: ${v.rule}: ${v.detail}`);
    console.log(`asset-guard: ${result.checked} files checked (${result.mode}), ${result.violations.length} violation(s)`);
  }
  return ok ? 0 : 1;
}

process.exitCode = main();
