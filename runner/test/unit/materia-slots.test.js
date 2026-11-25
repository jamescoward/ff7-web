// #255: the Materia slot scenarios are generated from the semantic plans,
// and the save they load holds what the scenario descriptions say.
// Original project code, GPL-2.0-or-later.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADDRESS_TABLE } from '../../../semantic/addresses.js';
import {
  ARMOR, BACK_SLOT, COLUMN_SLOT, FAR_COLUMN, LAST_SLOT, MATERIA, MATERIA_EMPTY, SAVE, WEAPON,
  materiaSlotsScenarios, toArmor, toBackSlot, toColumnSlot, toFarColumn, toLast, toThirteen, wordOf,
} from './materia-slots-scenarios.js';
import { SCENARIO_DIR, serialise } from './planner-scenarios.js';
import { loadScenario } from '../../scenario.js';
import { descriptionProblems } from '../../savegen/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAVES = path.resolve(HERE, '../../../harness/saves');

describe('#255 materia slot scenarios', () => {
  test('committed files equal materia-slots-scenarios.js (run node runner/test/unit/materia-slots-scenarios.js to fix)', () => {
    for (const s of materiaSlotsScenarios()) {
      const file = path.join(SCENARIO_DIR, `${s.name}.json`);
      assert.equal(readFileSync(file, 'utf8'), serialise(s), file);
    }
  });

  test('every scenario loads as a tier 2 scenario with at most 8 metrics', () => {
    for (const s of materiaSlotsScenarios()) {
      loadScenario(JSON.parse(readFileSync(path.join(SCENARIO_DIR, `${s.name}.json`), 'utf8')), { allowTier2: true });
      assert.ok(s.metrics.length <= 8, s.name);
    }
  });

  test('the save holds Cloud alone with the chosen weapon and armor, and materia only where the scenarios say', () => {
    const save = JSON.parse(readFileSync(path.join(SAVES, `${SAVE}.json`), 'utf8'));
    assert.deepEqual(descriptionProblems(save), []);
    assert.deepEqual(save.party, [0, 255, 255]);
    assert.deepEqual(save.equipment, [{ record: 0, weapon: WEAPON, armor: ARMOR, accessory: 255 }]);
    assert.deepEqual(save.materia, MATERIA.map((m) => ({ ...m })));
    const words = MATERIA.map((m) => wordOf(m.slot));
    assert.equal(new Set(words).size, words.length);
    assert.ok(!words.includes(MATERIA_EMPTY));
    for (const s of [COLUMN_SLOT, BACK_SLOT, LAST_SLOT]) assert.ok(MATERIA.some((m) => m.slot === s), `slot ${s} filled`);
  });

  test('the plans are the ones the descriptions name', () => {
    assert.equal(FAR_COLUMN, 7);
    assert.equal(toFarColumn.steps.length, 7);
    assert.deepEqual(toArmor.steps.map((s) => s.button), ['down']);
    assert.equal(toColumnSlot.steps.length, COLUMN_SLOT);
    assert.deepEqual([toThirteen.steps.at(-1).row, toThirteen.steps.at(-1).offset], [9, 4]);
    assert.deepEqual(toBackSlot.steps.slice(-2).map((s) => [s.row, s.offset]), [[0, 3], [0, 2]], 'the last two Ups scroll back');
    assert.equal(toLast.steps.length, LAST_SLOT);
  });

  test('every scenario file fits the sandbox 64 KiB scenario limit', () => {
    for (const sc of materiaSlotsScenarios()) assert.ok(Buffer.byteLength(serialise(sc)) <= 64 * 1024, sc.name);
  });

  test('list presses follow the plans in order (30d: held Downs to the last page, one Down, the stop checked, Circle)', () => {
    const [, column, armor, end] = materiaSlotsScenarios();
    const listPresses = (s) => {
      const start = s.input.findIndex((x) => x.wait?.until?.mem === 'l_off');
      return s.input.slice(start).filter((x) => x.buttons && ['up', 'down'].includes(x.buttons[0])).map((x) => x.buttons[0]);
    };
    assert.deepEqual(listPresses(column), toColumnSlot.steps.map((s) => s.button));
    assert.deepEqual(listPresses(armor), [...toThirteen.steps, ...toBackSlot.steps].map((s) => s.button));
    // 30d: held Downs until the last page's offset, its row checked, then the one measured Down.
    const held = end.input.find((x) => x.wait?.press && x.wait.until?.mem === 'l_off');
    assert.deepEqual(held.wait.until, { mem: 'l_off', equals: toLast.steps.at(-1).offset });
    assert.deepEqual(held.wait.press.buttons, ['down']);
    const after = end.input.slice(end.input.indexOf(held) + 1);
    assert.deepEqual(after[0].wait.until, { mem: 'l_row', equals: toLast.steps.at(-1).row });
    assert.deepEqual(after.filter((x) => x.buttons).map((x) => x.buttons), [['down'], ['circle']], 'then exactly one measured Down, then the Circle that takes slot 199');
    // The stop is checked after that Down, before the take.
    const down = after.findIndex((x) => x.buttons?.[0] === 'down');
    const circle = after.findIndex((x) => x.buttons?.[0] === 'circle');
    const stop = after.findIndex((x, i) => i > down && x.wait?.until?.mem === 'l_row');
    assert.ok(stop > down && stop < circle, 'row checked between the measured Down and the Circle');
    assert.deepEqual(after[stop].wait.until, { mem: 'l_row', equals: toLast.steps.at(-1).row });
  });

  test('the cursors and slots read are confirmed entries', () => {
    for (const n of ['materiaSlotColumn', 'materiaSlotRow', 'materiaListRow', 'materiaListOffset', 'materiaSlot', 'characterWeaponMateria', 'characterArmorMateria', 'menuOverlay']) {
      assert.equal(ADDRESS_TABLE.entries.find((e) => e.name === n)?.status, 'confirmed', n);
    }
  });
});
