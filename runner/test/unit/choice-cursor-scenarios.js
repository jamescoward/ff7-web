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
// Attempt 2 (2b32561, results in notes/168-choice-cursor.md) gave each
// candidate's offset per axis within a factor of 2; its sweeps timed out in
// every direction but down (model 7 again), and a timed-out wait zeroes every
// value. Attempt 3 (the last in this budget) replaces 28f and 28g with fixed
// routes towards the candidates (28h): no wait can time out, so every value
// survives. Each route holds its pad directions for a fixed number of frames
// with no Circle, then presses Circle once and waits, and reports both
// windows' state and pointerEnabled, the talk-range sign for its target and
// per-axis signs against 256 field units.
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
/**
 * Attempt 3 routes (pad legs as [buttons, frames]). Attempt 1 measured the pad
 * mapping: up (-x, +y), down (+x, -y), left (-x, -y), right (+x, +y), so
 * up+left -x, down+right +x, up+right +y, down+left -y (inferred). Attempt 2's
 * brackets (|model - player| per axis, field units): 5 x 512-1024 (-), y
 * 512-1024 (+); 8 x < 512, y 1024-2048 (+); 4 and 6 x < 512, y 1024-2048 (-);
 * 9 x < 512, y 2048-4096 (-). Model 7 (x < 512, y 512-1024) is in range after
 * 300 frames of down, so a walk covers very roughly 2-3 units a frame per axis
 * (an estimate, not measured).
 */
const UP = ['up'];
const UL = ['up', 'left'];
const UR = ['up', 'right'];
const DL = ['down', 'left'];
export const ROUTES = [
  { name: '5-up-150', target: [5], legs: [[UP, 150]] },
  { name: '5-up-250', target: [5], legs: [[UP, 250]] },
  { name: '5-up-350', target: [5], legs: [[UP, 350]] },
  { name: '5-up-450', target: [5], legs: [[UP, 450]] },
  { name: '5-ul-up', target: [5], legs: [[UL, 100], [UP, 200]] },
  { name: '5-ur-up', target: [5], legs: [[UR, 100], [UP, 200]] },
  { name: '8-ur-300', target: [8], legs: [[UR, 300]] },
  { name: '8-ur-450', target: [8], legs: [[UR, 450]] },
  { name: '8-ur-600', target: [8], legs: [[UR, 600]] },
  { name: '46-dl-300', target: [4, 6], legs: [[DL, 300]] },
  { name: '46-dl-450', target: [4, 6], legs: [[DL, 450]] },
  { name: '46-dl-600', target: [4, 6], legs: [[DL, 600]] },
  { name: '9-dl-1000', target: [9], legs: [[DL, 1000]] },
];
/** Attempt 3: frames between the walk's end and Circle, Circle's hold, and the wait after it (#224: window 1 reached 6 28 frames after Circle). */
export const SETTLE = 10;
export const CIRCLE_HOLD = 4;
export const AFTER_CIRCLE = 40;
/** Attempt 3: the per-axis bracket, field units. */
export const NEAR_AXIS = 256;
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

