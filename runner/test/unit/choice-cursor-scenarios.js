#!/usr/bin/env node
// #168, third budget (owner, 2026-11-23): generate the Tier 2 scenarios that
// look for a choice window (field opcode ask) in mds7st1.
//
//   node runner/test/unit/choice-cursor-scenarios.js
//
// Writes harness/scenarios/save-boot-28*.json.
//
// Attempt 1 (steering diagnostic). #224's 19a/19b already pressed Circle
// through the window-1 message on the down walk (model 7's talk, #237): it is
// a plain message (pointerEnabled 0) that closes after one Circle press. So
// the next candidates are the other talkable models in the field: 4-6 (#168)
// and 8-9 (#237), all TalkOff 0, none in range on any straight walk tried.
// Steering to them needs (1) which world axis each pad direction moves the
// player along (the field camera), and (2) where each model stands relative
// to the player. Only signs leave the run.
//
// Attempt 1 (de91358, results in notes/168-choice-cursor.md) measured the
// pad mapping and each model's side; its probes are removed except the
// snapshot keeper 28a. Attempt 2 adds per-axis distance brackets (28f) and
// walk-and-talk sweeps in 8 directions that watch window 1 (28g).
//
// Addresses: semantic/addresses.js (fieldX, fieldY, fieldTalkRange,
// fieldTalkOff; element k at address + k * stride). Reference only, no code:
// Xeeynamo/ff7-decomp@2c9239a include/game.h FieldEntity.
// Original project code, GPL-2.0-or-later.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADDRESS_TABLE } from '../../../semantic/addresses.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../../../harness/scenarios');
const SRC = 'semantic/addresses.js; Xeeynamo/ff7-decomp@2c9239a (reference only, no code) include/game.h FieldEntity';

export const FIELD_ID = 144; // mds7st1, the save's field (#99)
export const SNAPSHOT = 'mds7st1-loaded';
/** Talkable models other than #237's talker (7): TalkOff 0 per #168 (4-6) and #237 (8, 9). */
export const CANDIDATES = [4, 5, 6, 8, 9];
/** #237's talker: the down walk of 300 frames brings it into range, so its side calibrates the mapping. */
export const TALKER = 7;
/** Attempt 2: per-axis brackets (field units) for |model - player| along PosX and along PosY. */
export const AXIS = [512, 1024, 2048, 4096];
/**
 * Attempt 2: walk-and-talk sweep directions. Attempt 1 measured the pad mapping
 * (28b): up (-x, +y), down (+x, -y), left (-x, -y), right (+x, +y), so the
 * diagonals move along one world axis: up+left -x, down+right +x, up+right +y,
 * down+left -y.
 */
export const SWEEP = {
  up: ['up'], down: ['down'], left: ['left'], right: ['right'],
  'up-left': ['up', 'left'], 'down-right': ['down', 'right'], 'up-right': ['up', 'right'], 'down-left': ['down', 'left'],
};
export const SWEEP_TIMEOUT = 600;
export const DONE_TIMEOUT = 300;
/** Window k's base: g_WindowData + k * 0x30 (4 windows). */
export const WINDOW_STRIDE = 0x30;

const hex = (n) => `0x${n.toString(16)}`;
const entry = (name) => {
  const e = ADDRESS_TABLE.entries.find((x) => x.name === name);
  if (!e) throw new RangeError(`no address-table entry ${name}`);
  return e;
};
const element = (name, k, type, what) => {
  const e = entry(name);
  return { addr: hex(e.address + k * (e.stride ?? 0)), type, description: `${name}[${k}]: ${what} (${e.status} for the array; element ${k}${k === 0 ? '' : ' is a hypothesis for positions, #99'}). ${SRC}` };
};
const plain = (name, type, what) => ({ addr: hex(entry(name).address), type, description: `${name} (${entry(name).status}): ${what}. ${SRC}` });

export function memory() {
  const m = {
    game_state: plain('gameState', 'u16', 'g_GameState, field 1'),
    map_cur: plain('fieldId', 'u16', 'the field ID'),
    loading: plain('fieldLoading', 'u16', '2 in a settled field'),
    cnt: plain('fieldModelCount', 'u16', 'models in use'),
    x0: element('fieldX', 0, 'u32', 'the player\'s PosX, raw'),
    y0: element('fieldY', 0, 'u32', 'the player\'s PosY, raw'),
  };
  for (const k of [TALKER, ...CANDIDATES]) {
    m[`x${k}`] = element('fieldX', k, 'u32', `model ${k}'s PosX, raw`);
    m[`y${k}`] = element('fieldY', k, 'u32', `model ${k}'s PosY, raw`);
  }
  return m;
}

/** Window k's field (entry name, element k at address + k * 0x30); window 0 is the entry itself. */
const win = (name, k, type, what) => {
  const e = entry(name);
  return { addr: hex(e.address + k * WINDOW_STRIDE), type, description: `g_WindowData[${k}] via ${name} (${e.status} for window 0; window ${k} ${k === 0 ? 'is the entry' : 'is a hypothesis, #224'}): ${what}. ${SRC}; include/game.h WindowData, stride 0x30.` };
};

