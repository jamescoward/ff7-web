// Unit: the partyPick() reader and equipChosenSlot (#215). Synthetic memory only.
// Original project code, GPL-2.0-or-later.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ADDRESS_TABLE, EXE_USA_SHA1 } from '../../../semantic/addresses.js';
import { equipChosenSlot, equipMemberSlot } from '../../../semantic/equip-screen.js';
import { createSemantic } from '../../../semantic/layer.js';

const GAME_STATE = 0x9c560;
const PICK = 0x9a0e5;

function setup({ state = 5, pick = 0 } = {}) {
  const bytes = new Uint8Array(0x200000);
  const view = new DataView(bytes.buffer);
  view.setInt16(GAME_STATE, state, true);
  view.setInt8(PICK, pick);
  const reads = [];
  const backend = { readMem: (a, l) => { reads.push([a, l]); return bytes.subarray(a & 0x1fffff, (a & 0x1fffff) + l); } };
  return { s: createSemantic({ backend, exeSha1: EXE_USA_SHA1, table: ADDRESS_TABLE }), reads };
}

describe('partyPick reader', () => {
  test('the shipped entry is table 1 row of g_PartyMenuTables, confirmed by save-boot-16', () => {
    const e = ADDRESS_TABLE.entries.find((x) => x.name === 'partyPick');
    assert.equal(e.address, 0x8009a0e5);
    assert.equal(e.type, 's8');
    assert.equal(e.status, 'confirmed');
    assert.match(e.scenario, /save-boot-16c-party-pick-slot1\.json$/);
    const cursor = ADDRESS_TABLE.entries.find((x) => x.name === 'menuCursor');
    assert.equal(e.address - cursor.address, 0x12, 'the next MenuTable');
  });

  test('menu mode: the slot 0, 1 or 2', async () => {
    for (const pick of [0, 1, 2]) {
      assert.deepEqual(await setup({ pick }).s.partyPick(), { value: pick, confirmed: true }, `pick ${pick}`);
    }
  });

  test('out of range reads null', async () => {
    for (const pick of [3, -1, 127]) {
      assert.deepEqual(await setup({ pick }).s.partyPick(), { value: null, confirmed: true }, `pick ${pick}`);
    }
  });

  test('not in the menu: null, and only gameState is read', async () => {
    const { s, reads } = setup({ state: 1, pick: 2 });
    const r = await s.partyPick();
    assert.equal(r.value, null);
    assert.equal(r.reason, 'not in menu');
    assert.deepEqual(reads, [[0x8009c560, 2]]);
  });

  test('a failed read reports value null', async () => {
    const backend = { readMem: () => { throw new Error('gone'); } };
    const s = createSemantic({ backend, exeSha1: EXE_USA_SHA1, table: ADDRESS_TABLE });
    const r = await s.partyPick();
    assert.equal(r.value, null);
    assert.equal(r.confirmed, false);
  });
});

const EQ = (record) => ({ record, weapon: 0, armor: 0, accessory: null, weaponMateria: [], armorMateria: [] });

describe('equipChosenSlot', () => {
  test('the pick names an occupied slot in a larger party', () => {
    const three = [EQ(0), EQ(1), EQ(2)];
    for (const pick of [0, 1, 2]) assert.equal(equipChosenSlot(three, pick), pick);
    assert.equal(equipChosenSlot([EQ(0), EQ(1), null], 1), 1);
  });

  test('a pick on an empty slot, or no pick, falls back to the one-member rule', () => {
    assert.equal(equipChosenSlot([EQ(0), EQ(1), null], 2), null);
    assert.equal(equipChosenSlot([EQ(0), EQ(1), null], null), null);
    assert.equal(equipChosenSlot([EQ(0), null, null], null), 0);
    assert.equal(equipChosenSlot([EQ(0), null, null], 2), 0);
    assert.equal(equipChosenSlot(undefined, 1), null);
  });

  test('the tap rule is unchanged: a larger party still names no member for a tap', () => {
    assert.equal(equipMemberSlot([EQ(0), EQ(1), EQ(2)]), null);
  });
});
