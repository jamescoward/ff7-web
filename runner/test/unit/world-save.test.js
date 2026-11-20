// #226: the world-map save scenarios are generated, load as tier 2, move to
// Save with the planner's plan, and use addresses the semantic layer names.
// Original project code, GPL-2.0-or-later.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ADDRESS_TABLE } from '../../../semantic/addresses.js';
import { MENUS } from '../../../semantic/menus.js';
import { loadScenario } from '../../scenario.js';
import { SAVE, SAVE_ROW, SCENARIOS, savePlan } from './world-save-scenarios.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(HERE, '../../../harness/scenarios');
const SAVES = path.resolve(HERE, '../../../harness/saves');
const byName = (n) => ADDRESS_TABLE.entries.find((e) => e.name === n);
const SAVES_SC = SCENARIOS.filter((s) => s.assert.some((a) => 'card' in a));

describe('#226 world-map save scenarios', () => {
  test('committed files equal world-save-scenarios.js (run node runner/test/unit/world-save-scenarios.js to fix)', () => {
    for (const s of SCENARIOS) {
      const file = path.join(DIR, `${s.name}.json`);
      assert.equal(readFileSync(file, 'utf8'), `${JSON.stringify(s, null, 2)}\n`, file);
    }
  });

  test('every scenario loads as a tier 2 scenario with at most 8 metrics', () => {
    for (const s of SCENARIOS) {
      loadScenario(JSON.parse(readFileSync(path.join(DIR, `${s.name}.json`), 'utf8')), { allowTier2: true });
      assert.ok(s.metrics.length <= 8, s.name);
    }
  });

  test('the save scenarios (20a, 20b) end in a card check for a world map save; the diagnostic (20c) has none', () => {
    assert.deepEqual(SAVES_SC.map((s) => s.name), ['save-boot-20a-world-save-circle', 'save-boot-20b-world-save-file2']);
    for (const s of SAVES_SC) {
      const sc = loadScenario(s, { allowTier2: true });
      assert.equal(sc.asserts[0].kind, 'card');
      assert.equal(sc.asserts[0].module, 3);
    }
  });

  test('every scenario closes the entry window as save-boot-7-world-kalm does before any Triangle', () => {
    const seven = JSON.parse(readFileSync(path.join(DIR, 'save-boot-7-world-kalm.json'), 'utf8')).input;
    const closeOf = (input) => input.slice(1, 7).map((x) => JSON.stringify(x));
    for (const s of SCENARIOS) {
      assert.deepEqual(closeOf(s.input), closeOf(seven), s.name);
      const tri = s.input.findIndex((x) => x.buttons?.includes('triangle') || x.wait?.press?.buttons?.includes('triangle'));
      const shut = s.input.findIndex((x) => x.wait?.until?.mem === 'win0' && x.wait.until.equals === 0);
      assert.ok(shut > 0 && tri > shut, s.name);
    }
  });

  test('the save boots on the world map', () => {
    const d = JSON.parse(readFileSync(path.join(SAVES, `${SAVE}.json`), 'utf8'));
    assert.equal(d.module.state, 3);
  });

  test('Save is the main menu\'s row 9, and the planner reaches it with one Up (the menu wraps)', () => {
    assert.equal(MENUS.main.labels[SAVE_ROW], 'Save');
    const plan = savePlan();
    assert.deepEqual(plan.steps.map((s) => [s.button, s.expect]), [['up', 9]]);
    for (const s of SAVES_SC) {
      const ups = s.input.filter((x) => x.buttons?.includes('up'));
      assert.equal(ups.length, 1, s.name);
      assert.ok(s.input.some((x) => x.wait?.until?.mem === 'row0' && x.wait.until.equals === 9), s.name);
    }
  });

  test('memory addresses agree with the semantic layer', () => {
    const m = SCENARIOS[0].memory;
    assert.equal(Number(m.game_state.addr), byName('gameState').address);
    assert.equal(Number(m.win0.addr), byName('dialogState').address);
    assert.equal(Number(m.row0.addr), byName('menuCursor').address);
  });
});
