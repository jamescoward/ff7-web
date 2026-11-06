// Unit: the semantic layer (#75) on synthetic memory images and synthetic
// discs built here from the documented layouts. No core, no game data.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { openDisc } from '../../disc.js';
import { ADDRESS_TABLE, EXE_USA_SHA1, makeTable, validateTable } from '../../../semantic/addresses.js';
import { openIso } from '../../iso9660.js';
import { activateSemantic, bootExeSha1, createSemantic, evaluateGate, sha1Hex } from '../../../semantic/layer.js';
import { buildIso } from '../../synth/iso9660.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const RAM_SIZE = 0x200000;

/** A synthetic RAM image and the backend's readMem over it (sync, like the runner). */
function ram(writes = []) {
  const bytes = new Uint8Array(RAM_SIZE);
  const view = new DataView(bytes.buffer);
  for (const [addr, type, v] of writes) {
    const off = addr & 0x1fffffff;
    ({ u8: () => view.setUint8(off, v), s16: () => view.setInt16(off, v, true), u16: () => view.setUint16(off, v, true), s32: () => view.setInt32(off, v, true) })[type]();
  }
  const reads = [];
  return {
    reads,
    readMem(addr, len) {
      reads.push([addr, len]);
      const off = addr & 0x1fffffff;
      if (off + len > RAM_SIZE) throw new RangeError('address outside main RAM');
      return bytes.slice(off, off + len);
    },
  };
}

const HASH = 'a'.repeat(40);

/** A test-only table with every reader's entries filled in and a given status. */
function fullTable(status) {
  const scenario = status === 'confirmed' ? { scenario: 'harness/scenarios/synthetic.json' } : {};
  const e = (name, address, type, extra = {}) => ({
    name, address, type, meaning: 'synthetic', source: 'unit test', status, ...scenario, ...extra,
  });
  return makeTable(HASH, [
    e('gameState', 0x80001000, 's16', { values: { 1: 'field', 2: 'battle', 3: 'world', 5: 'menu' } }),
    e('prevGameState', 0x80001002, 's16', { values: { 1: 'field', 2: 'battle', 3: 'world', 5: 'menu' } }),
    e('fieldId', 0x80001010, 'u16'),
    e('fieldX', 0x80001012, 's16'),
    e('fieldY', 0x80001014, 's16'),
    e('menuCursor', 0x80001020, 'u8'),
    e('partySlot0', 0x80001030, 'u8'),
    e('partySlot1', 0x80001031, 'u8'),
    e('partySlot2', 0x80001032, 'u8'),
  ]);
}

const image = () => ram([
  [0x80001000, 's16', 2], [0x80001002, 's16', 1],
  [0x80001010, 'u16', 0x0074], [0x80001012, 's16', -300], [0x80001014, 's16', 1234],
  [0x80001020, 'u8', 2],
  [0x80001030, 'u8', 0], [0x80001031, 'u8', 1], [0x80001032, 'u8', 0xff],
]);

