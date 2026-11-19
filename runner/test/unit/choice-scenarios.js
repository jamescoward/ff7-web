// #168 (fresh budget, attempt 3; attempt 2's definitions are in f885ac7):
// find out whether a walk reaches a talkable model and whether a Circle there
// opens any of the four message windows, in the four #99 fields where the pad
// moves the player and attempt 2 found models with TalkOff clear. Generated so
// the committed scenarios are this file's output, not hand-written;
// choice-scenarios.test.js checks the committed files equal it.
//
//   node runner/test/unit/choice-scenarios.js    rewrite the files
//
// Why (notes/168-choice-cursor.md): attempt 2's 40 talk sweeps never saw
// window 0 open, and a timeout zeroes every later check. Here nothing waits
// after the load, and raw window states and near signs always report.
//
// Addresses are entries of semantic/addresses.js (g_FieldEntity 0x80074EA4,
// stride 0x84; TalkOff +0x5B; g_FieldModelCount; g_WindowData[0]; #77, #99,
// #108, #112).
//
// Original project code, GPL-2.0-or-later.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCENARIO_DIR, serialise } from './planner-scenarios.js';

export { SCENARIO_DIR };

const ENTITY = 0x80074ea4;
const STRIDE = 0x84;
const hex = (n) => `0x${(n >>> 0).toString(16)}`;
const at = (model, off) => hex(ENTITY + model * STRIDE + off);
const DECOMP = 'Xeeynamo/ff7-decomp@2c9239a (reference only, no code)';

/** Fields a generated save loads into and where the pad moves the player (#99, notes/99-player-model.md). */
export const FIELDS = Object.freeze([
  { key: 'md1-2', id: 118 },
  { key: 'nmkin-1', id: 120 },
  { key: 'md8-1', id: 133 },
  { key: 'mds7st1', id: 144 },
  { key: 'mds7', id: 151 },
]);
const COMMON = {
  game_state: { addr: '0x8009c560', type: 'u16', description: 'g_GameState (s16 as u16; confirmed #76): field 1.' },
  map_cur: { addr: '0x8009a05c', type: 'u16', description: 'g_FieldCurrentMap (s16 as u16; confirmed #77): the field ID.' },
  loading: { addr: '0x800965e8', type: 'u16', description: 'g_IsFieldLoading (s16 as u16; confirmed #77): 2 in a settled field.' },
};

/** Load the generated save as save-boot-1-load does (#38), then wait for the field to settle. */
const LOAD = [
  { wait: { until: { mem: 'game_state', equals: 1 }, timeout: 3600, press: { buttons: ['circle'], every: 30, hold: 4 } } },
  { segment: 'field-loaded' },
];

/** Pad directions; the field's camera decides how each maps to PosX/PosY. */
export const DIRECTIONS = Object.freeze({
  up: ['up'],
  'up-right': ['up', 'right'],
  right: ['right'],
  'down-right': ['down', 'right'],
  down: ['down'],
  'down-left': ['down', 'left'],
  left: ['left'],
  'up-left': ['up', 'left'],
});
const scenario = (name, description, save, memory, input, asserts, metrics, fieldId) => ({
  $schema: '../schema/scenario.schema.json',
  format: 2,
  tier: 2,
  name,
  description,
  boot: { disc: 1, save, slot: 1 },
  memory,
  input: [...LOAD, ...input],
  assert: [{ expect: { mem: 'map_cur', equals: fieldId } }, ...asserts],
  metrics,
});

/**
 * Talkable models per field: TalkOff 0 and index below the model count, from
 * attempt 2's talk-off scenarios (f885ac7); at most three per field (8 metrics).
 */
export const TALKABLE = Object.freeze({ 'md1-2': [1, 2, 3], 'nmkin-1': [2, 3, 4], mds7st1: [4, 5, 6], mds7: [1] });
/** Held frames of walking, then a Circle press and frames to let a window open. */
export const WALK_FRAMES = 300;
export const OPEN_FRAMES = 30;
const WINDOWS = [0, 1, 2, 3];

