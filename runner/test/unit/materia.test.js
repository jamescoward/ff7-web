// #241: the Materia-screen Tier 2 scenarios are generated (the move to
// Materia is the menu planner's output), and the save they load holds what
// the scenario descriptions say.
// Original project code, GPL-2.0-or-later.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADDRESS_TABLE, CHARACTER_RECORD_SIZE, MENU_OVERLAY_EQUIP, MENU_OVERLAY_MATERIA } from '../../../semantic/addresses.js';
import { MATERIA, MATERIA_EMPTY, MATERIA_ROW, MATERIA_WORD, OVERLAY_MATERIA, SAVE, materiaScenarios } from './materia-scenarios.js';
import { SCENARIO_DIR, serialise } from './planner-scenarios.js';
import { loadScenario } from '../../scenario.js';
import { descriptionProblems } from '../../savegen/index.js';
import { MATERIA_EMPTY as SAVEGEN_EMPTY, packMateria } from '../../savegen/layout.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAVES = path.resolve(HERE, '../../../harness/saves');
const byName = (n) => ADDRESS_TABLE.entries.find((e) => e.name === n);

describe('#241 materia scenarios', () => {
  test('committed files equal materia-scenarios.js (run node runner/test/unit/materia-scenarios.js to fix)', () => {
    for (const s of materiaScenarios()) {
      const file = path.join(SCENARIO_DIR, `${s.name}.json`);
      assert.equal(readFileSync(file, 'utf8'), serialise(s), file);
    }
  });

  test('every scenario loads as a tier 2 scenario with at most 8 metrics', () => {
    for (const s of materiaScenarios()) {
      loadScenario(JSON.parse(readFileSync(path.join(SCENARIO_DIR, `${s.name}.json`), 'utf8')), { allowTier2: true });
      assert.ok(s.metrics.length <= 8, s.name);
    }
  });

  test('the move to Materia is the planned Downs to row 2, then Circle until the overlay loads, then two Circles', () => {
    assert.equal(MATERIA_ROW, 2);
    const [open, accept] = materiaScenarios();
    assert.deepEqual(open.input.filter((s) => s.buttons).map((s) => s.buttons[0]), Array(MATERIA_ROW).fill('down'));
    assert.deepEqual(open.input.filter((s) => s.wait?.until?.mem === 'row0').map((s) => s.wait.until.equals), [0, 1, 2]);
    const ovl = accept.input.find((s) => s.wait?.until?.mem === 'menu_ovl');
    assert.equal(ovl.wait.until.equals, OVERLAY_MATERIA);
    assert.deepEqual(ovl.wait.press.buttons, ['circle']);
    assert.deepEqual(accept.input.filter((s) => s.buttons).map((s) => s.buttons[0]), [...Array(MATERIA_ROW).fill('down'), 'circle', 'circle']);
  });

  test('the overlay the scenarios wait for is the one before Equip (enum order), not Equip itself', () => {
    assert.equal(OVERLAY_MATERIA, MENU_OVERLAY_EQUIP - 1);
  });

  test('the save holds the party, the empty slots and the materia the scenarios assume', () => {
    const save = JSON.parse(readFileSync(path.join(SAVES, `${SAVE}.json`), 'utf8'));
    assert.deepEqual(descriptionProblems(save), []);
    assert.deepEqual(save.party, [0, 255, 255]);
    // A `characters` entry for record 0 empties its materia slots (#117); none are filled by `equipment`.
    assert.ok(save.characters.some((c) => c.record === 0));
    assert.ok(!save.equipment.some((e) => e.record === 0 && e.materia?.length));
    assert.deepEqual(save.materia, [{ ...MATERIA }]);
    assert.equal(MATERIA_WORD, packMateria(MATERIA.id, MATERIA.ap));
    assert.equal(MATERIA_EMPTY, SAVEGEN_EMPTY);
  });

  test('memory names point at the address-table entries', () => {
    const [s] = materiaScenarios();
    assert.equal(Number(s.memory.menu_ovl.addr), byName('menuOverlay').address);
    assert.equal(Number(s.memory.wm0.addr), byName('characterWeaponMateria').address + CHARACTER_RECORD_SIZE * 0);
    assert.equal(Number(s.memory.mat0.addr), byName('materiaSlot').address);
  });

  test('menuOverlay 3 (Materia) is confirmed by 22a, the value the scenarios wait for', () => {
    assert.equal(MENU_OVERLAY_MATERIA, OVERLAY_MATERIA);
    const e = byName('menuOverlay');
    assert.equal(e.values[OVERLAY_MATERIA], 'materia');
    assert.equal(e.confirmedValues[OVERLAY_MATERIA], 'harness/scenarios/save-boot-22a-materia-screen-open.json');
  });
});
