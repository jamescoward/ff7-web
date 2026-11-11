// Unit: partyGauges (#133), the bars drawn from a partyStatus value. No core, no game data.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ATB_MAX, LIMIT_MAX, partyGauges } from '../../../semantic/party-gauges.js';

test('ranges: ATB saturates at 0xFFFF, limit at 255', () => {
  assert.equal(ATB_MAX, 0xffff);
  assert.equal(LIMIT_MAX, 255);
});

test('every value present gives every bar', () => {
  const g = partyGauges({ hp: 271, maxHp: 314, mp: 41, maxMp: 54, limit: 100, atb: 0x8000 });
  assert.deepEqual(g.hp, { value: 271, max: 314, fraction: 271 / 314 });
  assert.deepEqual(g.mp, { value: 41, max: 54, fraction: 41 / 54 });
  assert.deepEqual(g.atb, { fraction: 0x8000 / 0xffff, full: false });
  assert.deepEqual(g.limit, { value: 100, fraction: 100 / 255, full: false });
});

test('full gauges', () => {
  const g = partyGauges({ hp: 10, maxHp: 10, mp: 0, maxMp: 10, limit: 255, atb: 0xffff });
  assert.equal(g.hp.fraction, 1);
  assert.equal(g.mp.fraction, 0);
  assert.equal(g.atb.full, true);
  assert.equal(g.limit.full, true);
});

test('null (unconfirmed) values give null bars, not guesses', () => {
  assert.deepEqual(partyGauges({ hp: 5, maxHp: null, mp: null, maxMp: 9, limit: null, atb: null }), { hp: null, mp: null, atb: null, limit: null });
  // Outside battle partyStatus gives atb null and limit from the record.
  const g = partyGauges({ hp: 1, maxHp: 2, mp: 3, maxMp: 4, limit: 7, atb: null });
  assert.equal(g.atb, null);
  assert.equal(g.limit.value, 7);
});

test('odd values are clamped or refused', () => {
  const g = partyGauges({ hp: 400, maxHp: 314, mp: -1, maxMp: 54, limit: 300, atb: 0x1ffff });
  assert.equal(g.hp.fraction, 1);
  assert.equal(g.mp.fraction, 0);
  assert.equal(g.limit.fraction, 1);
  assert.equal(g.atb.fraction, 1);
  assert.equal(partyGauges({ hp: 1, maxHp: 0, mp: 1, maxMp: Number.NaN }).hp, null);
  assert.equal(partyGauges(null), null);
  assert.equal(partyGauges(undefined), null);
});
