// #120: the headless touch-action playthrough, generated from the touch layer
// so the committed scripts are its output, not hand-written:
//   - drag-to-walk directions come from web/js/field-drag.js (a drag of
//     DRAG_PX CSS pixels, short of a run, gives one direction's pad bits);
//   - field buttons from FIELD_ACTIONS (semantic/controls.js);
//   - battle turns from the battle panel's plan (semantic/battle-panel.js,
//     #116) and BATTLE_PANEL_ACTIONS.
// playthrough.test.js checks the committed files equal this.
//
//   node runner/test/unit/playthrough-scenarios.js    rewrite the files
//
// Only one Tier 2 slot was free (63 of 64 used), so the playthrough is ONE
// scenario that grows stretch by stretch: each stretch is a segment, and the
// scenario runs them in order. Every stretch ends on a wait.until (mode or
// field ID); a timeout fails the scenario, so earlier stretches stay checked.
//
// Original project code, GPL-2.0-or-later.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADDRESS_TABLE, DIALOG_STATE_ENTRIES, BATTLE_WIDGET_COMMAND, BATTLE_WIDGET_NONE, BATTLE_WIDGET_TARGET, FIELD_GATEWAYS } from '../../../semantic/addresses.js';
import { battlePanelPlan } from '../../../semantic/battle-panel.js';
import { BATTLE_PANEL_ACTIONS, FIELD_ACTIONS } from '../../../semantic/controls.js';
import { createFieldDrag } from '../../../web/js/field-drag.js';
import { padNames } from '../../../web/js/pad.js';
import { SCENARIO_DIR, scriptFromPlan, serialise } from './planner-scenarios.js';

export { SCENARIO_DIR, serialise };
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SEGMENT_DIR = path.resolve(HERE, '../../../harness/scenarios/segments');

/** A drag this long (CSS px) walks; RUN_DISTANCE (64) would add Cross (run). */
export const DRAG_PX = 40;
const DIAG = DRAG_PX / Math.SQRT2;
/** Screen offsets (y grows downwards) for each walking direction. */
const DRAG_VECTORS = Object.freeze({
  up: [0, -DRAG_PX],
  'up-left': [-DIAG, -DIAG],
  left: [-DRAG_PX, 0],
  'down-left': [-DIAG, DIAG],
  down: [0, DRAG_PX],
  'down-right': [DIAG, DIAG],
  right: [DRAG_PX, 0],
  'up-right': [DIAG, -DIAG],
});

/** Every drag direction the generator may use. */
export const DRAG_DIRECTIONS = Object.freeze(Object.keys(DRAG_VECTORS));

/** The pad buttons field-drag.js holds for a drag in direction `dir` (lower-case PAD names). */
export function dragButtons(dir) {
  const v = DRAG_VECTORS[dir];
  if (!v) throw new RangeError(`unknown drag direction ${dir}`);
  const drag = createFieldDrag();
  const mask = drag.move(v[0], v[1], 0);
  return padNames(mask).map((n) => n.toLowerCase());
}

const fieldButton = (id) => {
  const a = FIELD_ACTIONS.find((x) => x.id === id);
  if (!a) throw new RangeError(`no field action ${id}`);
  return a.button;
};

const DECOMP = 'Xeeynamo/ff7-decomp@9411173 (reference only, no code)';
const DECOMP_BATTLE = 'Xeeynamo/ff7-decomp@d4db3de3c3aaf61269e048cf3f6a458996290de0 (reference only, no code)';
export const MEMORY = Object.freeze({
  game_state: {
    addr: '0x8009c560',
    type: 'u16',
    description: `gameState: g_GameState (s16 as u16; confirmed #76): field 1, battle 2. ${DECOMP} config/symbols.main.us.txt`,
  },
  map_cur: {
    addr: '0x8009a05c',
    type: 'u16',
    description: `fieldId: g_FieldCurrentMap (s16 as u16; confirmed #77): md1stin 0x74, md1_1 0x75. ${DECOMP} config/symbols.main.us.txt, include/game.h`,
  },
  loading: {
    addr: '0x800965e8',
    type: 'u16',
    description: `fieldLoading: g_IsFieldLoading (s16 as u16; confirmed #77): 2 in a settled field. ${DECOMP} config/symbols.main.us.txt`,
  },
  widget: {
    addr: '0x800f3896',
    type: 'u16',
    description: `battleMenuWidget: g_BattleMenuModalWidgetId (s16 as u16; confirmed #110): 0xffff none, 1 the command menu, 0 target selection. ${DECOMP_BATTLE} config/symbols.battle.txt, src/battle/battle3.c`,
  },
  row0: {
    addr: '0x800f90bf',
    type: 'u8',
    description: `battleCommandRow0: D_800F90B4[0].table00.row (confirmed #110): party slot 0's command cursor row, 0 = Attack. ${DECOMP_BATTLE} src/battle/battle_private.h, include/game.h MenuTable`,
  },
  hp0: {
    addr: '0x8009d85c',
    type: 'u16',
    description: `partyHp0: g_ActiveCharacters[0].hp (s16 as u16; confirmed #78): Cloud's current HP. ${DECOMP} config/symbols.main.us.txt, include/game.h ActiveCharacterData`,
  },
});

