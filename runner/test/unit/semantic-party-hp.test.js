// Unit: the partyHp reader added for the debug overlay (#79). Synthetic memory only.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ADDRESS_TABLE, EXE_USA_SHA1, makeTable, validateTable } from '../../../semantic/addresses.js';
import { createSemantic } from '../../../semantic/layer.js';

describe('partyHp reader', () => {
  test('answers "no address" with the shipped table, and reads nothing', async () => {
    validateTable(ADDRESS_TABLE);
    const reads = [];
    const backend = { readMem: (a, l) => { reads.push([a, l]); return new Uint8Array(l); } };
    const s = createSemantic({ backend, exeSha1: EXE_USA_SHA1 });
    assert.deepEqual(await s.partyHp(), { value: null, confirmed: false, reason: 'no address' });
    assert.deepEqual(reads, []);
  });

  test('is inactive with the gate off', async () => {
    const s = createSemantic({ backend: { readMem() { throw new Error('must not read'); } }, exeSha1: null });
    assert.equal((await s.partyHp()).reason, 'inactive');
  });

  test('decodes u16 HP from a table that has addresses, marked by status', async () => {
    const ent = (i, status) => ({
      name: `partyHp${i}`, address: 0x80001000 + i * 2, type: 'u16', meaning: 'hp', source: 'synthetic', status,
      ...(status === 'confirmed' ? { scenario: 'x' } : {}),
    });
    const bytes = new Uint8Array(8);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 321, true);
    view.setUint16(2, 0, true);
    view.setUint16(4, 9999, true);
    const backend = { readMem: (addr, len) => bytes.subarray((addr & 0xffff) - 0x1000, (addr & 0xffff) - 0x1000 + len) };
    for (const status of ['hypothesis', 'confirmed']) {
      const table = makeTable(EXE_USA_SHA1, [0, 1, 2].map((i) => ent(i, status)));
      const r = await createSemantic({ backend, exeSha1: EXE_USA_SHA1, table }).partyHp();
      assert.deepEqual(r, { value: [321, 0, 9999], confirmed: status === 'confirmed' });
    }
  });
});
