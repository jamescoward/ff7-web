#!/usr/bin/env node
// #224: generate the Tier 2 scenarios for message window 1 in mds7st1.
//
//   node runner/test/unit/window1-scenarios.js
//
// Writes harness/scenarios/save-boot-17*.json. The walk is #168's lead
// (notes/168-choice-cursor.md, "Attempt 3 (fresh budget) results"): from
// harness/saves/disc1-mds7st1.json hold Down 300 frames and press Circle;
// window 1 read 6 there with window 0 closed.
// Addresses: Xeeynamo/ff7-decomp@2c9239a (reference only, no code copied):
// config/symbols.main.us.txt g_WindowData 0x80083274 (4 x 0x30), include/game.h
// WindowData (pointerEnabled +0x1A, state +0x2C).
// Original project code, GPL-2.0-or-later.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../../../harness/scenarios');
const DECOMP = 'Xeeynamo/ff7-decomp@2c9239a (reference only, no code) config/symbols.main.us.txt g_WindowData (0xC0), include/game.h WindowData and WindowState';

const WINDOW_DATA = 0x80083274;
const WINDOW_SIZE = 0x30;
const hex = (n) => `0x${n.toString(16)}`;
const win = (i) => ({
  addr: hex(WINDOW_DATA + i * WINDOW_SIZE + 0x2c),
  type: 'u16',
  description: `g_WindowData[${i}].state (s16 as u16; window ${i} of 4, stride 0x30): 0 closed, 6 text done and waiting for Circle. ${i === 0 ? 'Confirmed #108.' : 'Hypothesis (#224).'} ${DECOMP}.`,
});

export const FIELD_ID = 144; // mds7st1, the save's field (#99)
export const WALK_FRAMES = 300;

const MEMORY = {
  game_state: { addr: '0x8009c560', type: 'u16', description: 'g_GameState (s16 as u16; confirmed #76): field 1.' },
  map_cur: { addr: '0x8009a05c', type: 'u16', description: 'g_FieldCurrentMap (s16 as u16; confirmed #77): the field ID.' },
  loading: { addr: '0x800965e8', type: 'u16', description: 'g_IsFieldLoading (s16 as u16; confirmed #77): 2 in a settled field.' },
  w0: win(0),
  w1: win(1),
  w2: win(2),
  w3: win(3),
  ptr1: {
    addr: hex(WINDOW_DATA + WINDOW_SIZE + 0x1a),
    type: 'u8',
    description: `g_WindowData[1].pointerEnabled (+0x1A): 1 while a choice waits in state 6, 0 for a plain message (hypothesis; window 0's is #168's). ${DECOMP}, src/field/field_dialog.c FieldDialogAskUpdateStates.`,
  },
};

const LOAD = [
  { wait: { until: { mem: 'game_state', equals: 1 }, timeout: 3600, press: { buttons: ['circle'], every: 30, hold: 4 } } },
  { segment: 'field-loaded' },
];
const WALK = [{ buttons: ['down'], frames: WALK_FRAMES }];
const CIRCLE = [{ buttons: ['circle'], frames: 4 }];
const OPEN_WAIT = { wait: { until: { mem: 'w1', equals: 6 }, timeout: 300 } };
const OPEN = [{ ...OPEN_WAIT, metric: 'open_wait' }];

const base = (name, description) => ({
  $schema: '../schema/scenario.schema.json',
  format: 2,
  tier: 2,
  name,
  description,
  boot: { disc: 1, save: 'disc1-mds7st1', slot: 1 },
  memory: MEMORY,
});

export const SCENARIOS = [
  {
    ...base('save-boot-17a-window1-open', `#224 (acceptance: window 1 state 6). Boot harness/saves/disc1-mds7st1.json (field ${FIELD_ID}) and load. Hold Down ${WALK_FRAMES} frames, press Circle (4 frames), then wait until window 1's state reads 6, text shown and waiting for Circle (open_wait, timeout 300). Checks window 1 reads 6, window 0 reads 0, field mode in field ${FIELD_ID}, and that a rerun matches. Reports window 1's pointerEnabled (ptr1) and window 2's raw state.`),
    input: [...LOAD, ...WALK, ...CIRCLE, ...OPEN],
    assert: [
      { expect: { mem: 'w1', equals: 6 }, metric: 'waiting' },
      { expect: { mem: 'w0', equals: 0 }, metric: 'w0_closed' },
      { expect: { mem: 'game_state', equals: 1 }, metric: 'field_ok' },
      { expect: { mem: 'map_cur', equals: FIELD_ID } },
      { sameState: 'rerun', metric: 'match' },
    ],
    metrics: ['load_done', 'open_wait', 'waiting', 'w0_closed', 'field_ok', 'match', 'ptr1', 'w2'],
  },
  {
    ...base('save-boot-17b-window1-circle', `#224 (acceptance: window 1 closes on Circle). As save-boot-17a up to window 1 in state 6, then Circle (4 frames): wait until the state leaves 6 (left_wait, timeout 120), then press Circle every 30 frames (4 held) until it reads 0 (close_wait, timeout 1800; a message may have more than one page). Checks window 1 and window 0 read 0, field mode, and that a rerun matches. Reports window 3's raw state.`),
    input: [
      ...LOAD, ...WALK, ...CIRCLE, OPEN_WAIT, ...CIRCLE,
      { wait: { until: { mem: 'w1', differs: 6 }, timeout: 120 }, metric: 'left_wait' },
      { wait: { until: { mem: 'w1', equals: 0 }, timeout: 1800, press: { buttons: ['circle'], every: 30, hold: 4 } }, metric: 'close_wait' },
    ],
    assert: [
      { expect: { mem: 'w1', equals: 0 }, metric: 'closed' },
      { expect: { mem: 'w0', equals: 0 }, metric: 'w0_closed' },
      { expect: { mem: 'game_state', equals: 1 }, metric: 'field_ok' },
      { sameState: 'rerun', metric: 'match' },
    ],
    metrics: ['load_done', 'left_wait', 'close_wait', 'closed', 'w0_closed', 'field_ok', 'match', 'w3'],
  },
  {
    ...base('save-boot-17c-window1-walk-only', `#224 diagnostic (attempt 1; removed before merge). As save-boot-17a but with no Circle press: hold Down ${WALK_FRAMES} frames, then 34 frames with no input. w0..w3: raw states of the four windows. Window 1 not 0 here means the walk itself (a trigger), not a Circle talk, opens the message. Nothing waits after the load, so nothing can zero the results.`),
    input: [...LOAD, ...WALK, { wait: { frames: 34 } }],
    assert: [{ expect: { mem: 'map_cur', equals: FIELD_ID } }],
    metrics: ['load_done', 'w0', 'w1', 'w2', 'w3', 'ptr1'],
  },
];

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  for (const s of SCENARIOS) writeFileSync(path.join(OUT, `${s.name}.json`), `${JSON.stringify(s, null, 2)}\n`);
  console.log(`wrote ${SCENARIOS.length} scenarios`);
}
