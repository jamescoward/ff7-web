// Unit: #120's touch-action playthrough files are the generator's output, and
// the generator uses only touch-layer actions. No emulator.
// Original project code, GPL-2.0-or-later.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

import { NAMING_PLANS, SCENE_GW_TIMEOUT, SCENE_LIMIT, sceneScenarios, ROUTE_NUDGE, ROUTE_TIMEOUT, AXIS_BRACKETS, HINT_MODELS, WALK_PRESS, hintMemory, hintScenarios, STALL_SNAPSHOT, WALKS, runButtons, runLeg, PROBE_MEMORY, PROBE_MODELS, probeScenarios, stallSegment, tapLeg, DIAG_END, DIAG_LEGS, DIAG_MEMORY, DIAG_MODELS, DIAG_RUN, DRAG_DIRECTIONS, FIELD_ENTITY_STRIDE, GATEWAY_FIELDS, MEMORY, stretch2Diagnostic, WIDGET_COMMAND, WIDGET_NONE, WIDGET_TARGET, battleTurn, dragButtons, playthroughFiles, serialise, stretch1 } from './playthrough-scenarios.js';
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
    for (const [mem, field] of [['gw1_x1', 'x1'], ['gw1_y1', 'y1'], ['gw1_x2', 'x2'], ['gw1_y2', 'y2']]) {
      assert.equal(Number(DIAG_MEMORY[mem].addr), trig.address, mem);
      assert.equal(Number(DIAG_MEMORY[mem].deref), FIELD_GATEWAYS.offset + FIELD_GATEWAYS.size + GATEWAY_FIELDS[field], mem);
    }
  });

  test('#204 diagnostic: up-left 2400, up 200 (to #200\'s stall), 30 frames still; Interact taps; model signs against Cloud', () => {
    assert.deepEqual(DIAG_LEGS, [['up-left', 2400], ['up', 200]]);
    assert.ok(['models-y', 'models-line'].includes(DIAG_RUN), DIAG_RUN);
    const steps = stretch2Diagnostic().steps;
    const frames = steps.reduce((n, s) => n + (s.frames ?? s.wait?.frames ?? 0), 0);
    assert.equal(frames, 30 + 2400 + 200 + 30);
    const offered = new Set([...DRAG_DIRECTIONS.flatMap((d) => dragButtons(d)), ...FIELD_ACTIONS.map((a) => a.button)]);
    for (const s of steps) for (const b of s.buttons ?? []) assert.ok(offered.has(b), b);
    // The model positions are fieldX/fieldY elements 1..6 (the table's stride).
    const fx = ADDRESS_TABLE.entries.find((x) => x.name === 'fieldX');
    const fy = ADDRESS_TABLE.entries.find((x) => x.name === 'fieldY');
    assert.equal(fx.stride, FIELD_ENTITY_STRIDE);
    assert.equal(fy.stride, FIELD_ENTITY_STRIDE);
    assert.deepEqual(DIAG_MODELS, [1, 2, 3, 4, 5, 6]);
    for (const k of DIAG_MODELS) {
      assert.equal(Number(DIAG_MEMORY[`m${k}_x`].addr), fx.address + k * fx.stride, `m${k}_x`);
      assert.equal(Number(DIAG_MEMORY[`m${k}_y`].addr), fy.address + k * fy.stride, `m${k}_y`);
    }
    // Model and player positions are both raw, so their compares have no shift; gateway lines are field units (shift 12).
    for (const a of DIAG_END.assert) {
      if (!a.compare) continue;
      assert.ok(DIAG_MEMORY[a.compare.mem] && DIAG_MEMORY[a.compare.with], a.compare.mem);
      assert.equal(a.compare.shift, a.compare.mem.startsWith('gw') ? 12 : 0, a.compare.mem);
    }
    const known = new Set([...DIAG_END.assert.map((a) => a.metric).filter(Boolean), ...Object.keys(DIAG_MEMORY), ...Object.keys(MEMORY)]);
    for (const m of DIAG_END.metrics) assert.ok(known.has(m), m);
    assert.ok(DIAG_END.metrics.length <= 8);
  });
  test('stretch 2 probes (fresh budget, attempt 3, and the owner-hint attempt): touch-layer buttons only, boot from touch-md1-1, after touch-playthrough, <= 8 metrics', () => {
    const offered = new Set([...DRAG_DIRECTIONS.flatMap((d) => dragButtons(d)), ...FIELD_ACTIONS.map((a) => a.button)]);
    const stall = stallSegment();
    const frames = stall.steps.reduce((n, s) => n + (s.frames ?? s.wait?.frames ?? 0), 0);
    assert.equal(frames, 30 + 2400 + 200 + 30);
    assert.equal(tapLeg('up', 200).reduce((n, s) => n + s.frames, 0), 200);
    assert.equal(probeScenarios().length, 8);
    const probes = [...probeScenarios(), ...hintScenarios()];
    assert.equal(hintScenarios().length, 1 + AXIS_BRACKETS.length + WALKS.length);
    // s2i: the first keeps the stall as a snapshot; the rest boot from it and sort after it.
    const [keeper, ...fromStall] = hintScenarios();
    assert.equal(keeper.snapshot, STALL_SNAPSHOT);
    for (const p of fromStall) {
      assert.deepEqual(p.boot, { from: STALL_SNAPSHOT }, p.name);
      assert.ok(keeper.name < p.name, p.name);
    }
    for (const [, groups] of AXIS_BRACKETS) assert.ok(groups.reduce((n, [, ps]) => n + 2 * ps.length, 0) <= 8);
    // Run 5 routes: fixed steps only (no wait can time out), no Interact while dragging, one Interact press after.
    for (const p of fromStall.filter((x) => x.name.includes('-go-'))) {
      assert.ok(p.input.every((st) => st.mark || st.buttons || 'frames' in (st.wait ?? {})), p.name);
      const presses = p.input.filter((st) => st.buttons);
      const legs = WALKS.find(([r]) => p.name === `touch-s2i-go-${r}`)[1];
      assert.equal(presses.length, legs.length + 1, p.name);
      const interact = FIELD_ACTIONS.find((a) => a.id === 'interact').button;
      for (const st of presses.slice(0, -1)) assert.ok(!st.buttons.includes(interact), p.name);
      assert.deepEqual(presses.at(-1), { buttons: [interact], frames: WALK_PRESS }, p.name);
    }
    assert.deepEqual(runButtons('up').sort(), ['cross', 'up']);
    assert.ok(runLeg('up', 40).every((s) => s.buttons.includes('cross')));
    for (const b of runButtons('up-left')) offered.add(b);
    for (const b of runButtons('up-right')) offered.add(b);
    for (const p of probes) {
      assert.equal(p.tier, 2);
      assert.ok([{ from: 'touch-md1-1' }, { from: STALL_SNAPSHOT }].some((b) => b.from === p.boot.from), p.name);
      // Tier 2 runs scenarios in file-name order; touch-playthrough keeps touch-md1-1.
      assert.ok([`${p.name}.json`, 'touch-playthrough.json'].sort()[0] === 'touch-playthrough.json', p.name);
      assert.ok(p.metrics.length <= 8, p.name);
      const steps = [...p.input.flatMap((s) => (s.segment ? stall.steps : [s]))];
      for (const s of steps) {
        for (const b of [...(s.buttons ?? []), ...(s.wait?.press?.buttons ?? [])]) assert.ok(offered.has(b), `${p.name}: ${b}`);
        if (s.wait?.until) assert.ok(p.memory[s.wait.until.mem], `${p.name}: ${s.wait.until.mem}`);
      }
      const named = new Set([...p.assert.map((a) => a.metric).filter(Boolean), ...steps.map((s) => s.metric).filter(Boolean), ...Object.keys(p.memory)]);
      for (const m of p.metrics) assert.ok(named.has(m), `${p.name}: ${m}`);
      for (const a of p.assert) {
        const c = a.compare;
        if (c) {
          assert.ok(p.memory[c.mem] && p.memory[c.with], `${p.name}: ${c.mem}`);
          assert.equal(c.shift, c.mem.startsWith('gw') ? 12 : 0, `${p.name}: gateway ends are field units, positions raw`);
        }
      }
    }
    assert.deepEqual(PROBE_MODELS, [1, 2, 3, 4]);
    // Hint probes: windows and field-model arrays come from the address table (#224, #237), element k at address + k * stride.
    const hm = hintMemory();
    for (const [i, n] of ['dialogState', 'dialogState1', 'dialogState2', 'dialogState3'].entries()) {
      assert.equal(Number(hm[`w${i}`].addr), ADDRESS_TABLE.entries.find((x) => x.name === n).address, n);
    }
    for (const [pre, n] of [['x', 'fieldX'], ['y', 'fieldY'], ['talk', 'fieldTalkRange'], ['off', 'fieldTalkOff']]) {
      const e = ADDRESS_TABLE.entries.find((x) => x.name === n);
      for (const k of HINT_MODELS) assert.equal(Number(hm[`${pre}${k}`].addr), e.address + k * e.stride, `${pre}${k}`);
    }
    for (const p of hintScenarios()) {
      for (const a of p.assert.filter((x) => x.near)) {
        const n = a.near;
        if (n.range.length) assert.deepEqual(n.range, [`talk${n.toX.slice(1)}`, 'solid0'], p.name);
        // A per-axis bracket keeps Cloud's own other coordinate, so it measures one axis only.
        else assert.ok((n.toY === 'y0' && n.toX !== 'x0') || (n.toX === 'x0' && n.toY !== 'y0'), `${p.name}: ${a.metric}`);
      }
    }
    const dlg = ADDRESS_TABLE.entries.find((x) => x.name === 'dialogState');
    assert.equal(dlg.status, 'confirmed');
    assert.equal(Number(PROBE_MEMORY.dlg.addr), dlg.address);
  });
  test('stretch 2 scene probes (budget 4): route steps and touch-layer buttons only, boot from touch-md1-1, after touch-playthrough, <= 8 metrics', () => {
    const offered = new Set([...DRAG_DIRECTIONS.flatMap((d) => dragButtons(d)), ...FIELD_ACTIONS.map((a) => a.button)]);
    const probes = sceneScenarios();
    assert.deepEqual(probes.map((p) => p.name), ['touch-s2s-gw-c', 'touch-s2s-gw-sc', 'touch-s2s-m3-gw-sc']);
    // Attempt 1: each ends on a scene-driving gateway route to gateway 1 (md1_2), with a naming plan; one talks to model 3 first.
    for (const p of probes) {
      const routes = p.input.filter((s) => s.route).map((s) => s.route);
      const gw = routes.at(-1);
      assert.deepEqual(gw.to, { gateway: 1 }, p.name);
      assert.equal(gw.nudge, ROUTE_NUDGE, p.name);
      assert.equal(gw.timeout, SCENE_GW_TIMEOUT, p.name);
      assert.equal(gw.scene, SCENE_LIMIT, p.name);
      assert.deepEqual(gw.naming, NAMING_PLANS[p.name.endsWith('-sc') ? 'sc' : 'c'], p.name);
      for (const k of ['scenes', 'named', 'nleft', 'smode', 'evt']) assert.ok(p.metrics.includes(gw.report[k]), `${p.name}: ${k}`);
      if (p.name.includes('-m3-')) {
        assert.equal(routes.length, 2, p.name);
        assert.ok(routes[0].to.model === 3 && routes[0].talk > 0 && routes[0].timeout === ROUTE_TIMEOUT, p.name);
      } else assert.equal(routes.length, 1, p.name);
    }
    const files = new Set(playthroughFiles().map((f) => f.data.name));
    for (const p of probes) {
      assert.ok(files.has(p.name), p.name);
      assert.equal(p.tier, 2);
      assert.deepEqual(p.boot, { from: 'touch-md1-1' }, p.name);
      assert.ok([`${p.name}.json`, 'touch-playthrough.json'].sort()[0] === 'touch-playthrough.json', p.name);
      assert.ok(p.metrics.length <= 8, p.name);
      const named = new Set(Object.keys(p.memory));
      for (const s of p.input) {
        for (const b of s.buttons ?? []) assert.ok(offered.has(b), `${p.name}: ${b}`);
        if (s.route) {
          for (const m of [...Object.values(s.route.report), ...(s.route.leg ?? [])]) named.add(m);
        }
      }
      for (const m of p.metrics) assert.ok(named.has(m), `${p.name}: ${m}`);
      // Route metrics only: no position or coordinate memory is reported.
      for (const m of p.metrics) assert.ok(!/^[xy]\d/.test(m), `${p.name}: ${m}`);
    }
    // The hint probes and attempt 1's route probes they replace are no longer generated.
    for (const n of files) assert.ok(!n.startsWith('touch-s2i-'), n);
    for (const n of ['touch-s2r3-gw', 'touch-s2r3-m3-gw', 'touch-s2r-gw1', 'touch-s2r-m2', 'touch-s2r-m3', 'touch-s2r-m4', 'touch-s2r-m3-gw1', 'touch-s2r-talk-m2', 'touch-s2r-talk-m3', 'touch-s2r-talk-m4']) assert.ok(!files.has(n), n);
  });
});
