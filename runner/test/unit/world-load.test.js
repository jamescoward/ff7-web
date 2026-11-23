// #228: the world-map load-back scenario is generated, loads as tier 2, plays
// save-boot-20a's script unchanged before one restart, and then loads as
// save-boot-7-world-kalm does. Original project code, GPL-2.0-or-later.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadScenario } from '../../scenario.js';
import { LOCATION, SAVE_SCENARIO, SCENARIOS, unnamed } from './world-load-scenarios.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(HERE, '../../../harness/scenarios');
const read = (n) => JSON.parse(readFileSync(path.join(DIR, `${n}.json`), 'utf8'));
const [doc] = SCENARIOS;

describe('#228 world-map load-back scenario', () => {
  test('the committed file equals world-load-scenarios.js (run node runner/test/unit/world-load-scenarios.js to fix)', () => {
    const file = path.join(DIR, `${doc.name}.json`);
    assert.equal(readFileSync(file, 'utf8'), `${JSON.stringify(doc, null, 2)}\n`, file);
  });

  test('it loads as a tier 2 scenario with at most 8 metrics and one restart', () => {
    const sc = loadScenario(read(doc.name), { allowTier2: true });
    assert.ok(doc.metrics.length <= 8);
    assert.equal(sc.steps.filter((s) => s.kind === 'restart').length, 1);
  });

  test('before the restart it plays the passing save scenario unchanged (bar wait metric names), from the same boot', () => {
    const save = read(SAVE_SCENARIO);
    const at = doc.input.findIndex((x) => x.restart !== undefined);
    assert.deepEqual(doc.input.slice(0, at), unnamed(save.input));
    assert.ok(doc.input.slice(0, at).every((x) => x.metric === undefined));
    assert.deepEqual(doc.boot, save.boot);
    for (const [k, v] of Object.entries(save.memory)) assert.deepEqual(doc.memory[k], v, k);
  });

  test('after the restart it loads and checks as save-boot-7-world-kalm does', () => {
    const seven = read('save-boot-7-world-kalm');
    const at = doc.input.findIndex((x) => x.restart !== undefined);
    const after = doc.input.slice(at + 1);
    assert.deepEqual(after[0].wait, seven.input[0].wait);
    assert.deepEqual(after.slice(1, 8), seven.input.slice(1, 8));
    assert.deepEqual(after.slice(-3), seven.input.slice(-3));
    for (const k of ['game_state', 'map_cur', 'pos_x', 'win0']) assert.equal(doc.memory[k].addr, seven.memory[k].addr, k);
    const map = doc.assert.find((a) => a.expect?.mem === 'map_cur');
    assert.equal(map.expect.equals, LOCATION);
    assert.deepEqual(seven.assert.find((a) => a.expect?.mem === 'map_cur').expect.equals, LOCATION);
  });

  test('the card check reports whether the savemap bytes changed', () => {
    const card = doc.assert.find((a) => 'card' in a);
    assert.equal(card.card.module, 3);
    assert.equal(card.card.report.savemap, 'c_data');
    assert.ok(doc.metrics.includes('c_data') && doc.metrics.includes('card_ok'));
  });
});
