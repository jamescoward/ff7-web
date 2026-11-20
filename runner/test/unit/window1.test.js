// #224: the window-1 Tier 2 scenarios are generated, load as tier 2, and
// read the window addresses the semantic layer uses.
// Original project code, GPL-2.0-or-later.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADDRESS_TABLE } from '../../../semantic/addresses.js';
import { FIELD_ID, SCENARIOS } from './window1-scenarios.js';
import { loadScenario } from '../../scenario.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(HERE, '../../../harness/scenarios');
const SAVES = path.resolve(HERE, '../../../harness/saves');
const byName = (n) => ADDRESS_TABLE.entries.find((e) => e.name === n);

describe('#224 window-1 scenarios', () => {
  test('committed files equal window1-scenarios.js (run node runner/test/unit/window1-scenarios.js to fix)', () => {
    for (const s of SCENARIOS) {
      const file = path.join(DIR, `${s.name}.json`);
      assert.equal(readFileSync(file, 'utf8'), `${JSON.stringify(s, null, 2)}\n`, file);
    }
  });

  test('every scenario loads as a tier 2 scenario with at most 8 metrics', () => {
    for (const s of SCENARIOS) {
      loadScenario(JSON.parse(readFileSync(path.join(DIR, `${s.name}.json`), 'utf8')), { allowTier2: true });
      assert.ok(s.metrics.length <= 8, s.name);
    }
  });

  test('window 0 is dialogState; window 1 is one record (0x30) later', () => {
    const m = SCENARIOS[0].memory;
    assert.equal(Number(m.w0.addr), byName('dialogState').address);
    assert.equal(Number(m.w1.addr) - Number(m.w0.addr), 0x30);
    assert.equal(Number(m.ptr1.addr) - Number(m.w1.addr), 0x1a - 0x2c);
    const s1 = byName('dialogState1');
    if (s1) assert.equal(s1.address, Number(m.w1.addr));
  });

  test('the save boots in the field the scenarios check', () => {
    const save = JSON.parse(readFileSync(path.join(SAVES, 'disc1-mds7st1.json'), 'utf8'));
    assert.equal(save.field.id, FIELD_ID);
    for (const s of SCENARIOS) assert.equal(s.boot.save, 'disc1-mds7st1');
  });
});
