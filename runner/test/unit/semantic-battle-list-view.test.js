// Unit: the battle panel's list view facts (#253 part 2): list entries from raw
// reads, their labels, the view for a battleList() sample, the tap plan, the
// plan cursor, and the layer's battleListEntries() reader. Synthetic memory only.
// Original project code, GPL-2.0-or-later.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { EXE_USA_SHA1, SAVEMAP } from '../../../semantic/addresses.js';
import { battleListEntries, battleListLabel, battleListPlan, MAGIC_ID_NONE } from '../../../semantic/battle-lists.js';
import { battleListPlanCursor, battleListTapPlan, battleListView } from '../../../semantic/battle-panel.js';
import { createSemantic } from '../../../semantic/layer.js';

const MAGIC_IDS = 0x9d84c + 0x108; // g_ActiveCharacters[0].enabledMagic, 8 bytes an entry
const ITEM_COUNTS = 0x1671b8 + 2; // g_BattleItemList[n].count, 6 bytes an entry
const INVENTORY = (SAVEMAP & 0x1fffff) + 0x4fc; // savemap inventory (addresses.js inventorySlot)

describe('battleListEntries / battleListLabel (#253 part 2)', () => {
  test('magic: every index whose id is not 0xFF, in list order', () => {
    const ids = [0, 1, MAGIC_ID_NONE, 7, MAGIC_ID_NONE];
    assert.deepEqual(battleListEntries('magic', { ids }), [{ index: 0, id: 0 }, { index: 1, id: 1 }, { index: 3, id: 7 }]);
    assert.equal(battleListLabel('magic', { index: 3, id: 7 }), 'Spell #7');
  });

  test('item: every index with a count, with the inventory id of that slot', () => {
    const counts = [3, 0, 5];
    const inventory = [{ slot: 0, index: 1, quantity: 3, kind: 'item', number: 1 }, { slot: 2, index: 130, quantity: 5, kind: 'weapon', number: 2 }];
    const got = battleListEntries('item', { counts, inventory });
    assert.deepEqual(got, [
      { index: 0, count: 3, item: { index: 1, kind: 'item', number: 1 } },
      { index: 2, count: 5, item: { index: 130, kind: 'weapon', number: 2 } },
    ]);
    assert.equal(battleListLabel('item', got[0]), 'item #1 ×3');
    assert.equal(battleListLabel('item', { index: 4, count: 2, item: null }), 'Slot 4 ×2');
  });

  test('bad input gives no entries; an unknown list throws', () => {
    assert.deepEqual(battleListEntries('magic', null), []);
    assert.deepEqual(battleListEntries('item', { counts: 'x' }), []);
    assert.throws(() => battleListEntries('summon2', {}), RangeError);
  });
});

describe('battleListView / battleListTapPlan / battleListPlanCursor', () => {
  const sample = (v, confirmed = true) => ({ value: { actor: 0, list: 'magic', index: 4, row: 1, offset: 0, column: 1, ...v }, confirmed });

  test('a confirmed list read is the list view, with its cursor', () => {
    assert.deepEqual(battleListView(sample({})), { view: 'list', list: 'magic', actor: 0, row: null, index: 4, pos: { row: 1, offset: 0, column: 1 } });
    const item = battleListView(sample({ list: 'item', index: 3, row: 2, offset: 1, column: null }));
    assert.deepEqual(item.pos, { row: 2, offset: 1, column: 0 });
  });

  test('a failed read is null; unconfirmed or no list is hidden; an unread cursor has no index', () => {
    assert.equal(battleListView(null), null);
    assert.equal(battleListView({ value: null }), null);
    assert.equal(battleListView(sample({}, false)).view, 'hidden');
    assert.equal(battleListView(sample({ list: null })).view, 'hidden');
    const v = battleListView(sample({ actor: 1, index: null, row: null, offset: null, column: null }));
    assert.equal(v.view, 'list');
    assert.equal(v.index, null);
    assert.equal(v.pos, null);
  });

  test('the tap plan is battleListPlan from the read cursor', () => {
    const v = battleListView(sample({}));
    assert.deepEqual(battleListTapPlan(v, 0), battleListPlan('magic', { row: 1, offset: 0, column: 1 }, 0));
    assert.deepEqual(battleListTapPlan(v, 0).steps.map((s) => s.button), ['up', 'left']);
    assert.throws(() => battleListTapPlan(battleListView(sample({ index: null })), 0), RangeError);
    assert.throws(() => battleListTapPlan(v, 54), RangeError);
  });

  test('plan cursor: the index, null when unread, left when the list closed or changed hands', () => {
    assert.equal(battleListPlanCursor(sample({}), 0, 'magic'), 4);
    assert.equal(battleListPlanCursor(sample({ index: null }), 0, 'magic'), null);
    assert.equal(battleListPlanCursor(sample({}, false), 0, 'magic'), null);
    assert.equal(battleListPlanCursor(null, 0, 'magic'), null);
    assert.equal(battleListPlanCursor(sample({ list: null }), 0, 'magic'), 'left');
    assert.equal(battleListPlanCursor(sample({ list: 'item' }), 0, 'magic'), 'left');
    assert.equal(battleListPlanCursor(sample({ actor: 1 }), 0, 'magic'), 'left');
  });
});

describe('layer battleListEntries() (#253 part 2)', () => {
  function setup() {
    const bytes = new Uint8Array(0x200000);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < 54; i++) bytes[MAGIC_IDS + i * 8] = MAGIC_ID_NONE;
    bytes[MAGIC_IDS] = 0;
    bytes[MAGIC_IDS + 2 * 8] = 2;
    for (let i = 0; i < 320; i++) view.setUint16(INVENTORY + i * 2, 0xffff, true);
    view.setUint16(INVENTORY + 3 * 2, (9 << 9) | 1, true); // slot 3: item 1 ×9
    bytes[ITEM_COUNTS + 3 * 6] = 8; // battle count 8
    const backend = { readMem: (a, l) => bytes.subarray(a & 0x1fffff, (a & 0x1fffff) + l) };
    return createSemantic({ backend, exeSha1: EXE_USA_SHA1 });
  }

  test('magic for slot 0 reads battleMagicId0 at its stride', async () => {
    const r = await setup().battleListEntries('magic', 0);
    assert.deepEqual(r, { value: [{ index: 0, id: 0 }, { index: 2, id: 2 }], confirmed: true });
  });

  test('item reads the battle counts and the inventory ids', async () => {
    const r = await setup().battleListEntries('item', 0);
    assert.equal(r.confirmed, true);
    assert.deepEqual(r.value, [{ index: 3, count: 8, item: { index: 1, kind: 'item', number: 1 } }]);
  });

  test('an unconfirmed entry reads nothing; bad arguments are refused', async () => {
    const s = setup();
    assert.deepEqual(await s.battleListEntries('magic', 1), { value: [], confirmed: false });
    assert.equal((await s.battleListEntries('nope', 0)).reason, 'unknown list');
    assert.equal((await s.battleListEntries('magic', 3)).reason, 'out of range');
  });
});
