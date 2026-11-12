// Unit: the nearby() reader and semantic/nearby.js (#112). Synthetic memory only.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ADDRESS_TABLE, EXE_USA_SHA1, FIELD_GATEWAYS, makeTable, validateTable } from '../../../semantic/addresses.js';
import { createSemantic } from '../../../semantic/layer.js';
import { GATEWAY_UNUSED, directionTo, fieldUnits, lineDistanceSq, nearbyFrom, talkCheck, turnDifference } from '../../../semantic/nearby.js';

const RAM = (a) => a & 0x1fffff;
const GAME_STATE = 0x8009c560;
const LOADING = 0x800965e8;
const PLAYER_MODEL = 0x800965e0;
const MODEL_COUNT = 0x8009abf4 + 0x28;
const ENTITY = (i) => 0x80074ea4 + i * 0x84;
const TRIGGERS_PTR = 0x800716c4;
const TRIGGERS = 0x80118000; // somewhere in the field file area
const NAMES = ['fieldModelCount', 'fieldZ', 'fieldDir', 'fieldSolidRange', 'fieldTalkOff', 'fieldTalkRange', 'fieldTriggers'];

/** The shipped table with #112's entries confirmed (synthetic scenario names). */
const CONFIRMED = makeTable(EXE_USA_SHA1, ADDRESS_TABLE.entries.map((e) => {
  const { exe, ...rest } = e;
  return NAMES.includes(e.name) ? { ...rest, status: 'confirmed', scenario: 'synthetic' } : rest;
}));

/**
 * A settled field. models: [{ x, y, z, dir, solid, talkOff, talkRange }] in
 * field units (stored << 12); gateways: [{ x1, y1, z1, x2, y2, z2, to }];
 * unused gateway slots are 0x7FFF.
 */
function setup({ state = 1, loading = 2, player = 0, count, models, gateways = [], ptr = TRIGGERS, table = CONFIRMED }) {
  const bytes = new Uint8Array(0x200000);
  const v = new DataView(bytes.buffer);
  v.setInt16(RAM(GAME_STATE), state, true);
  v.setInt16(RAM(LOADING), loading, true);
  v.setInt16(RAM(PLAYER_MODEL), player, true);
  v.setInt16(RAM(MODEL_COUNT), count ?? models.length, true);
  models.forEach((m, i) => {
    const b = RAM(ENTITY(i));
    v.setInt32(b + 0x0c, m.x * 4096, true);
    v.setInt32(b + 0x10, m.y * 4096, true);
    v.setInt32(b + 0x14, (m.z ?? 0) * 4096, true);
    bytes[b + 0x38] = m.dir ?? 0;
    v.setUint16(b + 0x6c, m.solid ?? 0, true);
    bytes[b + 0x5b] = m.talkOff ? 1 : 0;
    v.setUint16(b + 0x6e, m.talkRange ?? 0, true);
  });
  v.setUint32(RAM(TRIGGERS_PTR), ptr, true);
  for (let i = 0; i < FIELD_GATEWAYS.count; i++) {
    const g = gateways[i];
    const b = RAM(TRIGGERS) + FIELD_GATEWAYS.offset + i * FIELD_GATEWAYS.size;
    if (!g) {
      v.setUint16(b + FIELD_GATEWAYS.to, GATEWAY_UNUSED, true);
      continue;
    }
    [g.x1, g.y1, g.z1 ?? 0, g.x2, g.y2, g.z2 ?? 0].forEach((n, k) => v.setInt16(b + 2 * k, n, true));
    v.setUint16(b + FIELD_GATEWAYS.to, g.to, true);
  }
  const reads = [];
  const backend = { readMem: (a, l) => { reads.push([a, l]); return bytes.subarray(RAM(a), RAM(a) + l); } };
  return { s: createSemantic({ backend, exeSha1: EXE_USA_SHA1, table }), reads };
}

// Player at the origin facing +y (Dir 128: the angle of +y is 64, plus 64).
const PLAYER = { x: 0, y: 0, dir: 128, solid: 30 };

