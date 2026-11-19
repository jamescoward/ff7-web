// #121 part 1: the Equip-screen Tier 2 scenarios are generated (the move to
// Equip is the menu planner's output), and the save they load holds what the
// scenario descriptions say.
// Original project code, GPL-2.0-or-later.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADDRESS_TABLE, CHARACTER_RECORD_SIZE, MENU_OVERLAY_EQUIP } from '../../../semantic/addresses.js';
import { EQUIP_ROW, ITEMS, OVERLAY_EQUIP, SAVE, WEAPON_AFTER, WEAPON_BEFORE, equipScenarios } from './equip-scenarios.js';
import { SCENARIO_DIR, serialise } from './planner-scenarios.js';
import { loadScenario } from '../../scenario.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAVES = path.resolve(HERE, '../../../harness/saves');
const byName = (n) => ADDRESS_TABLE.entries.find((e) => e.name === n);

describe('#121 equip scenarios', () => {
  test('committed files equal equip-scenarios.js (run node runner/test/unit/equip-scenarios.js to fix)', () => {
    for (const s of equipScenarios()) {
      const file = path.join(SCENARIO_DIR, `${s.name}.json`);
      assert.equal(readFileSync(file, 'utf8'), serialise(s), file);
    }
  });

  test('every scenario loads as a tier 2 scenario with at most 8 metrics', () => {
    for (const s of equipScenarios()) {
      loadScenario(JSON.parse(readFileSync(path.join(SCENARIO_DIR, `${s.name}.json`), 'utf8')), { allowTier2: true });
      assert.ok(s.metrics.length <= 8, s.name);
    }
  });

  test('the move to Equip is the planned Downs to row 3, then Circle', () => {
    assert.equal(EQUIP_ROW, 3);
    const [once, , accept] = equipScenarios();
    const presses = once.input.filter((s) => s.buttons).map((s) => s.buttons[0]);
    assert.deepEqual(presses, [...Array(EQUIP_ROW).fill('down'), 'circle']);
    const rowWaits = once.input.filter((s) => s.wait?.until?.mem === 'row0').map((s) => s.wait.until.equals);
    assert.deepEqual(rowWaits, [0, 1, 2, 3]);
    // Acceptance: the planned Downs, Circle until the overlay loads, then two Circles.
    const acc = accept.input.filter((s) => s.buttons).map((s) => s.buttons[0]);
    assert.deepEqual(acc, [...Array(EQUIP_ROW).fill('down'), 'circle', 'circle']);
    const ovl = accept.input.find((s) => s.wait?.until?.mem === 'menu_ovl');
    assert.equal(ovl.wait.until.equals, OVERLAY_EQUIP);
    assert.deepEqual(ovl.wait.press.buttons, ['circle']);
  });

  test('the save holds the party, weapon and spare weapons the scenarios assume', () => {
    const save = JSON.parse(readFileSync(path.join(SAVES, `${SAVE}.json`), 'utf8'));
    assert.deepEqual(save.party, [0, 255, 255]);
    assert.deepEqual(save.items, ITEMS.map((i) => ({ ...i })));
    const cloud = save.equipment.find((e) => e.record === 0);
    assert.equal(cloud.weapon, WEAPON_BEFORE);
    assert.equal(WEAPON_AFTER, save.items[0].index - 128);
    for (const i of save.items) assert.ok(i.index >= 128 && i.index < 256, 'a weapon');
  });

  test('memory names point at the address-table entries', () => {
    const [s] = equipScenarios();
    assert.equal(Number(s.memory.menu_ovl.addr), byName('menuOverlay').address);
    assert.equal(Number(s.memory.weapon0.addr), byName('characterWeapon').address + CHARACTER_RECORD_SIZE * 0);
    assert.equal(Number(s.memory.inv0.addr), byName('inventorySlot').address);
    assert.equal(Number(s.memory.inv1.addr), byName('inventorySlot').address + 2);
  });

  test('menuOverlay 4 (Equip) is confirmed by 15b, the value the scenarios wait for', () => {
    assert.equal(MENU_OVERLAY_EQUIP, OVERLAY_EQUIP);
    const e = byName('menuOverlay');
    assert.equal(e.values[OVERLAY_EQUIP], 'equip');
    assert.equal(e.confirmedValues[OVERLAY_EQUIP], 'harness/scenarios/save-boot-15b-equip-screen-open.json');
  });
});
