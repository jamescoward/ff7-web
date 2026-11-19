// #168: the committed choice-cursor diagnostic scenarios equal their
// generator's output, and each loads as a Tier 2 scenario.
// Original project code, GPL-2.0-or-later.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { loadScenario } from '../../scenario.js';
import { choiceFiles } from './choice-scenarios.js';
import { serialise } from './planner-scenarios.js';

test('committed #168 scenarios equal choice-scenarios.js', () => {
  for (const { file, data } of choiceFiles()) assert.equal(readFileSync(file, 'utf8'), serialise(data), file);
});

test('every #168 scenario loads, with at most 8 metrics', () => {
  for (const { file, data } of choiceFiles()) {
    const sc = loadScenario(JSON.parse(readFileSync(file, 'utf8')), { file, allowTier2: true });
    assert.ok(data.metrics.length <= 8, file);
    assert.equal(sc.name, data.name);
  }
});
