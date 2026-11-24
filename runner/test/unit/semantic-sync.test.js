// Unit: web/js/semantic/ is a byte-identical copy of semantic/ (#75). The
// browser can only import files under web/; see semantic/sync-web.js.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RUNNER_SHARED, SHARED, drift } from '../../../semantic/sync-web.js';

test('web/js/semantic/ matches semantic/ (run node semantic/sync-web.js to fix)', () => {
  assert.ok(SHARED.includes('layer.js') && SHARED.includes('iso9660.js') && SHARED.includes('addresses.js'));
  assert.deepEqual(drift(), []);
});

test('runner/semantic/ copies have no imports (Tier 2 ships only runner/ and harness/)', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of RUNNER_SHARED) {
    const src = readFileSync(new URL(`../../../semantic/${f}`, import.meta.url), 'utf8');
    assert.ok(!/^\s*import\b|\bimport\(/m.test(src), f);
  }
});
