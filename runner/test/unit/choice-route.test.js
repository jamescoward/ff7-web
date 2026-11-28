// #168 (fourth budget): the choice-route probes are generated, load as tier 2
// scenarios with at most 8 metrics, and fit the 128-scenario cap.
// Original project code, GPL-2.0-or-later.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROBES, SCENARIOS } from './choice-route-scenarios.js';
import { loadScenario } from '../../scenario.js';
import { MAX_SCENARIOS } from '../../tier2.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(HERE, '../../../harness/scenarios');
const SAVES = path.resolve(HERE, '../../../harness/saves');

describe('#168 choice-route probes', () => {
  test('committed files equal choice-route-scenarios.js (run node runner/test/unit/choice-route-scenarios.js to fix)', () => {
    for (const s of SCENARIOS) {
      const file = path.join(DIR, `${s.name}.json`);
      assert.equal(readFileSync(file, 'utf8'), `${JSON.stringify(s, null, 2)}\n`, file);
    }
  });

  test('every probe loads as tier 2 with at most 8 metrics, and its save is the named field', () => {
    for (const [i, s] of SCENARIOS.entries()) {
      loadScenario(JSON.parse(readFileSync(path.join(DIR, `${s.name}.json`), 'utf8')), { allowTier2: true });
      assert.ok(s.metrics.length <= 8, s.name);
      const save = JSON.parse(readFileSync(path.join(SAVES, `${PROBES[i].save}.json`), 'utf8'));
      assert.equal(save.field.id, PROBES[i].field, s.name);
    }
  });

  test('every route step talks with ask noted and reports its own metrics', () => {
    for (const s of SCENARIOS) {
      const routes = s.input.filter((x) => x.route);
      assert.ok(routes.length > 0);
      for (const { route } of routes) {
        assert.equal(route.ask, 'note');
        assert.ok(route.talk > 0);
        assert.deepEqual(Object.values(route.report).sort(), [`a${route.to.model}`, `o${route.to.model}`, `r${route.to.model}`, `t${route.to.model}`]);
      }
    }
  });

  test('tier 2 scenarios fit the cap', () => {
    const tier2 = readdirSync(DIR).filter((f) => f.endsWith('.json') && JSON.parse(readFileSync(path.join(DIR, f), 'utf8')).tier === 2);
    assert.ok(tier2.length <= MAX_SCENARIOS, `${tier2.length}`);
  });
});
