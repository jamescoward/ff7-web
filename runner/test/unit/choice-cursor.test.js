// #168 third budget: checks on the generated choice-cursor scenarios
// (runner/test/unit/choice-cursor-scenarios.js).
// Original project code, GPL-2.0-or-later.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ADDRESS_TABLE } from '../../../semantic/addresses.js';
import { CANDIDATES, SNAPSHOT, STEER_DIRS, TALKER, memory, scenarios } from './choice-cursor-scenarios.js';

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
    assert.deepEqual(rest.filter((s) => s.name.includes('-steer-') && s.input.some((i) => i.buttons)).map((s) => s.input[1].buttons[0]), STEER_DIRS);
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

  test('every talkable candidate and the talker get a side and a distance', () => {
    const metrics = new Set(scenarios().flatMap((s) => s.metrics));
    for (const k of [...CANDIDATES, TALKER]) {
      for (const m of [`sx${k}`, `sy${k}`, `d${k}_256`, `d${k}_1024`]) assert.ok(metrics.has(m), m);
    }
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
