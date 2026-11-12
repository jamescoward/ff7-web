// Unit: inventory(), materia() and equipment(slot) (#117) on synthetic
// memory images, and the pure decoders in semantic/inventory.js. No core, no
// game data: the words are the author-chosen ones of
// harness/saves/disc1-md1stin-inventory.json, written by hand.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

import { ADDRESS_TABLE, EXE_USA_SHA1, makeTable } from '../../../semantic/addresses.js';
import { decodeItem, decodeMateria, ITEM_KINDS } from '../../../semantic/inventory.js';
import { createSemantic } from '../../../semantic/layer.js';

const RAM_SIZE = 0x200000;
const SAVEMAP = 0x8009c6e4;
const REC = SAVEMAP + 0x54;

function ram(writes = []) {
  const bytes = new Uint8Array(RAM_SIZE);
  const view = new DataView(bytes.buffer);
  for (const [addr, type, v] of writes) {
    const off = addr & 0x1fffffff;
    ({ u8: () => view.setUint8(off, v), u16: () => view.setUint16(off, v, true), u32: () => view.setUint32(off, v >>> 0, true) })[type]();
  }
  const reads = [];
  return {
    bytes,
    reads,
    readMem(addr, len) {
      reads.push([addr, len]);
      const off = addr & 0x1fffffff;
      return bytes.slice(off, off + len);
    },
  };
}

const item = (index, q) => (q << 9) | index;
const mat = (id, ap) => ((ap << 8) | id) >>> 0;

/** Every inventory and materia slot empty, then the save's values. */
function savedRam(extra = []) {
  const w = [];
  for (let i = 0; i < 320; i++) w.push([SAVEMAP + 0x4fc + 2 * i, 'u16', 0xffff]);
  for (let i = 0; i < 200; i++) w.push([SAVEMAP + 0x77c + 4 * i, 'u32', 0xffffffff]);
  for (let r = 0; r < 9; r++) for (let m = 0; m < 16; m++) w.push([REC + 0x84 * r + 0x40 + 4 * m, 'u32', 0xffffffff]);
  w.push(
    [SAVEMAP + 0x4f8, 'u8', 0], [SAVEMAP + 0x4f9, 'u8', 1], [SAVEMAP + 0x4fa, 'u8', 0xff],
    [SAVEMAP + 0x4fc + 0, 'u16', item(1, 7)],
    [SAVEMAP + 0x4fc + 2, 'u16', item(130, 2)],
    [SAVEMAP + 0x4fc + 4, 'u16', item(260, 3)],
    [SAVEMAP + 0x4fc + 638, 'u16', item(300, 1)],
    [SAVEMAP + 0x77c + 0, 'u32', mat(0x31, 1234)],
    [SAVEMAP + 0x77c + 4, 'u32', mat(0x0e, 0xabcd)],
    [SAVEMAP + 0x77c + 796, 'u32', mat(0x2a, 0xffffff)],
    [REC + 0x1c, 'u8', 3], [REC + 0x1d, 'u8', 5], [REC + 0x1e, 'u8', 7],
    [REC + 0x40, 'u32', mat(0x11, 0x012345)], [REC + 0x44, 'u32', mat(0x01, 500)],
    [REC + 0x60, 'u32', mat(0x0e, 0)], [REC + 0x64, 'u32', mat(0x2a, 77)],
    [REC + 0x84 + 0x1c, 'u8', 40], [REC + 0x84 + 0x1d, 'u8', 0], [REC + 0x84 + 0x1e, 'u8', 0xff],
    ...extra,
  );
  return ram(w);
}

const layerOn = (backend, table = ADDRESS_TABLE) => createSemantic({ backend, exeSha1: EXE_USA_SHA1, table });
const empty8 = Array(8).fill(null);

describe('semantic/inventory.js decoders (#117)', () => {
  test('items: quantity over a 9-bit index, with the kind and its number', () => {
    assert.deepEqual(decodeItem(item(1, 7)), { index: 1, quantity: 7, kind: 'item', number: 1 });
    assert.deepEqual(decodeItem(item(130, 2)), { index: 130, quantity: 2, kind: 'weapon', number: 2 });
    assert.deepEqual(decodeItem(item(260, 3)), { index: 260, quantity: 3, kind: 'armor', number: 4 });
    assert.deepEqual(decodeItem(item(319, 99)), { index: 319, quantity: 99, kind: 'accessory', number: 31 });
    assert.equal(decodeItem(0xffff), null);
    assert.equal(decodeItem(item(320, 1)), null, 'an index past the accessories names nothing');
    assert.deepEqual(ITEM_KINDS.map((k) => [k.first, k.count]), [[0, 128], [128, 128], [256, 32], [288, 32]]);
  });

  test('materia: ID in the low byte, 24-bit AP above; ID 0xFF is empty', () => {
    assert.deepEqual(decodeMateria(mat(0x31, 1234)), { id: 0x31, ap: 1234 });
    assert.deepEqual(decodeMateria(mat(0x2a, 0xffffff)), { id: 0x2a, ap: 0xffffff });
    assert.deepEqual(decodeMateria(0), { id: 0, ap: 0 });
    assert.equal(decodeMateria(0xffffffff), null);
    assert.equal(decodeMateria(mat(0xff, 5)), null);
  });

  test('platform-neutral: no DOM, Worker, Node or timer references', () => {
    const src = readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../semantic/inventory.js'), 'utf8');
    const code = src.replace(/\/\/.*$/gm, '');
    for (const word of ['document', 'window', 'Worker', 'postMessage', 'require', 'node:', 'process', 'setTimeout', 'setInterval', 'requestAnimationFrame']) {
      assert.ok(!code.includes(word), word);
    }
  });
});

