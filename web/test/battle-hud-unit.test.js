// Unit (no browser): the battle status strip's policy and lifecycle (#133).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createBattleHud, hudForMode, hudRows, HUD_FLAG } from '../js/battle-hud.js';

const battle = { value: { mode: 'battle', raw: 2, previous: 'field' }, confirmed: true };
const field = { value: { mode: 'field', raw: 1, previous: 'none' }, confirmed: true };
const STATUS = { hp: 271, maxHp: 314, mp: 41, maxMp: 54, limit: 100, atb: 0xffff };

describe('hudForMode', () => {
  test('only a confirmed battle shows the strip', () => {
    assert.equal(hudForMode(battle), true);
    assert.equal(hudForMode({ ...battle, confirmed: false }), false);
    assert.equal(hudForMode(field), false);
    assert.equal(hudForMode({ value: null, confirmed: false, reason: 'read failed' }), false);
    assert.equal(hudForMode(null), false);
  });
});

describe('hudRows', () => {
  test('confirmed, non-empty slots only', () => {
    const rows = hudRows([
      { value: STATUS, confirmed: true },
      { value: null, confirmed: true, reason: 'empty slot' },
      { value: STATUS, confirmed: false },
    ]);
    assert.deepEqual(rows.map((r) => r.slot), [0]);
    assert.equal(rows[0].gauges.hp.value, 271);
    assert.equal(rows[0].gauges.atb.full, true);
  });
  test('a slot with no confirmed value at all has no row', () => {
    const none = { hp: null, maxHp: null, mp: null, maxMp: null, limit: null, atb: null };
    assert.deepEqual(hudRows([{ value: none, confirmed: true }, null, undefined]), []);
  });
  test('an unconfirmed field is null, the rest stay', () => {
    const [row] = hudRows([{ value: { ...STATUS, mp: null }, confirmed: true }]);
    assert.equal(row.gauges.mp, null);
    assert.ok(row.gauges.hp && row.gauges.atb && row.gauges.limit);
  });
});

function fakes({ flag = true } = {}) {
  const intervals = new Set();
  const timers = {
    setInterval(fn) { const h = { fn }; intervals.add(h); return h; },
    clearInterval(h) { intervals.delete(h); },
  };
  let on = flag;
  const listeners = [];
  const labs = {
    isOn: (n) => n === HUD_FLAG && on,
    onChange: (cb) => listeners.push(cb),
    set(v) { on = v; for (const cb of listeners) cb(HUD_FLAG, v); },
  };
  const attrs = new Set();
  const root = {
    hidden: true,
    ownerDocument: { documentElement: { toggleAttribute: (n, v) => (v ? attrs.add(n) : attrs.delete(n)) } },
  };
  return { timers, intervals, labs, root, attrs };
}

describe('createBattleHud lifecycle', () => {
  test('flag off: never polls', async () => {
    const f = fakes({ flag: false });
    const hud = createBattleHud({ root: f.root, labs: f.labs, timers: f.timers });
    let reads = 0;
    hud.setSource({ mode: async () => { reads++; return field; }, partyStatus: async () => null });
    hud.setGate({ active: true });
    assert.equal(hud.running, false);
    assert.equal(reads, 0);
    assert.equal(f.root.hidden, true);
  });

  test('gate closed: never polls; closing it stops and hides', async () => {
    const f = fakes();
    const hud = createBattleHud({ root: f.root, labs: f.labs, timers: f.timers });
    hud.setSource({ mode: async () => field, partyStatus: async () => null });
    assert.equal(hud.running, false);
    hud.setGate({ active: true });
    assert.equal(hud.running, true);
    hud.setGate({ active: false });
    assert.equal(hud.running, false);
    assert.equal(f.intervals.size, 0);
    assert.equal(f.root.hidden, true);
  });

  test('outside battle the strip stays hidden and party status is not read', async () => {
    const f = fakes();
    const hud = createBattleHud({ root: f.root, labs: f.labs, timers: f.timers });
    let statusReads = 0;
    hud.setSource({ mode: async () => field, partyStatus: async () => { statusReads++; return null; } });
    hud.setGate({ active: true });
    await hud.tick();
    for (const h of f.intervals) await h.fn();
    assert.equal(statusReads, 0);
    assert.equal(f.root.hidden, true);
    assert.equal(f.attrs.has('data-hud-on'), false);
  });

  test('a failed mode read changes nothing; switching the flag off hides', async () => {
    const f = fakes();
    const hud = createBattleHud({ root: f.root, labs: f.labs, timers: f.timers });
    hud.setSource({ mode: async () => { throw new Error('read failed'); }, partyStatus: async () => null });
    hud.setGate({ active: true });
    await new Promise((r) => setImmediate(r));
    assert.equal(f.root.hidden, true);
    f.root.hidden = false; // as if a battle had shown it
    for (const h of f.intervals) await h.fn();
    assert.equal(f.root.hidden, false, 'failed read leaves it');
    f.labs.set(false);
    assert.equal(hud.running, false);
    assert.equal(f.root.hidden, true);
  });
});