describe('address table', () => {
  test('the shipped table is valid, applies to the USA executable, and confirms only what a committed Tier 2 scenario checks', () => {
    validateTable(ADDRESS_TABLE);
    assert.equal(ADDRESS_TABLE.exe, EXE_USA_SHA1);
    assert.equal(EXE_USA_SHA1, 'a95e8b16b97071203b953bb81a33980509262f30');
    // #76 and #77 confirmed these; everything else is still a hypothesis.
    const confirmed = ['gameState', 'prevGameState', 'movieFrame', 'fieldId', 'fieldX', 'fieldY'];
    const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
    const tier2 = (file) => {
      const doc = JSON.parse(readFileSync(path.join(root, file), 'utf8'));
      assert.equal(doc.tier, 2, file);
      return doc;
    };
    for (const e of ADDRESS_TABLE.entries) {
      assert.equal(e.status, confirmed.includes(e.name) ? 'confirmed' : 'hypothesis', e.name);
      assert.equal(e.exe, EXE_USA_SHA1, e.name);
      assert.ok(e.source.length > 10, `${e.name} has a source`);
      if (e.status !== 'confirmed') continue;
      // The scenario exists, is tier 2, and reads this entry's address.
      const files = [e.scenario, ...Object.values(e.confirmedValues ?? {})];
      for (const f of files) {
        const doc = tier2(f);
        const addrs = Object.values(doc.memory ?? {}).map((m) => Number(m.addr));
        assert.ok(addrs.includes(e.address), `${e.name}: ${f} reads 0x${e.address.toString(16)}`);
      }
      for (const raw of Object.keys(e.confirmedValues ?? {})) assert.ok(raw in e.values, `${e.name}: confirmed value ${raw} has a label`);
    }
    assert.deepEqual(Object.keys(ADDRESS_TABLE.entries.find((e) => e.name === 'gameState').confirmedValues), ['1', '2', '5']);
    const state = ADDRESS_TABLE.entries.find((e) => e.name === 'gameState');
    assert.equal(state.address, 0x8009c560);
    assert.equal(state.type, 's16');
  });

  test('entries without a known address say so instead of inventing one', () => {
    for (const name of ['menuCursor', 'partySlot0']) {
      const e = ADDRESS_TABLE.entries.find((x) => x.name === name);
      assert.equal(e.address, null, name);
      assert.match(e.source, /no RAM address known/, name);
    }
  });

  test('field ID and position are confirmed at the addresses #77 checked in Tier 2', () => {
    const want = { fieldId: [0x8009a05c, 's16', 'reactor-field-1-id'], fieldX: [0x80074eb0, 's32', 'reactor-field-3-walk-right'], fieldY: [0x80074eb4, 's32', 'reactor-field-5-walk-up'] };
    for (const [name, [address, type, scenario]] of Object.entries(want)) {
      const e = ADDRESS_TABLE.entries.find((x) => x.name === name);
      assert.equal(e.address, address, name);
      assert.equal(e.type, type, name);
      assert.equal(e.status, 'confirmed', name);
      assert.equal(e.scenario, `harness/scenarios/${scenario}.json`, name);
      assert.ok(existsSync(path.join(ROOT, e.scenario)), `${name}: its scenario file exists`);
    }
    const loading = ADDRESS_TABLE.entries.find((x) => x.name === 'fieldLoading');
    assert.equal(loading.address, 0x800965e8);
    assert.equal(loading.status, 'hypothesis');
  });

  test('validateTable rejects bad entries', () => {
    const base = { name: 'a', address: 0x80000010, type: 'u8', meaning: 'm', source: 's', status: 'hypothesis' };
    const bad = (patch, re) => assert.throws(() => validateTable(makeTable(HASH, [{ ...base, ...patch }])), re);
    bad({ type: 'f32' }, /unknown type/);
    bad({ address: 0x00001000 }, /outside KSEG0/);
    bad({ address: 0x801fffff, type: 'u16' }, /outside KSEG0/);
    bad({ source: '' }, /meaning and source/);
    bad({ status: 'confirmed' }, /without the Tier 2 scenario/);
    bad({ status: 'confirmed', address: null, scenario: 'x.json' }, /without an address/);
    bad({ status: 'maybe' }, /hypothesis or confirmed/);
    assert.throws(() => makeTable(HASH, [base, base]), /duplicate/);
    assert.throws(() => validateTable({ exe: 'XYZ', entries: [] }), /SHA-1/);
    validateTable(makeTable(HASH, [{ ...base, status: 'confirmed', scenario: 'harness/scenarios/x.json' }]));
  });
});

describe('readers on a synthetic memory image', () => {
  for (const status of ['hypothesis', 'confirmed']) {
    test(`all five readers decode the layout and report ${status}`, async () => {
      const layer = createSemantic({ backend: image(), exeSha1: HASH, table: fullTable(status) });
      assert.equal(layer.active, true);
      const confirmed = status === 'confirmed';
      assert.deepEqual(await layer.mode(), { value: { mode: 'battle', raw: 2, previous: 'field' }, confirmed });
      assert.deepEqual(await layer.fieldId(), { value: 0x74, confirmed });
      assert.deepEqual(await layer.playerPosition(), { value: { x: -300, y: 1234 }, confirmed });
      assert.deepEqual(await layer.menuCursor(), { value: 2, confirmed });
      assert.deepEqual(await layer.party(), { value: [0, 1, null], confirmed });
    });
  }

  test('a reader is confirmed only if every address it used is', async () => {
    const t = fullTable('confirmed');
    const mixed = makeTable(HASH, t.entries.map((e) => (e.name === 'fieldY' ? { ...e, status: 'hypothesis', scenario: undefined } : e)));
    const layer = createSemantic({ backend: image(), exeSha1: HASH, table: mixed });
    assert.equal((await layer.playerPosition()).confirmed, false);
    assert.equal((await layer.fieldId()).confirmed, true);
  });

  test('mode names every documented game state and flags the rest as unknown', async () => {
    for (const [raw, name] of [[1, 'field'], [2, 'battle'], [3, 'world'], [5, 'menu'], [0, 'unknown'], [4, 'unknown'], [-1, 'unknown']]) {
      const layer = createSemantic({ backend: ram([[0x80001000, 's16', raw]]), exeSha1: HASH, table: fullTable('hypothesis') });
      const r = await layer.mode();
      assert.equal(r.value.mode, name, `raw ${raw}`);
      assert.equal(r.value.raw, raw);
    }
  });

  test('values are signed or unsigned as typed', async () => {
    const layer = createSemantic({ backend: ram([[0x80001010, 'u16', 0xfffe], [0x80001012, 's16', 0xfffe - 0x10000]]), exeSha1: HASH, table: fullTable('hypothesis') });
    assert.equal((await layer.fieldId()).value, 0xfffe);
    assert.equal((await layer.playerPosition()).value.x, -2);
  });

  test('works with an asynchronous readMem, like the browser backend', async () => {
    const sync = image();
    const backend = { readMem: async (a, l) => sync.readMem(a, l) };
    const layer = createSemantic({ backend, exeSha1: HASH, table: fullTable('hypothesis') });
    assert.equal((await layer.fieldId()).value, 0x74);
  });

  test('a failing read gives a null value, never a throw', async () => {
    const backend = { readMem() { throw new RangeError('boom'); } };
    const layer = createSemantic({ backend, exeSha1: HASH, table: fullTable('hypothesis') });
    assert.deepEqual(await layer.mode(), { value: null, confirmed: false, reason: 'read failed' });
  });

  test('the shipped table: mode, field ID and position read their confirmed addresses; the rest answer "no address"', async () => {
    const b = ram([[0x8009c560, 's16', 1], [0x800965ec, 's16', 5], [0x8009a05c, 's16', 0x74], [0x80074eb0, 's32', -70000], [0x80074eb4, 's32', 123456]]);
    const layer = createSemantic({ backend: b, exeSha1: EXE_USA_SHA1 });
    assert.deepEqual(await layer.mode(), { value: { mode: 'field', raw: 1, previous: 'menu' }, confirmed: true });
    assert.deepEqual(await layer.fieldId(), { value: 0x74, confirmed: true });
    assert.deepEqual(await layer.playerPosition(), { value: { x: -70000, y: 123456 }, confirmed: true });
    for (const name of ['menuCursor', 'party']) {
      assert.deepEqual(await layer[name](), { value: null, confirmed: false, reason: 'no address' }, name);
    }
    assert.deepEqual(b.reads, [[0x8009c560, 2], [0x800965ec, 2], [0x8009a05c, 2], [0x80074eb0, 4], [0x80074eb4, 4]], 'no address means no read');
  });

  test('the layer never calls writeMem', async () => {
    const b = image();
    b.writeMem = () => assert.fail('writeMem called');
    const layer = createSemantic({ backend: b, exeSha1: HASH, table: fullTable('hypothesis') });
    for (const name of ['mode', 'fieldId', 'playerPosition', 'menuCursor', 'party']) await layer[name]();
  });
});