describe('inventory(), materia(), equipment() (#117)', () => {
  test('inventory: the non-empty slots in slot order, in one read', async () => {
    const backend = savedRam();
    const layer = layerOn(backend);
    backend.reads.length = 0;
    assert.deepEqual(await layer.inventory(), {
      value: [
        { slot: 0, index: 1, quantity: 7, kind: 'item', number: 1 },
        { slot: 1, index: 130, quantity: 2, kind: 'weapon', number: 2 },
        { slot: 2, index: 260, quantity: 3, kind: 'armor', number: 4 },
        { slot: 319, index: 300, quantity: 1, kind: 'accessory', number: 12 },
      ],
      confirmed: true,
    });
    assert.deepEqual(backend.reads, [[SAVEMAP + 0x4fc, 640]]);
  });

  test('materia: the non-empty slots in slot order', async () => {
    assert.deepEqual(await layerOn(savedRam()).materia(), {
      value: [{ slot: 0, id: 0x31, ap: 1234 }, { slot: 1, id: 0x0e, ap: 0xabcd }, { slot: 199, id: 0x2a, ap: 0xffffff }],
      confirmed: true,
    });
  });

  test('equipment: by party slot, through the record it names', async () => {
    const layer = layerOn(savedRam());
    assert.deepEqual(await layer.equipment(0), {
      value: {
        record: 0, weapon: 3, armor: 5, accessory: 7,
        weaponMateria: [{ id: 0x11, ap: 0x012345 }, { id: 0x01, ap: 500 }, ...empty8.slice(2)],
        armorMateria: [{ id: 0x0e, ap: 0 }, { id: 0x2a, ap: 77 }, ...empty8.slice(2)],
      },
      confirmed: true,
    });
    assert.deepEqual(await layer.equipment(1), {
      value: { record: 1, weapon: 40, armor: 0, accessory: null, weaponMateria: empty8, armorMateria: empty8 },
      confirmed: true,
    });
    assert.deepEqual(await layer.equipment(2), { value: null, confirmed: true, reason: 'empty slot' });
  });

  test('equipment follows the party: Barret in slot 0 reads record 1', async () => {
    const layer = layerOn(savedRam([[SAVEMAP + 0x4f8, 'u8', 1]]));
    assert.equal((await layer.equipment(0)).value.record, 1);
  });

  test('a character without a record, a bad slot, the gate off', async () => {
    assert.deepEqual(await layerOn(savedRam([[SAVEMAP + 0x4f8, 'u8', 10]])).equipment(0), { value: null, confirmed: true, reason: 'no record' });
    for (const bad of [-1, 3, 1.5, '0']) assert.deepEqual(await layerOn(savedRam()).equipment(bad), { value: null, confirmed: false, reason: 'out of range' });
    const off = createSemantic({ backend: savedRam(), exeSha1: 'c'.repeat(40) });
    for (const r of [await off.inventory(), await off.materia(), await off.equipment(0)]) assert.deepEqual(r, { value: null, confirmed: false, reason: 'inactive' });
  });

  test('a failed read gives null with its reason', async () => {
    const backend = { readMem() { throw new Error('gone'); } };
    const layer = layerOn(backend);
    assert.deepEqual(await layer.inventory(), { value: null, confirmed: false, reason: 'read failed' });
    assert.deepEqual(await layer.materia(), { value: null, confirmed: false, reason: 'read failed' });
    assert.deepEqual(await layer.equipment(0), { value: null, confirmed: false, reason: 'read failed' });
    const short = layerOn({ readMem: (a, n) => new Uint8Array(Math.max(0, n - 1)) });
    assert.deepEqual(await short.inventory(), { value: null, confirmed: false, reason: 'read failed' });
  });

  test('values from hypothesis entries are reported unconfirmed', async () => {
    const t = makeTable(EXE_USA_SHA1, ADDRESS_TABLE.entries.map((e) => (['materiaSlot', 'characterArmorMateria'].includes(e.name) ? { ...e, status: 'hypothesis', scenario: undefined } : e)));
    const layer = layerOn(savedRam(), t);
    assert.equal((await layer.inventory()).confirmed, true);
    assert.equal((await layer.materia()).confirmed, false);
    const eq = await layer.equipment(0);
    assert.equal(eq.confirmed, false);
    assert.equal(eq.value.weapon, 3);
  });

  test('a table without the entries answers no address', async () => {
    const t = makeTable(EXE_USA_SHA1, ADDRESS_TABLE.entries.filter((e) => !['inventorySlot', 'materiaSlot', 'characterWeapon'].includes(e.name)));
    const layer = layerOn(savedRam(), t);
    assert.deepEqual(await layer.inventory(), { value: null, confirmed: false, reason: 'no address' });
    assert.deepEqual(await layer.materia(), { value: null, confirmed: false, reason: 'no address' });
    assert.deepEqual(await layer.equipment(0), { value: null, confirmed: false, reason: 'no address' });
  });
});
