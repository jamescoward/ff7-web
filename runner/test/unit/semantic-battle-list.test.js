// Unit: the battleList() reader and battleInput() while a sub-list is open (#253). Synthetic memory only.
// Original project code, GPL-2.0-or-later.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ADDRESS_TABLE, BATTLE_WIDGET_ITEM, BATTLE_WIDGET_MAGIC, EXE_USA_SHA1, makeTable } from '../../../semantic/addresses.js';
import { createSemantic } from '../../../semantic/layer.js';

const GAME_STATE = 0x9c560;
const WIDGET = 0xf3896;
const ACTOR = 0xf38a0;
const SLOT = (i) => 0xf90b4 + i * 0x240;
const MAGIC = { off: 0x24 + 0x02, col: 0x24 + 0x0a, row: 0x24 + 0x0b };
const ITEM = { scroll: 0x12 + 0x02, row: 0x12 + 0x0b };

/** The shipped table with every slot's list cursors confirmed (synthetic scenarios). */
const ALL = makeTable(EXE_USA_SHA1, ADDRESS_TABLE.entries.map((e) => {
  const { exe, ...rest } = e;
  return /^battle(Magic(Row|Column|Offset)|Item(Row|Scroll))\d$/.test(e.name) ? { ...rest, status: 'confirmed', scenario: 'synthetic' } : rest;
}));
const SHIPPED = makeTable(EXE_USA_SHA1, ADDRESS_TABLE.entries.map(({ exe, ...rest }) => rest));

function setup({ state = 2, widget = BATTLE_WIDGET_MAGIC, actor = 0, magic = { off: 0, col: 0, row: 0 }, item = { scroll: 0, row: 0 }, table = ALL }) {
  const bytes = new Uint8Array(0x200000);
  const view = new DataView(bytes.buffer);
  view.setInt16(GAME_STATE, state, true);
  view.setInt16(WIDGET, widget, true);
  bytes[ACTOR] = actor;
  view.setInt16(SLOT(actor) + MAGIC.off, magic.off, true);
  bytes[SLOT(actor) + MAGIC.col] = magic.col;
  bytes[SLOT(actor) + MAGIC.row] = magic.row;
  view.setInt16(SLOT(actor) + ITEM.scroll, item.scroll, true);
  bytes[SLOT(actor) + ITEM.row] = item.row;
  const backend = { readMem: (a, l) => bytes.subarray(a & 0x1fffff, (a & 0x1fffff) + l) };
  return createSemantic({ backend, exeSha1: EXE_USA_SHA1, table });
}

describe('battleList reader (#253)', () => {
  test('Magic list: the cursor and its list index', async () => {
    const r = await setup({ magic: { off: 1, col: 2, row: 2 } }).battleList();
    assert.deepEqual(r.value, { actor: 0, list: 'magic', index: 11, row: 2, offset: 1, column: 2 });
    assert.equal(r.confirmed, true);
  });

  test('Item list: one column, index = scroll + row; another slot\'s cursor', async () => {
    const r = await setup({ widget: BATTLE_WIDGET_ITEM, actor: 2, item: { scroll: 1, row: 2 } }).battleList();
    assert.deepEqual(r.value, { actor: 2, list: 'item', index: 3, row: 2, offset: 1, column: null });
  });

  test('no list open, or not in battle: everything null', async () => {
    const none = { actor: null, list: null, index: null, row: null, offset: null, column: null };
    assert.deepEqual((await setup({ widget: 1 }).battleList()).value, none);
    const out = await setup({ state: 1 }).battleList();
    assert.deepEqual(out.value, none);
    assert.equal(out.reason, 'not in battle');
  });

  test('with the shipped table, unconfirmed cursors read null and give no index', async () => {
    const r = await setup({ widget: BATTLE_WIDGET_ITEM, actor: 1, item: { scroll: 0, row: 1 }, table: SHIPPED }).battleList();
    assert.deepEqual(r.value, { actor: 1, list: 'item', index: null, row: null, offset: null, column: null });
    const m = await setup({ magic: { off: 0, col: 1, row: 1 }, table: SHIPPED }).battleList();
    assert.deepEqual(m.value, { actor: 0, list: 'magic', index: 4, row: 1, offset: 0, column: 1 });
  });

  test('battleInput reports nothing while a list is open, so the command panel hides', async () => {
    for (const widget of [BATTLE_WIDGET_MAGIC, BATTLE_WIDGET_ITEM]) {
      const r = await setup({ widget, table: SHIPPED }).battleInput();
      assert.deepEqual(r.value, { actor: null, row: null, targeting: null }, String(widget));
      assert.equal(r.confirmed, true);
    }
  });
});
