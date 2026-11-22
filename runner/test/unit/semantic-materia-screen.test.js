// Unit: materia list rows map to inventory slots in slot order, gaps kept (#246). Plain data only.
// Original project code, GPL-2.0-or-later.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { MATERIA_PAGE_ROWS, materiaListSlot, materiaPageRows } from '../../../semantic/materia-screen.js';
import { GAP_DOWNS, EMPTY_DOWNS, MATERIA } from './materia-gap-scenarios.js';
import { LIST_DOWNS, LIST_PAGE } from './materia-cursor-scenarios.js';

describe('materia list slots (#246)', () => {
  test('the page size is the one #244 measured', () => {
    assert.equal(MATERIA_PAGE_ROWS, LIST_PAGE);
  });

  test('26a and 25b: the slot under the cursor is offset + row', () => {
    assert.equal(materiaListSlot(GAP_DOWNS, 0), 3);
    assert.equal(materiaListSlot(LIST_PAGE - 1, LIST_DOWNS - (LIST_PAGE - 1)), 11);
  });

  test('unconfirmed or off-page cursors give null', () => {
    for (const [r, o] of [[null, 0], [0, null], [-1, 0], [0, -1], [MATERIA_PAGE_ROWS, 0], [1.5, 0]]) assert.equal(materiaListSlot(r, o), null);
  });

  test("the gap save's page keeps empty slots in place", () => {
    const rows = materiaPageRows(0, MATERIA);
    assert.equal(rows.length, MATERIA_PAGE_ROWS);
    assert.deepEqual(rows.filter((r) => r.materia).map((r) => r.slot), [0, 3, 5]);
    assert.equal(rows[GAP_DOWNS].materia.ap, 3);
    assert.equal(rows[EMPTY_DOWNS].materia, null);
    assert.deepEqual(materiaPageRows(2, MATERIA).map((r) => r.slot), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    assert.deepEqual(materiaPageRows(null, MATERIA), []);
  });
});
