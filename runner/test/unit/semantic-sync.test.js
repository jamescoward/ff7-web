// Unit: web/js/semantic/ is a byte-identical copy of semantic/ (#75). The
// browser can only import files under web/; see semantic/sync-web.js.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SHARED, drift } from '../../../semantic/sync-web.js';

test('web/js/semantic/ matches semantic/ (run node semantic/sync-web.js to fix)', () => {
  assert.ok(SHARED.includes('layer.js') && SHARED.includes('iso9660.js') && SHARED.includes('addresses.js'));
  assert.deepEqual(drift(), []);
});
