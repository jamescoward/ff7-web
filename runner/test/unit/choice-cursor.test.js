// #168 third budget: checks on the generated choice-cursor scenarios
// (runner/test/unit/choice-cursor-scenarios.js).
// Original project code, GPL-2.0-or-later.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ADDRESS_TABLE } from '../../../semantic/addresses.js';
import { CANDIDATES, NEAR_AXIS, ROUTES, SNAPSHOT, TALKER, WINDOW_STRIDE, memory, routeMemory, scenarios } from './choice-cursor-scenarios.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCENARIOS = path.resolve(HERE, '../../../harness/scenarios');
const entry = (n) => ADDRESS_TABLE.entries.find((e) => e.name === n);

describe('#168 choice-cursor scenarios', () => {
  test('the committed files match the generator', () => {
    for (const s of scenarios()) {
      const file = JSON.parse(readFileSync(path.join(SCENARIOS, `${s.name}.json`), 'utf8'));
      assert.deepEqual(file, s, s.name);
    }
  });

  test('one save boot keeps the snapshot; the rest boot from it and sort after it', () => {
    const [first, ...rest] = scenarios();
    assert.deepEqual(first.boot, { disc: 1, save: 'disc1-mds7st1', slot: 1 });
    assert.equal(first.snapshot, SNAPSHOT);
    for (const s of rest) {
      assert.deepEqual(s.boot, { from: SNAPSHOT }, s.name);
      assert.ok(first.name < s.name, s.name);
      assert.equal(s.snapshot, undefined, s.name);
    }
  });

  test('at most 8 metrics, each named by a check, a step or a location', () => {
    for (const s of scenarios()) {
      assert.ok(s.metrics.length <= 8, s.name);
      const named = new Set([...s.assert.map((a) => a.metric), ...s.input.map((i) => i.metric), ...Object.keys(s.memory), 'load_done'].filter(Boolean));
      for (const m of s.metrics) assert.ok(named.has(m), `${s.name}: ${m}`);
      for (const a of s.assert) {
        const mems = a.compare ? [a.compare.mem, a.compare.with] : a.near ? [a.near.x, a.near.y, a.near.toX, a.near.toY] : a.change ? [a.change.mem] : [a.expect.mem];
        for (const m of mems) assert.ok(s.memory[m], `${s.name}: ${m}`);
      }
    }
  });

  test('routes: every candidate is a target, and no step waits on a condition (a timeout would zero the values)', () => {
    const routes = scenarios().filter((sc) => sc.name.includes('-route-'));
    assert.equal(routes.length, ROUTES.length);
    assert.deepEqual([...new Set(ROUTES.flatMap((r) => r.target))].sort(), [...CANDIDATES].sort());
    for (const sc of routes) {
      for (const step of sc.input) assert.ok(step.buttons || (step.wait && 'frames' in step.wait), `${sc.name}: fixed steps only`);
      const last = sc.input.slice(-3);
      assert.deepEqual(last[1], { buttons: ['circle'], frames: 4 }, `${sc.name}: one Circle after the walk`);
      assert.ok(!sc.input.slice(0, -3).some((st) => st.buttons?.includes('circle')), `${sc.name}: no Circle while walking`);
      assert.deepEqual(sc.metrics.slice(0, 4), ['w0', 'w1', 'ptr0', 'ptr1'], sc.name);
    }
  });

  test('routes: each target gets the talk-rule sign, and axis brackets keep the other coordinate', () => {
    for (const r of ROUTES) {
      const sc = scenarios().find((x) => x.name === `save-boot-28h-route-${r.name}`);
      for (const k of r.target) {
        const n = sc.assert.find((a) => a.metric === `n${k}`).near;
        assert.deepEqual(n.range, [`talk${k}`, 'solid0'], r.name);
      }
      for (const a of sc.assert.filter((x) => /^a[xy]\d$/.test(x.metric ?? ''))) {
        assert.equal(a.near.plus, NEAR_AXIS);
        if (a.metric[1] === 'x') assert.deepEqual([a.near.y, a.near.toY], ['y0', 'y0'], a.metric);
        else assert.deepEqual([a.near.x, a.near.toX], ['x0', 'x0'], a.metric);
      }
    }
  });

  test('route window locations: window k at the entry + k * 0x30', () => {
    const m = routeMemory([5]);
    for (const k of [0, 1]) assert.equal(Number(m[`w${k}`].addr), entry('dialogState').address + k * WINDOW_STRIDE, `w${k}`);
    for (const k of [0, 1]) assert.equal(Number(m[`ptr${k}`].addr), entry('dialogPointer').address + k * WINDOW_STRIDE, `ptr${k}`);
    assert.equal(m.w1.addr, '0x800832d0', 'window 1 state as #224');
    assert.equal(m.ptr1.addr, '0x800832be', 'window 1 pointerEnabled as save-boot-19a');
    const e = entry('fieldTalkRange');
    assert.equal(Number(m.talk5.addr), e.address + 5 * e.stride);
  });

  test('positions come from the address table: element k at address + k * stride', () => {
    const m = memory();
    for (const [pre, n] of [['x', 'fieldX'], ['y', 'fieldY']]) {
      const e = entry(n);
      for (const k of [0, TALKER, ...CANDIDATES]) assert.equal(Number(m[`${pre}${k}`].addr), e.address + k * e.stride, `${pre}${k}`);
    }
    assert.equal(Number(m.map_cur.addr), entry('fieldId').address);
    assert.equal(Number(m.game_state.addr), entry('gameState').address);
  });
});
