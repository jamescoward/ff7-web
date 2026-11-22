// Unit: the materiaCursors() reader and its address entries (#244). Synthetic memory only.
// Original project code, GPL-2.0-or-later.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ADDRESS_TABLE, EXE_USA_SHA1, MENU_OVERLAY_EQUIP, MENU_OVERLAY_MATERIA } from '../../../semantic/addresses.js';
import { createSemantic } from '../../../semantic/layer.js';
import { CANDIDATES } from './materia-cursor-scenarios.js';

const GAME_STATE = 0x9c560;
const OVERLAY = 0x62dd4;
const COLUMN = 0x1df5ac;
const ROW = 0x1df5ad;
const LIST_ROW = 0x1df5d1;
const OFFSET = 0x1df5c8;
const byName = (n) => ADDRESS_TABLE.entries.find((e) => e.name === n);
const CURSOR_NAMES = ['materiaSlotColumn', 'materiaSlotRow', 'materiaListRow', 'materiaListOffset'];
/**
 * The reader's logic is tested over a copy of the table with the four cursor
 * entries marked confirmed, whatever their status in the real table (they
 * stay hypotheses until save-boot-25a/25b pass in Tier 2).
 */
const CONFIRMED_TABLE = { ...ADDRESS_TABLE, entries: ADDRESS_TABLE.entries.map((e) => (CURSOR_NAMES.includes(e.name) ? { ...e, status: 'confirmed' } : e)) };

function setup({ state = 5, overlay = MENU_OVERLAY_MATERIA, row = 0, column = 0, listRow = 0, offset = 0, table = CONFIRMED_TABLE } = {}) {
  const bytes = new Uint8Array(0x200000);
  const view = new DataView(bytes.buffer);
  view.setInt16(GAME_STATE, state, true);
  view.setUint32(OVERLAY, overlay, true);
  view.setInt8(ROW, row);
  view.setInt8(COLUMN, column);
  view.setInt8(LIST_ROW, listRow);
  view.setInt16(OFFSET, offset, true);
  const reads = [];
  const backend = { readMem: (a, l) => { reads.push([a, l]); return bytes.subarray(a & 0x1fffff, (a & 0x1fffff) + l); } };
  return { s: createSemantic({ backend, exeSha1: EXE_USA_SHA1, table }), reads };
}

describe('Materia screen cursor entries (#244)', () => {
  test('the entries are the track candidates the scenarios check, laid out as MenuTables', () => {
    assert.equal(byName('materiaSlotColumn').address, CANDIDATES.column);
    assert.equal(byName('materiaSlotRow').address, CANDIDATES.row);
    assert.equal(byName('materiaListRow').address, CANDIDATES.listRow);
    assert.equal(byName('materiaListOffset').address, CANDIDATES.listOffset);
    assert.equal(byName('materiaListRow').address - byName('materiaSlotRow').address, 2 * 0x12);
    assert.equal(byName('materiaListRow').address - byName('materiaListOffset').address, 0x0b - 0x02);
    assert.match(byName('materiaSlotColumn').scenario, /save-boot-25a-materia-slot-cursor\.json$/);
    assert.match(byName('materiaListOffset').scenario, /save-boot-25b-materia-list-cursor\.json$/);
  });
});

describe('materiaCursors reader (#244)', () => {
  test('on the Materia screen: row, column, list row and offset', async () => {
    assert.deepEqual(await setup({ row: 1, column: 1, listRow: 9, offset: 2 }).s.materiaCursors(), { value: { row: 1, column: 1, listRow: 9, listOffset: 2 }, confirmed: true });
    assert.deepEqual(await setup().s.materiaCursors(), { value: { row: 0, column: 0, listRow: 0, listOffset: 0 }, confirmed: true });
  });

  test('with the real table: every field is null unless all four entries are confirmed', async () => {
    const r = await setup({ row: 1, column: 1, listRow: 9, offset: 2, table: ADDRESS_TABLE }).s.materiaCursors();
    const all = CURSOR_NAMES.every((n) => byName(n).status === 'confirmed');
    assert.equal(r.confirmed, all);
    if (!all) assert.deepEqual(r.value, { row: null, column: null, listRow: null, listOffset: null });
  });

  test('out-of-range values read null', async () => {
    const r = await setup({ row: 2, column: 8, listRow: 10, offset: -1 }).s.materiaCursors();
    assert.deepEqual(r.value, { row: null, column: null, listRow: null, listOffset: null });
    assert.deepEqual((await setup({ row: -1, column: 7 }).s.materiaCursors()).value, { row: null, column: 7, listRow: 0, listOffset: 0 });
  });

  test('another overlay (Equip): nulls, and the overlay variables are not read', async () => {
    const { s, reads } = setup({ overlay: MENU_OVERLAY_EQUIP, column: 1 });
    const r = await s.materiaCursors();
    assert.deepEqual(r.value, { row: null, column: null, listRow: null, listOffset: null });
    assert.equal(r.reason, 'not the Materia screen');
    assert.deepEqual(reads, [[0x8009c560, 2], [0x80062dd4, 4]]);
  });

  test('not in the menu: nulls, and only gameState is read', async () => {
    const { s, reads } = setup({ state: 1 });
    const r = await s.materiaCursors();
    assert.equal(r.reason, 'not in menu');
    assert.deepEqual(reads, [[0x8009c560, 2]]);
  });

  test('a failed read reports confirmed false', async () => {
    const backend = { readMem: () => { throw new Error('gone'); } };
    const r = await createSemantic({ backend, exeSha1: EXE_USA_SHA1, table: ADDRESS_TABLE }).materiaCursors();
    assert.equal(r.confirmed, false);
  });
});
