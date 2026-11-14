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

import { FIELD_GATEWAYS } from '../../../semantic/addresses.js';
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
const DECOMP_FIELD = 'Xeeynamo/ff7-decomp@2c9239a4da08f039b1dcd4a3c9c34fe3fe7287fe (reference only, no code)';
/** Byte offsets inside one FieldGateway (#112): LinePos x1, y1, then fieldMapId at FIELD_GATEWAYS.to. */
const GATEWAY_FIELDS = Object.freeze({ x1: 0x0, y1: 0x2, to: FIELD_GATEWAYS.to });

/** A deref location for gateway `i`'s `field` (#112: g_FieldTriggers -> gateways[i]). */
export function gatewayLocation(i, field) {
  const off = FIELD_GATEWAYS.offset + i * FIELD_GATEWAYS.size + GATEWAY_FIELDS[field];
  return {
    addr: '0x800716c4',
    deref: `0x${off.toString(16)}`,
    type: 'u16',
    description: `fieldTriggers -> gateways[${i}] ${field} (s16 as u16; layout confirmed #112: gateways at +0x38, 0x18 bytes, x/y at +0/+2, fieldMapId at +0x12, 0x7FFF unused). ${DECOMP_FIELD} include/game.h FieldTriggers, FieldGateway, LinePos`,
  };
}

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
  pos_x: {
    addr: '0x80074eb0',
    type: 'u32',
    description: `fieldX[0]: g_FieldEntity[0].PosX (s32 as u32; confirmed #77): the player (playerModel 0, #99); field units << 12. ${DECOMP} config/symbols.main.us.txt, include/game.h FieldEntity`,
  },
  pos_y: {
    addr: '0x80074eb4',
    type: 'u32',
    description: `fieldY[0]: g_FieldEntity[0].PosY (s32 as u32; confirmed #77): the player; field units << 12. ${DECOMP} config/symbols.main.us.txt, include/game.h FieldEntity`,
  },
  gw0_to: gatewayLocation(0, 'to'),
  gw1_to: gatewayLocation(1, 'to'),
  gw0_x1: gatewayLocation(0, 'x1'),
  gw0_y1: gatewayLocation(0, 'y1'),
  gw1_x1: gatewayLocation(1, 'x1'),
  gw1_y1: gatewayLocation(1, 'y1'),
});

const WIDGET_NONE = 0xffff;
const WIDGET_TARGET = 0;
const WIDGET_COMMAND = 1;
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
 * Stretch 2, attempt 1 (a probe, no route yet): in md1_1 just after it loads,
 * hold a drag up for 20 frames. The end checks then report which field
 * gateways 0 and 1 lead to, on which side of the player their first ends lie
 * (signs only), and which way the drag-up moved the player (signs of the
 * PosX/PosY change since the mark), so attempt 2 can choose the drag
 * direction towards md1_2 (0x76, notes/77-field-position.md).
 */
export function stretch2Probe() {
  return {
    $schema: '../../schema/scenario.schema.json',
    name: 'touch-2-md1-1-probe',
    description: '#120 stretch 2, attempt 1 (probe), generated by runner/test/unit/playthrough-scenarios.js: in md1_1 just after it loads, wait 30 frames, mark, drag up (field-drag.js) for 20 frames, wait 10 frames. The scenario reports gateway targets and signs, and the drag direction. Needs memory names pos_x, pos_y.',
    steps: [
      { wait: { frames: 30 } },
      { mark: 'probe' },
      { buttons: dragButtons('up'), frames: 20 },
      { wait: { frames: 10 } },
    ],
  };
}

export const STRETCHES = [stretch1, stretch2Probe];

/** The checks at the scenario's end: stretch 2's probe (attempt 1). */
const sign = (mem, withMem) => ({ compare: { mem, with: withMem, shift: 12, signed: true, is: 'unequal' } });
export const END = Object.freeze({
  summary: 'still in md1_1 (0x75) in field mode with Cloud\'s HP above 0, and a rerun matches (checks without metrics). Metrics (probe for stretch 2): gw0_to/gw1_to are the fields gateways 0 and 1 lead to; g0x/g0y/g1x/g1y the signs of each gateway\'s first end minus the player\'s position; up_dx/up_dy the signs of the player\'s PosX/PosY change over the 20-frame drag up.',
  assert: [
    { expect: { mem: 'map_cur', equals: 0x75 } },
    { expect: { mem: 'game_state', equals: 1 } },
    { expect: { mem: 'hp0', in: [1, 9999] } },
    { ...sign('gw0_x1', 'pos_x'), metric: 'g0x' },
    { ...sign('gw0_y1', 'pos_y'), metric: 'g0y' },
    { ...sign('gw1_x1', 'pos_x'), metric: 'g1x' },
    { ...sign('gw1_y1', 'pos_y'), metric: 'g1y' },
    { change: { mem: 'pos_x', is: 'changed', signed: true, since: 'probe' }, metric: 'up_dx' },
    { change: { mem: 'pos_y', is: 'changed', signed: true, since: 'probe' }, metric: 'up_dy' },
    { sameState: 'rerun' },
  ],
  snapshot: 'touch-md1-1',
  metrics: ['gw0_to', 'gw1_to', 'g0x', 'g0y', 'g1x', 'g1y', 'up_dx', 'up_dy'],
});

export function playthroughScenario(segments) {
  return {
    $schema: '../schema/scenario.schema.json',
    format: 2,
    tier: 2,
    name: 'touch-playthrough',
    description: `#120: the M3 exit chain, played with touch-layer actions only. One scenario that grows stretch by stretch (63 of 64 Tier 2 slots were taken); the input is the generated segments ${segments.map((s) => s.name).join(', ')} (runner/test/unit/playthrough-scenarios.js; a Tier 1 test checks the files). Each stretch ends on a wait.until, and a timeout fails the scenario. End checks: ${END.summary} Only field IDs, signs and 1/0 leave.`,
    boot: { from: 'reactor-entrance' },
    memory: MEMORY,
    input: segments.map((s) => ({ segment: s.name })),
    assert: END.assert,
    snapshot: END.snapshot,
    // Stretch 1's frame metrics (battle_wait … next_wait) were measured twice
    // (notes/120-touch-playthrough.md); its waits still fail the scenario on a
    // timeout. The 8 metric slots go to the current stretch.
    metrics: END.metrics,
  };
}

/**
 * A segment with its waits' metric names removed: a segment's metrics must be
 * listed by the scenario (max 8), and they go to the current stretch. The waits
 * themselves stay, so a timeout still fails the scenario.
 */
export function withoutMetrics(segment) {
  return { ...segment, steps: segment.steps.map(({ metric, ...rest }) => rest) };
}

/** [{ file, data }] for every generated file. */
export function playthroughFiles() {
  const segments = STRETCHES.map((f, i) => (i < STRETCHES.length - 1 ? withoutMetrics(f()) : f()));
  return [
    ...segments.map((s) => ({ file: path.join(SEGMENT_DIR, `${s.name}.json`), data: s })),
    { file: path.join(SCENARIO_DIR, 'touch-playthrough.json'), data: playthroughScenario(segments) },
  ];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const { file, data } of playthroughFiles()) writeFileSync(file, serialise(data));
}
