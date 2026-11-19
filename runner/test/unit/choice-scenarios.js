// #168 (fresh budget, attempt 1): the walk and talk-range diagnostic in
// Wall Market's inn (mktinn), generated so the 17 committed scenarios are
// this file's output, not hand-written. choice-scenarios.test.js checks the
// committed files equal it.
//
//   node runner/test/unit/choice-scenarios.js    rewrite the files
//
// Why (notes/168-choice-cursor.md): the first budget's walks ended on waits
// that timed out, which zeroed every change check, so nothing said whether
// the player moved or came near a model. Here no wait follows the load: each
// walk is a fixed number of held frames, so x_dir / y_dir and the talk-range
// signs (a `near` check per model, the field talk rule's distance part:
// floor(hypot) < TalkRange + the player's SolidRange) always report.
//
// Addresses are entries of semantic/addresses.js (field entity array
// g_FieldEntity 0x80074EA4, stride 0x84; PosX +0x0C, PosY +0x10, TalkOff
// +0x5B, SolidRange +0x6C, TalkRange +0x6E; #77, #99, #112).
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
/** mktinn has 5 field models (#168 attempt 1, model_count 5): the player 0 and models 1-4. */
export const MODELS = [1, 2, 3, 4];
export const SAVE = 'disc1-mktinn';
export const FIELD_ID = 199;

const DECOMP = 'Xeeynamo/ff7-decomp@2c9239a (reference only, no code) include/game.h FieldEntity';

function memory() {
  const m = {
    game_state: { addr: '0x8009c560', type: 'u16', description: 'g_GameState (s16 as u16; confirmed #76): field 1.' },
    map_cur: { addr: '0x8009a05c', type: 'u16', description: 'g_FieldCurrentMap (s16 as u16; confirmed #77): the field ID.' },
    loading: { addr: '0x800965e8', type: 'u16', description: 'g_IsFieldLoading (s16 as u16; confirmed #77): 2 in a settled field.' },
    pos_x: { addr: at(0, 0x0c), type: 'u32', description: 'g_FieldEntity[0].PosX (s32 as u32; confirmed #77): the player (model 0, #99).' },
    pos_y: { addr: at(0, 0x10), type: 'u32', description: 'g_FieldEntity[0].PosY (s32 as u32; confirmed #77): the player.' },
    solid0: { addr: at(0, 0x6c), type: 'u16', description: `g_FieldEntity[0].SolidRange (confirmed #112, in 1..255): the player's part of the talk distance. ${DECOMP}.` },
    win0: { addr: '0x800832a0', type: 'u16', description: 'g_WindowData[0].state (dialogState, confirmed #108): 0 closed, 6 text shown and waiting.' },
  };
  for (const k of MODELS) {
    m[`m${k}_x`] = { addr: at(k, 0x0c), type: 'u32', description: `g_FieldEntity[${k}].PosX (s32 as u32; fieldX hypothesis for k >= 1, #99). ${DECOMP}.` };
    m[`m${k}_y`] = { addr: at(k, 0x10), type: 'u32', description: `g_FieldEntity[${k}].PosY (s32 as u32; fieldY hypothesis for k >= 1, #99). ${DECOMP}.` };
    m[`m${k}_talk`] = { addr: at(k, 0x6e), type: 'u16', description: `g_FieldEntity[${k}].TalkRange (fieldTalkRange, hypothesis, #112). ${DECOMP}.` };
    m[`m${k}_off`] = { addr: at(k, 0x5b), type: 'u8', description: `g_FieldEntity[${k}].TalkOff (fieldTalkOff, hypothesis, #112): not 0 = the model cannot be talked to. ${DECOMP}.` };
  }
  return m;
}

/** Load the generated save as save-boot-1-load does (#38), then wait for the field to settle. */
const LOAD = [
  { wait: { until: { mem: 'game_state', equals: 1 }, timeout: 3600, press: { buttons: ['circle'], every: 30, hold: 4 } } },
  { segment: 'field-loaded' },
];

