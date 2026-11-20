// Unit: the equipCursors() reader and its address entries (#216). Synthetic memory only.
// Original project code, GPL-2.0-or-later.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ADDRESS_TABLE, EXE_USA_SHA1, MENU_OVERLAY_EQUIP, MENU_OVERLAY_ITEM } from '../../../semantic/addresses.js';
import { createSemantic } from '../../../semantic/layer.js';
import { CANDIDATES } from './equip-cursor-scenarios.js';

const GAME_STATE = 0x9c560;
const OVERLAY = 0x62dd4;
const SLOT = 0x1d8aab;
const ROW = 0x1d8abd;
const OFFSET = 0x1d8ab4;
const byName = (n) => ADDRESS_TABLE.entries.find((e) => e.name === n);

function setup({ state = 5, overlay = MENU_OVERLAY_EQUIP, slot = 0, row = 0, offset = 0 } = {}) {
  const bytes = new Uint8Array(0x200000);
  const view = new DataView(bytes.buffer);
  view.setInt16(GAME_STATE, state, true);
  view.setUint32(OVERLAY, overlay, true);
  view.setInt8(SLOT, slot);
  view.setInt8(ROW, row);
  view.setInt16(OFFSET, offset, true);
  const reads = [];
  const backend = { readMem: (a, l) => { reads.push([a, l]); return bytes.subarray(a & 0x1fffff, (a & 0x1fffff) + l); } };
  return { s: createSemantic({ backend, exeSha1: EXE_USA_SHA1, table: ADDRESS_TABLE }), reads };
}

describe('Equip screen cursor entries (#216)', () => {
  test('the entries are the track candidates the scenarios check, laid out as MenuTables', () => {
    assert.equal(byName('equipSlotCursor').address, CANDIDATES.slot);
    assert.equal(byName('equipListRow').address, CANDIDATES.listRow);
    assert.equal(byName('equipListOffset').address, CANDIDATES.listOffset);
    assert.equal(byName('equipListRow').address - byName('equipSlotCursor').address, 0x12);
    assert.equal(byName('equipListRow').address - byName('equipListOffset').address, 0x0b - 0x02);
    assert.match(byName('equipSlotCursor').scenario, /save-boot-18a-equip-slot-cursor\.json$/);
    assert.match(byName('equipListRow').scenario, /save-boot-18b-equip-list-cursor\.json$/);
  });
});

describe('equipCursors reader (#216)', () => {
  test('on the Equip screen: slot, row and offset', async () => {
    assert.deepEqual(await setup({ slot: 2, row: 7, offset: 2 }).s.equipCursors(), { value: { slot: 2, listRow: 7, listOffset: 2 }, confirmed: true });
    assert.deepEqual(await setup().s.equipCursors(), { value: { slot: 0, listRow: 0, listOffset: 0 }, confirmed: true });
  });

  test('out-of-range values read null', async () => {
    const r = await setup({ slot: 3, row: 8, offset: -1 }).s.equipCursors();
    assert.deepEqual(r.value, { slot: null, listRow: null, listOffset: null });
    assert.deepEqual((await setup({ slot: -1, row: -1 }).s.equipCursors()).value, { slot: null, listRow: null, listOffset: 0 });
  });

  test('another overlay: nulls, and the overlay variables are not read', async () => {
    const { s, reads } = setup({ overlay: MENU_OVERLAY_ITEM, slot: 1 });
    const r = await s.equipCursors();
    assert.deepEqual(r.value, { slot: null, listRow: null, listOffset: null });
    assert.equal(r.reason, 'not the Equip screen');
    assert.deepEqual(reads, [[0x8009c560, 2], [0x80062dd4, 4]]);
  });

  test('not in the menu: nulls, and only gameState is read', async () => {
    const { s, reads } = setup({ state: 1 });
    const r = await s.equipCursors();
    assert.equal(r.reason, 'not in menu');
    assert.deepEqual(reads, [[0x8009c560, 2]]);
  });

  test('a failed read reports confirmed false', async () => {
    const backend = { readMem: () => { throw new Error('gone'); } };
    const r = await createSemantic({ backend, exeSha1: EXE_USA_SHA1, table: ADDRESS_TABLE }).equipCursors();
    assert.equal(r.confirmed, false);
  });
});