function attempt3Memory(models) {
  const m = { ...COMMON };
  m.pos_x = { addr: at(0, 0x0c), type: 'u32', description: 'g_FieldEntity[0].PosX (s32 as u32; confirmed #77): the player (model 0, #99).' };
  m.pos_y = { addr: at(0, 0x10), type: 'u32', description: 'g_FieldEntity[0].PosY (s32 as u32; confirmed #77): the player.' };
  m.solid0 = { addr: at(0, 0x6c), type: 'u16', description: `g_FieldEntity[0].SolidRange (confirmed #112). ${DECOMP} include/game.h FieldEntity.` };
  for (const w of WINDOWS) {
    m[`w${w}`] = { addr: hex(0x800832a0 + w * 0x30), type: 'u16', description: `g_WindowData[${w}].state (window ${w} of 4, stride 0x30; dialogState is window 0, confirmed #108; windows 1-3 hypotheses): 0 closed. ${DECOMP} config/symbols.main.us.txt g_WindowData (0xC0), include/game.h WindowData.` };
  }
  for (const k of models) {
    m[`m${k}_x`] = { addr: at(k, 0x0c), type: 'u32', description: `g_FieldEntity[${k}].PosX (fieldX hypothesis for k >= 1, #99).` };
    m[`m${k}_y`] = { addr: at(k, 0x10), type: 'u32', description: `g_FieldEntity[${k}].PosY (fieldY hypothesis for k >= 1, #99).` };
    m[`m${k}_talk`] = { addr: at(k, 0x6e), type: 'u16', description: `g_FieldEntity[${k}].TalkRange (fieldTalkRange, hypothesis, #112). ${DECOMP} include/game.h FieldEntity.` };
  }
  return m;
}

export function choiceScenarios() {
  const out = [];
  for (const f of FIELDS) {
    const models = TALKABLE[f.key];
    if (!models) continue;
    const save = `disc1-${f.key}`;
    for (const [dir, buttons] of Object.entries(DIRECTIONS)) {
      out.push(
        scenario(
          `save-boot-16-${f.key}-reach-${dir}`,
          `#168 fresh budget, attempt 3 (diagnostic; nothing here can time out after the load). Boot harness/saves/${save}.json (field ${f.id}) and load. Hold ${buttons.join('+')} for ${WALK_FRAMES} frames (the walk ends against whatever is in the way, facing that way), press Circle (4 frames) and wait ${OPEN_FRAMES} frames. w0..w3: the state of each of the four message windows at the end (not 0 = that Circle talk opened a message in that window; attempt 2 watched window 0 only). ${models.map((k) => `n${k}`).join(', ')}: the talk-distance sign of each model attempt 2 found talkable (TalkOff 0) from the player at the end (-1 within TalkRange + the player's SolidRange). Only the states, the signs and load_done leave.`,
          save,
          attempt3Memory(models),
          [
            { buttons, frames: WALK_FRAMES },
            { buttons: ['circle'], frames: 4 },
            { wait: { frames: OPEN_FRAMES } },
          ],
          models.map((k) => ({
            near: { x: `m${k}_x`, y: `m${k}_y`, toX: 'pos_x', toY: 'pos_y', range: [`m${k}_talk`, 'solid0'], shift: 12, is: 'within' },
            metric: `n${k}`,
          })),
          ['load_done', ...WINDOWS.map((w) => `w${w}`), ...models.map((k) => `n${k}`)],
          f.id,
        ),
      );
    }
  }
  return out;
}

export const choiceFiles = () => choiceScenarios().map((s) => ({ file: path.join(SCENARIO_DIR, `${s.name}.json`), data: s }));

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const { file, data } of choiceFiles()) writeFileSync(file, serialise(data));
}