/** The talk-distance sign of model k from the player at the end of the script: -1 within range. */
const near = (k) => ({
  near: { x: `m${k}_x`, y: `m${k}_y`, toX: 'pos_x', toY: 'pos_y', range: [`m${k}_talk`, 'solid0'], shift: 12, is: 'within' },
  metric: `n${k}`,
});

const base = (name, description, input, asserts, metrics) => ({
  $schema: '../schema/scenario.schema.json',
  format: 2,
  tier: 2,
  name,
  description,
  boot: { disc: 1, save: SAVE, slot: 1 },
  memory: memory(),
  input: [...LOAD, ...input],
  assert: [{ expect: { mem: 'map_cur', equals: FIELD_ID } }, ...asserts],
  metrics,
});

/** Pad directions for the sweep; the field's camera decides how each maps to PosX/PosY. */
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
/** Walk lengths (held frames): a short step, and a long walk that ends against whatever is in the way. */
export const WALKS = Object.freeze({ s: 40, l: 160 });
/** Still frames after a walk, so the last step has settled before the end reads. */
const SETTLE = 20;

export function choiceScenarios() {
  const out = [];
  out.push(
    base(
      'save-boot-16a-mktinn-talk-ranges',
      "#168 fresh budget, attempt 1 (diagnostic). Boot harness/saves/disc1-mktinn.json (Wall Market's inn, field 199) and load as save-boot-1-load does, then 60 still frames. For models 1-4: the talk-distance sign from the player (n1..n4: sign of floor(hypot(dx, dy)) - (TalkRange + the player's SolidRange), in field units, -1 within range), and self, the same check of the player against itself with its own SolidRange (must be -1: distance 0; checks the near check's wiring). Only frame counts and signs leave.",
      [{ wait: { frames: 60 } }],
      [
        { near: { x: 'pos_x', y: 'pos_y', toX: 'pos_x', toY: 'pos_y', range: ['solid0'], shift: 12, is: 'within' }, metric: 'self' },
        ...MODELS.map(near),
      ],
      ['load_done', 'self', ...MODELS.map((k) => `n${k}`), 'win0'],
    ),
  );
  out.push(
    base(
      'save-boot-16b-mktinn-talk-off',
      "#168 fresh budget, attempt 1 (diagnostic). As save-boot-16a: boot disc1-mktinn and load, 60 still frames. Reports TalkOff of models 1-4 (m1_off..m4_off: 0 = the model can be talked to; field talk rule, notes/112-field-interactables.md) Only these flag bytes and load_done leave.",
      [{ wait: { frames: 60 } }],
      [],
      ['load_done', ...MODELS.map((k) => `m${k}_off`)],
    ),
  );
  for (const [w, frames] of Object.entries(WALKS)) {
    for (const [dir, buttons] of Object.entries(DIRECTIONS)) {
      out.push(
        base(
          `save-boot-16-walk-${w}-${dir}`,
          `#168 fresh budget, attempt 1 (diagnostic walk). Boot disc1-mktinn and load, then hold ${buttons.join('+')} for ${frames} frames with no wait (so nothing can time out after the load) and ${SETTLE} still frames. x_dir / y_dir: the sign of the player's PosX / PosY change over the walk (the camera mapping here). n1..n4: each model's talk-distance sign from the player at the end (-1 within TalkRange + the player's SolidRange). win0: window 0's state at the end (not 0 if walking alone opened a message). Only signs, the state and load_done leave.`,
          [
            { mark: 'loaded' },
            { buttons, frames },
            { wait: { frames: SETTLE } },
          ],
          [
            { change: { mem: 'pos_x', is: 'changed', signed: true, since: 'loaded' }, metric: 'x_dir' },
            { change: { mem: 'pos_y', is: 'changed', signed: true, since: 'loaded' }, metric: 'y_dir' },
            ...MODELS.map(near),
          ],
          ['load_done', 'x_dir', 'y_dir', ...MODELS.map((k) => `n${k}`), 'win0'],
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
