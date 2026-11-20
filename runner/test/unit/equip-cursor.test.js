// #216: the Equip-cursor Tier 2 scenarios are generated (the move to Equip is
// the menu planner's output), search only bounded ranges, and the save they
// load holds what the descriptions say.
// Original project code, GPL-2.0-or-later.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadScenario } from '../../scenario.js';
import { EQUIP_ROW, ITEMS, MAIN_RANGE, OVERLAY_RANGE, PAGE_SIZES, SAVE, SCROLL_DOWNS, UP_DOWN, equipCursorScenarios, offsetAfter } from './equip-cursor-scenarios.js';
import { SCENARIO_DIR, serialise } from './planner-scenarios.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAVES = path.resolve(HERE, '../../../harness/saves');

describe('#216 Equip-cursor scenarios', () => {
  test('committed files equal equip-cursor-scenarios.js (run node runner/test/unit/equip-cursor-scenarios.js to fix)', () => {
    for (const s of equipCursorScenarios()) {
      const file = path.join(SCENARIO_DIR, `${s.name}.json`);
      assert.equal(readFileSync(file, 'utf8'), serialise(s), file);
    }
  });

  test('every scenario loads as tier 2 with at most 8 metrics', () => {
    for (const s of equipCursorScenarios()) {
      const sc = loadScenario(JSON.parse(readFileSync(path.join(SCENARIO_DIR, `${s.name}.json`), 'utf8')), { allowTier2: true });
      assert.ok(sc.metrics.length <= 8, s.name);
      assert.ok(sc.asserts.every((a) => a.kind === 'track'), s.name);
    }
  });

  test('the ranges stay in main RAM: the overlay area to its end, and main data', () => {
    assert.equal(OVERLAY_RANGE.from + OVERLAY_RANGE.bytes, 0x80200000);
    assert.ok(MAIN_RANGE.from <= 0x80062dd4 && 0x8009a0c8 < MAIN_RANGE.from + MAIN_RANGE.bytes);
  });

  test('17a and 17b mark around Down, Down, Up, Up and search for 0, 1, 2, 1, 0', () => {
    const [slot, list] = equipCursorScenarios();
    assert.equal(EQUIP_ROW, 3);
    const presses = (s) => s.input.filter((x) => x.buttons).map((x) => x.buttons[0]);
    assert.deepEqual(presses(slot), ['down', 'down', 'down', ...UP_DOWN.presses]);
    assert.deepEqual(presses(list), ['down', 'down', 'down', 'circle', ...UP_DOWN.presses]);
    for (const s of [slot, list]) for (const a of s.assert) assert.deepEqual(a.track.values, [0, 1, 2, 1, 0]);
  });

  test('17c: the offset hypotheses, one per page size', () => {
    assert.deepEqual(SCROLL_DOWNS.map((d) => offsetAfter(d, 8)), [0, 0, 0, 0, 0, 1, 2, 3]);
    assert.deepEqual(SCROLL_DOWNS.map((d) => offsetAfter(d, 6)), [0, 0, 0, 1, 2, 3, 4, 5]);
    assert.equal(offsetAfter(20, 8), ITEMS.length - 8, 'clamped at the last page');
    const scroll = equipCursorScenarios()[2];
    assert.deepEqual(scroll.assert.map((a) => a.track.values), PAGE_SIZES.map((P) => SCROLL_DOWNS.map((d) => offsetAfter(d, P))));
    assert.equal(scroll.input.filter((x) => x.buttons?.[0] === 'down').length, 3 + SCROLL_DOWNS.at(-1));
  });

  test('the save: Cloud alone, weapon 0, spare weapons 1-12 in slots 0-11', () => {
    const save = JSON.parse(readFileSync(path.join(SAVES, `${SAVE}.json`), 'utf8'));
    assert.deepEqual(save.party, [0, 255, 255]);
    assert.equal(save.equipment[0].weapon, 0);
    assert.deepEqual(save.items, ITEMS);
  });
});
