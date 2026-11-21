#!/usr/bin/env node
// #237: generate the Tier 2 scenarios that check the field talk rule at the
// one reachable talk known so far: mds7st1, hold Down 300 frames, press
// Circle, and window 1 opens (#224, save-boot-19a).
//
//   node runner/test/unit/talk-rule-scenarios.js
//
// Writes harness/scenarios/save-boot-21*.json. The rule, as the reference
// describes it (notes/112-field-interactables.md, semantic/nearby.js
// talkCheck): a model other than the player qualifies when its TalkOff is
// clear, its ground distance is below its TalkRange plus the player's
// SolidRange (field units, PosX/PosY >> 12) and its height differs from the
// player's by less than 256 field units. Facing is not checked here.
// Addresses: Xeeynamo/ff7-decomp@2c9239a (reference only, no code copied):
// config/symbols.main.us.txt g_FieldEntity 0x80074EA4, g_FieldState
// 0x8009ABF4; include/game.h FieldEntity (0x84 bytes: PosX +0x0C, PosY +0x10,
// PosZ +0x14, TalkOff +0x5B, SolidRange +0x6C, TalkRange +0x6E), FieldState
// (modelCount +0x28).
// Original project code, GPL-2.0-or-later.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../../../harness/scenarios');
const DECOMP = 'Xeeynamo/ff7-decomp@2c9239a (reference only, no code) config/symbols.main.us.txt g_FieldEntity, include/game.h FieldEntity';

export const FIELD_ENTITY = 0x80074ea4;
export const FIELD_ENTITY_SIZE = 0x84;
export const FIELD_ID = 144; // mds7st1, the save's field (#99)
export const WALK_FRAMES = 300; // #224's route
export const CONTROL_FRAMES = 150; // half the route
/** Models 1-6 were read by #168 (1-3 TalkOff set, 4-6 out of range on this walk); 7-9 were not watched (g_FieldModelCount 10). */
export const UNWATCHED = [7, 8, 9];

const hex = (n) => `0x${n.toString(16)}`;
const ent = (k, off) => FIELD_ENTITY + k * FIELD_ENTITY_SIZE + off;
const pos = (k, axis, off) => ({
  addr: hex(ent(k, off)),
  type: 'u32',
  description: `g_FieldEntity[${k}].Pos${axis} (s32 as u32, raw; >> 12 for field units). ${k === 0 ? (axis === 'Z' ? 'Hypothesis (fieldZ).' : 'Confirmed #77 for element 0.') : 'Hypothesis for this element (#99).'} ${DECOMP}.`,
});

const MEMORY = {
  game_state: { addr: '0x8009c560', type: 'u16', description: 'g_GameState (s16 as u16; confirmed #76): field 1.' },
  map_cur: { addr: '0x8009a05c', type: 'u16', description: 'g_FieldCurrentMap (s16 as u16; confirmed #77): the field ID. Also used as both y coordinates of the height checks, so their y difference is 0.' },
  loading: { addr: '0x800965e8', type: 'u16', description: 'g_IsFieldLoading (s16 as u16; confirmed #77): 2 in a settled field. Also the range (2) of the height checks.' },
  pm: { addr: '0x800965e0', type: 'u16', description: 'g_PlayerModelId (s16 as u16; confirmed 0 for md1stin and nmkin_1, #99): the player\'s model index.' },
  cnt: { addr: '0x8009ac1c', type: 'u16', description: `g_FieldState.modelCount (s16 as u16; confirmed #112): models in use. ${DECOMP}, FieldState.` },
  w0: { addr: '0x800832a0', type: 'u16', description: 'g_WindowData[0].state (s16 as u16): 0 closed, 6 waiting. Confirmed #108.' },
  w1: { addr: '0x800832d0', type: 'u16', description: 'g_WindowData[1].state (s16 as u16): 0 closed, 6 waiting. Confirmed for 0 and 6 (#224).' },
  w2: { addr: '0x80083300', type: 'u16', description: 'g_WindowData[2].state (s16 as u16). Hypothesis (#224).' },
  w3: { addr: '0x80083330', type: 'u16', description: 'g_WindowData[3].state (s16 as u16). Hypothesis (#224).' },
  x0: pos(0, 'X', 0x0c),
  y0: pos(0, 'Y', 0x10),
  z0: pos(0, 'Z', 0x14),
  solid0: { addr: hex(ent(0, 0x6c)), type: 'u16', description: `g_FieldEntity[0].SolidRange (field units; confirmed #112 for element 0). ${DECOMP}.` },
};
for (const k of [1, 2, 3, ...UNWATCHED]) {
  MEMORY[`x${k}`] = pos(k, 'X', 0x0c);
  MEMORY[`y${k}`] = pos(k, 'Y', 0x10);
  MEMORY[`z${k}`] = pos(k, 'Z', 0x14);
  MEMORY[`talk${k}`] = { addr: hex(ent(k, 0x6e)), type: 'u16', description: `g_FieldEntity[${k}].TalkRange (field units). Hypothesis (fieldTalkRange). ${DECOMP}.` };
  MEMORY[`off${k}`] = { addr: hex(ent(k, 0x5b)), type: 'u8', description: `g_FieldEntity[${k}].TalkOff: 0 talkable. Hypothesis (fieldTalkOff). ${DECOMP}.` };
}