describe('nearby.js rules', () => {
  test('directionTo: the angle from +x towards +y, plus 64, in 1/256 turns', () => {
    assert.equal(directionTo(0, 0, 10, 0), 64);
    assert.equal(directionTo(0, 0, 0, 10), 128);
    assert.equal(directionTo(0, 0, -10, 0), 192);
    assert.equal(directionTo(0, 0, 0, -10), 0);
    assert.equal(directionTo(0, 0, 10, 10), 96);
  });

  test('turnDifference folds to 0..128', () => {
    assert.equal(turnDifference(10, 250), 16);
    assert.equal(turnDifference(250, 10), 16);
    assert.equal(turnDifference(0, 128), 128);
    assert.equal(turnDifference(64, 64), 0);
  });

  test('fieldUnits is an arithmetic shift by 12', () => {
    assert.equal(fieldUnits(5 * 4096 + 4095), 5);
    assert.equal(fieldUnits(-1), -1);
    assert.equal(fieldUnits(-4096), -1);
  });

  test('talkCheck: distance < talkRange + player solidRange, height, facing', () => {
    const p = { x: 0, y: 0, z: 0, dir: 128, solidRange: 30 };
    const npc = (o) => ({ x: 0, y: 50, z: 0, talkOff: false, talkRange: 40, ...o });
    assert.deepEqual(talkCheck(p, npc()), { inRange: true, near: true, facing: true, distance: 50 });
    // Exactly at the limit is out (the game's "distance >= range" leaves it out).
    assert.equal(talkCheck(p, npc({ y: 70 })).inRange, false);
    assert.equal(talkCheck(p, npc({ y: 69 })).inRange, true);
    // Behind the player: near, not faced.
    assert.deepEqual(talkCheck(p, npc({ y: -50 })), { inRange: false, near: true, facing: false, distance: 50 });
    // 45 degrees off (32/256) is faced; 90 degrees (64/256) is not.
    assert.equal(talkCheck(p, npc({ x: 30, y: 30 })).facing, true);
    assert.equal(talkCheck(p, npc({ x: 50, y: 0 })).facing, false);
    // Height difference of 256 or more.
    assert.equal(talkCheck(p, npc({ z: 256 })).near, false);
    assert.equal(talkCheck(p, npc({ z: -255 })).near, true);
    // TalkOff, or the very same spot.
    assert.equal(talkCheck(p, npc({ talkOff: true })).inRange, false);
    assert.equal(talkCheck(p, npc({ y: 0 })).inRange, false);
  });

  test('lineDistanceSq: within the segment only', () => {
    const g = { x1: -10, y1: 100, z1: 0, x2: 10, y2: 100, z2: 0 };
    assert.equal(lineDistanceSq(g, { x: 0, y: 80, z: 0 }), 400);
    assert.equal(lineDistanceSq(g, { x: 30, y: 80, z: 0 }), null);
    assert.equal(lineDistanceSq({ ...g, x2: -10 }, { x: 0, y: 0, z: 0 }), null); // zero length
  });

  test('nearbyFrom: npcs, other models and exits, nearest first, without the player', () => {
    const list = nearbyFrom({
      player: { x: 0, y: 0, z: 0, dir: 128, solidRange: 30, model: 1 },
      models: [
        { x: 0, y: 200, z: 0, talkOff: false, talkRange: 40 },
        { x: 0, y: 0, z: 0, talkOff: false, talkRange: 40 },
        { x: 20, y: 0, z: 0, talkOff: true, talkRange: 40 },
      ],
      gateways: [{ x1: -50, y1: 25, z1: 0, x2: 50, y2: 25, z2: 0, to: 0x75 }, { x1: 0, y1: 0, z1: 0, x2: 1, y2: 1, z2: 0, to: GATEWAY_UNUSED }],
    });
    assert.deepEqual(list, [
      { kind: 'unknown', model: 2, dx: 20, dy: 0, distance: 20, inRange: false },
      { kind: 'exit', gateway: 0, to: 0x75, dx: 0, dy: 25, distance: 25, inRange: true },
      { kind: 'npc', model: 0, dx: 0, dy: 200, distance: 200, inRange: false, near: false, facing: true },
    ]);
  });
});

