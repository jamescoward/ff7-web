// #135: the Item-screen Tier 2 scenarios are the planner's output, and the
// save they load holds what the scenario descriptions say.
// Original project code, GPL-2.0-or-later.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADDRESS_TABLE } from '../../../semantic/addresses.js';
import { MENUS, menuPlanArgs } from '../../../semantic/menus.js';
import { HP_BEFORE, HP_MAX, ITEMS, SAVE, USE, itemUseScenarios } from './item-use-scenarios.js';
import { SCENARIO_DIR, serialise } from './planner-scenarios.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAVES = path.resolve(HERE, '../../../harness/saves');

describe('#135 item-use scenarios', () => {
  test('committed files equal item-use-scenarios.js (run node runner/test/unit/item-use-scenarios.js to fix)', () => {
    for (const s of itemUseScenarios()) {
      const file = path.join(SCENARIO_DIR, `${s.name}.json`);
      assert.equal(readFileSync(file, 'utf8'), serialise(s), file);
    }
  });

  test('the acceptance script presses Item, the planned list and party moves, then Circle', () => {
    const accept = itemUseScenarios().find((s) => s.name === 'save-boot-14b-item-use-plan');
    const presses = accept.input.filter((s) => s.buttons).map((s) => s.buttons[0]);
    assert.deepEqual(presses, ['circle', ...Array(USE.listRow).fill('down'), 'circle', ...Array(USE.partySlot).fill('down'), 'circle']);
    const listWaits = accept.input.filter((s) => s.wait?.until?.mem === 'list_row').map((s) => s.wait.until.equals);
    assert.deepEqual(listWaits, [1, 2]);
    const partyWaits = accept.input.filter((s) => s.wait?.until?.mem === 'party_row').map((s) => s.wait.until.equals);
    assert.deepEqual(partyWaits, [1]);
    // The count check is one below the save's quantity, same index.
    const used = ITEMS[USE.listRow];
    const countCheck = accept.assert.find((a) => a.metric === 'count_ok');
    assert.equal(countCheck.expect.equals, ((used.quantity - 1) << 9) | used.index);
    assert.ok(accept.metrics.length <= 8);
  });

  test('the save holds the items and the HP the scenarios assume', () => {
    const save = JSON.parse(readFileSync(path.join(SAVES, `${SAVE}.json`), 'utf8'));
    assert.deepEqual(save.items, ITEMS.map((i) => ({ ...i })));
    assert.deepEqual(save.party, [0, 1, 2]);
    const rec = save.characters.find((c) => c.record === save.party[USE.partySlot]);
    assert.equal(rec.hp, HP_BEFORE);
    assert.equal(rec.maxHp, HP_MAX);
    // A Potion restores 100 (source claim): the HP the check expects is capped at max.
    assert.equal(Math.min(HP_BEFORE + 100, HP_MAX), HP_MAX);
  });

  test('memory names point at the address-table entries', () => {
    const [diag] = itemUseScenarios();
    const byName = (n) => ADDRESS_TABLE.entries.find((e) => e.name === n);
    assert.equal(Number(diag.memory.item_screen.addr), byName('itemMenuScreen').address);
    assert.equal(Number(diag.memory.list_row.addr), byName('itemListRow').address);
    assert.equal(Number(diag.memory.list_off.addr), byName('itemListOffset').address);
    assert.equal(Number(diag.memory.party_row.addr), byName('itemTargetSlot').address);
  });

  test('the Item-screen menus plan within source claims only', () => {
    for (const name of ['itemList', 'itemTarget']) {
      const m = MENUS[name];
      assert.ok(ADDRESS_TABLE.entries.find((e) => e.name === m.cursor), m.cursor);
      assert.equal(menuPlanArgs(name).wraps, false);
    }
  });
});