/** Attempt 3 route memory: window 0 and 1 state and pointerEnabled, and each target's position and TalkRange. */
export function routeMemory(targets) {
  const m = {
    game_state: plain('gameState', 'u16', 'g_GameState, field 1'),
    x0: element('fieldX', 0, 'u32', 'the player\'s PosX, raw'),
    y0: element('fieldY', 0, 'u32', 'the player\'s PosY, raw'),
    solid0: element('fieldSolidRange', 0, 'u16', 'the player\'s SolidRange'),
  };
  for (const k of targets) {
    m[`x${k}`] = element('fieldX', k, 'u32', `model ${k}'s PosX, raw`);
    m[`y${k}`] = element('fieldY', k, 'u32', `model ${k}'s PosY, raw`);
    m[`talk${k}`] = element('fieldTalkRange', k, 'u16', `model ${k}'s TalkRange`);
  }
  for (const k of [0, 1]) m[`w${k}`] = win('dialogState', k, 'u16', '0 closed, 6 text shown and waiting for Circle');
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
const axis = (k, ax, plus, metric) => ({
  near: ax === 'x' ? { x: 'x0', y: 'y0', toX: `x${k}`, toY: 'y0', range: [], plus, shift: 12, is: 'within' } : { x: 'x0', y: 'y0', toX: 'x0', toY: `y${k}`, range: [], plus, shift: 12, is: 'within' },
  metric,
});
/** The talk rule's distance half (#237): model k within TalkRange + the player's SolidRange; -1 in range. */
const talkNear = (k) => ({ near: { x: `x${k}`, y: `y${k}`, toX: 'x0', toY: 'y0', range: [`talk${k}`, 'solid0'], shift: 12, is: 'within' }, metric: `n${k}` });

/** Route metrics, at most 8: windows 0 and 1 and their pointers, then per target n<k>, and axis signs while room is left. */
export function routeChecks(r) {
  const checks = [{ expect: { mem: 'game_state', equals: 1 } }, ...r.target.map(talkNear)];
  const room = 8 - 4 - r.target.length;
  const extra = [];
  for (const ax of ['y', 'x']) for (const k of r.target) extra.push(axis(k, ax, NEAR_AXIS, `a${ax}${k}`));
  checks.push(...extra.slice(0, room));
  return checks;
}

export function scenarios() {
  const loaded = {
    ...doc('save-boot-28a-steer-loaded', `Boot harness/saves/disc1-mds7st1.json (field ${FIELD_ID}) and load. Checks field mode in a settled field ${FIELD_ID} and keeps the state as snapshot ${SNAPSHOT}. Metrics: load_done, cnt (g_FieldModelCount).`, { disc: 1, save: 'disc1-mds7st1', slot: 1 }),
    input: LOAD,
    assert: SETTLED,
    metrics: ['load_done', 'cnt'],
    snapshot: SNAPSHOT,
  };
  // Attempt 3: fixed routes, no waits that can time out.
  const routes = ROUTES.map((r) => {
    const legs = r.legs.map(([b, f]) => `${b.join('+')} ${f} frames`).join(', then ');
    const assert = routeChecks(r);
    const axes = assert.filter((a) => a.near && a.metric.startsWith('a')).map((a) => a.metric);
    return {
      ...fromSnap(`save-boot-28h-route-${r.name}`, `Attempt 3 (route towards model ${r.target.join(' and ')}). Input: hold ${legs}, with no Circle; wait ${SETTLE} frames; press Circle for ${CIRCLE_HOLD} frames; wait ${AFTER_CIRCLE} frames. No wait can time out. Metrics: w0, w1 (raw state of windows 0 and 1: 6 is a message waiting), ptr0, ptr1 (raw pointerEnabled: 1 is an ask), ${r.target.map((k) => `n${k}`).join(', ')} (model within TalkRange + the player's SolidRange at the end: -1)${axes.length ? `, ${axes.join(', ')} (sign of |model - player| along that axis minus ${NEAR_AXIS} field units)` : ''}. The checks may fail by design.`),
      memory: routeMemory(r.target),
      input: [
        ...r.legs.map(([b, f]) => ({ buttons: b, frames: f })),
        { wait: { frames: SETTLE } },
        { buttons: ['circle'], frames: CIRCLE_HOLD },
        { wait: { frames: AFTER_CIRCLE } },
      ],
      assert,
      metrics: ['w0', 'w1', 'ptr0', 'ptr1', ...assert.filter((a) => a.metric).map((a) => a.metric)],
    };
  });
  return [loaded, ...routes];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const list = scenarios();
  for (const s of list) writeFileSync(path.join(OUT, `${s.name}.json`), `${JSON.stringify(s, null, 2)}\n`);
  console.log(`wrote ${list.length} scenarios`);
}
