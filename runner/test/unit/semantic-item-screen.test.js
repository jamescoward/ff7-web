// Unit: the itemScreen() reader and semantic/item-screen.js (#135 part 2).
// Synthetic memory only.
// Original project code, GPL-2.0-or-later.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ADDRESS_TABLE, EXE_USA_SHA1, MENU_OVERLAY_ITEM, makeTable, validateTable } from '../../../semantic/addresses.js';
import { ITEM_SCREEN_ACTIONS } from '../../../semantic/controls.js';
import { ITEM_PAGE_ROWS, ITEM_TARGET_ROWS, itemListPlan, itemPageRows, itemRowLabel, itemTargetPlan, itemUseOutcome } from '../../../semantic/item-screen.js';
import { createSemantic } from '../../../semantic/layer.js';

const GAME_STATE = 0x9c560;
const OVERLAY = 0x62dd4;
const SCREEN = 0x1d3e48;
const LIST_ROW = 0x1d3df9;
const LIST_OFF = 0x1d3df0;
const TARGET = 0x1d3e0b;

/** The shipped table with menuOverlay confirmed (as Tier 2 may make it); the tests do not depend on scenario names. */
const CONFIRMED = makeTable(EXE_USA_SHA1, ADDRESS_TABLE.entries.map((e) => {
  const { exe, ...rest } = e;
  if (e.name !== 'menuOverlay') return rest;
  return { ...rest, status: 'confirmed', scenario: 'synthetic', confirmedValues: { 1: 'synthetic' } };
}));

function setup({ state = 5, overlay = MENU_OVERLAY_ITEM, screen = 1, listRow = 3, listOff = 0, target = 2, table = CONFIRMED } = {}) {
  const bytes = new Uint8Array(0x200000);
  const view = new DataView(bytes.buffer);
  view.setInt16(GAME_STATE, state, true);
  view.setUint32(OVERLAY, overlay, true);
  view.setInt32(SCREEN, screen, true);
  bytes[LIST_ROW] = listRow;
  view.setInt16(LIST_OFF, listOff, true);
  bytes[TARGET] = target;
  const reads = [];
  const backend = { readMem: (a, l) => { reads.push([a, l]); return bytes.subarray(a & 0x1fffff, (a & 0x1fffff) + l); } };
  return { s: createSemantic({ backend, exeSha1: EXE_USA_SHA1, table }), reads };
}
const NONE = { page: null, listRow: null, listOffset: null, targetSlot: null };

describe('itemScreen reader', () => {
  test('the shipped table validates; menuOverlay is at D_80062DD4 and names the Item overlay as 1', () => {
    validateTable(ADDRESS_TABLE);
    const e = ADDRESS_TABLE.entries.find((x) => x.name === 'menuOverlay');
    assert.equal(e.address, 0x80062dd4);
    assert.equal(e.type, 'u32');
    assert.equal(MENU_OVERLAY_ITEM, 1);
  });

  test('list page: page, list row and offset; the party cursor is not read', async () => {
    const { s, reads } = setup({ screen: 1, listRow: 3 });
    const r = await s.itemScreen();
    assert.deepEqual(r, { value: { page: 'list', listRow: 3, listOffset: 0, targetSlot: null }, confirmed: true });
    assert.ok(!reads.some(([a]) => a === 0x80000000 + TARGET));
  });

  test('target page: page, offset and party slot', async () => {
    const r = await setup({ screen: 2, target: 1 }).s.itemScreen();
    assert.deepEqual(r, { value: { page: 'target', listRow: null, listOffset: 0, targetSlot: 1 }, confirmed: true });
  });

  test('not in the menu: nothing, and only gameState is read', async () => {
    const { s, reads } = setup({ state: 1 });
    const r = await s.itemScreen();
    assert.deepEqual(r.value, NONE);
    assert.equal(r.reason, 'not in menu');
    assert.deepEqual(reads, [[0x8009c560, 2]]);
  });

  test('another menu overlay: nothing, and the Item overlay variables are not read', async () => {
    const { s, reads } = setup({ overlay: 3, screen: 1 });
    const r = await s.itemScreen();
    assert.deepEqual(r.value, NONE);
    assert.ok(!reads.some(([a]) => a === 0x80000000 + SCREEN));
  });

  test('an unconfirmed page (tabs 0, arrange 4, data 0x43784343) shows nothing', async () => {
    for (const screen of [0, 3, 4, 0x43784343]) {
      const r = await setup({ screen }).s.itemScreen();
      assert.deepEqual(r.value, NONE, `screen ${screen}`);
      assert.equal(r.confirmed, false);
    }
  });

  test('with menuOverlay a hypothesis (the shipped table until Tier 2), nothing is confirmed', async () => {
    const shipped = ADDRESS_TABLE.entries.find((x) => x.name === 'menuOverlay').status;
    const r = await setup({ table: ADDRESS_TABLE }).s.itemScreen();
    if (shipped === 'confirmed') assert.equal(r.value.page, 'list');
    else assert.deepEqual(r, { value: NONE, confirmed: false });
  });

  test('a failed read reports the reason', async () => {
    const backend = { readMem: () => { throw new Error('gone'); } };
    const r = await createSemantic({ backend, exeSha1: EXE_USA_SHA1, table: CONFIRMED }).itemScreen();
    assert.deepEqual(r, { value: null, confirmed: false, reason: 'read failed' });
  });
});