describe('hash gate', () => {
  let dir;
  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ff7-sem-'));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  const exe = Buffer.from('synthetic boot executable, not a game file '.repeat(200));
  const files = { 'SYSTEM.CNF': 'BOOT = cdrom:\\SYNTH_000.00;1\r\n', 'SYNTH_000.00': exe };
  const sha = createHash('sha1').update(exe).digest('hex');

  test('sha1Hex matches node:crypto', async () => {
    assert.equal(await sha1Hex(exe), sha);
    assert.equal(await sha1Hex(new Uint8Array(0)), 'da39a3ee5e6b4b0d3255bfef95601890afd80709');
  });

  test('evaluateGate: only the table\'s exe turns it on', () => {
    assert.deepEqual(evaluateGate(ADDRESS_TABLE, EXE_USA_SHA1), { active: true, reason: null });
    assert.deepEqual(evaluateGate(ADDRESS_TABLE, EXE_USA_SHA1.toUpperCase()), { active: true, reason: null });
    assert.equal(evaluateGate(ADDRESS_TABLE, sha).active, false);
    assert.equal(evaluateGate(ADDRESS_TABLE, null).active, false);
  });

  for (const [how, open] of [
    ['openDisc (runner)', (file) => {
      const d = openDisc(file);
      return { iso: d, close: () => d.close() };
    }],
    ['openIso over a reader (browser path)', (file) => {
      const data = new Uint8Array(buildIso({ files }));
      return { iso: openIso((off, len) => data.subarray(off, off + len), data.length), close() {} };
    }],
  ]) {
    test(`a disc with another boot executable leaves the layer off; a test table with its hash turns it on (${how})`, async () => {
      const file = path.join(dir, 'synth.bin');
      writeFileSync(file, buildIso({ files }));
      const { iso, close } = open(file);
      try {
        assert.equal(await bootExeSha1(iso), sha);
        const backend = image();

        const off = await activateSemantic({ iso, backend }); // the shipped USA table
        assert.equal(off.active, false);
        assert.deepEqual(await off.mode(), { value: null, confirmed: false, reason: 'inactive' });
        assert.deepEqual(backend.reads, [], 'an inactive layer reads nothing');

        const table = makeTable(sha, fullTable('hypothesis').entries.map(({ exe: _x, ...rest }) => rest));
        const on = await activateSemantic({ iso, backend, table });
        assert.equal(on.active, true);
        assert.equal((await on.fieldId()).value, 0x74);
      } finally {
        close();
      }
    });
  }

  test('a disc that can\'t be read leaves the layer off', async () => {
    const iso = { read() { throw new Error('unreadable'); }, bootPath: () => 'X' };
    const layer = await activateSemantic({ iso, backend: image() });
    assert.equal(layer.active, false);
    assert.equal(layer.inactiveReason, 'no boot executable hash');
  });
});
