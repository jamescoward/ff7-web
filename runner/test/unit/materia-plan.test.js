// #248: the Materia planner scenarios are generated from the semantic plans,
// and the save they load holds what the scenario descriptions say.
// Original project code, GPL-2.0-or-later.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADDRESS_TABLE } from '../../../semantic/addresses.js';
import { MATERIA_PAGE_ROWS } from '../../../semantic/materia-screen.js';
import {
  BACK_SLOT, FAR_SLOT, MATERIA, MATERIA_EMPTY, SAVE, backEnd, farEnd, materiaPlanScenarios, toBack, toFar, wordOf,
} from './materia-plan-scenarios.js';
import { SCENARIO_DIR, serialise } from './planner-scenarios.js';
import { loadScenario } from '../../scenario.js';
import { descriptionProblems } from '../../savegen/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAVES = path.resolve(HERE, '../../../harness/saves');
const filled = new Set(MATERIA.map((m) => m.slot));

describe('#248 materia planner scenarios', () => {
  test('committed files equal materia-plan-scenarios.js (run node runner/test/unit/materia-plan-scenarios.js to fix)', () => {
    for (const s of materiaPlanScenarios()) {
      const file = path.join(SCENARIO_DIR, `${s.name}.json`);
      assert.equal(readFileSync(file, 'utf8'), serialise(s), file);
    }
  });

  test('every scenario loads as a tier 2 scenario with at most 8 metrics', () => {
    for (const s of materiaPlanScenarios()) {
      loadScenario(JSON.parse(readFileSync(path.join(SCENARIO_DIR, `${s.name}.json`), 'utf8')), { allowTier2: true });
      assert.ok(s.metrics.length <= 8, s.name);
    }
  });

  test('the save holds Cloud alone and materia only in slots 2, 7 and 13, each word distinct', () => {
    const save = JSON.parse(readFileSync(path.join(SAVES, `${SAVE}.json`), 'utf8'));
    assert.deepEqual(descriptionProblems(save), []);
    assert.deepEqual(save.party, [0, 255, 255]);
    assert.deepEqual(save.equipment[0].accessory, 255);
    assert.deepEqual(save.materia, MATERIA.map((m) => ({ ...m })));
    const words = MATERIA.map((m) => wordOf(m.slot));
    assert.equal(new Set(words).size, words.length);
    assert.ok(!words.includes(MATERIA_EMPTY));
  });

  test('the far target is past page 1 with empty slots before it on both pages; the plans end where the descriptions say', () => {
    assert.ok(filled.has(FAR_SLOT) && filled.has(BACK_SLOT));
    assert.ok(FAR_SLOT >= MATERIA_PAGE_ROWS);
    assert.ok([...Array(MATERIA_PAGE_ROWS).keys()].some((i) => !filled.has(i)));
    assert.ok([...Array(FAR_SLOT - MATERIA_PAGE_ROWS).keys()].some((i) => !filled.has(MATERIA_PAGE_ROWS + i)));
    assert.deepEqual([farEnd.row, farEnd.offset, farEnd.expect], [9, 4, 13]);
    assert.deepEqual([backEnd.row, backEnd.offset, backEnd.expect], [3, 4, 7]);
    assert.equal(toFar.steps.length, 13);
    assert.equal(toBack.steps.length, 6);
    assert.ok(toBack.steps.every((s) => s.button === 'up' && s.offset === 4), 'under H2 the Ups never scroll');
  });

  test('every press in the list scripts is a plan step, in order', () => {
    const [far, back] = materiaPlanScenarios();
    const listPresses = (s) => {
      const start = s.input.findIndex((x) => x.wait?.until?.mem === 'l_off');
      return s.input.slice(start).filter((x) => x.buttons && ['up', 'down'].includes(x.buttons[0])).map((x) => x.buttons[0]);
    };
    assert.deepEqual(listPresses(far), toFar.steps.map((s) => s.button));
    assert.deepEqual(listPresses(back), [...toFar.steps, ...toBack.steps].map((s) => s.button));
  });

  test('the cursors and slots read are confirmed entries', () => {
    for (const n of ['materiaSlotColumn', 'materiaListRow', 'materiaListOffset', 'materiaSlot', 'characterWeaponMateria', 'menuOverlay']) {
      assert.equal(ADDRESS_TABLE.entries.find((e) => e.name === n)?.status, 'confirmed', n);
    }
  });
});