/** A signed battleMenuWidget value from semantic/ as the u16 the `widget` entry reads. */
export const widgetU16 = (v) => v & 0xffff;
export const WIDGET_NONE = widgetU16(BATTLE_WIDGET_NONE);
export const WIDGET_TARGET = widgetU16(BATTLE_WIDGET_TARGET);
export const WIDGET_COMMAND = widgetU16(BATTLE_WIDGET_COMMAND);
const HOLD = 4;
const SETTLE = 30;
/** Frames between the command menu opening and the first tap (as reactor-mode-4f). */
export const MENU_SETTLE = 30;

/**
 * Walk with a drag in `dir` while tapping Interact, until `until` holds.
 * format 2 holds one set of buttons per press, so the drag and the tap are
 * held together for `hold` of every `every` frames (a re-landed drag gives the
 * same mask: field-drag.js keeps no state across a release).
 */
function walk(dir, until, timeout, { interact = false, every = 60, hold = 59, metric } = {}) {
  const buttons = [...dragButtons(dir), ...(interact ? [fieldButton('interact')] : [])];
  const w = { wait: { until, timeout, press: { buttons, every, hold } } };
  if (metric) w.metric = metric;
  return w;
}

/**
 * One battle turn of party slot 0 with the battle panel (#116): wait for the
 * command menu, check the cursor is where the plan starts (the executor's
 * `start` check), run the plan to row `to` (scriptFromPlan: each press waits
 * for the planned row, as the executor does), tap the row (select), then in
 * target selection tap Confirm. Each wait ends on the widget value #110
 * confirmed; a timeout fails the scenario.
 */
export function battleTurn(to, metric, { target, done, menuTimeout = 1800 } = {}) {
  const from = 0; // the command cursor at menu open (#110: reads 0 in the first guard battle)
  const plan = battlePanelPlan(from, to);
  return [
    { wait: { until: { mem: 'widget', equals: WIDGET_COMMAND }, timeout: menuTimeout }, ...(metric ? { metric } : {}) },
    // A tap can't come the frame the panel appears; reactor-mode-4f (#110) also
    // left the menu 30 frames before its first press.
    { wait: { frames: MENU_SETTLE } },
    { wait: { until: { mem: 'row0', equals: from }, timeout: SETTLE } },
    ...scriptFromPlan(plan, 'row0'),
    { buttons: [BATTLE_PANEL_ACTIONS.select.button], frames: HOLD },
    { wait: { until: { mem: 'widget', equals: WIDGET_TARGET }, timeout: SETTLE }, ...(target ? { metric: target } : {}) },
    { buttons: [BATTLE_PANEL_ACTIONS.confirm.button], frames: HOLD },
    { wait: { until: { mem: 'widget', equals: WIDGET_NONE }, timeout: SETTLE }, ...(done ? { metric: done } : {}) },
  ];
}

/**
 * Stretch 1: reactor-entrance → the first guard battle → md1_1.
 * - Drag up with Interact taps until battle (#76: Up reached it in 839 frames).
 * - Battle: wait for BattleMenuInit (widget none), then two Attack turns with
 *   the battle panel (two guards, and one Attack fells at most one, so the
 *   battle lasts at least two turns). Then, until field mode, Circle every 30
 *   frames: that is Command 1 (Attack, plan from row 0 is empty) and Confirm
 *   tapped as the panel offers them, and the classic pad's ○ on the result
 *   screens (auto-controls shows the classic pad outside field mode; the panel
 *   is hidden there).
 * - Field: Interact taps until the picture is still for 5 s (#77's
 *   after-battle rule), then drag up-left until the field ID leaves md1stin
 *   (#77: the only exit side), then #77's load rule.
 */
export function stretch1() {
  return {
    $schema: '../../schema/scenario.schema.json',
    name: 'touch-1-first-battle',
    description: '#120 stretch 1, generated by runner/test/unit/playthrough-scenarios.js from the touch layer (field-drag.js directions, FIELD_ACTIONS, the battle panel plan): from reactor-entrance, drag up with Interact taps until battle; two Attack turns with the battle panel (Command 1, Confirm); Command 1 / Confirm taps and the classic pad ○ until field mode; Interact taps until a still picture; drag up-left until the field ID leaves md1stin; wait for the field to load. Needs memory names game_state, map_cur, loading, widget, row0. Metrics: battle_wait, turn1, t1_target, t1_done, turn2, end_wait, next_wait.',
    steps: [
      walk('up', { mem: 'game_state', equals: 2 }, 1800, { interact: true, every: 20, hold: 15, metric: 'battle_wait' }),
      { wait: { until: { mem: 'widget', equals: WIDGET_NONE }, timeout: 600 } },
      ...battleTurn(0, 'turn1', { target: 't1_target', done: 't1_done' }),
      // Attempt 1 (5c866b4): turn2 0 with turn1 496, so some wait from turn 1's
      // select onwards timed out; t1_target/t1_done say which, and turn 2's
      // menu wait is longer in case the guards act first.
      ...battleTurn(0, 'turn2', { menuTimeout: 3600 }),
      {
        wait: {
          until: { mem: 'game_state', equals: 1 },
          timeout: 10800,
          press: { buttons: [BATTLE_PANEL_ACTIONS.confirm.button], every: 30, hold: HOLD },
        },
        metric: 'end_wait',
      },
      { wait: { stillFrames: 300, timeout: 3600, press: { buttons: [fieldButton('interact')], every: 60, hold: HOLD } } },
      walk('up-left', { mem: 'map_cur', differs: 0x74 }, 3600, { metric: 'next_wait' }),
      { wait: { until: { mem: 'loading', differs: 2 }, timeout: 600 } },
      { wait: { until: { mem: 'loading', equals: 2 }, timeout: 3600 } },
    ],
  };
}

