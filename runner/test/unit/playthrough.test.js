// Unit: #120's touch-action playthrough files are the generator's output, and
// the generator uses only touch-layer actions. No emulator.
// Original project code, GPL-2.0-or-later.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

import { DIAG_END, DIAG_LEGS, DIAG_MARKS, DIAG_MEMORY, DRAG_DIRECTIONS, GATEWAY_FIELDS, PROBE, MEMORY, stretch2Diagnostic, WIDGET_COMMAND, WIDGET_NONE, WIDGET_TARGET, battleTurn, dragButtons, playthroughFiles, serialise, stretch1 } from './playthrough-scenarios.js';
import { ADDRESS_TABLE, FIELD_GATEWAYS, BATTLE_WIDGET_COMMAND, BATTLE_WIDGET_NONE, BATTLE_WIDGET_TARGET } from '../../../semantic/addresses.js';
import { BATTLE_PANEL_ACTIONS, FIELD_ACTIONS } from '../../../semantic/controls.js';

describe('#120 touch playthrough', () => {
  test('committed files equal playthrough-scenarios.js (run node runner/test/unit/playthrough-scenarios.js to fix)', () => {
    for (const { file, data } of playthroughFiles()) {
      assert.equal(readFileSync(file, 'utf8'), serialise(data), path.basename(file));
    }
  });

  test('drag directions are field-drag.js output: one or two d-pad bits, never Cross (run)', () => {
    assert.deepEqual(dragButtons('up'), ['up']);
    assert.deepEqual(dragButtons('right'), ['right']);
    assert.deepEqual(dragButtons('up-left').sort(), ['left', 'up']);
    assert.deepEqual(dragButtons('down-right').sort(), ['down', 'right']);
    assert.throws(() => dragButtons('north'), RangeError);
  });

  test('every button the script holds is one a touch control offers', () => {
    const offered = new Set([
      ...DRAG_DIRECTIONS.flatMap((d) => dragButtons(d)),
      ...FIELD_ACTIONS.map((a) => a.button),
      ...Object.values(BATTLE_PANEL_ACTIONS).map((a) => a.button),
    ]);
    const held = [];
    for (const step of stretch1().steps) {
      if (step.buttons) held.push(...step.buttons);
      if (step.wait?.press) held.push(...step.wait.press.buttons);
    }
    assert.ok(held.length > 0);
    for (const b of held) assert.ok(offered.has(b), b);
  });

  test('a battle turn is the panel plan, select, then Confirm, each followed by its widget wait', () => {
    const t = battleTurn(0, 'm');
    assert.equal(t[0].metric, 'm');
    assert.deepEqual(t[0].wait.until, { mem: 'widget', equals: 1 });
    const presses = t.filter((s) => s.buttons).map((s) => s.buttons[0]);
    assert.deepEqual(presses, [BATTLE_PANEL_ACTIONS.select.button, BATTLE_PANEL_ACTIONS.confirm.button]);
    assert.deepEqual(t.at(-1).wait.until, { mem: 'widget', equals: 0xffff });
    // A plan to a lower row adds its cursor presses before select.
    assert.ok(battleTurn(1).filter((s) => s.buttons).length > 2);
  });

  test('widget waits use the semantic/ battleMenuWidget values, read as u16', () => {
    assert.equal(MEMORY.widget.type, 'u16');
    assert.equal(WIDGET_NONE, BATTLE_WIDGET_NONE & 0xffff);
    assert.equal(WIDGET_NONE, 0xffff);
    assert.equal(WIDGET_TARGET, BATTLE_WIDGET_TARGET & 0xffff);
    assert.equal(WIDGET_COMMAND, BATTLE_WIDGET_COMMAND & 0xffff);
    const values = new Set();
    const walk = (steps) => {
      for (const s of steps) if (s.wait?.until?.mem === 'widget') values.add(s.wait.until.equals);
    };
    walk(stretch1().steps);
    walk(battleTurn(0));
    assert.deepEqual([...values].sort((a, b) => a - b), [WIDGET_TARGET, WIDGET_COMMAND, WIDGET_NONE].sort((a, b) => a - b));
  });

  test('memory addresses match the semantic address table', () => {
    const names = { game_state: 'gameState', map_cur: 'fieldId', loading: 'fieldLoading', widget: 'battleMenuWidget', row0: 'battleCommandRow0', hp0: 'partyHp0' };
    for (const [mem, entry] of Object.entries(names)) {
      const e = ADDRESS_TABLE.entries.find((x) => x.name === entry);
      assert.ok(e, entry);
      assert.equal(Number(MEMORY[mem].addr), e.address, mem);
      assert.equal(e.status, 'confirmed', entry);
    }
  });
  test('diagnostic: player memory matches the semantic address table; gateway derefs use fieldTriggers and FIELD_GATEWAYS', () => {
    for (const [mem, entry] of Object.entries({ pos_x: 'fieldX', pos_y: 'fieldY' })) {
      const e = ADDRESS_TABLE.entries.find((x) => x.name === entry);
      assert.ok(e, entry);
      assert.equal(Number(DIAG_MEMORY[mem].addr), e.address, mem);
      assert.equal(e.status, 'confirmed', entry);
    }
    const trig = ADDRESS_TABLE.entries.find((x) => x.name === 'fieldTriggers');
    assert.equal(trig.status, 'confirmed');
    for (const [mem, field] of [['gw1_x1', 'x1'], ['gw1_y1', 'y1'], ['gw1_x2', 'x2']]) {
      assert.equal(Number(DIAG_MEMORY[mem].addr), trig.address, mem);
      assert.equal(Number(DIAG_MEMORY[mem].deref), FIELD_GATEWAYS.offset + FIELD_GATEWAYS.size + GATEWAY_FIELDS[field], mem);
    }
  });

  test('#202 diagnostic: up-left 2400 (attempt 3), up 200 (past #200\'s stall), then a 600-frame probe; Interact taps; marks add no frames', () => {
    assert.deepEqual(DIAG_LEGS, [['up-left', 2400], ['up', 200], [PROBE, 600]]);
    assert.ok(['up-right', 'up-left'].includes(PROBE), PROBE);
    const steps = stretch2Diagnostic().steps;
    const frames = steps.reduce((n, s) => n + (s.frames ?? s.wait?.frames ?? 0), 0);
    assert.equal(frames, 30 + 2400 + 200 + 600 + 30);
    const marks = steps.filter((s) => s.mark).map((s) => s.mark);
    assert.deepEqual(marks, DIAG_MARKS.map((m) => `p${m}`));
    const offered = new Set([...DRAG_DIRECTIONS.flatMap((d) => dragButtons(d)), ...FIELD_ACTIONS.map((a) => a.button)]);
    for (const s of steps) for (const b of s.buttons ?? []) assert.ok(offered.has(b), b);
    // The probe's presses come after mark p0 and hold exactly the probe's drag bits (plus Interact).
    const probe = steps.slice(steps.findIndex((s) => s.mark === 'p0')).filter((s) => s.buttons);
    assert.equal(probe.length, 600 / 20 * 2);
    const interact = FIELD_ACTIONS.find((a) => a.id === 'interact').button;
    for (const s of probe) assert.deepEqual(s.buttons.filter((b) => b !== interact).sort(), dragButtons(PROBE).sort());
    // Every change check names a mark the script reaches, and every metric is a check or a memory name.
    for (const a of DIAG_END.assert) if (a.change) assert.ok(marks.includes(a.change.since), a.change.since);
    for (const a of DIAG_END.assert) if (a.compare) assert.ok(DIAG_MEMORY[a.compare.mem] && DIAG_MEMORY[a.compare.with], a.compare.mem);
    const known = new Set([...DIAG_END.assert.map((a) => a.metric).filter(Boolean), ...Object.keys(DIAG_MEMORY), ...Object.keys(MEMORY)]);
    for (const m of DIAG_END.metrics) assert.ok(known.has(m), m);
    assert.ok(DIAG_END.metrics.length <= 8);
  });
});