/** Attempt 2 sweep memory: the window states, both windows' pointerEnabled, and model 7's talk range. */
export function sweepMemory() {
  const m = {
    game_state: plain('gameState', 'u16', 'g_GameState, field 1'),
    x0: element('fieldX', 0, 'u32', 'the player\'s PosX, raw'),
    y0: element('fieldY', 0, 'u32', 'the player\'s PosY, raw'),
    [`x${TALKER}`]: element('fieldX', TALKER, 'u32', `model ${TALKER}'s PosX, raw`),
    [`y${TALKER}`]: element('fieldY', TALKER, 'u32', `model ${TALKER}'s PosY, raw`),
    [`talk${TALKER}`]: element('fieldTalkRange', TALKER, 'u16', `model ${TALKER}'s TalkRange`),
    solid0: element('fieldSolidRange', 0, 'u16', 'the player\'s SolidRange'),
  };
  for (const k of [0, 1, 2, 3]) m[`w${k}`] = win('dialogState', k, 'u16', '0 closed, 6 text shown and waiting for Circle');
  for (const k of [0, 1]) m[`ptr${k}`] = win('dialogPointer', k, 'u8', 'pointerEnabled: 1 while an ask waits in state 6');
  return m;
}

const LOAD = [
  { wait: { until: { mem: 'game_state', equals: 1 }, timeout: 3600, press: { buttons: ['circle'], every: 30, hold: 4 } } },
  { segment: 'field-loaded' },
];
const SETTLED = [
  { expect: { mem: 'game_state', equals: 1 } },
  { expect: { mem: 'map_cur', equals: FIELD_ID } },
  { expect: { mem: 'loading', equals: 2 } },
];
const doc = (name, description, boot) => ({
  $schema: '../schema/scenario.schema.json',
  format: 2,
  tier: 2,
  name,
  description: `#168 third budget, generated by runner/test/unit/choice-cursor-scenarios.js. ${description} Only signs and frame counts leave.`,
  boot,
  memory: memory(),
});
const fromSnap = (name, description) => doc(name, `Boots from snapshot ${SNAPSHOT} (save-boot-28a's end). ${description}`, { from: SNAPSHOT });

/** Sign of |model k - player| along one axis (field units) minus plus: the other axis is the player's own. */
const axis = (k, ax, plus) => ({
  near: ax === 'x' ? { x: 'x0', y: 'y0', toX: `x${k}`, toY: 'y0', range: [], plus, shift: 12, is: 'within' } : { x: 'x0', y: 'y0', toX: 'x0', toY: `y${k}`, range: [], plus, shift: 12, is: 'within' },
  metric: `a${ax}${k}_${plus / 512}`,
});

export function scenarios() {
  const loaded = {
    ...doc('save-boot-28a-steer-loaded', `Boot harness/saves/disc1-mds7st1.json (field ${FIELD_ID}) and load. Checks field mode in a settled field ${FIELD_ID} and keeps the state as snapshot ${SNAPSHOT}. Metrics: load_done, cnt (g_FieldModelCount).`, { disc: 1, save: 'disc1-mds7st1', slot: 1 }),
    input: LOAD,
    assert: SETTLED,
    metrics: ['load_done', 'cnt'],
    snapshot: SNAPSHOT,
  };
  // Attempt 2 (a): how far each model is along each world axis, to plan two-leg routes.
  const axes = [...CANDIDATES, TALKER].map((k) => ({
    ...fromSnap(`save-boot-28f-axis-${k}`, `Attempt 2. Input: wait 1 frame. Metrics: ax${k}_<n> and ay${k}_<n>, the sign of |model ${k}'s PosX - the player's| (and the same for PosY), in field units, minus 512 * n, for n = ${AXIS.map((p) => p / 512).join(', ')}. The checks may fail by design.`),
    input: [{ wait: { frames: 1 } }],
    assert: ['x', 'y'].flatMap((ax) => AXIS.map((p) => axis(k, ax, p))),
    metrics: ['x', 'y'].flatMap((ax) => AXIS.map((p) => `a${ax}${k}_${p / 512}`)),
  }));
  // Attempt 2 (b): walk-and-talk sweeps that watch window 1 (#224's talk used it; earlier sweeps watched window 0 only).
  const sweeps = Object.entries(SWEEP).map(([d, buttons]) => ({
    ...fromSnap(`save-boot-28g-talk-${d}`, `Attempt 2. Input: hold ${buttons.join('+')} with Circle for 7 of every 8 frames (a Circle edge every 8 frames while walking) until window 1 leaves state 0 (win_wait, timeout ${SWEEP_TIMEOUT}); then, with no input, until window 1 reads 6 (done_wait, timeout ${DONE_TIMEOUT}). Metrics: win_wait, done_wait, ptr1 (window 1's pointerEnabled: 1 is an ask), ptr0, w0, w2 (raw; they survive a timeout), n${TALKER} (model ${TALKER} within talk range: -1, so the talk is #224's plain message). The checks may fail by design.`),
    memory: sweepMemory(),
    input: [
      { wait: { until: { mem: 'w1', differs: 0 }, timeout: SWEEP_TIMEOUT, press: { buttons: [...buttons, 'circle'], every: 8, hold: 7 } }, metric: 'win_wait' },
      { wait: { until: { mem: 'w1', equals: 6 }, timeout: DONE_TIMEOUT }, metric: 'done_wait' },
    ],
    assert: [
      { expect: { mem: 'game_state', equals: 1 } },
      { near: { x: `x${TALKER}`, y: `y${TALKER}`, toX: 'x0', toY: 'y0', range: [`talk${TALKER}`, 'solid0'], shift: 12, is: 'within' }, metric: `n${TALKER}` },
    ],
    metrics: ['win_wait', 'done_wait', 'ptr1', 'ptr0', 'w0', 'w2', `n${TALKER}`],
  }));
  return [loaded, ...axes, ...sweeps];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const list = scenarios();
  for (const s of list) writeFileSync(path.join(OUT, `${s.name}.json`), `${JSON.stringify(s, null, 2)}\n`);
  console.log(`wrote ${list.length} scenarios`);
}