/**
 * Branch-only diagnostics of #120 stretch 2's blocker. The merged generator
 * has DIAGNOSTIC false, so the committed touch-playthrough stays stretch 1.
 * - #200 (PR #201) replayed PR #197 attempt 3 (up-left 2400, up 1200) and
 *   found Cloud stops dead 60-100 frames into the up leg, with no window open
 *   and models 1-2 still: a wall or solid obstacle (notes, "#200").
 * - #202 (PR #203): the same up-left leg, up 200 frames (into the stall),
 *   then up-right / up-left probes: both move Cloud, neither reaches gateway
 *   1's line; the obstacle spans its x-range just below it (notes, "#202").
 * - #204 (this): the same input up to the stall point (up-left 2400, up 200),
 *   then 30 frames still. Signs say where field models 1-6 lie against
 *   Cloud and gateway 1 (DIAG_RUN below), to tell a solid model from the
 *   walkmesh; map_cur says he is still in md1_1.
 * Interact taps 15 of every 20 frames throughout, as attempt 3.
 */
export const DIAGNOSTIC = false;
/**
 * #204 run 1 ('models-y', c03ca4e) put every model 1-6 above Cloud in y.
 * Run 2 ('models-line') compares gateway 1's y1 with each model's PosY
 * (+1: the model is below the md1_2 line, so between Cloud and it), and y2
 * with Cloud's (the line's other end).
 */
export const DIAG_RUN = 'models-line';
export const DIAG_LEGS = Object.freeze([['up-left', 2400], ['up', 200]]);
/** The other field models (md1_1 has 7; #200). */
export const DIAG_MODELS = Object.freeze([1, 2, 3, 4, 5, 6]);

export function stretch2Diagnostic() {
  const steps = [{ wait: { frames: 30 } }];
  for (const [dir, frames] of DIAG_LEGS) {
    const drag = dragButtons(dir);
    const tap = [...drag, fieldButton('interact')];
    for (let f = 0; f < frames; f += 20) steps.push({ buttons: tap, frames: 15 }, { buttons: drag, frames: 5 });
  }
  steps.push({ wait: { frames: 30 } });
  return {
    $schema: '../../schema/scenario.schema.json',
    name: 'touch-2-md1-1-diagnostic',
    description: `#204 (diagnostic for #120 stretch 2), generated by runner/test/unit/playthrough-scenarios.js from the touch layer: in md1_1 after it loads, wait 30 frames, then drag (field-drag.js) with Interact taps (FIELD_ACTIONS): ${DIAG_LEGS.map(([d, f]) => `${d} ${f} frames`).join(', then ')} (to #200's stall point); wait 30 frames. Needs memory names pos_x, pos_y, gw1_y1, gw1_y2 and the model positions m<k>_x / m<k>_y.`,
    steps,
  };
}

