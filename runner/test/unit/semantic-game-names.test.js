// #260 part 2: the shared BIN-GZIP split (semantic/bin-gzip.js), the name
// tables built from a kernel archive (semantic/game-names.js), the browser's
// gunzip and disc read (web/js/game-names.js) and the panel label helpers
// with and without tables. Everything is synthetic: author-made strings in
// the documented encoding (ASCII - 0x20, FF end), the documented BIN-GZIP
// layout, and a synthetic ISO9660 image. No game data.
// Original project code, GPL-2.0-or-later.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { gunzipSync, gzipSync } from 'node:zlib';

import { BinGzipError, KERNEL_PATH, parseBinGzip, sectionGzip } from '../../../semantic/bin-gzip.js';
import { NAME_KINDS, kernelNameTables } from '../../../semantic/game-names.js';
import { KERNEL_NAME_SECTIONS } from '../../../semantic/game-text.js';
import { equipMemberLabel, equipSlotLabel, spareWeaponLabel } from '../../../semantic/equip-screen.js';
import { itemRowLabel } from '../../../semantic/item-screen.js';
import { materiaColumnLabel, materiaLabel } from '../../../semantic/materia-screen.js';
import { createGameNames, gunzipSection, namesFromImage, NAMES_FLAG } from '../../../web/js/game-names.js';
import { BaselineError, parseBinGzip as baselineSplit } from '../../savegen/baseline.js';
import { buildIso } from '../../synth/iso9660.js';

const enc = (s) => [...s].map((c) => c.charCodeAt(0) - 0x20).concat([0xff]);

function section(strings) {
  const bodies = strings.map((s) => (Array.isArray(s) ? s : enc(s)));
  const out = [];
  let at = strings.length * 2;
  for (const b of bodies) {
    out.push(at & 0xff, at >> 8);
    at += b.length;
  }
  return Uint8Array.from([...out, ...bodies.flat()]);
}

function archive(sections) {
  const parts = [];
  for (const data of sections) {
    const gz = data.gz ?? gzipSync(data);
    const len = data.gz ? data.unpacked : data.length;
    parts.push(gz.length & 0xff, gz.length >> 8, len & 0xff, len >> 8, 0, 0, ...gz);
  }
  return Uint8Array.from(parts);
}

/** 27 sections; the name sections hold `names[kind]`, the rest one filler byte. */
function kernel(names = {}, override = {}) {
  const secs = Array.from({ length: 27 }, () => Uint8Array.of(0));
  for (const [kind, strings] of Object.entries(names)) secs[KERNEL_NAME_SECTIONS[kind]] = section(strings);
  for (const [i, v] of Object.entries(override)) secs[i] = v;
  return archive(secs);
}

const nodeUnpack = (gz) => new Uint8Array(gunzipSync(gz));

// Author-made names, one per kind.
const NAMES = {
  item: ['Pebble', '', 'Old Map'],
  weapon: ['Stick', 'Bent Rod'],
  armor: ['Coat'],
  accessory: ['Ring A'],
  materia: ['Blue Orb', '', 'Red Orb'],
};

describe('semantic/bin-gzip.js', () => {
  test('splits sections and gives each one\'s gzip bytes', () => {
    const k = archive([Uint8Array.of(1, 2), Uint8Array.of(3, 4, 5)]);
    const secs = parseBinGzip(k);
    assert.equal(secs.length, 2);
    assert.deepEqual([...nodeUnpack(sectionGzip(k, secs[1]))], [3, 4, 5]);
    assert.equal(KERNEL_PATH, 'INIT/KERNEL.BIN');
  });
  test('refuses a truncated archive with BinGzipError; baseline.js keeps BaselineError', () => {
    const k = archive([Uint8Array.of(1, 2)]);
    const cut = k.subarray(0, k.length - 1);
    assert.throws(() => parseBinGzip(cut), BinGzipError);
    assert.throws(() => baselineSplit(cut), BaselineError);
    assert.throws(() => parseBinGzip([1, 2]), BinGzipError);
  });
});