describe('nearby reader', () => {
  test('the shipped table validates; #112 entries are at the decomp addresses', () => {
    validateTable(ADDRESS_TABLE);
    const byName = Object.fromEntries(ADDRESS_TABLE.entries.map((e) => [e.name, e]));
    assert.equal(byName.fieldModelCount.address, 0x8009ac1c);
    assert.equal(byName.fieldZ.address, 0x80074eb8);
    assert.equal(byName.fieldDir.address, 0x80074edc);
    assert.equal(byName.fieldTalkOff.address, 0x80074eff);
    assert.equal(byName.fieldSolidRange.address, 0x80074f10);
    assert.equal(byName.fieldTalkRange.address, 0x80074f12);
    assert.equal(byName.fieldTriggers.address, 0x800716c4);
    // Confirmed by #112 attempt 1; the talk entries stay hypotheses (notes/112-field-interactables.md).
    for (const n of ['fieldModelCount', 'fieldDir', 'fieldSolidRange', 'fieldTriggers']) assert.equal(byName[n].status, 'confirmed', n);
    for (const n of ['fieldZ', 'fieldTalkOff', 'fieldTalkRange']) assert.equal(byName[n].status, 'hypothesis', n);
  });

  test('an NPC in range and faced, an NPC out of range, and an exit', async () => {
    const { s } = setup({
      models: [
        PLAYER,
        { x: 0, y: 40, talkRange: 20 },
        { x: -300, y: 0, talkRange: 20 },
      ],
      gateways: [undefined, { x1: -100, y1: 500, x2: 100, y2: 500, to: 0x75 }],
    });
    const r = await s.nearby();
    assert.equal(r.confirmed, true);
    assert.deepEqual(r.value, [
      { kind: 'npc', model: 1, dx: 0, dy: 40, distance: 40, inRange: true, near: true, facing: true },
      { kind: 'npc', model: 2, dx: -300, dy: 0, distance: 300, inRange: false, near: false, facing: false },
      { kind: 'exit', gateway: 1, to: 0x75, dx: 0, dy: 500, distance: 500, inRange: false },
    ]);
  });

  test('walking up to an NPC and away: inRange goes false, true, false', async () => {
    const at = async (y) => (await setup({ models: [{ ...PLAYER, y }, { x: 0, y: 100, talkRange: 20 }] }).s.nearby()).value[0].inRange;
    assert.deepEqual([await at(0), await at(60), await at(0)], [false, true, false]);
  });

  test('the player is the model g_PlayerModelId names', async () => {
    const { s } = setup({ player: 1, models: [{ x: 0, y: 40, talkRange: 20 }, PLAYER] });
    const r = await s.nearby();
    assert.deepEqual(r.value.map((e) => e.model), [0]);
    assert.equal(r.value[0].inRange, true);
  });

  test('no other models and no gateways: an empty list', async () => {
    const r = await setup({ models: [PLAYER] }).s.nearby();
    assert.deepEqual(r.value, []);
    assert.equal(r.confirmed, true);
  });

  test('with the shipped table it reads, but is not confirmed', async () => {
    const r = await setup({ models: [PLAYER, { x: 0, y: 40, talkRange: 20 }], table: ADDRESS_TABLE }).s.nearby();
    assert.equal(r.value.length, 1);
    assert.equal(r.confirmed, false);
  });

  test('outside a settled field: [] and reason "not in field", reading only the mode', async () => {
    for (const o of [{ state: 2 }, { state: 5 }, { loading: 1 }]) {
      const { s, reads } = setup({ models: [PLAYER], ...o });
      const r = await s.nearby();
      assert.deepEqual(r.value, []);
      assert.equal(r.reason, 'not in field');
      assert.equal(reads.length, 2);
    }
  });

  test('a model count or player index out of range, or a bad triggers pointer: out of range', async () => {
    for (const o of [{ count: 0 }, { count: 17 }, { player: 3 }, { ptr: 0 }, { ptr: 0x801fff00 }]) {
      const r = await setup({ models: [PLAYER, { x: 0, y: 40 }], ...o }).s.nearby();
      assert.equal(r.value, null, JSON.stringify(o));
      assert.equal(r.reason, 'out of range');
    }
  });

  test('the model arrays are read in one readMem', async () => {
    const { s, reads } = setup({ models: [PLAYER, { x: 0, y: 40 }, { x: 0, y: 80 }] });
    await s.nearby();
    const big = reads.filter(([, l]) => l > 4);
    // One for the three models' fields (+0x0C .. +0x6F of each), one for the 12 gateways.
    assert.deepEqual(big, [[0x80074ea4 + 0x0c, 2 * 0x84 + 0x70 - 0x0c], [TRIGGERS + 0x38, 12 * 0x18]]);
  });

  test('gate off: inactive, nothing read', async () => {
    const bytes = new Uint8Array(0x200000);
    const reads = [];
    const s = createSemantic({ backend: { readMem: (a, l) => { reads.push(a); return bytes.subarray(0, l); } }, exeSha1: '0'.repeat(40) });
    const r = await s.nearby();
    assert.equal(r.reason, 'inactive');
    assert.equal(reads.length, 0);
  });
});