const DIAG_DESC = `${DECOMP} config/symbols.main.us.txt, include/game.h FieldEntity`;
const DECOMP_FIELD = 'Xeeynamo/ff7-decomp@2c9239a4da08f039b1dcd4a3c9c34fe3fe7287fe (reference only, no code)';
/** Byte offsets inside one FieldGateway (#112): LinePos x1, y1 at +0/+2, x2, y2 at +6/+8. */
export const GATEWAY_FIELDS = Object.freeze({ x1: 0x0, y1: 0x2, x2: 0x6, y2: 0x8 });
/** A deref location for gateway `i`'s `field` (#112: g_FieldTriggers -> gateways[i]). */
export function gatewayLocation(i, field) {
  const off = FIELD_GATEWAYS.offset + i * FIELD_GATEWAYS.size + GATEWAY_FIELDS[field];
  return {
    addr: '0x800716c4',
    deref: `0x${off.toString(16)}`,
    type: 'u16',
    description: `fieldTriggers -> gateways[${i}] ${field} (s16 as u16; layout confirmed #112: gateways at +0x38, 0x18 bytes, x/y at +0/+2 and +6/+8). In md1_1, gateway 1 leads to md1_2 (PR #197 attempt 1). ${DECOMP_FIELD} include/game.h FieldTriggers, FieldGateway, LinePos`,
  };
}
/** fieldX/fieldY element 0's address and the FieldEntity stride (#77, #99). */
export const FIELD_X0 = 0x80074eb0;
export const FIELD_Y0 = 0x80074eb4;
export const FIELD_ENTITY_STRIDE = 0x84;
/** m<k>_x / m<k>_y: field model k's PosX/PosY (hypotheses for k >= 1; #99 confirmed only model 0). */
function modelMemory() {
  const out = {};
  for (const k of DIAG_MODELS) {
    out[`m${k}_x`] = { addr: `0x${(FIELD_X0 + k * FIELD_ENTITY_STRIDE).toString(16)}`, type: 'u32', description: `fieldX[${k}]: g_FieldEntity[${k}].PosX (s32 as u32; the array is confirmed for element 0 only, #77/#99; element ${k} is a hypothesis). ${DIAG_DESC}` };
    out[`m${k}_y`] = { addr: `0x${(FIELD_Y0 + k * FIELD_ENTITY_STRIDE).toString(16)}`, type: 'u32', description: `fieldY[${k}]: g_FieldEntity[${k}].PosY (s32 as u32; the array is confirmed for element 0 only, #77/#99; element ${k} is a hypothesis). ${DIAG_DESC}` };
  }
  return out;
}
export const DIAG_MEMORY = Object.freeze({
  pos_x: { addr: '0x80074eb0', type: 'u32', description: `fieldX[0]: g_FieldEntity[0].PosX (s32 as u32; confirmed #77): the player (playerModel 0, #99); field units << 12. ${DIAG_DESC}` },
  pos_y: { addr: '0x80074eb4', type: 'u32', description: `fieldY[0]: g_FieldEntity[0].PosY (s32 as u32; confirmed #77): the player; field units << 12. ${DIAG_DESC}` },
  gw1_x1: gatewayLocation(1, 'x1'),
  gw1_y1: gatewayLocation(1, 'y1'),
  gw1_x2: gatewayLocation(1, 'x2'),
  gw1_y2: gatewayLocation(1, 'y2'),
  ...modelMemory(),
});

const sign = (mem, withMem, metric, shift = 12) => ({ compare: { mem, with: withMem, shift, signed: true, is: 'unequal' }, metric });
const RUN1_END = Object.freeze({
  summary: 'field mode; and, as signs whatever the checks say: m1y .. m6y (field model k\'s PosY against Cloud\'s at the end, both raw), g1y (gateway 1\'s y1 against Cloud); raw map_cur at the end.',
  assert: [
    { expect: { mem: 'game_state', equals: 1 } },
    ...DIAG_MODELS.map((k) => sign(`m${k}_y`, 'pos_y', `m${k}y`, 0)),
    sign('gw1_y1', 'pos_y', 'g1y'),
  ],
  metrics: [...DIAG_MODELS.map((k) => `m${k}y`), 'g1y', 'map_cur'],
});
const RUN2_END = Object.freeze({
  summary: 'field mode; and, as signs whatever the checks say: l1 .. l6 (gateway 1\'s y1 against field model k\'s PosY: +1 when the model is below the md1_2 line), g1y2 (gateway 1\'s y2 against Cloud); raw map_cur at the end.',
  assert: [
    { expect: { mem: 'game_state', equals: 1 } },
    ...DIAG_MODELS.map((k) => sign('gw1_y1', `m${k}_y`, `l${k}`)),
    sign('gw1_y2', 'pos_y', 'g1y2'),
  ],
  metrics: [...DIAG_MODELS.map((k) => `l${k}`), 'g1y2', 'map_cur'],
});
/** End checks of the diagnostic. Its compare checks may fail by design: their metrics (signs) are what it is for. */
export const DIAG_END = DIAG_RUN === 'models-y' ? RUN1_END : RUN2_END;

export const STRETCHES = DIAGNOSTIC ? [stretch1, stretch2Diagnostic] : [stretch1];

/** A segment without its waits' metric names (the scenario's 8 metrics go to the diagnostic); waits stay, so a timeout still fails. */
export function withoutMetrics(segment) {
  return { ...segment, steps: segment.steps.map(({ metric, ...rest }) => rest) };
}

function diagnosticScenario(segments) {
  return {
    $schema: '../schema/scenario.schema.json',
    format: 2,
    tier: 2,
    name: 'touch-playthrough',
    description: `#204: a diagnostic of #120 stretch 2's blocker, on the #204 branch only (the merged scenario is stretch 1). The input is the generated segments ${segments.map((s) => s.name).join(', ')} (runner/test/unit/playthrough-scenarios.js). Stretch 1's waits still fail the scenario on a timeout. End checks: ${DIAG_END.summary} Only signs and small state values leave.`,
    boot: { from: 'reactor-entrance' },
    memory: { ...MEMORY, ...DIAG_MEMORY },
    input: segments.map((s) => ({ segment: s.name })),
    assert: DIAG_END.assert,
    metrics: DIAG_END.metrics,
  };
}

