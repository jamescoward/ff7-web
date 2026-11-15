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

import { BATTLE_WIDGET_COMMAND, BATTLE_WIDGET_NONE, BATTLE_WIDGET_TARGET } from '../../../semantic/addresses.js';
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
 * #200: a diagnostic of #120 stretch 2's blocker, run on its branch only.
 * PR #197 attempt 3 (423bc94) dragged up-left 2400 frames, then up 1200
 * frames (Interact taps 15 of every 20 frames), and Cloud ended just below
 * the md1_2 gateway line, still in md1_1. This replays that input exactly and
 * measures, over the up leg: whether PosY/PosX still change after marks at
 * 0-700 frames (a stall: a wall or a frozen player); dialogState at
 * the end (a message window: a scene); whether field models 1 and 2 moved (a
 * scene); and fieldModelCount. The merged generator has DIAGNOSTIC false, so
 * the committed touch-playthrough stays stretch 1 only.
 */
export const DIAGNOSTIC = true;
export const DIAG_LEGS = Object.freeze([['up-left', 2400], ['up', 1200]]);
/** Frames into the last (up) leg at which a mark is taken; multiples of 20. */
export const DIAG_MARKS = Object.freeze([0, 20, 40, 60, 100]);

export function stretch2Diagnostic() {
  const steps = [{ wait: { frames: 30 } }];
  DIAG_LEGS.forEach(([dir, frames], i) => {
    const drag = dragButtons(dir);
    const tap = [...drag, fieldButton('interact')];
    const last = i === DIAG_LEGS.length - 1;
    for (let f = 0; f < frames; f += 20) {
      if (last && DIAG_MARKS.includes(f)) steps.push({ mark: `u${f}` });
      steps.push({ buttons: tap, frames: 15 }, { buttons: drag, frames: 5 });
    }
  });
  steps.push({ wait: { frames: 30 } });
  return {
    $schema: '../../schema/scenario.schema.json',
    name: 'touch-2-md1-1-diagnostic',
    description: `#200 (diagnostic for #120 stretch 2), generated by runner/test/unit/playthrough-scenarios.js from the touch layer: in md1_1 after it loads, wait 30 frames, then drag (field-drag.js) with Interact taps (FIELD_ACTIONS): ${DIAG_LEGS.map(([d, f]) => `${d} ${f} frames`).join(', then ')} (PR #197 attempt 3's input); marks ${DIAG_MARKS.map((m) => `u${m}`).join(', ')} at those frames into the last leg; wait 30 frames. Needs memory names pos_x, pos_y, m1_x, m2_x.`,
    steps,
  };
}

const DIAG_DESC = `${DECOMP} config/symbols.main.us.txt, include/game.h FieldEntity`;
export const DIAG_MEMORY = Object.freeze({
  pos_x: { addr: '0x80074eb0', type: 'u32', description: `fieldX[0]: g_FieldEntity[0].PosX (s32 as u32; confirmed #77): the player (playerModel 0, #99). ${DIAG_DESC}` },
  pos_y: { addr: '0x80074eb4', type: 'u32', description: `fieldY[0]: g_FieldEntity[0].PosY (s32 as u32; confirmed #77): the player. ${DIAG_DESC}` },
  m1_x: { addr: '0x80074f34', type: 'u32', description: `fieldX[1]: g_FieldEntity[1].PosX (s32 as u32; the fieldX array, stride 0x84, #99). ${DIAG_DESC}` },
  m2_x: { addr: '0x80074fb8', type: 'u32', description: `fieldX[2]: g_FieldEntity[2].PosX (s32 as u32; stride 0x84, #99). ${DIAG_DESC}` },
  dlg: { addr: '0x800832a0', type: 'u16', description: `dialogState: g_WindowData[0].state (s16 as u16; confirmed #108): 0 closed, 6 text done and waiting; 1-14 open. ${DECOMP} config/symbols.main.us.txt, include/game.h` },
  mcount: { addr: '0x8009ac1c', type: 'u16', description: `fieldModelCount: g_FieldState.modelCount (s16 as u16; confirmed #112). ${DECOMP} include/game.h FieldState` },
});

const since = (mem, mark, is, metric) => ({ change: { mem, is, signed: true, since: mark }, metric });
/** End checks of the diagnostic. Its change checks may fail by design: their metrics (signs) are what it is for. */
export const DIAG_END = Object.freeze({
  // Run 1 (e9f45c0): dy_100 dy_300 dy_700 dx_700 m1_dx m2_dx all 0, dlg 0,
  // mcount 7. A change metric is also 0 when a wait timed out, so run 2 adds
  // dy_0/dx_0 (attempt 3 saw +1/+1 over the whole up leg: non-zero proves the
  // script ran to the end) and finer marks to time the stall.
  summary: 'field mode; and, as signs whatever the checks say: dy_0, dy_20, dy_40, dy_60 (PosY change since 0, 20, 40, 60 frames into the up leg), dx_0, dx_100 (PosX since 0 and 100); raw map_cur and game_state at the end.',
  assert: [
    { expect: { mem: 'game_state', equals: 1 } },
    since('pos_y', 'u0', 'increased', 'dy_0'),
    since('pos_y', 'u20', 'changed', 'dy_20'),
    since('pos_y', 'u40', 'changed', 'dy_40'),
    since('pos_y', 'u60', 'unchanged', 'dy_60'),
    since('pos_x', 'u0', 'increased', 'dx_0'),
    since('pos_x', 'u100', 'unchanged', 'dx_100'),
  ],
  metrics: ['dy_0', 'dy_20', 'dy_40', 'dy_60', 'dx_0', 'dx_100', 'map_cur', 'game_state'],
});

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
    description: `#200: a diagnostic of #120 stretch 2's blocker, on the #200 branch only (the merged scenario is stretch 1). The input is the generated segments ${segments.map((s) => s.name).join(', ')} (runner/test/unit/playthrough-scenarios.js). Stretch 1's waits still fail the scenario on a timeout. End checks: ${DIAG_END.summary} Only signs and small state values leave.`,
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
  return [
    ...segments.map((s) => ({ file: path.join(SEGMENT_DIR, `${s.name}.json`), data: s })),
    { file: path.join(SCENARIO_DIR, 'touch-playthrough.json'), data: playthroughScenario(segments) },
  ];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const { file, data } of playthroughFiles()) writeFileSync(file, serialise(data));
}
