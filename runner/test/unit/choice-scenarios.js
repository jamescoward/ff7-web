// #168 (fresh budget, attempt 2): look for a talkable NPC with a choice in
// the five fields a generated save loads into and where the pad moves the
// player (#99), generated so the 45 committed scenarios are this file's
// output, not hand-written. choice-scenarios.test.js checks the committed
// files equal it.
//
//   node runner/test/unit/choice-scenarios.js    rewrite the files
//
// Why (notes/168-choice-cursor.md): attempt 1 found that in Wall Market's
// inn, at the generated saves' progress value, every model has TalkOff set
// and the player cannot move, so no talk can happen there. Per field this
// reports the model count and TalkOff of models 1-6, and walks in eight
// directions pressing Circle until a window opens, then until a choice's
// pointer shows; if one does, the acceptance runs in the same scenario.
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
/** TalkOff is reported for models 1..6 (model 0 is the player, #99). */
export const MODELS = [1, 2, 3, 4, 5, 6];

const COMMON = {
  game_state: { addr: '0x8009c560', type: 'u16', description: 'g_GameState (s16 as u16; confirmed #76): field 1.' },
  map_cur: { addr: '0x8009a05c', type: 'u16', description: 'g_FieldCurrentMap (s16 as u16; confirmed #77): the field ID.' },
  loading: { addr: '0x800965e8', type: 'u16', description: 'g_IsFieldLoading (s16 as u16; confirmed #77): 2 in a settled field.' },
};

function staticMemory() {
  const m = {
    ...COMMON,
    cnt: { addr: '0x8009c6c4', type: 'u16', description: 'g_FieldModelCount (fieldModelCount, confirmed #112): models in the field, the player included.' },
  };
  for (const k of MODELS) {
    m[`off${k}`] = { addr: at(k, 0x5b), type: 'u8', description: `g_FieldEntity[${k}].TalkOff (fieldTalkOff, hypothesis, #112): not 0 = the model cannot be talked to (#168 attempt 1: 1 for every mktinn model). ${DECOMP} include/game.h FieldEntity.` };
  }
  return m;
}

function talkMemory() {
  return {
    ...COMMON,
    win0: { addr: '0x800832a0', type: 'u16', description: 'g_WindowData[0].state (dialogState, confirmed #108): 0 closed, 6 text shown and waiting.' },
    ptr_en: { addr: '0x8008328e', type: 'u8', description: `g_WindowData[0].pointerEnabled at +0x1A (dialogPointer, hypothesis, #168): 1 while a choice (field opcode ask) waits in state 6. ${DECOMP} include/game.h WindowData, src/field/field_dialog.c FieldDialogAskUpdateStates.` },
    ptr_y: { addr: '0x8008329a', type: 'u16', description: 'g_WindowData[0].pointerY at +0x26 (dialogPointerY, s16 as u16; hypothesis, #168): chosen line * 16 + 6 while a choice waits. Same source.' },
  };
}

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
/** Frames to walk (pressing Circle) before giving up on a window; then frames of Circle presses before giving up on a pointer. */
export const WALK_TIMEOUT = 600;
export const ASK_TIMEOUT = 900;

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

export function choiceScenarios() {
  const out = [];
  for (const f of FIELDS) {
    const save = `disc1-${f.key}`;
    out.push(
      scenario(
        `save-boot-16-${f.key}-talk-off`,
        `#168 fresh budget, attempt 2 (diagnostic). Boot harness/saves/${save}.json (field ${f.id}, a #99 boot point where the pad moves the player) and load as save-boot-1-load does, then 60 still frames. Reports the field's model count (cnt) and TalkOff of models 1-6 (off1..off6: 0 = the model can be talked to; a model index at or above cnt is not a model). Only the count, these flag bytes and load_done leave.`,
        save,
        staticMemory(),
        [{ wait: { frames: 60 } }],
        [],
        ['load_done', 'cnt', ...MODELS.map((k) => `off${k}`)],
        f.id,
      ),
    );
    for (const [dir, buttons] of Object.entries(DIRECTIONS)) {
      out.push(
        scenario(
          `save-boot-16-${f.key}-talk-${dir}`,
          `#168 fresh budget, attempt 2 (search and acceptance in one run). Boot harness/saves/${save}.json (field ${f.id}) and load. Phase 1: hold ${buttons.join('+')} with Circle held 7 of every 8 frames (a Circle edge every 8 frames while walking and facing the way the player goes) until window 0 leaves state 0 (win_wait: a talk opened a message or a choice; timeout ${WALK_TIMEOUT}). Phase 2: Circle (hold 2) every 8 frames until window 0's pointerEnabled reads 1 (ptr_wait: a choice shows its pointer; the wait ends on that frame, before the next edge could pick; timeout ${ASK_TIMEOUT}). Then the #168 acceptance: mark, Down (4 frames: one line) and 12 frames, mark, Up (4) and 12; window 0 still in state 6 (still6); Circle (4) picks and closes window 0 (close_wait: back to 0, timeout 300). pointerY ends lower than after Down (up_dir -1) and where the pointer appeared (back_dir 0). A rerun matches (match). The first zero says how far it got. Only frame counts and signs leave.`,
          save,
          talkMemory(),
          [
            { wait: { until: { mem: 'win0', differs: 0 }, timeout: WALK_TIMEOUT, press: { buttons: [...buttons, 'circle'], every: 8, hold: 7 } }, metric: 'win_wait' },
            { wait: { until: { mem: 'ptr_en', equals: 1 }, timeout: ASK_TIMEOUT, press: { buttons: ['circle'], every: 8, hold: 2 } }, metric: 'ptr_wait' },
            { mark: 'ask' },
            { buttons: ['down'], frames: 4 },
            { wait: { frames: 12 } },
            { mark: 'down' },
            { buttons: ['up'], frames: 4 },
            { wait: { frames: 12 } },
            { wait: { until: { mem: 'win0', equals: 6 }, timeout: 1 }, metric: 'still6' },
            { buttons: ['circle'], frames: 4 },
            { wait: { until: { mem: 'win0', equals: 0 }, timeout: 300 }, metric: 'close_wait' },
          ],
          [
            { change: { mem: 'ptr_y', is: 'decreased', signed: true, since: 'down' }, metric: 'up_dir' },
            { change: { mem: 'ptr_y', is: 'unchanged', signed: true, since: 'ask' }, metric: 'back_dir' },
            { sameState: 'rerun', metric: 'match' },
          ],
          ['load_done', 'win_wait', 'ptr_wait', 'up_dir', 'back_dir', 'still6', 'close_wait', 'match'],
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