export function playthroughScenario(segments) {
  return {
    $schema: '../schema/scenario.schema.json',
    format: 2,
    tier: 2,
    name: 'touch-playthrough',
    description: `#120: the M3 exit chain, played with touch-layer actions only. One scenario that grows stretch by stretch (63 of 64 Tier 2 slots were taken); the input is the generated segments ${segments.map((s) => s.name).join(', ')} (runner/test/unit/playthrough-scenarios.js; a Tier 1 test checks the files). Each stretch ends on a wait.until, and a timeout fails the scenario. End checks: the field ID is md1_1 (0x75), field mode, Cloud's HP is above 0, and a rerun matches (match). Only frame counts and 1/0 leave.`,
    boot: { from: 'reactor-entrance' },
    memory: MEMORY,
    input: segments.map((s) => ({ segment: s.name })),
    assert: [
      { expect: { mem: 'map_cur', equals: 0x75 } },
      { expect: { mem: 'game_state', equals: 1 } },
      { expect: { mem: 'hp0', in: [1, 9999] } },
      { sameState: 'rerun', metric: 'match' },
    ],
    snapshot: 'touch-md1-1',
    // next_ok and hp_ok stay checks (they count in pass/fail) without metrics: 8 is the limit.
    metrics: ['battle_wait', 'turn1', 't1_target', 't1_done', 'turn2', 'end_wait', 'next_wait', 'match'],
  };
}

/**
 * #120 stretch 2, fresh budget (owner, 2026-11-18), attempt 1: a batch of
 * probes, each its own Tier 2 scenario (the cap is 128 since PR #206), all
 * booting from stretch 1's snapshot `touch-md1-1` (touch-playthrough runs
 * first: file names sort `touch-p` < `touch-s`). touch-playthrough itself
 * stays stretch 1, so it stays green.
 * - s2a: models 1-4's x against gateway 1's x1/x2 at #200's stall point
 *   (#204's suggested next step: which model stands in the line's x-range).
 * - s2b / s2c: does a message window open during the up-left / up leg?
 *   (#200 saw dlg 0 only at the end; a window opened and closed by the taps
 *   would hide there.) s2c then closes it and walks up again to the exit.
 * - s2d: a route round the obstacle: #202's up-right slide ends right of the
 *   line, still rising; then up, then left, with signs against gateway 1.
 * Every button is a drag direction (field-drag.js) or Interact (FIELD_ACTIONS).
 */
export const PROBES_ON = true;
export const STALL_SEGMENT = 'touch-2-stall';
const DIALOG = ADDRESS_TABLE.entries.find((e) => e.name === 'dialogState');
export const PROBE_MEMORY = Object.freeze({
  dlg: { addr: `0x${DIALOG.address.toString(16)}`, type: 'u16', description: `dialogState: g_WindowData[0].state (s16 as u16; confirmed #108): 0 closed, 6 waiting for Circle. ${DECOMP} config/symbols.main.us.txt` },
});
const MD1_1 = 0x75;
const MD1_2 = 0x76;

/** Drag `dir` for `frames` frames with Interact taps 15 of every 20 frames (as #200-#204). */
export function tapLeg(dir, frames) {
  const drag = dragButtons(dir);
  const tap = [...drag, fieldButton('interact')];
  const steps = [];
  for (let f = 0; f < frames; f += 20) steps.push({ buttons: tap, frames: 15 }, { buttons: drag, frames: 5 });
  return steps;
}

export function stallSegment() {
  return {
    $schema: '../../schema/scenario.schema.json',
    name: STALL_SEGMENT,
    description: `#120 stretch 2 probes, generated by runner/test/unit/playthrough-scenarios.js from the touch layer: in md1_1 after it loads, wait 30 frames, then drag (field-drag.js) with Interact taps (FIELD_ACTIONS): ${DIAG_LEGS.map(([d, f]) => `${d} ${f} frames`).join(', then ')} (#200's stall point); wait 30 frames.`,
    steps: [{ wait: { frames: 30 } }, ...DIAG_LEGS.flatMap(([d, f]) => tapLeg(d, f)), { wait: { frames: 30 } }],
  };
}

const tapPress = (dir) => ({ buttons: [...(dir ? dragButtons(dir) : []), fieldButton('interact')], every: 20, hold: 15 });
const untilDlg = (cond, timeout, dir, metric) => ({ wait: { until: { mem: 'dlg', ...cond }, timeout, press: tapPress(dir) }, metric });

function probe(name, what, memory, input, assert, metrics) {
  return {
    $schema: '../schema/scenario.schema.json',
    format: 2,
    tier: 2,
    name,
    description: `#120 stretch 2 probe (fresh budget, attempt 3), generated by runner/test/unit/playthrough-scenarios.js from the touch layer; boots from touch-md1-1 (stretch 1's end, kept by touch-playthrough). ${what} Only signs, frame counts and small state values leave.`,
    boot: { from: 'touch-md1-1' },
    memory,
    input,
    assert,
    metrics,
  };
}

