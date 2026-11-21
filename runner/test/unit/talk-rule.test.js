// #237: the talk-rule Tier 2 scenarios are generated, load as tier 2, and
// read the field entity addresses the semantic layer's nearby() uses.
// Original project code, GPL-2.0-or-later.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADDRESS_TABLE } from '../../../semantic/addresses.js';
import { SCENARIOS, UNWATCHED, FIELD_ENTITY_SIZE, TALKER, heightBound } from './talk-rule-scenarios.js';
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

  test('every height check holds only when |dz| is below its stated bound (y difference 0, range 2 per location)', () => {
    const u32 = { type: 'u32', len: 4 };
    const u16 = { type: 'u16', len: 2 };
    const checks = SCENARIOS.flatMap((s) => s.assert).filter((a) => a.near && a.near.x === 'z0');
    assert.ok(checks.length >= 6);
    for (const { near, metric } of checks) {
      assert.equal(near.y, near.toY, metric);
      assert.ok(near.range.every((r) => r === 'loading'), metric);
      const bound = heightBound(near.shift, near.range.length, near.plus ?? 0);
      const locs = [u32, u16, u32, u16, ...near.range.map(() => u16)];
      const run = (a, b) => nearOutcome({ shift: near.shift, plus: near.plus ?? 0, is: 'within' }, locs, [(a * 4096) >>> 0, 144, (b * 4096) >>> 0, 144, ...near.range.map(() => 2)]);
      for (const a of [-700, -300, -129, -1, 0, 1, 50, 127, 128, 255, 400]) {
        for (const d of [0, 1, 15, 31, 32, 63, 64, 127, 128, 199, 200, 223, 224, 239, 240, 255, 256, 271, 272, 287, 288, 303, 304, 511, 512, 600]) {
          for (const sgn of [1, -1]) {
            const out = run(a, a + sgn * d);
            if (out.holds) assert.ok(d < bound, `${metric}: ${a}, ${a + sgn * d} within but |dz| ${d} >= ${bound}`);
          }
        }
      }
      assert.equal(run(10, 10).holds, true, metric);
    }
    const h = SCENARIOS[0].assert.find((a) => a.metric === `h${TALKER}`).near;
    assert.equal(heightBound(h.shift, h.range.length, h.plus), 256);
    // At shift 12 the bound is exact for whole field units: 255 apart holds, 256 does not.
    const exact = (a, b) => nearOutcome({ shift: 12, plus: 256, is: 'within' }, [{ type: 'u32', len: 4 }, { type: 'u16', len: 2 }, { type: 'u32', len: 4 }, { type: 'u16', len: 2 }], [(a * 4096) >>> 0, 144, (b * 4096) >>> 0, 144]);
    assert.equal(exact(0, 255).holds, true);
    assert.equal(exact(0, 256).holds, false);
    assert.equal(exact(-100, 155).holds, true);
    assert.equal(exact(-100, 156).holds, false);
  });
});
