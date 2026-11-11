// Unit: the battleInput() reader (#110). Synthetic memory only.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ADDRESS_TABLE, EXE_USA_SHA1, makeTable, validateTable } from '../../../semantic/addresses.js';
import { createSemantic } from '../../../semantic/layer.js';

const GAME_STATE = 0x9c560;
const WIDGET = 0xf3896; // g_BattleMenuModalWidgetId
const ACTOR = 0xf38a0; // g_BattleMenuPartySlot
const ROW = (slot) => 0xf90b4 + slot * 0x240 + 0x0b; // D_800F90B4[slot].table00.row
const TARGET = 0xf38a9;
const NAMES = ['battleMenuWidget', 'battleActor', 'battleCommandRow', 'battleTarget'];

/** The shipped table with the battle menu entries confirmed (values -1, 0, 1), as #110 will once Tier 2 shows them. */
const CONFIRMED = makeTable(EXE_USA_SHA1, ADDRESS_TABLE.entries.map((e) => {
  const { exe, ...rest } = e;
  if (!NAMES.includes(e.name)) return rest;
  const out = { ...rest, status: 'confirmed', scenario: 'synthetic' };
  if (e.name === 'battleMenuWidget') out.confirmedValues = { '-1': 'synthetic', 0: 'synthetic', 1: 'synthetic' };
  return out;
}));

function setup({ state = 2, widget = 1, actor = 0, rows = [0, 0, 0], target = 4, table = CONFIRMED }) {
  const bytes = new Uint8Array(0x200000);
  const view = new DataView(bytes.buffer);
  view.setInt16(GAME_STATE, state, true);
  view.setInt16(WIDGET, widget, true);
  bytes[ACTOR] = actor;
  rows.forEach((r, i) => { bytes[ROW(i)] = r; });
  bytes[TARGET] = target;
  const reads = [];
  const backend = { readMem: (a, l) => { reads.push([a, l]); return bytes.subarray(a & 0x1fffff, (a & 0x1fffff) + l); } };
  return { s: createSemantic({ backend, exeSha1: EXE_USA_SHA1, table }), reads };
}

describe('battleInput reader', () => {
  test('the shipped table validates and has the four battle menu entries at the decomp addresses', () => {
    validateTable(ADDRESS_TABLE);
    const byName = Object.fromEntries(ADDRESS_TABLE.entries.map((e) => [e.name, e]));
    assert.equal(byName.battleMenuWidget.address, 0x800f3896);
    assert.equal(byName.battleMenuWidget.type, 's16');
    assert.equal(byName.battleActor.address, 0x800f38a0);
    assert.equal(byName.battleCommandRow.address, 0x800f90bf);
    assert.equal(byName.battleCommandRow.stride, 0x240);
    assert.equal(byName.battleCommandRow.count, 3);
    assert.equal(byName.battleTarget.address, 0x800f38a9);
  });

  test('outside battle: everything null, reason "not in battle", and only gameState is read', async () => {
    const { s, reads } = setup({ state: 1 });
    const r = await s.battleInput();
    assert.deepEqual(r.value, { actor: null, row: null, targeting: null });
    assert.equal(r.reason, 'not in battle');
    assert.deepEqual(reads, [[0x8009c560, 2]]);
  });

  test('no menu open (widget -1): actor null, confirmed', async () => {
    const r = await setup({ widget: -1, actor: 1 }).s.battleInput();
    assert.deepEqual(r.value, { actor: null, row: null, targeting: null });
    assert.equal(r.confirmed, true);
  });

  test('command menu: actor and that slot\'s row', async () => {
    const r = await setup({ widget: 1, actor: 2, rows: [0, 3, 1] }).s.battleInput();
    assert.deepEqual(r.value, { actor: 2, row: 1, targeting: null });
    assert.equal(r.confirmed, true);
  });

  test('target selection: targeting.index is the target byte', async () => {
    const r = await setup({ widget: 0, actor: 0, rows: [0, 0, 0], target: 5 }).s.battleInput();
    assert.deepEqual(r.value, { actor: 0, row: 0, targeting: { index: 5 } });
  });

  test('an unlabelled widget value (a sub-menu) is not confirmed and reports nothing', async () => {
    const r = await setup({ widget: 3, actor: 0 }).s.battleInput();
    assert.deepEqual(r.value, { actor: null, row: null, targeting: null });
    assert.equal(r.confirmed, false);
  });

  test('an actor byte outside 0-2 gives actor and row null', async () => {
    const r = await setup({ widget: 1, actor: 7 }).s.battleInput();
    assert.deepEqual(r.value, { actor: null, row: null, targeting: null });
  });

  test('with the shipped table, a hypothesis entry is never reported', async () => {
    const shipped = ADDRESS_TABLE.entries.filter((e) => NAMES.includes(e.name));
    const { s } = setup({ widget: 0, actor: 0, target: 5, table: ADDRESS_TABLE });
    const r = await s.battleInput();
    for (const e of shipped) {
      if (e.status === 'confirmed') continue;
      if (e.name === 'battleMenuWidget') assert.deepEqual(r.value, { actor: null, row: null, targeting: null });
      if (e.name === 'battleActor') assert.equal(r.value.actor, null);
      if (e.name === 'battleCommandRow') assert.equal(r.value.row, null);
      if (e.name === 'battleTarget') assert.equal(r.value.targeting, null);
    }
  });

  test('inactive gate: value null with reason inactive', async () => {
    const backend = { readMem: () => new Uint8Array(2) };
    const r = await createSemantic({ backend, exeSha1: 'not-usa', table: CONFIRMED }).battleInput();
    assert.equal(r.value, null);
    assert.equal(r.reason, 'inactive');
  });
});
