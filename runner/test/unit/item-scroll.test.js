// #256 part 1: the Item-list scroll Tier 2 scenarios are the planner's
// output, and the save they load holds what their descriptions say.
// Original project code, GPL-2.0-or-later.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADDRESS_TABLE } from '../../../semantic/addresses.js';
import { ITEM_PAGE_ROWS, itemListSlot } from '../../../semantic/item-screen.js';
import { HP_BEFORE, HP_MAX, ITEMS, LIST_START, MEASURE_DOWNS, SAVE, USE, farEnd, itemScrollScenarios, toFar, wordOf } from './item-scroll-scenarios.js';
import { SCENARIO_DIR, serialise } from './planner-scenarios.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAVES = path.resolve(HERE, '../../../harness/saves');
const byName = (n) => itemScrollScenarios().find((s) => s.name === n);

describe('#256 item-scroll scenarios', () => {
  test('committed files equal item-scroll-scenarios.js (run node runner/test/unit/item-scroll-scenarios.js to fix)', () => {
    for (const s of itemScrollScenarios()) {
      const file = path.join(SCENARIO_DIR, `${s.name}.json`);
      assert.equal(readFileSync(file, 'utf8'), serialise(s), file);
      assert.ok(statSync(file).size < 64 * 1024, `${file} under the 64 KiB scenario limit`);
      assert.ok(s.metrics.length <= 8);
    }
  });

  test('the target is past page 1 and the plan ends on it', () => {
    assert.ok(USE.slot >= ITEM_PAGE_ROWS);
    assert.equal(itemListSlot(farEnd.row, farEnd.offset), USE.slot);
    assert.deepEqual(LIST_START, { row: 0, offset: 0 });
  });

  test('the acceptance presses Item, the planned list moves, Circle, the party move, Circle', () => {
    const accept = byName('save-boot-31b-item-use-past-page1');
    const presses = accept.input.filter((s) => s.buttons).map((s) => s.buttons[0]);
    assert.deepEqual(presses, ['circle', ...toFar.steps.map((s) => s.button), 'circle', ...Array(USE.partySlot).fill('down'), 'circle']);
    // After every list press, both cursors are checked against the plan's step.
    const listChecks = accept.input.filter((s) => ['list_row', 'list_off'].includes(s.wait?.until?.mem)).map((s) => [s.wait.until.mem, s.wait.until.equals]);
    const expected = [['list_row', 0], ['list_off', 0]];
    let prev = LIST_START;
    for (const s of toFar.steps) {
      const scrolls = s.row === prev.row;
      expected.push(scrolls ? ['list_off', s.offset] : ['list_row', s.row], scrolls ? ['list_row', s.row] : ['list_off', s.offset]);
      prev = s;
    }
    assert.deepEqual(listChecks, expected);
    assert.ok(toFar.steps.some((s, i) => s.row === (i ? toFar.steps[i - 1] : LIST_START).row), 'the plan scrolls at least once');
    const countCheck = accept.assert.find((a) => a.metric === 'count_ok');
    assert.equal(countCheck.expect.equals, wordOf({ ...ITEMS[2], quantity: ITEMS[2].quantity - 1 }));
  });

  test('the measurement presses Down blind, as many times as the plan', () => {
    const measure = byName('save-boot-31a-item-list-scroll-measure');
    const presses = measure.input.filter((s) => s.buttons).map((s) => s.buttons[0]);
    assert.deepEqual(presses, Array(MEASURE_DOWNS).fill('down'));
    assert.equal(MEASURE_DOWNS, toFar.steps.length);
  });

  test('the save holds the items and the HP the scenarios assume', () => {
    const save = JSON.parse(readFileSync(path.join(SAVES, `${SAVE}.json`), 'utf8'));
    assert.deepEqual(save.items, ITEMS.map((i) => ({ ...i })));
    assert.equal(save.items.find((i) => i.slot === USE.slot).index, 0);
    assert.deepEqual(save.party, [0, 1, 2]);
    const rec = save.characters.find((c) => c.record === save.party[USE.partySlot]);
    assert.equal(rec.hp, HP_BEFORE);
    assert.equal(rec.maxHp, HP_MAX);
  });

  test('memory names point at the address-table entries', () => {
    const s = byName('save-boot-31b-item-use-past-page1');
    const e = (n) => ADDRESS_TABLE.entries.find((x) => x.name === n);
    assert.equal(Number(s.memory.list_row.addr), e('itemListRow').address);
    assert.equal(Number(s.memory.list_off.addr), e('itemListOffset').address);
    assert.equal(Number(s.memory.inv13.addr), e('inventorySlot').address + e('inventorySlot').stride * 13);
  });
});
