// #168 third budget: checks on the generated choice-cursor scenarios
// (runner/test/unit/choice-cursor-scenarios.js).
// Original project code, GPL-2.0-or-later.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ADDRESS_TABLE } from '../../../semantic/addresses.js';
import { AXIS, CANDIDATES, SNAPSHOT, SWEEP, TALKER, WINDOW_STRIDE, memory, scenarios, sweepMemory } from './choice-cursor-scenarios.js';

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

  test('every talkable candidate and the talker get both axis brackets', () => {
    const metrics = new Set(scenarios().flatMap((s) => s.metrics));
    for (const k of [...CANDIDATES, TALKER]) {
      for (const ax of ['x', 'y']) for (const p of AXIS) assert.ok(metrics.has(`a${ax}${k}_${p / 512}`), `a${ax}${k}_${p / 512}`);
    }
    const ax = scenarios().find((s) => s.name === 'save-boot-28f-axis-4');
    const bx = ax.assert.find((a) => a.metric === 'ax4_1').near;
    assert.deepEqual([bx.y, bx.toY, bx.toX], ['y0', 'y0', 'x4'], 'the x bracket keeps the player\'s own PosY');
    const by = ax.assert.find((a) => a.metric === 'ay4_1').near;
    assert.deepEqual([by.x, by.toX, by.toY], ['x0', 'x0', 'y4'], 'the y bracket keeps the player\'s own PosX');
  });

  test('sweeps: 8 directions, each walks with Circle edges until window 1 opens, then waits for state 6', () => {
    const sweeps = scenarios().filter((s) => s.name.includes('-talk-'));
    assert.equal(sweeps.length, 8);
    assert.deepEqual(sweeps.map((s) => s.input[0].wait.press.buttons), Object.values(SWEEP).map((b) => [...b, 'circle']));
    for (const s of sweeps) {
      const [walk, done] = s.input;
      assert.deepEqual(walk.wait.until, { mem: 'w1', differs: 0 }, s.name);
      assert.ok(walk.wait.press.hold < walk.wait.press.every, s.name);
      assert.deepEqual(done.wait.until, { mem: 'w1', equals: 6 }, s.name);
      assert.ok(s.metrics.includes('ptr1'), s.name);
    }
  });

  test('sweep window locations: window k at the entry + k * 0x30', () => {
    const m = sweepMemory();
    for (const k of [0, 1, 2, 3]) assert.equal(Number(m[`w${k}`].addr), entry('dialogState').address + k * WINDOW_STRIDE, `w${k}`);
    for (const k of [0, 1]) assert.equal(Number(m[`ptr${k}`].addr), entry('dialogPointer').address + k * WINDOW_STRIDE, `ptr${k}`);
    assert.equal(m.w1.addr, '0x800832d0', 'window 1 state as #224');
    assert.equal(m.ptr1.addr, '0x800832be', 'window 1 pointerEnabled as save-boot-19a');
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