describe('kernelNameTables', () => {
  test('builds every kind from a synthetic archive; counts are numbers only', async () => {
    const { tables, counts } = await kernelNameTables(kernel(NAMES), nodeUnpack);
    assert.deepEqual(Object.keys(tables), NAME_KINDS);
    for (const kind of NAME_KINDS) assert.deepEqual(tables[kind], NAMES[kind]);
    assert.deepEqual(counts.item, { built: 1, count: 3, empty: 1, failed: 0 });
    assert.deepEqual(counts.materia, { built: 1, count: 3, empty: 1, failed: 0 });
    assert.ok(Object.isFrozen(tables) && Object.isFrozen(tables.item));
  });
  test('a kind whose section fails is left out; the others still build', async () => {
    const k = kernel(NAMES, { [KERNEL_NAME_SECTIONS.armor]: { gz: Uint8Array.of(1, 2, 3), unpacked: 4 } });
    const { tables, counts } = await kernelNameTables(k, nodeUnpack);
    assert.equal(tables.armor, undefined);
    assert.deepEqual(counts.armor, { built: 0, count: 0, empty: 0, failed: 0 });
    assert.deepEqual(tables.weapon, NAMES.weapon);
  });
  test('a section that unpacks to another length, or has no table, is left out', async () => {
    const shortUnpack = (gz) => nodeUnpack(gz).subarray(1);
    assert.deepEqual(Object.keys((await kernelNameTables(kernel(NAMES), shortUnpack)).tables), []);
    const k = kernel(NAMES, { [KERNEL_NAME_SECTIONS.item]: Uint8Array.of(1) });
    assert.equal((await kernelNameTables(k, nodeUnpack)).tables.item, undefined);
  });
  test('an archive with too few sections builds nothing; a broken archive throws', async () => {
    const few = archive([Uint8Array.of(0)]);
    assert.deepEqual((await kernelNameTables(few, nodeUnpack)).tables, {});
    await assert.rejects(kernelNameTables(few.subarray(0, 4), nodeUnpack), BinGzipError);
  });
});

describe('web/js/game-names.js gunzipSection (DecompressionStream)', () => {
  const data = Uint8Array.from({ length: 300 }, (_, i) => (i * 7) & 0xff);
  test('a whole gzip member', async () => {
    assert.deepEqual(await gunzipSection(gzipSync(data), data.length), data);
  });
  test('a member whose trailer does not check out falls back to raw inflate', async () => {
    const gz = Uint8Array.from(gzipSync(data));
    gz[gz.length - 5] ^= 0xff; // CRC32 byte
    assert.deepEqual(await gunzipSection(gz, data.length), data);
  });
  test('the wrong length or non-gzip bytes are refused, with fixed messages', async () => {
    await assert.rejects(gunzipSection(gzipSync(data), data.length + 1), /^Error: not the length its header gives$/);
    await assert.rejects(gunzipSection(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11), 4), /^Error: not gzip data$/);
    await assert.rejects(gunzipSection(gzipSync(data), data.length, null), /cannot decompress/, 'no DecompressionStream');
  });
  test('namesFromImage reads INIT/KERNEL.BIN from a synthetic disc image', async () => {
    const iso = new Uint8Array(buildIso({ files: { 'SYSTEM.CNF': Buffer.from('BOOT = cdrom:\\X;1\r\n'), [KERNEL_PATH]: Buffer.from(kernel(NAMES)) } }));
    const readAt = (o, n) => iso.subarray(o, o + n);
    const { tables } = await namesFromImage(readAt, iso.length);
    assert.deepEqual(tables.materia, NAMES.materia);
    assert.deepEqual(tables.weapon, NAMES.weapon);
  });
});

