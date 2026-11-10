// Unit: partyStatus(slot) (#130) on synthetic memory images. No core, no
// game data.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ADDRESS_TABLE, EXE_USA_SHA1, makeTable, validateTable } from '../../../semantic/addresses.js';
import { createSemantic } from '../../../semantic/layer.js';

const RAM_SIZE = 0x200000;
const HASH = 'b'.repeat(40);

function ram(writes = []) {
  const bytes = new Uint8Array(RAM_SIZE);
  const view = new DataView(bytes.buffer);
  for (const [addr, type, v] of writes) {
    const off = addr & 0x1fffffff;
    ({ u8: () => view.setUint8(off, v), s16: () => view.setInt16(off, v, true), u16: () => view.setUint16(off, v, true) })[type]();
  }
  const reads = [];
  return {
    reads,
    readMem(addr, len) {
      reads.push([addr, len]);
      const off = addr & 0x1fffffff;
      return bytes.slice(off, off + len);
    },
  };
}

/** Test table: slot s's stats at 0x80002000 + 0x40 s; every entry has the given status unless overridden. */
function table(status, overrides = {}) {
  const e = (name, address, type, extra = {}) => {
    const st = overrides[name] ?? status;
    return { name, address, type, meaning: 'synthetic', source: 'unit test', status: st, ...(st === 'confirmed' ? { scenario: 'harness/scenarios/synthetic.json' } : {}), ...extra };
  };
  const slots = [0, 1, 2];
  return makeTable(HASH, [
    e('gameState', 0x80001000, 's16', { values: { 1: 'field', 2: 'battle', 5: 'menu' } }),
    ...slots.map((i) => e(`partySlot${i}`, 0x80001030 + i, 'u8')),
    ...slots.flatMap((i) => [
      e(`partyHp${i}`, 0x80002000 + 0x40 * i, 's16'),
      e(`partyMaxHp${i}`, 0x80002002 + 0x40 * i, 's16'),
      e(`partyMp${i}`, 0x80002004 + 0x40 * i, 's16'),
      e(`partyMaxMp${i}`, 0x80002006 + 0x40 * i, 's16'),
      e(`partyLimit${i}`, 0x80003000 + 0x10 * i, 'u16'),
      e(`partyAtb${i}`, 0x80003004 + 0x10 * i, 'u16'),
    ]),
    e('characterLimit', 0x80004000, 'u8', { stride: 0x84, count: 9 }),
  ]);
}

const stats = (state, party = [0, 1, 0xff]) => ram([
  [0x80001000, 's16', state],
  ...party.map((id, i) => [0x80001030 + i, 'u8', id]),
  [0x80002000, 's16', 271], [0x80002002, 's16', 314], [0x80002004, 's16', 41], [0x80002006, 's16', 54],
  [0x80002040, 's16', 300], [0x80002042, 's16', 333], [0x80002044, 's16', 20], [0x80002046, 's16', 27],
  [0x80003000, 'u16', 120], [0x80003004, 'u16', 0xffff], [0x80003010, 'u16', 60], [0x80003014, 'u16', 0x1234],
  [0x80004000, 'u8', 100], [0x80004084, 'u8', 50],
]);