export const PROBE_MODELS = Object.freeze([1, 2, 3, 4]);
/**
 * Fresh attempt 1 (`b89cbc0`): model 3 is the only one of models 1-4 in
 * gateway 1's x-range; no window opens dragging up-left or up with taps.
 * Fresh attempt 2 (`aa67516`): no window opens with taps facing any way at
 * the stall, and models 1-4 stand still there (no scene running).
 * Fresh attempt 3 (this, the last): route sweeps over md1_1, from its entry
 * and from the stall point, one of them running (a drag past RUN_DISTANCE
 * adds Cross, as field-drag.js does), looking for a scene trigger or a
 * walkmesh way to the md1_2 line. Each checks md1_2 at the end and reports
 * whether models 1-4 moved (a scene started) and a window opened.
 */
/** The pad buttons a run drag in `dir` holds (field-drag.js past RUN_DISTANCE: the direction plus Cross). */
export function runButtons(dir) {
  const v = DRAG_VECTORS[dir];
  if (!v) throw new RangeError(`unknown drag direction ${dir}`);
  const mask = createFieldDrag().move(v[0] * 2, v[1] * 2, 0);
  return padNames(mask).map((n) => n.toLowerCase());
}
/** Run `dir` for `frames` frames with Interact taps 15 of every 20 frames. */
export function runLeg(dir, frames) {
  const run = runButtons(dir);
  const steps = [];
  for (let f = 0; f < frames; f += 20) steps.push({ buttons: [...run, fieldButton('interact')], frames: 15 }, { buttons: run, frames: 5 });
  return steps;
}
const STALL = 'stall';
/** [name, legs]: a leg is [dir, frames] (walk) or ['run', dir, frames]; STALL is segment touch-2-stall. */
export const SWEEPS = Object.freeze([
  ['up', [['up', 2400]]],
  ['up-right', [['up-right', 2400]]],
  ['right-up', [['right', 1200], ['up', 1200]]],
  ['stall-right-up', [STALL, ['right', 300], ['up', 900]]],
  ['stall-left-up', [STALL, ['left', 300], ['up', 900]]],
  ['stall-round', [STALL, ['down', 200], ['right', 600], ['up', 900], ['left', 600]]],
  ['ul-up-right-up', [['up-left', 1200], ['up', 600], ['right', 900], ['up', 600]]],
  ['stall-run', [STALL, ['run', 'up', 600], ['run', 'up-right', 300], ['run', 'up-left', 300]]],
]);
const legText = (l) => (l === STALL ? 'segment touch-2-stall' : l[0] === 'run' ? `run ${l[1]} ${l[2]}` : `${l[0]} ${l[1]}`);
function legSteps(l) {
  if (l === STALL) return [{ segment: STALL_SEGMENT }];
  return l[0] === 'run' ? runLeg(l[1], l[2]) : tapLeg(l[0], l[1]);
}
export function probeScenarios() {
  const pick = (...names) => Object.fromEntries(names.map((n) => [n, DIAG_MEMORY[n]]));
  const models = PROBE_MODELS.flatMap((k) => [`m${k}_y`]);
  return SWEEPS.map(([name, legs]) =>
    probe(
      `touch-s2g-sweep-${name}`,
      `Input: wait 30 frames; mark go; ${legs.map(legText).join(', then ')}; all with Interact taps (drag directions from field-drag.js; a run is a drag past RUN_DISTANCE). End checks: md1_2 (0x${MD1_2.toString(16)}). Metrics: map_cur; dy1 .. dy4 and dx3 (field models' PosY / model 3's PosX since go: a scene moved them); cy (Cloud's PosY since go); dlg.`,
      { map_cur: MEMORY.map_cur, ...PROBE_MEMORY, ...pick('pos_y', 'm3_x', ...models) },
      [{ wait: { frames: 30 } }, { mark: 'go' }, ...legs.flatMap(legSteps)],
      [
        { expect: { mem: 'map_cur', equals: MD1_2 } },
        ...PROBE_MODELS.map((k) => ({ change: { mem: `m${k}_y`, is: 'changed', signed: true, since: 'go' }, metric: `dy${k}` })),
        { change: { mem: 'm3_x', is: 'changed', signed: true, since: 'go' }, metric: 'dx3' },
        { change: { mem: 'pos_y', is: 'changed', signed: true, since: 'go' }, metric: 'cy' },
      ],
      ['map_cur', 'dy1', 'dy2', 'dy3', 'dy4', 'dx3', 'cy', 'dlg'],
    ),
  );
}

/**
 * #120 stretch 2, owner hint (2026-11-23, from memory, a hypothesis): in
 * md1_1 the way to md1_2 opens after talking to a party member (Biggs, else
 * Jessie). Fresh attempts 1-3 watched only message window 0, and pressed
 * Interact wherever Cloud stopped. Since then #237 confirmed the talk rule
 * (fieldTalkOff, fieldTalkRange, fieldSolidRange, the `near` check) and #224
 * found messages in window 1. So the hint attempt:
 * - s2h-info-entry / s2h-info-stall: for models 1-4, TalkOff and the talk
 *   rule's distance sign (near: ground distance against TalkRange_k plus the
 *   player's SolidRange; -1 within), at md1_1's entry and at #200's stall.
 * - s2h-talk-*: from the stall (optionally a short approach first), Interact
 *   taps while facing a way until window 1 opens; then taps until it closes,
 *   60 still frames, and a drag up until the field ID leaves md1_1. End:
 *   md1_2, plus each model's near sign (which one is in range there).
 * Windows 0, 2 and 3 are read at the end (0 if nothing is open).
 */
