// #237: the talk-rule Tier 2 scenarios are generated, load as tier 2, and
// read the field entity addresses the semantic layer's nearby() uses.
// Original project code, GPL-2.0-or-later.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADDRESS_TABLE } from '../../../semantic/addresses.js';
import { SCENARIOS, UNWATCHED, FIELD_ENTITY_SIZE } from './talk-rule-scenarios.js';
import { loadScenario } from '../../scenario.js';
import { nearOutcome } from '../../format2.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(HERE, '../../../harness/scenarios');
const byName = (n) => ADDRESS_TABLE.entries.find((e) => e.name === n);
const at = (name, k) => byName(name).address + k * (byName(name).stride ?? 0);

describe('#237 talk-rule scenarios', () => {
  test('committed files equal talk-rule-scenarios.js (run node runner/test/unit/talk-rule-scenarios.js to fix)', () => {
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

  test('locations match the address table', () => {
    const m = SCENARIOS[0].memory;
    assert.equal(byName('fieldX').stride, FIELD_ENTITY_SIZE);
    for (const k of [0, 1, 2, 3, ...UNWATCHED]) {
      assert.equal(Number(m[`x${k}`].addr), at('fieldX', k), `x${k}`);
      assert.equal(Number(m[`y${k}`].addr), at('fieldY', k), `y${k}`);
      assert.equal(Number(m[`z${k}`].addr), at('fieldZ', k), `z${k}`);
      if (k === 0) continue;
      assert.equal(Number(m[`talk${k}`].addr), at('fieldTalkRange', k), `talk${k}`);
      assert.equal(Number(m[`off${k}`].addr), at('fieldTalkOff', k), `off${k}`);
    }
    assert.equal(Number(m.solid0.addr), at('fieldSolidRange', 0));
    assert.equal(Number(m.cnt.addr), byName('fieldModelCount').address);
    assert.equal(Number(m.pm.addr), byName('playerModel').address);
    assert.equal(Number(m.w0.addr), byName('dialogState').address);
  });

  test('the height check holds only when |dz| < 256 field units (shift 19, range 2, y difference 0)', () => {
    const chk = SCENARIOS[1].assert.find((a) => a.metric === 'h7').near;
    assert.equal(chk.shift, 19);
    assert.equal(chk.y, chk.toY);
    const u32 = { type: 'u32' };
    const u16 = { type: 'u16' };
    const locs = [u32, u16, u32, u16, u16];
    const run = (z0fu, zkfu) => nearOutcome({ shift: 19, is: 'within' }, locs, [(z0fu * 4096) >>> 0, 144, (zkfu * 4096) >>> 0, 144, 2]);
    // Sufficient: every pair the check accepts is less than 256 field units apart.
    for (const [a, b] of [[0, 0], [0, 255], [-100, 100], [127, -128], [-300, -200], [1000, 1200]]) {
      const out = run(a, b);
      if (out.holds) assert.ok(Math.abs(a - b) < 256, `${a},${b}`);
    }
    for (const [a, b] of [[0, 256], [-128, 128], [0, -300], [500, 0]]) assert.equal(run(a, b).holds, false, `${a},${b}`);
    assert.equal(run(10, 20).holds, true);
  });
});
