// Unit: runner code (not its tests) imports only from runner/ and node:
// builtins. Tier 2 ships only runner/ and harness/ into the sandbox (the
// eval's WORK_TOP_DIRS), so an import of ../semantic/ or ../web/ works here
// and fails there (#260: semantic/ modules the runner needs are synced into
// runner/semantic/ by semantic/sync-web.js).
// Original project code, GPL-2.0-or-later.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const RUNNER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SKIP = new Set(['test', 'dist', 'node_modules']);

function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return SKIP.has(e.name) ? [] : sources(path.join(dir, e.name));
    return /\.(m?js)$/.test(e.name) ? [path.join(dir, e.name)] : [];
  });
}

test('runner modules import only from runner/ and node: builtins', () => {
  const bad = [];
  for (const file of sources(RUNNER)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = m[1] ?? m[2];
      if (spec.startsWith('node:')) continue;
      if (!spec.startsWith('.')) {
        bad.push(`${path.relative(RUNNER, file)}: ${spec}`);
        continue;
      }
      const target = path.resolve(path.dirname(file), spec);
      if (!target.startsWith(RUNNER + path.sep)) bad.push(`${path.relative(RUNNER, file)}: ${spec}`);
    }
  }
  assert.deepEqual(bad, []);
});
