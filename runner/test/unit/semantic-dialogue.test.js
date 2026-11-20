// Unit: the dialogue() reader (#108). Synthetic memory only.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ADDRESS_TABLE, DIALOG_STATE_ENTRIES, EXE_USA_SHA1, makeTable, validateTable } from '../../../semantic/addresses.js';
import { dialogueTapButton } from '../../../semantic/controls.js';
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
    const { s, reads } = setup({ state: 6, pointer: 1, pointerY: 22 });
    assert.deepEqual(await s.dialogue(), { value: { open: true, waiting: true, choice: null }, confirmed: true });
    assert.deepEqual(reads, [[0x800832a0, 2]], 'hypothesis pointer entries are not read');
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

// #224: windows 1-3. Window 1's state is g_WindowData[1].state, one 0x30
// record after window 0's.
const STATE1 = STATE + 0x30;
const withStatus = (statuses) => makeTable(EXE_USA_SHA1, ADDRESS_TABLE.entries.map((e) => {
  const { exe, ...rest } = e;
  if (!(e.name in statuses)) return rest;
  if (statuses[e.name] === 'hypothesis') { const { scenario, confirmedValues, ...h } = rest; return { ...h, status: 'hypothesis' }; }
  return { ...rest, status: 'confirmed', scenario: 'synthetic', confirmedValues: { 0: 'synthetic', 6: 'synthetic' } };
}));
const WINDOW1_CONFIRMED = withStatus({ dialogState1: 'confirmed', dialogState2: 'hypothesis', dialogState3: 'hypothesis' });
const WINDOW1_HYPOTHESIS = withStatus({ dialogState1: 'hypothesis', dialogState2: 'hypothesis', dialogState3: 'hypothesis' });

function setupWindows({ state0 = 0, state1 = 0, state2 = 0, table }) {
  const bytes = new Uint8Array(0x200000);
  const view = new DataView(bytes.buffer);
  view.setInt16(STATE, state0, true);
  view.setInt16(STATE1, state1, true);
  view.setInt16(STATE1 + 0x30, state2, true);
  const reads = [];
  const backend = { readMem: (a, l) => { reads.push([a, l]); return bytes.subarray(a & 0x1fffff, (a & 0x1fffff) + l); } };
  return { s: createSemantic({ backend, exeSha1: EXE_USA_SHA1, table }), reads };
}

describe('dialogue reader, windows 1-3 (#224)', () => {
  test('the window state entries are one 0x30 record apart, in DIALOG_STATE_ENTRIES order', () => {
    const byName = Object.fromEntries(ADDRESS_TABLE.entries.map((e) => [e.name, e]));
    assert.deepEqual(DIALOG_STATE_ENTRIES, ['dialogState', 'dialogState1', 'dialogState2', 'dialogState3']);
    DIALOG_STATE_ENTRIES.forEach((n, i) => assert.equal(byName[n].address, 0x800832a0 + i * 0x30, n));
  });

  test('window 1 waiting with window 0 closed: waiting, and window 1 is read', async () => {
    const { s, reads } = setupWindows({ state1: 6, table: WINDOW1_CONFIRMED });
    assert.deepEqual(await s.dialogue(), { value: { open: true, waiting: true, choice: null }, confirmed: true });
    assert.deepEqual(reads, [[0x800832a0, 2], [0x800832d0, 2]]);
  });

  test('window 1 typing: open, not waiting, not confirmed (only 0 and 6 are)', async () => {
    const r = await setupWindows({ state1: 2, table: WINDOW1_CONFIRMED }).s.dialogue();
    assert.deepEqual(r.value, { open: true, waiting: false, choice: null });
    assert.equal(r.confirmed, false);
  });

  test('both closed: not open, confirmed', async () => {
    assert.deepEqual(await setupWindows({ table: WINDOW1_CONFIRMED }).s.dialogue(), { value: { open: false, waiting: false, choice: null }, confirmed: true });
  });

  test('window 0 typing while window 1 waits: waiting (a tap advances window 1)', async () => {
    assert.equal((await setupWindows({ state0: 2, state1: 6, table: WINDOW1_CONFIRMED }).s.dialogue()).value.waiting, true);
  });

  test('a hypothesis window entry is not read: window 1 waiting is invisible then', async () => {
    const { s, reads } = setupWindows({ state1: 6, table: WINDOW1_HYPOTHESIS });
    assert.deepEqual((await s.dialogue()).value, { open: false, waiting: false, choice: null });
    assert.deepEqual(reads, [[0x800832a0, 2]]);
  });

  test('window 2 stays unread while it is a hypothesis, even with window 1 confirmed', async () => {
    const { s, reads } = setupWindows({ state2: 6, table: WINDOW1_CONFIRMED });
    assert.equal((await s.dialogue()).value.open, false);
    assert.ok(!reads.some(([a]) => a === 0x80083300));
  });

  test('a waiting window 1 gives the dialogue tap its Circle', async () => {
    assert.equal(dialogueTapButton(await setupWindows({ state1: 6, table: WINDOW1_CONFIRMED }).s.dialogue()), 'circle');
  });
});
