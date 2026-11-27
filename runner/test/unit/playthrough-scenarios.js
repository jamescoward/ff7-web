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

import { ADDRESS_TABLE, BATTLE_WIDGET_COMMAND, BATTLE_WIDGET_NONE, BATTLE_WIDGET_TARGET, FIELD_GATEWAYS } from '../../../semantic/addresses.js';
import { battlePanelPlan } from '../../../semantic/battle-panel.js';
import { BATTLE_PANEL_ACTIONS, FIELD_ACTIONS, NAMING_ACTIONS } from '../../../semantic/controls.js';
import { createFieldDrag } from '../../../web/js/field-drag.js';
import { padNames } from '../../../web/js/pad.js';
import { MD1_2, NAME_ENTRY, ROUTE as GATE_ROUTE } from './naming-scenarios.js';
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
 * Stretch 2 (#120 budget 4): md1_1 → md1_2 through the gate scene, as a
 * chained scenario. touch-playthrough stays stretch 1 and keeps its
 * snapshot touch-md1-1, because #289's touch-s2n-naming-confirm boots from
 * it; touch-s2-md1-2 boots from the same snapshot (its name sorts after
 * touch-playthrough, and a snapshot chain stays in one Tier 2 shard) and
 * keeps touch-md1-2 for stretch 3 (agent default, recorded on PR #197).
 *
 * The segment is one route step (#282, #293): the route steers Cloud over
 * md1_1's walkmesh to gateway 1 with drag directions, presses Interact
 * through every message window that waits for Circle, and on the naming
 * screen plays the touch layer's "Use default name" action
 * (NAMING_ACTIONS.useDefault, #289). Limits are touch-s2n-naming-confirm's
 * (budget 4 attempt 2 reached md1_2 with them, PR #197 touch-s2s-gw-sc).
 */
export const STRETCH2_SEGMENT = 'touch-2-gate-scene';
export function stretch2() {
  const use = NAMING_ACTIONS.useDefault;
  const seq = use.sequence.map((g) => g.join(' + ')).join(', then ');
  return {
    $schema: '../../schema/scenario.schema.json',
    name: STRETCH2_SEGMENT,
    description: `#120 stretch 2, generated by runner/test/unit/playthrough-scenarios.js from the touch layer: in md1_1 after it loads, wait 30 frames, then route to gateway 1 (md1_2) over the walkmesh with drag directions, at most ${GATE_ROUTE.timeout} frames, driving the gate scene: Interact (FIELD_ACTIONS) through every message window that waits for Circle and, on the naming screen (gameState 5 with fieldEventCmd ${NAME_ENTRY}), NAMING_ACTIONS.useDefault (${seq}); then wait for md1_2 to load. Needs memory names map_cur and loading; metrics out_g, named, nleft.`,
    steps: [
      { wait: { frames: 30 } },
      {
        route: {
          to: { gateway: 1 },
          ...GATE_ROUTE,
          naming: use.sequence.map((g) => [...g]),
          report: { outcome: 'out_g', named: 'named', nleft: 'nleft' },
        },
      },
      { wait: { until: { mem: 'map_cur', equals: MD1_2 }, timeout: 600 } },
      { wait: { until: { mem: 'loading', equals: 2 }, timeout: 3600 } },
    ],
  };
}

export function playthrough2Scenario(segment) {
  return {
    $schema: '../schema/scenario.schema.json',
    format: 2,
    tier: 2,
    name: 'touch-s2-md1-2',
    description: `#120 stretch 2 of the M3 exit chain, played with touch-layer actions only: boots from touch-md1-1 (kept by touch-playthrough, stretch 1) and plays the generated segment ${segment.name} (runner/test/unit/playthrough-scenarios.js; a Tier 1 test checks the files). End checks: the field ID is md1_2 (0x76), field mode, fieldEventCmd is no longer ${NAME_ENTRY} (the naming screen closed), Cloud's HP is above 0, and a rerun matches (match). Keeps snapshot touch-md1-2 for stretch 3. Metrics: out_g (route outcome: 1 reached, 2 stuck, 3 timeout, 4 left field mode, 5 no walkmesh, 6 no goal, 7 no path), named (route frame + 1 when the naming screen was first seen, 0 never), nleft (frames on the naming screen, 0 never), and the end checks (1 holds, 0 not). Only those numbers leave.`,
    boot: { from: 'touch-md1-1' },
    memory: {
      game_state: MEMORY.game_state,
      map_cur: { ...MEMORY.map_cur, description: MEMORY.map_cur.description.replace('md1_1 0x75', 'md1_1 0x75, md1_2 0x76') },
      loading: MEMORY.loading,
      hp0: MEMORY.hp0,
      event_cmd: {
        addr: `0x${ADDRESS_TABLE.entries.find((e) => e.name === 'fieldEventCmd').address.toString(16)}`,
        type: 'u8',
        description: 'fieldEventCmd: g_FieldState.eventCmd (u8; #289 confirms 6, character name entry). Xeeynamo/ff7-decomp@33ce78c (reference only, no code) include/game.h',
      },
    },
    input: [{ segment: segment.name }],
    assert: [
      { expect: { mem: 'map_cur', equals: MD1_2 }, metric: 'md1_2' },
      { expect: { mem: 'game_state', equals: 1 }, metric: 'field' },
      { expect: { mem: 'event_cmd', differs: NAME_ENTRY }, metric: 'evt_off' },
      { expect: { mem: 'hp0', in: [1, 9999] } },
      { sameState: 'rerun', metric: 'match' },
    ],
    snapshot: 'touch-md1-2',
    metrics: ['out_g', 'named', 'nleft', 'md1_2', 'field', 'evt_off', 'match'],
  };
}

/**
 * Stretch 3, attempt 1 (fresh budget): probes of md1_2, booting from
 * touch-md1-2 (kept by touch-s2-md1-2). md1_2's layout is unknown, and the
 * validator takes at most 128 Tier 2 scenarios (126 were on main), so two
 * probes: touch-s3r-gw<g> routes to gateway g (0 and 1) with the stretch 2
 * limits, driving scenes, and reports the outcome, the path, locks, scene
 * drives, the first non-field mode seen (2 would be a battle), the
 * triangles left and the field ID S3_SETTLE frames after the route ends
 * (where the gateway leads, if reached; 6 = no goal means an unused one).
 * Branch-only probes: the next attempt replaces them with the stretch.
 */
export const S3_BOOT = 'touch-md1-2';
export const S3_ROUTE_GATEWAYS = Object.freeze([0, 1]);
export const S3_SETTLE = 600;

function s3Base(name, description, steps, metrics) {
  const segName = name.replace('touch-', 'touch-3-');
  const segment = {
    $schema: '../../schema/scenario.schema.json',
    name: segName,
    description,
    steps,
  };
  const scenario = {
    $schema: '../schema/scenario.schema.json',
    format: 2,
    tier: 2,
    name,
    description: `#120 stretch 3 attempt 1 (probe; may fail by design: only its metrics matter): boots from ${S3_BOOT} (kept by touch-s2-md1-2) and plays the generated segment ${segName} (runner/test/unit/playthrough-scenarios.js). ${description} The end check is field mode. Metrics: ${metrics.join(', ')}. Only those numbers leave.`,
    boot: { from: S3_BOOT },
    memory: {
      game_state: MEMORY.game_state,
      map_cur: { ...MEMORY.map_cur, description: MEMORY.map_cur.description.replace('md1_1 0x75', 'md1_1 0x75, md1_2 0x76') },
    },
    input: [{ segment: segName }],
    assert: [{ expect: { mem: 'game_state', equals: 1 }, metric: 'field' }],
    metrics,
  };
  return { segment, scenario };
}

/** touch-s3r-gw<g>: a scene-driving route to md1_2's gateway g. */
export function stretch3Route(g) {
  return s3Base(
    `touch-s3r-gw${g}`,
    `In md1_2 after it loads, wait 30 frames, then route to gateway ${g} over the walkmesh with drag directions, at most ${GATE_ROUTE.timeout} frames, driving scenes (Interact, FIELD_ACTIONS, through every message window that waits for Circle); then wait ${S3_SETTLE} frames and read the field ID (map_cur, raw). Route reports: out_g (1 reached, 2 stuck, 3 timeout, 4 left field mode, 5 no walkmesh, 6 no goal, 7 no path), path (triangles), locked, scenes, smode (first gameState other than field seen in a drive, 0 none), remain (triangles left to the goal).`,
    [
      { wait: { frames: 30 } },
      {
        route: {
          to: { gateway: g },
          ...GATE_ROUTE,
          report: { outcome: 'out_g', path: 'path', locked: 'locked', scenes: 'scenes', smode: 'smode', remain: 'remain' },
        },
      },
      { wait: { frames: S3_SETTLE } },
    ],
    ['out_g', 'path', 'locked', 'scenes', 'smode', 'remain', 'map_cur', 'field'],
  );
}

/** Every stretch 3 probe, in order. */
export function stretch3Probes() {
  return S3_ROUTE_GATEWAYS.map(stretch3Route);
}

/** [{ file, data }] for every generated file. */
export function playthroughFiles() {
  if (DIAGNOSTIC) {
    const segments = STRETCHES.map((f, i) => (i === 0 ? withoutMetrics(f()) : f()));
    return [
      ...segments.map((s) => ({ file: path.join(SEGMENT_DIR, `${s.name}.json`), data: s })),
      { file: path.join(SCENARIO_DIR, 'touch-playthrough.json'), data: diagnosticScenario(segments) },
    ];
  }
  const segments = STRETCHES.map((f) => f());
  const s2 = stretch2();
  return [
    ...segments.map((s) => ({ file: path.join(SEGMENT_DIR, `${s.name}.json`), data: s })),
    { file: path.join(SCENARIO_DIR, 'touch-playthrough.json'), data: playthroughScenario(segments) },
    { file: path.join(SEGMENT_DIR, `${s2.name}.json`), data: s2 },
    { file: path.join(SCENARIO_DIR, 'touch-s2-md1-2.json'), data: playthrough2Scenario(s2) },
    ...stretch3Probes().flatMap(({ segment, scenario }) => [
      { file: path.join(SEGMENT_DIR, `${segment.name}.json`), data: segment },
      { file: path.join(SCENARIO_DIR, `${scenario.name}.json`), data: scenario },
    ]),
  ];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const { file, data } of playthroughFiles()) writeFileSync(file, serialise(data));
}
