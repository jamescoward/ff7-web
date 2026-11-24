// #254: the Equip v2 Tier 2 scenarios are generated from the semantic plans,
// and the save they load holds what the descriptions say.
// Original project code, GPL-2.0-or-later.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadScenario } from '../../scenario.js';
import { ACCESSORIES, ARMOR, CASES, ITEMS, PARTY, SAVE, casePlans, equipPlanScenarios } from './equip-plan-scenarios.js';
import { SCENARIO_DIR, serialise } from './planner-scenarios.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAVES = path.resolve(HERE, '../../../harness/saves');

describe('#254 Equip v2 plan scenarios', () => {
  test('committed files equal equip-plan-scenarios.js (run node runner/test/unit/equip-plan-scenarios.js to fix)', () => {
    for (const s of equipPlanScenarios()) {
      const file = path.join(SCENARIO_DIR, `${s.name}.json`);
      assert.equal(readFileSync(file, 'utf8'), serialise(s), file);
    }
  });

  test('every scenario loads as tier 2 with at most 8 metrics', () => {
    for (const s of equipPlanScenarios()) {
      const sc = loadScenario(JSON.parse(readFileSync(path.join(SCENARIO_DIR, `${s.name}.json`), 'utf8')), { allowTier2: true });
      assert.ok(sc.metrics.length <= 8, s.name);
    }
  });

  test('the save: party Cloud, Barret, Tifa and the author-chosen spares', () => {
    const save = JSON.parse(readFileSync(path.join(SAVES, `${SAVE}.json`), 'utf8'));
    assert.deepEqual(save.party, [...PARTY]);
    assert.deepEqual(save.items, ITEMS.map((x) => ({ ...x })));
    assert.equal(save.equipment, undefined, 'baseline equipment');
    assert.deepEqual(ITEMS.filter((x) => x.index >= 256 && x.index < 288).map((x) => x.index - 256), [...ARMOR]);
    assert.deepEqual(ITEMS.filter((x) => x.index >= 288).map((x) => x.index - 288), [...ACCESSORIES]);
  });

  test('the presses after the menu opens are the plans, in order', () => {
    const scenarios = equipPlanScenarios();
    CASES.forEach((c, i) => {
      const p = casePlans(c);
      const presses = scenarios[i].input.filter((x) => x.buttons).map((x) => x.buttons[0]);
      const expected = [
        'down', 'down', 'down', // main menu 0 -> Equip (3)
        'circle', ...p.pick.steps.map((s) => s.button),
        ...p.slot.steps.map((s) => s.button), 'circle',
        ...p.list.steps.map((s) => s.button), 'circle',
      ];
      assert.deepEqual(presses, expected, scenarios[i].name);
      assert.equal(p.slot.steps.at(-1).expect, c.slot);
      assert.equal(p.list.steps.at(-1).expect, c.index);
      assert.ok(c.member > 0, 'a member other than Cloud');
    });
  });
});
