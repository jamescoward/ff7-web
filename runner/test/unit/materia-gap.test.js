// #246: the Materia-list gap scenarios are generated (the move to Materia is
// the menu planner's output), and the save they load holds what the scenario
// descriptions say.
// Original project code, GPL-2.0-or-later.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADDRESS_TABLE } from '../../../semantic/addresses.js';
import { EMPTY_DOWNS, GAP_DOWNS, MATERIA, MATERIA_EMPTY, SAVE, materiaGapScenarios, wordOf } from './materia-gap-scenarios.js';
import { SCENARIO_DIR, serialise } from './planner-scenarios.js';
import { loadScenario } from '../../scenario.js';
import { descriptionProblems } from '../../savegen/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAVES = path.resolve(HERE, '../../../harness/saves');
const filled = new Set(MATERIA.map((m) => m.slot));

describe('#246 materia list gap scenarios', () => {
  test('committed files equal materia-gap-scenarios.js (run node runner/test/unit/materia-gap-scenarios.js to fix)', () => {
    for (const s of materiaGapScenarios()) {
      const file = path.join(SCENARIO_DIR, `${s.name}.json`);
      assert.equal(readFileSync(file, 'utf8'), serialise(s), file);
    }
  });

  test('every scenario loads as a tier 2 scenario with at most 8 metrics', () => {
    for (const s of materiaGapScenarios()) {
      loadScenario(JSON.parse(readFileSync(path.join(SCENARIO_DIR, `${s.name}.json`), 'utf8')), { allowTier2: true });
      assert.ok(s.metrics.length <= 8, s.name);
    }
  });

  test('the save holds Cloud alone and materia only in slots 0, 3 and 5, each word distinct', () => {
    const save = JSON.parse(readFileSync(path.join(SAVES, `${SAVE}.json`), 'utf8'));
    assert.deepEqual(descriptionProblems(save), []);
    assert.deepEqual(save.party, [0, 255, 255]);
    assert.deepEqual(save.materia, MATERIA.map((m) => ({ ...m })));
    const words = MATERIA.map((m) => wordOf(m.slot));
    assert.equal(new Set(words).size, words.length);
    assert.ok(!words.includes(MATERIA_EMPTY));
  });

  test('under H1 26a lands on a filled slot past empty ones, and 26b on an empty slot; the two hypotheses differ', () => {
    assert.ok(filled.has(GAP_DOWNS));
    assert.ok([...Array(GAP_DOWNS).keys()].some((i) => !filled.has(i)), 'an empty slot lies before the target');
    assert.ok(!filled.has(EMPTY_DOWNS));
    // H2 (compacted): index GAP_DOWNS does not exist (only MATERIA.length entries), and index EMPTY_DOWNS is a filled slot.
    assert.ok(GAP_DOWNS >= MATERIA.length);
    const [gap, empty] = materiaGapScenarios();
    const downsIn = (s) => s.input.slice(s.input.findIndex((x) => x.wait?.until?.mem === 'l_off')).filter((x) => x.buttons?.[0] === 'down').length;
    assert.equal(downsIn(gap), GAP_DOWNS);
    assert.equal(downsIn(empty), EMPTY_DOWNS);
  });

  test('the cursors and slots read are confirmed entries', () => {
    for (const n of ['materiaListRow', 'materiaListOffset', 'materiaSlot', 'characterWeaponMateria', 'menuOverlay']) {
      assert.equal(ADDRESS_TABLE.entries.find((e) => e.name === n)?.status, 'confirmed', n);
    }
  });
});
