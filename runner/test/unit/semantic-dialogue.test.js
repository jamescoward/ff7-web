// Unit: the dialogue() reader (#108). Synthetic memory only.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ADDRESS_TABLE, EXE_USA_SHA1, makeTable, validateTable } from '../../../semantic/addresses.js';
import { createSemantic } from '../../../semantic/layer.js';

const STATE = 0x832a0; // g_WindowData[0].state, 0x80083274 + 0x2C
const POINTER = 0x8328e; // + 0x1A pointerEnabled
const POINTER_Y = 0x8329a; // + 0x26 pointerY

/** The shipped table with the pointer entries marked confirmed, as #168 will. */
const POINTER_CONFIRMED = makeTable(EXE_USA_SHA1, ADDRESS_TABLE.entries.map((e) => {
  const { exe, ...rest } = e;
  return e.name === 'dialogPointer' || e.name === 'dialogPointerY' ? { ...rest, status: 'confirmed', scenario: 'synthetic' } : rest;
}));

function setup({ state, pointer = 0, pointerY = 0, table = ADDRESS_TABLE }) {
  const bytes = new Uint8Array(0x200000);
  const view = new DataView(bytes.buffer);
  view.setInt16(STATE, state, true);
  bytes[POINTER] = pointer;
  view.setInt16(POINTER_Y, pointerY, true);
  const reads = [];
  const backend = { readMem: (a, l) => { reads.push([a, l]); return bytes.subarray(a & 0x1fffff, (a & 0x1fffff) + l); } };
  return { s: createSemantic({ backend, exeSha1: EXE_USA_SHA1, table }), reads };
}

describe('dialogue reader', () => {
  test('the shipped table validates and has the three window entries', () => {
    validateTable(ADDRESS_TABLE);
    const byName = Object.fromEntries(ADDRESS_TABLE.entries.map((e) => [e.name, e]));
    assert.equal(byName.dialogState.address, 0x800832a0);
    assert.equal(byName.dialogPointer.address, 0x8008328e);
    assert.equal(byName.dialogPointerY.address, 0x8008329a);
  });

  test('closed window: not open, not waiting, no choice, and reads only the state', async () => {
    const { s, reads } = setup({ state: 0, pointer: 1, pointerY: 22 });
    const r = await s.dialogue();
    assert.deepEqual(r.value, { open: false, waiting: false, choice: null });
    assert.deepEqual(reads, [[0x800832a0, 2]]);
  });

  test('typing (2) and closing (7) are open but not waiting', async () => {
    for (const state of [1, 2, 3, 7, 8, 9]) {
      const { s } = setup({ state, pointer: 1, pointerY: 22 });
      assert.deepEqual((await s.dialogue()).value, { open: true, waiting: false, choice: null }, `state ${state}`);
    }
  });

  test('text done (6) with no pointer is a plain message waiting for Circle', async () => {
    const { s } = setup({ state: 6, pointer: 0, pointerY: 0 });
    assert.deepEqual((await s.dialogue()).value, { open: true, waiting: true, choice: null });
  });

  test('the other Circle-only states count as waiting', async () => {
    for (const state of [4, 11, 13, 14]) {
      const { s } = setup({ state });
      assert.deepEqual((await s.dialogue()).value, { open: true, waiting: true, choice: null }, `state ${state}`);
    }
  });

  test('a choice waiting in state 6 (pointer entries confirmed): row from pointerY = row * 16 + 6', async () => {
    for (const [pointerY, row] of [[6, 0], [22, 1], [38, 2], [54, 3]]) {
      const { s } = setup({ state: 6, pointer: 1, pointerY, table: POINTER_CONFIRMED });
      assert.deepEqual((await s.dialogue()).value, { open: true, waiting: true, choice: { row } });
    }
  });

  test('with the shipped table the pointer entries are hypotheses, so choice stays null (#168)', async () => {
    const byName = Object.fromEntries(ADDRESS_TABLE.entries.map((e) => [e.name, e]));
    assert.equal(byName.dialogPointer.status, 'hypothesis');
    const { s } = setup({ state: 6, pointer: 1, pointerY: 22 });
    assert.deepEqual(await s.dialogue(), { value: { open: true, waiting: true, choice: null }, confirmed: true });
  });

  test('the pointer is ignored outside state 6 (it blinks while closing)', async () => {
    const { s, reads } = setup({ state: 7, pointer: 1, pointerY: 22, table: POINTER_CONFIRMED });
    assert.deepEqual((await s.dialogue()).value, { open: true, waiting: false, choice: null });
    assert.deepEqual(reads, [[0x800832a0, 2]]);
  });

  test('confirmed: closed (0) and done (6) are confirmed values (#108); typing (2) is not', async () => {
    assert.equal((await setup({ state: 0 }).s.dialogue()).confirmed, true);
    assert.equal((await setup({ state: 6 }).s.dialogue()).confirmed, true);
    assert.equal((await setup({ state: 2 }).s.dialogue()).confirmed, false);
  });

  test('is inactive with the gate off', async () => {
    const s = createSemantic({ backend: { readMem() { throw new Error('must not read'); } }, exeSha1: null });
    assert.equal((await s.dialogue()).reason, 'inactive');
  });

  test('a failed read gives value null', async () => {
    const s = createSemantic({ backend: { readMem() { throw new Error('boom'); } }, exeSha1: EXE_USA_SHA1 });
    const r = await s.dialogue();
    assert.equal(r.value, null);
    assert.equal(r.reason, 'read failed');
  });
});
