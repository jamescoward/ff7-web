// #215: the party-pick Tier 2 scenarios are generated (the move to Equip is the
// menu planner's output), and the save they load holds what the scenario
// descriptions say.
// Original project code, GPL-2.0-or-later.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADDRESS_TABLE, CHARACTER_RECORD_SIZE } from '../../../semantic/addresses.js';
import { EQUIP_ROW, ITEMS, OVERLAY_EQUIP, PARTY, PICK_CANDIDATE, SAVE, TABLE2_ROW, partyPickScenarios } from './party-pick-scenarios.js';
import { SCENARIO_DIR, serialise } from './planner-scenarios.js';
import { loadScenario } from '../../scenario.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAVES = path.resolve(HERE, '../../../harness/saves');
const byName = (n) => ADDRESS_TABLE.entries.find((e) => e.name === n);

describe('#215 party-pick scenarios', () => {
  test('committed files equal party-pick-scenarios.js (run node runner/test/unit/party-pick-scenarios.js to fix)', () => {
    for (const s of partyPickScenarios()) {
      const file = path.join(SCENARIO_DIR, `${s.name}.json`);
      assert.equal(readFileSync(file, 'utf8'), serialise(s), file);
    }
  });

  test('every scenario loads as a tier 2 scenario with at most 8 metrics', () => {
    for (const s of partyPickScenarios()) {
      loadScenario(JSON.parse(readFileSync(path.join(SCENARIO_DIR, `${s.name}.json`), 'utf8')), { allowTier2: true });
      assert.ok(s.metrics.length <= 8, s.name);
    }
  });

  test('the candidate is table 1 row of g_PartyMenuTables, next to the confirmed menuCursor', () => {
    assert.equal(byName('menuCursor').address, 0x8009a0d3);
    assert.equal(PICK_CANDIDATE, 0x8009a0e5);
    assert.equal(PICK_CANDIDATE - byName('menuCursor').address, 0x12);
    assert.equal(TABLE2_ROW, 0x8009a0f7);
  });

  test('each acceptance plans to Equip, Circles once, then Downs k times before checking the pick', () => {
    assert.equal(EQUIP_ROW, 3);
    const [diag, ...accept] = partyPickScenarios();
    assert.equal(accept.length, 3);
    const presses = (s) => s.input.filter((x) => x.buttons).map((x) => x.buttons[0]);
    assert.deepEqual(presses(diag), ['down', 'down', 'down', 'circle', 'down']);
    accept.forEach((s, k) => {
      assert.deepEqual(presses(s), ['down', 'down', 'down', 'circle', ...Array(k).fill('down'), 'circle', 'circle']);
      const pickWait = s.input.findIndex((x) => x.wait?.until?.mem === 'pick');
      assert.equal(s.input[pickWait].wait.until.equals, k);
      const ovl = s.input.findIndex((x) => x.wait?.until?.mem === 'menu_ovl');
      assert.ok(ovl > pickWait, 'the pick is checked before the member is chosen');
      assert.equal(s.input[ovl].wait.until.equals, OVERLAY_EQUIP);
      const changed = s.assert.filter((a) => a.change?.is === 'changed').map((a) => a.change.mem);
      const kept = s.assert.filter((a) => a.change?.is === 'unchanged').map((a) => a.change.mem).sort();
      assert.deepEqual(changed, [`weapon${k}`]);
      assert.deepEqual(kept, PARTY.filter((r) => r !== k).map((r) => `weapon${r}`));
    });
  });

  test('the save holds the party and the spare weapons the scenarios assume', () => {
    const save = JSON.parse(readFileSync(path.join(SAVES, `${SAVE}.json`), 'utf8'));
    assert.deepEqual(save.party, [...PARTY]);
    assert.deepEqual(save.items, ITEMS.map((i) => ({ ...i })));
    assert.deepEqual(save.items.map((i) => i.index - 128), [1, 17, 33]);
    assert.equal(save.equipment, undefined, 'members keep the baseline equipment');
  });

  test('memory names point at the address-table entries', () => {
    const [s] = partyPickScenarios();
    assert.equal(Number(s.memory.menu_ovl.addr), byName('menuOverlay').address);
    for (const r of PARTY) assert.equal(Number(s.memory[`weapon${r}`].addr), byName('characterWeapon').address + CHARACTER_RECORD_SIZE * r);
    assert.equal(Number(s.memory.row0.addr), byName('menuCursor').address);
  });
});