describe('label helpers with and without names', () => {
  const names = { item: ['Pebble', ''], weapon: ['Stick'], armor: ['Coat'], accessory: ['Ring A'], materia: ['Blue Orb'] };
  test('without names the labels are the ID labels, unchanged', () => {
    assert.equal(itemRowLabel({ kind: 'item', number: 0, quantity: 3 }), 'item #0 ×3');
    assert.equal(equipMemberLabel(0, { weapon: 0, armor: 0, accessory: null }), 'Slot 1  Wpn #0  Arm #0  Acc none');
    assert.equal(equipSlotLabel(0, { weapon: 0 }), 'Weapon: #0');
    assert.equal(spareWeaponLabel({ number: 0, quantity: 2 }), 'weapon #0 ×2');
    assert.equal(materiaLabel({ id: 0, ap: 5 }), 'materia #0  AP 5');
    assert.equal(materiaColumnLabel(1, { id: 0 }), 'Wpn 2: #0');
    assert.equal(materiaColumnLabel(1, null, names), 'Wpn 2: empty');
  });
  test('with names, the name replaces the ID; an empty or missing entry keeps the ID label', () => {
    assert.equal(itemRowLabel({ kind: 'item', number: 0, quantity: 3 }, names), 'Pebble ×3');
    assert.equal(itemRowLabel({ kind: 'item', number: 1, quantity: 3 }, names), 'item #1 ×3');
    assert.equal(itemRowLabel({ kind: 'weapon', number: 9, quantity: 1 }, names), 'weapon #9 ×1');
    assert.equal(equipMemberLabel(0, { weapon: 0, armor: 0, accessory: 0 }, names), 'Slot 1  Wpn Stick  Arm Coat  Acc Ring A');
    assert.equal(equipMemberLabel(0, { weapon: 0, armor: 0, accessory: null }, names), 'Slot 1  Wpn Stick  Arm Coat  Acc none');
    assert.equal(equipSlotLabel(2, { accessory: 0 }, names), 'Accessory: Ring A');
    assert.equal(spareWeaponLabel({ number: 0, quantity: 2 }, names), 'Stick ×2');
    assert.equal(materiaLabel({ id: 0, ap: 5 }, names), 'Blue Orb  AP 5');
    assert.equal(materiaLabel({ id: 7, ap: 5 }, names), 'materia #7  AP 5');
    assert.equal(materiaColumnLabel(0, { id: 0 }, names), 'Wpn 1: Blue Orb');
  });
});

describe('createGameNames (page side)', () => {
  function fakeLabs(on = false) {
    const cbs = new Set();
    const state = { on, registered: null };
    return {
      state,
      registerFlag(name, opts) { state.registered = { name, ...opts }; },
      isOn: (name) => name === NAMES_FLAG && state.on,
      onChange: (cb) => cbs.add(cb),
      set(v) { state.on = v; for (const cb of cbs) cb(NAMES_FLAG, v); },
    };
  }
  const tick = () => new Promise((r) => setImmediate(r));

  test('registers the flag off by default with a ≤5-line checklist', () => {
    const labs = fakeLabs();
    createGameNames({ labs });
    assert.equal(labs.state.registered.name, 'game-names');
    assert.ok(labs.state.registered.checklist.length <= 5);
  });
  test('asks the worker only with the flag on and the gate active; names() follows the flag', async () => {
    const labs = fakeLabs(false);
    let asked = 0;
    const g = createGameNames({ labs });
    g.setBackend({ gameNames: async () => { asked += 1; return { tables: { item: ['Pebble'] } }; } });
    g.setGate({ active: true });
    await tick();
    assert.equal(asked, 0, 'flag off: nothing read');
    assert.equal(g.names(), null);
    labs.set(true);
    await tick();
    assert.equal(asked, 1);
    assert.equal(g.state, 'ready');
    assert.deepEqual(g.names(), { item: ['Pebble'] });
    labs.set(false);
    assert.equal(g.names(), null, 'flag off again: ID labels');
    labs.set(true);
    await tick();
    assert.equal(asked, 1, 'built once');
  });
  test('gate inactive: nothing read', async () => {
    const labs = fakeLabs(true);
    let asked = 0;
    const g = createGameNames({ labs });
    g.setBackend({ gameNames: async () => { asked += 1; return null; } });
    g.setGate({ active: false });
    await tick();
    assert.equal(asked, 0);
    assert.equal(g.names(), null);
  });
  test('a failed read leaves ID labels and gives one fixed notice', async () => {
    for (const reply of [async () => null, async () => { throw new Error('x'); }, async () => ({ tables: {} })]) {
      const labs = fakeLabs(true);
      const notes = [];
      const g = createGameNames({ labs, onStatus: (m) => notes.push(m) });
      g.setGate({ active: true });
      g.setBackend({ gameNames: reply });
      await tick();
      assert.equal(g.state, 'failed');
      assert.equal(g.names(), null);
      assert.deepEqual(notes, ['Game names: could not read the names from this disc.']);
    }
  });
});