export const HINT_MODELS = PROBE_MODELS;
const entry = (name) => {
  const e = ADDRESS_TABLE.entries.find((x) => x.name === name);
  if (!e) throw new RangeError(`no address-table entry ${name}`);
  return e;
};
const hex = (n) => `0x${n.toString(16)}`;
const HINT_SRC = 'semantic/addresses.js; Xeeynamo/ff7-decomp@2c9239a (reference only, no code) include/game.h FieldEntity, WindowData';
const element = (name, k, type, what) => {
  const e = entry(name);
  return { addr: hex(e.address + k * (e.stride ?? 0)), type, description: `${name}[${k}]: ${what} (${e.status} for the array; element ${k}${k === 0 ? '' : ' is a hypothesis for positions, #99'}). ${HINT_SRC}` };
};
export function hintMemory() {
  const m = { map_cur: MEMORY.map_cur, game_state: MEMORY.game_state };
  DIALOG_STATE_ENTRIES.forEach((n, i) => {
    m[`w${i}`] = { addr: hex(entry(n).address), type: 'u16', description: `${n}: g_WindowData[${i}].state (s16 as u16; ${entry(n).status}): 0 closed, 6 waiting for Circle. ${HINT_SRC}` };
  });
  m.x0 = element('fieldX', 0, 'u32', 'the player\'s PosX, raw');
  m.y0 = element('fieldY', 0, 'u32', 'the player\'s PosY, raw');
  m.solid0 = element('fieldSolidRange', 0, 'u16', 'the player\'s SolidRange, field units');
  for (const k of HINT_MODELS) {
    m[`x${k}`] = element('fieldX', k, 'u32', `model ${k}'s PosX, raw`);
    m[`y${k}`] = element('fieldY', k, 'u32', `model ${k}'s PosY, raw`);
    m[`talk${k}`] = element('fieldTalkRange', k, 'u16', `model ${k}'s TalkRange, field units`);
    m[`off${k}`] = element('fieldTalkOff', k, 'u8', `model ${k}'s TalkOff, 0 talkable`);
  }
  return m;
}
/** The talk rule's distance part for model k: sign of ground distance minus (TalkRange_k + SolidRange_0), field units. */
export const talkNear = (k) => ({ near: { x: 'x0', y: 'y0', toX: `x${k}`, toY: `y${k}`, range: [`talk${k}`, 'solid0'], shift: 12, is: 'within' }, metric: `n${k}` });

const hintProbe = (name, what, input, assert, metrics) => ({
  ...probe(name, what, hintMemory(), input, assert, metrics),
  description: `#120 stretch 2 probe (owner hint: talk to a party member), generated by runner/test/unit/playthrough-scenarios.js from the touch layer; boots from touch-md1-1 (stretch 1's end, kept by touch-playthrough). ${what} Only signs, frame counts and small state values leave.`,
});

/**
 * Owner-hint attempt, second run (after `5035cc4`): no model is within talk
 * range at the stall, and the eight talk probes were cut by Tier 2's
 * deadline. So three cheap probes replace them, sharing one stall run:
 * - s2i-a-stall: segment touch-2-stall once, end check md1_1, and keep the
 *   state as snapshot `touch-stall` (kept only if it passes).
 * - s2i-b-range: from touch-stall, how far out of talk range models 2-4 are:
 *   near signs with the constant `plus` added to TalkRange_k + SolidRange_0.
 * - s2i-c / s2i-d: from touch-stall, walk towards model 3 (right of Cloud,
 *   between him and the exit line) with Interact taps until window 1 opens;
 *   then taps until it closes, 60 still frames, drag up until the field ID
 *   leaves md1_1. End: md1_2 and the near signs of models 2-4.
 */
export const STALL_SNAPSHOT = 'touch-stall';
/**
 * Third run (after `0b3d215`): every talkable model is more than 256 field
 * units beyond talk range at the stall, and both walks towards model 3 timed
 * out with window 1 closed (a timeout zeroes the end checks, so where they
 * ended is unknown). So the range probe becomes per-axis brackets, and the
 * walks have fixed lengths with no wait, so their end signs survive:
 * - s2i-b-axis-3 / s2i-c-axis-24: the sign of |model k - Cloud| along PosX,
 *   and along PosY (the other coordinate set to Cloud's own), minus plus.
 * - s2i-walk-<dir>-<frames>: from the stall, drag that way with Interact taps
 *   for a fixed time, then 30 still frames. Metrics: n3 and two wider
 *   brackets for model 3, raw w0 and w1, Cloud's PosX / PosY signs since
 *   the start, map_cur.
 */
