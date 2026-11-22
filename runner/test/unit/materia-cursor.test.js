// #244: the Materia-screen cursor search scenarios are generated (the move to
// Materia is the menu planner's output), and the save they load holds what
// the scenario descriptions say.
// Original project code, GPL-2.0-or-later.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MENU_OVERLAY_MATERIA } from '../../../semantic/addresses.js';
import {
  CANDIDATES, COLUMN_VALUES, LIST_DOWNS, LIST_PAGE, MATERIA, MATERIA_ROW, OVERLAY_MATERIA, OVERLAY_RANGE, PAGE_SIZES, ROW_VALUES, SAVE, SCROLL_DOWNS, SLOT_STEPS,
  materiaCursorScenarios, offsetAfter,
} from './materia-cursor-scenarios.js';
import { SCENARIO_DIR, serialise } from './planner-scenarios.js';
import { loadScenario } from '../../scenario.js';
import { TRACK_WINDOWS } from '../../format2.js';
import { descriptionProblems } from '../../savegen/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAVES = path.resolve(HERE, '../../../harness/saves');

describe('#244 materia cursor scenarios', () => {
  test('committed files equal materia-cursor-scenarios.js (run node runner/test/unit/materia-cursor-scenarios.js to fix)', () => {
    for (const s of materiaCursorScenarios()) {
      const file = path.join(SCENARIO_DIR, `${s.name}.json`);
      assert.equal(readFileSync(file, 'utf8'), serialise(s), file);
    }
  });

  test('every scenario loads as a tier 2 scenario with at most 8 metrics', () => {
    for (const s of materiaCursorScenarios()) {
      loadScenario(JSON.parse(readFileSync(path.join(SCENARIO_DIR, `${s.name}.json`), 'utf8')), { allowTier2: true });
      assert.ok(s.metrics.length <= 8, s.name);
    }
  });

  test('the overlay waited for is the confirmed Materia id, and the searches lie in the overlay window', () => {
    assert.equal(OVERLAY_MATERIA, MENU_OVERLAY_MATERIA);
    assert.equal(MATERIA_ROW, 2);
    const w = TRACK_WINDOWS.find((x) => x.name === 'overlay');
    assert.equal(OVERLAY_RANGE.from - 0x80000000, w.from);
    assert.equal(OVERLAY_RANGE.bytes, w.bytes);
    for (const s of materiaCursorScenarios()) {
      for (const a of s.assert.filter((x) => x.track)) {
        assert.equal(Number(a.track.from), OVERLAY_RANGE.from, s.name);
        assert.equal(a.track.bytes, OVERLAY_RANGE.bytes, s.name);
      }
    }
  });

  test('24a marks follow Right, Left, Right, Left, Down, Up; the column uses the first five marks', () => {
    const [slot] = materiaCursorScenarios();
    const after = slot.input.slice(slot.input.findIndex((s) => s.mark === 'c0'));
    assert.deepEqual(after.filter((s) => s.buttons).map((s) => s.buttons[0]), [...SLOT_STEPS]);
    const [col, row] = slot.assert;
    assert.deepEqual(col.track.marks, ['c0', 'c1', 'c2', 'c3', 'c4']);
    assert.deepEqual(col.track.values, [...COLUMN_VALUES]);
    assert.equal(row.track.marks.length, SLOT_STEPS.length + 1);
    assert.deepEqual(row.track.values, [...ROW_VALUES]);
  });

  test('24c offsets do not depend on whether the list holds 12 or 200 entries', () => {
    for (const P of PAGE_SIZES) {
      const vals = SCROLL_DOWNS.map((d) => offsetAfter(d, P));
      assert.deepEqual(vals, SCROLL_DOWNS.map((d) => offsetAfter(d, P, 200)), `page ${P}`);
      assert.ok(new Set(vals).size >= 2, `page ${P} is not constant`);
    }
  });

  test('the save holds Cloud alone and materia 49 in inventory slots 0-11', () => {
    const save = JSON.parse(readFileSync(path.join(SAVES, `${SAVE}.json`), 'utf8'));
    assert.deepEqual(descriptionProblems(save), []);
    assert.deepEqual(save.party, [0, 255, 255]);
    assert.ok(save.characters.some((c) => c.record === 0));
    assert.deepEqual(save.materia, MATERIA.map((m) => ({ ...m })));
  });

  test('the candidates sit as MenuTables do (0x12 bytes; rowOffset +0x02, column +0x0A, row +0x0B)', () => {
    const slotTable = CANDIDATES.row - 0x0b;
    const listTable = CANDIDATES.listRow - 0x0b;
    assert.equal(CANDIDATES.column, slotTable + 0x0a);
    assert.equal(listTable - slotTable, 2 * 0x12);
    assert.equal(CANDIDATES.listOffset, listTable + 0x02);
  });

  test('25b takes the last filled entry: row page-1 plus offset, within the 12 entries', () => {
    const offset = LIST_DOWNS - (LIST_PAGE - 1);
    assert.equal(LIST_PAGE - 1 + offset, LIST_DOWNS);
    assert.equal(LIST_DOWNS, MATERIA.length - 1);
    const [, , , slot, list] = materiaCursorScenarios();
    assert.equal(slot.name, 'save-boot-25a-materia-slot-cursor');
    const inList = list.input.slice(list.input.findIndex((s) => s.wait?.until?.mem === 'l_row'));
    assert.equal(inList.filter((s) => s.buttons?.[0] === 'down').length, LIST_DOWNS);
  });
});