/** sign of ground distance - (TalkRange_k + SolidRange_0), field units: -1 = the talk rule's distance part holds. */
const near = (k, is, metric) => ({ near: { x: 'x0', y: 'y0', toX: `x${k}`, toY: `y${k}`, range: [`talk${k}`, 'solid0'], shift: 12, is }, metric });
/**
 * Height part of the rule, |dz| < 256 field units, with the near check: both
 * y coordinates are the same location (difference 0), the shift is 19 (units
 * of 128 field units) and the range is g_IsFieldLoading, asserted to read 2.
 * floor(z0 >> 19) and floor(zk >> 19) less than 2 apart implies |dz| < 256
 * field units (sufficient, not necessary).
 */
const height = (k, metric) => ({ near: { x: 'z0', y: 'map_cur', toX: `z${k}`, toY: 'map_cur', range: ['loading'], shift: 19, is: 'within' }, metric });

const LOAD = [
  { wait: { until: { mem: 'game_state', equals: 1 }, timeout: 3600, press: { buttons: ['circle'], every: 30, hold: 4 } } },
  { segment: 'field-loaded' },
];
const SETTLED = [
  { expect: { mem: 'game_state', equals: 1 } },
  { expect: { mem: 'map_cur', equals: FIELD_ID } },
  { expect: { mem: 'loading', equals: 2 } },
];

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
    ...base('save-boot-21a-talk-rule-unwatched', `#237 attempt 1 (diagnostic). Boot harness/saves/disc1-mds7st1.json (field ${FIELD_ID}) and load. Hold Down ${WALK_FRAMES} frames (save-boot-19a's route) and stop before Circle. For models 7-9 (not watched by #168) reports the near sign of ground distance against TalkRange + the player's SolidRange (n7..n9; -1 within) and raw TalkOff (off7..off9); also the player model (pm). Fails by design where a model is not within.`),
    input: [...LOAD, { buttons: ['down'], frames: WALK_FRAMES }],
    assert: [...SETTLED, ...UNWATCHED.map((k) => near(k, 'within', `n${k}`))],
    metrics: ['n7', 'n8', 'n9', 'off7', 'off8', 'off9', 'pm', 'load_done'],
  },
  {
    ...base('save-boot-21b-talk-rule-height', `#237 attempt 1 (diagnostic). As save-boot-21a. Reports the height part of the rule for models 7-9 (h7..h9; -1 means floor(z >> 19) values less than 2 apart, so |dz| < 256 field units), the near sign for models 1-3 (TalkOff set per #168), and whether a rerun matches. Fails by design where a check does not hold.`),
    input: [...LOAD, { buttons: ['down'], frames: WALK_FRAMES }],
    assert: [
      ...SETTLED,
      ...UNWATCHED.map((k) => height(k, `h${k}`)),
      ...[1, 2, 3].map((k) => near(k, 'outside', `n${k}`)),
      { sameState: 'rerun', metric: 'match' },
    ],
    metrics: ['h7', 'h8', 'h9', 'n1', 'n2', 'n3', 'load_done', 'match'],
  },
  {
    ...base('save-boot-21c-talk-rule-control', `#237 attempt 1 (control). Boot and load as save-boot-21a, hold Down ${CONTROL_FRAMES} frames (half the route), press Circle (4 frames) and wait 60 frames. Checks windows 0-3 read 0 and models 7-9 are outside talk range (n7..n9 signs), and that a rerun matches.`),
    input: [...LOAD, { buttons: ['down'], frames: CONTROL_FRAMES }, { buttons: ['circle'], frames: 4 }, { wait: { frames: 60 } }],
    assert: [
      ...SETTLED,
      { expect: { mem: 'w0', equals: 0 } },
      { expect: { mem: 'w1', equals: 0 }, metric: 'w1_closed' },
      { expect: { mem: 'w2', equals: 0 } },
      { expect: { mem: 'w3', equals: 0 } },
      ...UNWATCHED.map((k) => near(k, 'outside', `n${k}`)),
      { sameState: 'rerun', metric: 'match' },
    ],
    metrics: ['w1_closed', 'w0', 'w3', 'n7', 'n8', 'n9', 'load_done', 'match'],
  },
];

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  for (const s of SCENARIOS) writeFileSync(path.join(OUT, `${s.name}.json`), `${JSON.stringify(s, null, 2)}\n`);
  console.log(`wrote ${SCENARIOS.length} scenarios`);
}