describe('partyStatus (#130)', () => {
  test('in the field: HP and MP from the slot, limit from the character record, no ATB', async () => {
    const layer = createSemantic({ backend: stats(1), exeSha1: HASH, table: table('confirmed') });
    assert.deepEqual(await layer.partyStatus(0), { value: { hp: 271, maxHp: 314, mp: 41, maxMp: 54, limit: 100, atb: null }, confirmed: true });
    assert.deepEqual(await layer.partyStatus(1), { value: { hp: 300, maxHp: 333, mp: 20, maxMp: 27, limit: 50, atb: null }, confirmed: true });
  });

  test('in battle: limit and ATB from the battle copies', async () => {
    const layer = createSemantic({ backend: stats(2), exeSha1: HASH, table: table('confirmed') });
    assert.deepEqual(await layer.partyStatus(0), { value: { hp: 271, maxHp: 314, mp: 41, maxMp: 54, limit: 120, atb: 0xffff }, confirmed: true });
    assert.deepEqual((await layer.partyStatus(1)).value, { hp: 300, maxHp: 333, mp: 20, maxMp: 27, limit: 60, atb: 0x1234 });
  });

  test('the limit record follows the character in the slot, not the slot', async () => {
    // Barret (record 1) in slot 0.
    const layer = createSemantic({ backend: stats(1, [1, 0xff, 0xff]), exeSha1: HASH, table: table('confirmed') });
    assert.equal((await layer.partyStatus(0)).value.limit, 50);
  });

  test('a character without a record of its own (9-11) has no limit outside battle', async () => {
    const layer = createSemantic({ backend: stats(1, [9, 0xff, 0xff]), exeSha1: HASH, table: table('confirmed') });
    assert.equal((await layer.partyStatus(0)).value.limit, null);
  });

  test('any entry that is a hypothesis reads null, and the others still read', async () => {
    const layer = createSemantic({ backend: stats(2), exeSha1: HASH, table: table('confirmed', { partyMp0: 'hypothesis', partyAtb0: 'hypothesis' }) });
    assert.deepEqual((await layer.partyStatus(0)).value, { hp: 271, maxHp: 314, mp: null, maxMp: 54, limit: 120, atb: null });
  });

  test('with every entry a hypothesis, every field is null and confirmed is false', async () => {
    const layer = createSemantic({ backend: stats(2), exeSha1: HASH, table: table('hypothesis') });
    assert.deepEqual(await layer.partyStatus(0), { value: { hp: null, maxHp: null, mp: null, maxMp: null, limit: null, atb: null }, confirmed: false });
  });

  test('an unconfirmed game state picks neither copy of the limit', async () => {
    const layer = createSemantic({ backend: stats(2), exeSha1: HASH, table: table('confirmed', { gameState: 'hypothesis' }) });
    const r = await layer.partyStatus(0);
    assert.equal(r.value.limit, null);
    assert.equal(r.value.atb, null);
    assert.equal(r.confirmed, false);
  });

  test('an empty slot and a slot outside 0-2', async () => {
    const layer = createSemantic({ backend: stats(1), exeSha1: HASH, table: table('confirmed') });
    assert.deepEqual(await layer.partyStatus(2), { value: null, confirmed: true, reason: 'empty slot' });
    for (const bad of [-1, 3, 1.5, '0']) assert.deepEqual(await layer.partyStatus(bad), { value: null, confirmed: false, reason: 'out of range' });
  });

  test('the gate off: inactive, nothing read', async () => {
    const b = stats(1);
    const layer = createSemantic({ backend: b, exeSha1: 'c'.repeat(40), table: table('confirmed') });
    assert.deepEqual(await layer.partyStatus(0), { value: null, confirmed: false, reason: 'inactive' });
    assert.deepEqual(b.reads, []);
  });

  test('a failing read gives null fields, never a throw', async () => {
    let n = 0;
    const backend = { readMem(addr, len) { if (++n > 2) throw new RangeError('boom'); return new Uint8Array(len); } };
    const layer = createSemantic({ backend, exeSha1: HASH, table: table('confirmed') });
    assert.deepEqual((await layer.partyStatus(0)).value, { hp: null, maxHp: null, mp: null, maxMp: null, limit: null, atb: null });
  });
});

describe('the shipped table (#130 entries)', () => {
  const byName = new Map(ADDRESS_TABLE.entries.map((e) => [e.name, e]));
  test('is valid; the new entries sit at the documented layouts', () => {
    validateTable(ADDRESS_TABLE);
    assert.equal(ADDRESS_TABLE.exe, EXE_USA_SHA1);
    for (const i of [0, 1, 2]) {
      const act = 0x8009d84c + 0x440 * i;
      assert.equal(byName.get(`partyHp${i}`).address, act + 0x10);
      assert.equal(byName.get(`partyMaxHp${i}`).address, act + 0x12);
      assert.equal(byName.get(`partyMp${i}`).address, act + 0x14);
      assert.equal(byName.get(`partyMaxMp${i}`).address, act + 0x16);
      assert.equal(byName.get(`partyLimit${i}`).address - byName.get('partyLimit0').address, 0x34 * i);
      assert.equal(byName.get(`partyAtb${i}`).address - byName.get('partyAtb0').address, 0x44 * i);
      // Both battle entries hang off one g_BattleWork base: party[] is 0x2A8 after turn[].
      assert.equal(byName.get('partyLimit0').address - byName.get('partyAtb0').address, 0x2a8 + 0x08 - 0x04);
    }
    const lim = byName.get('characterLimit');
    assert.deepEqual([lim.address, lim.stride, lim.count, lim.type], [0x8009c6e4 + 0x54 + 0x0f, 0x84, 9, 'u8']);
  });

  test('partyStatus with the shipped table: confirmed fields read, slot 1 ATB (a hypothesis) is null', async () => {
    const act = (i, off) => 0x8009d84c + 0x440 * i + off;
    const bw = 0x800f5bb8;
    const b = ram([
      [0x8009c560, 's16', 2], [0x8009cbdc, 'u8', 0], [0x8009cbdd, 'u8', 1], [0x8009cbde, 'u8', 0xff],
      [act(0, 0x10), 's16', 271], [act(0, 0x12), 's16', 314], [act(0, 0x14), 's16', 41], [act(0, 0x16), 's16', 54],
      [act(1, 0x10), 's16', 300], [act(1, 0x12), 's16', 333], [act(1, 0x14), 's16', 20], [act(1, 0x16), 's16', 27],
      [bw + 0x2a8 + 0x08, 'u16', 100], [bw + 0x2a8 + 0x34 + 0x08, 'u16', 50],
      [bw + 0x04, 'u16', 0x8000], [bw + 0x44 + 0x04, 'u16', 0x4000],
    ]);
    const layer = createSemantic({ backend: b, exeSha1: EXE_USA_SHA1 });
    assert.deepEqual(await layer.partyStatus(0), { value: { hp: 271, maxHp: 314, mp: 41, maxMp: 54, limit: 100, atb: 0x8000 }, confirmed: true });
    assert.deepEqual(await layer.partyStatus(1), { value: { hp: 300, maxHp: 333, mp: 20, maxMp: 27, limit: 50, atb: null }, confirmed: true });
    assert.deepEqual(await layer.partyStatus(2), { value: null, confirmed: true, reason: 'empty slot' });
  });
});