/** [model, [plus...]] for the per-axis brackets: 2 axes x plus count <= 8 metrics per scenario. */
export const AXIS_BRACKETS = Object.freeze([
  ['3', [[3, [256, 512, 1024, 2048]]]],
  ['24', [[2, [512, 2048]], [4, [512, 2048]]]],
]);
/** [drag direction, frames] for the fixed walks towards model 3 (right of Cloud and above him). */
export const WALKS = Object.freeze([
  ['right', 300],
  ['up-right', 300],
]);
const nearPlus = (k, plus) => ({ near: { x: 'x0', y: 'y0', toX: `x${k}`, toY: `y${k}`, range: [`talk${k}`, 'solid0'], shift: 12, plus, is: 'within' }, metric: `n${k}p${plus}` });
/** Sign of |model k - Cloud| along one axis (field units) minus plus; the other coordinate is Cloud's own. */
const axisNear = (k, ax, plus) => ({
  near: ax === 'x' ? { x: 'x0', y: 'y0', toX: `x${k}`, toY: 'y0', range: [], plus, shift: 12, is: 'within' } : { x: 'x0', y: 'y0', toX: 'x0', toY: `y${k}`, range: [], plus, shift: 12, is: 'within' },
  metric: `a${ax}${k}_${plus}`,
});

export function hintScenarios() {
  const fromStall = (s) => ({ ...s, boot: { from: STALL_SNAPSHOT } });
  const stall = {
    ...hintProbe('touch-s2i-a-stall', `Input: wait 30 frames; segment touch-2-stall (#200's stall point). End check: still md1_1 (0x${MD1_1.toString(16)}). Keeps the state as snapshot ${STALL_SNAPSHOT} for the other s2i probes.`, [{ wait: { frames: 30 } }, { segment: STALL_SEGMENT }], [{ expect: { mem: 'map_cur', equals: MD1_1 } }], ['map_cur']),
    snapshot: STALL_SNAPSHOT,
  };
  const axes = AXIS_BRACKETS.map(([tag, groups], i) => {
    const checks = groups.flatMap(([k, pluses]) => ['x', 'y'].flatMap((ax) => pluses.map((p) => axisNear(k, ax, p))));
    return fromStall(
      hintProbe(
        `touch-s2i-${'bc'[i]}-axis-${tag}`,
        `Boots from ${STALL_SNAPSHOT}. Input: wait 1 frame. Metrics: a<axis><k>_<n>, the sign of |model k's PosX - Cloud's| (axis x) or |PosY - Cloud's| (axis y), in field units, minus n: ${groups.map(([k, ps]) => `model ${k} at ${ps.join(', ')}`).join('; ')}. The checks may fail by design.`,
        [{ wait: { frames: 1 } }],
        checks,
        checks.map((c) => c.metric),
      ),
    );
  });
  const walks = WALKS.map(([dir, frames]) =>
    fromStall(
      hintProbe(
        `touch-s2i-walk-${dir}-${frames}`,
        `Boots from ${STALL_SNAPSHOT}. Input: mark go; drag ${dir} with Interact taps (15 of every 20 frames) for ${frames} frames; 30 still frames. No wait, so nothing can zero the end checks. End check: md1_1 still (0x${MD1_1.toString(16)}). Metrics: n3, n3p256, n3p1024 (model 3's talk-rule distance sign, plus 0 / 256 / 1024 field units), w0 and w1 (raw window states at the end), cx and cy (sign of Cloud's PosX / PosY change since go), map_cur. The near checks may fail by design.`,
        [{ mark: 'go' }, ...tapLeg(dir, frames), { wait: { frames: 30 } }],
        [
          { expect: { mem: 'map_cur', equals: MD1_1 } },
          talkNear(3),
          nearPlus(3, 256),
          nearPlus(3, 1024),
          { change: { mem: 'x0', is: 'changed', signed: true, since: 'go' }, metric: 'cx' },
          { change: { mem: 'y0', is: 'changed', signed: true, since: 'go' }, metric: 'cy' },
        ],
        ['n3', 'n3p256', 'n3p1024', 'w0', 'w1', 'cx', 'cy', 'map_cur'],
      ),
    ),
  );
  return [stall, ...axes, ...walks];
}

/** [{ file, data }] for every generated file. */
export function playthroughFiles() {
  const probes = PROBES_ON
    ? [
        { file: path.join(SEGMENT_DIR, `${STALL_SEGMENT}.json`), data: stallSegment() },
        ...hintScenarios().map((s) => ({ file: path.join(SCENARIO_DIR, `${s.name}.json`), data: s })),
      ]
    : [];
  return [...mainFiles(), ...probes];
}
function mainFiles() {
  if (DIAGNOSTIC) {
    const segments = STRETCHES.map((f, i) => (i === 0 ? withoutMetrics(f()) : f()));
    return [
      ...segments.map((s) => ({ file: path.join(SEGMENT_DIR, `${s.name}.json`), data: s })),
      { file: path.join(SCENARIO_DIR, 'touch-playthrough.json'), data: diagnosticScenario(segments) },
    ];
  }
  const segments = STRETCHES.map((f) => f());
  return [
    ...segments.map((s) => ({ file: path.join(SEGMENT_DIR, `${s.name}.json`), data: s })),
    { file: path.join(SCENARIO_DIR, 'touch-playthrough.json'), data: playthroughScenario(segments) },
  ];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const { file, data } of playthroughFiles()) writeFileSync(file, serialise(data));
}