describe('semantic/item-screen.js', () => {
  const inv = [
    { slot: 0, index: 1, quantity: 2, kind: 'item', number: 1 },
    { slot: 2, index: 0, quantity: 5, kind: 'item', number: 0 },
    { slot: 12, index: 130, quantity: 1, kind: 'weapon', number: 2 },
  ];

  test('page rows: ten rows from the offset, empty slots null', () => {
    assert.equal(ITEM_PAGE_ROWS, 10);
    assert.equal(ITEM_TARGET_ROWS, 3);
    const rows = itemPageRows(0, inv);
    assert.equal(rows.length, 10);
    assert.deepEqual(rows[0], { row: 0, slot: 0, item: { index: 1, quantity: 2, kind: 'item', number: 1 } });
    assert.equal(rows[1].item, null);
    assert.equal(rows[2].item.quantity, 5);
    const later = itemPageRows(5, inv);
    assert.equal(later[0].slot, 5);
    assert.equal(later[7].item.kind, 'weapon');
  });

  test('page rows: no rows for an unread or bad offset', () => {
    assert.deepEqual(itemPageRows(null, inv), []);
    assert.deepEqual(itemPageRows(-1, inv), []);
    assert.deepEqual(itemPageRows(1.5, inv), []);
    assert.equal(itemPageRows(0, null).length, 10);
  });

  test('row labels are IDs and counts only', () => {
    assert.equal(itemRowLabel(null), '—');
    assert.equal(itemRowLabel({ kind: 'item', number: 0, quantity: 5 }), 'item #0 ×5');
  });

  test('plans: list moves never wrap, the party cursor never wraps (source claims)', () => {
    const down = itemListPlan(0, 2);
    assert.deepEqual(down.steps.map((s) => s.expect), [1, 2]);
    assert.equal(down.wraps, false);
    const up = itemListPlan(9, 0);
    assert.equal(up.steps.length, 9);
    const target = itemTargetPlan(2, 0);
    assert.deepEqual(target.steps.map((s) => s.expect), [1, 0]);
    assert.throws(() => itemListPlan(0, 10), RangeError);
    assert.throws(() => itemTargetPlan(0, 3), RangeError);
  });

  test('use outcome: count down by one is a use; HP rise reported separately', () => {
    assert.deepEqual(itemUseOutcome({ quantity: 5, hp: 300 }, { quantity: 4, hp: 333 }), { used: true, hpRose: true });
    assert.deepEqual(itemUseOutcome({ quantity: 1, hp: 300 }, { quantity: 0, hp: 400 }), { used: true, hpRose: true });
    assert.deepEqual(itemUseOutcome({ quantity: 5, hp: 500 }, { quantity: 5, hp: 500 }), { used: false, hpRose: false });
    assert.deepEqual(itemUseOutcome({ quantity: 5, hp: null }, { quantity: 4, hp: 200 }), { used: true, hpRose: null });
    assert.deepEqual(itemUseOutcome({ quantity: 5, hp: 1 }, { quantity: 3, hp: 2 }), { used: false, hpRose: true });
    assert.deepEqual(itemUseOutcome(null, { quantity: 4 }), { used: false, hpRose: null });
  });

  test('actions: select is Circle, Back is Cross', () => {
    assert.equal(ITEM_SCREEN_ACTIONS.select.button, 'circle');
    assert.equal(ITEM_SCREEN_ACTIONS.back.button, 'cross');
  });
});
