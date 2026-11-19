// Unit: the equipScreen() reader and semantic/equip-screen.js (#121 part 2).
// Synthetic memory only.
// Original project code, GPL-2.0-or-later.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ADDRESS_TABLE, EXE_USA_SHA1, MENU_OVERLAY_EQUIP, MENU_OVERLAY_ITEM } from '../../../semantic/addresses.js';
import { EQUIP_SCREEN_ACTIONS } from '../../../semantic/controls.js';
import {
  EQUIP_FIRST_WEAPON_PRESSES, EQUIP_SETTLE_FRAMES, EQUIP_STEP_FRAMES, equipMemberLabel, equipMemberSlot,
  equipOutcome, equipTapAllowed, spareWeaponLabel, spareWeapons,
} from '../../../semantic/equip-screen.js';
import { createSemantic } from '../../../semantic/layer.js';

const GAME_STATE = 0x9c560;
const OVERLAY = 0x62dd4;

function setup({ state = 5, overlay = MENU_OVERLAY_EQUIP } = {}) {
  const bytes = new Uint8Array(0x200000);
  const view = new DataView(bytes.buffer);
  view.setInt16(GAME_STATE, state, true);
  view.setUint32(OVERLAY, overlay, true);
  const reads = [];
  const backend = { readMem: (a, l) => { reads.push([a, l]); return bytes.subarray(a & 0x1fffff, (a & 0x1fffff) + l); } };
  return { s: createSemantic({ backend, exeSha1: EXE_USA_SHA1, table: ADDRESS_TABLE }), reads };
}

describe('equipScreen reader', () => {
  test('the Equip overlay id is 4 and confirmed in the shipped table', () => {
    assert.equal(MENU_OVERLAY_EQUIP, 4);
    const e = ADDRESS_TABLE.entries.find((x) => x.name === 'menuOverlay');
    assert.equal(e.status, 'confirmed');
    assert.ok(e.confirmedValues[4]);
  });

  test('menu mode with overlay 4: open', async () => {
    assert.deepEqual(await setup().s.equipScreen(), { value: { open: true }, confirmed: true });
  });

  test('menu mode with the Item overlay or the main menu: closed, confirmed', async () => {
    for (const overlay of [MENU_OVERLAY_ITEM, 0]) {
      assert.deepEqual(await setup({ overlay }).s.equipScreen(), { value: { open: false }, confirmed: true }, `overlay ${overlay}`);
    }
  });

  test('an unconfirmed overlay value: closed, unconfirmed', async () => {
    assert.deepEqual(await setup({ overlay: 3 }).s.equipScreen(), { value: { open: false }, confirmed: false });
  });

  test('not in the menu: closed, and only gameState is read', async () => {
    const { s, reads } = setup({ state: 1 });
    const r = await s.equipScreen();
    assert.deepEqual(r.value, { open: false });
    assert.equal(r.reason, 'not in menu');
    assert.deepEqual(reads, [[0x8009c560, 2]]);
  });

  test('a failed read reports value null', async () => {
    const backend = { readMem: () => { throw new Error('gone'); } };
    const s = createSemantic({ backend, exeSha1: EXE_USA_SHA1, table: ADDRESS_TABLE });
    const r = await s.equipScreen();
    assert.equal(r.value, null);
    assert.equal(r.confirmed, false);
  });
});

const EQ = (weapon) => ({ record: 0, weapon, armor: 0, accessory: null, weaponMateria: [], armorMateria: [] });
const OPEN = { open: true, framesOpen: EQUIP_SETTLE_FRAMES, pristine: true, memberSlot: 0, weapons: [{ slot: 0, number: 1, quantity: 1 }, { slot: 1, number: 2, quantity: 1 }] };

describe('equip-screen facts', () => {
  test('the presses are 15c\'s: Circle, 60 frames, Circle', () => {
    assert.equal(EQUIP_STEP_FRAMES, 60);
    assert.equal(EQUIP_SETTLE_FRAMES, 120);
    assert.deepEqual(EQUIP_FIRST_WEAPON_PRESSES.map((p) => [p.at, EQUIP_SCREEN_ACTIONS[p.action].button]), [[0, 'circle'], [60, 'circle']]);
    assert.equal(EQUIP_SCREEN_ACTIONS.back.button, 'cross');
  });

  test('spareWeapons keeps weapons only, in slot order', () => {
    const inv = [
      { slot: 4, index: 131, quantity: 2, kind: 'weapon', number: 3 },
      { slot: 0, index: 0, quantity: 5, kind: 'item', number: 0 },
      { slot: 1, index: 129, quantity: 1, kind: 'weapon', number: 1 },
      { slot: 2, index: 257, quantity: 1, kind: 'armor', number: 1 },
    ];
    assert.deepEqual(spareWeapons(inv), [{ slot: 1, number: 1, quantity: 1 }, { slot: 4, number: 3, quantity: 2 }]);
    assert.deepEqual(spareWeapons(null), []);
  });

  test('equipMemberSlot: only a one-member party names the member', () => {
    assert.equal(equipMemberSlot([EQ(0), null, null]), 0);
    assert.equal(equipMemberSlot([null, EQ(0), null]), 1);
    assert.equal(equipMemberSlot([EQ(0), EQ(1), null]), null);
    assert.equal(equipMemberSlot([null, null, null]), null);
    assert.equal(equipMemberSlot(undefined), null);
  });

  test('equipTapAllowed: only the first weapon, a known member, settled and pristine', () => {
    assert.deepEqual(equipTapAllowed(OPEN, 0), { ok: true, reason: null });
    assert.equal(equipTapAllowed(OPEN, 1).reason, 'list order not read');
    assert.equal(equipTapAllowed(OPEN, 2).reason, 'no weapon');
    assert.equal(equipTapAllowed({ ...OPEN, open: false }, 0).reason, 'closed');
    assert.equal(equipTapAllowed({ ...OPEN, memberSlot: null }, 0).reason, 'party pick not read');
    assert.equal(equipTapAllowed({ ...OPEN, pristine: false }, 0).reason, 'not the opening state');
    assert.equal(equipTapAllowed({ ...OPEN, framesOpen: EQUIP_SETTLE_FRAMES - 1 }, 0).reason, 'settling');
    assert.equal(equipTapAllowed({ ...OPEN, framesOpen: null }, 0).reason, 'settling');
    assert.equal(equipTapAllowed({ ...OPEN, weapons: [] }, 0).reason, 'no weapon');
  });

  test('equipOutcome', () => {
    assert.equal(equipOutcome(0, 1, 1), 'equipped');
    assert.equal(equipOutcome(0, 2, 1), 'other');
    assert.equal(equipOutcome(0, 0, 1), 'none');
    assert.equal(equipOutcome(null, 1, 1), 'none');
    assert.equal(equipOutcome(0, null, 1), 'none');
  });

  test('labels are IDs only', () => {
    assert.equal(equipMemberLabel(0, EQ(3)), 'Slot 1  Wpn #3  Arm #0  Acc none');
    assert.equal(equipMemberLabel(1, { ...EQ(0), accessory: 2 }), 'Slot 2  Wpn #0  Arm #0  Acc #2');
    assert.equal(equipMemberLabel(2, null), 'Slot 3: —');
    assert.equal(spareWeaponLabel({ slot: 0, number: 1, quantity: 2 }), 'weapon #1 ×2');
    assert.equal(spareWeaponLabel(null), '—');
  });
});
