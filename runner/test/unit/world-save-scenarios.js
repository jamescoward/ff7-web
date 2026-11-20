#!/usr/bin/env node
// #226: generate the Tier 2 scenarios for an in-game save from the world map.
//
//   node runner/test/unit/world-save-scenarios.js
//
// Writes harness/scenarios/save-boot-20*.json. Each loads
// harness/saves/disc1-wm1-kalm.json (the world map, #80), closes the entry
// message window (#108, save-boot-12c), opens the menu with Triangle, moves
// the main-menu cursor to Save with the menu planner (semantic/menus.js
// `main`: 10 rows that wrap, so row 0 → 9 is one Up), and presses through the
// save screens. A format 2 "card" check then reads the slot 1 card inside
// the sandbox (runner/savegen/read.js). Only numbers leave.
//
// The save screens' cursors and prompts have no source here, so attempt 1
// tries two button sequences (one scenario each): Circle only (the first
// card and the first file, overwriting the generated save in file 1, with
// any prompt answered by its default), and Down once in the file list (file
// 2, which is empty).
// Original project code, GPL-2.0-or-later.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { menuPlanArgs } from '../../../semantic/menus.js';
import { planCursorMove } from '../../../semantic/planner.js';
import { scriptFromPlan } from './planner-scenarios.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../../../harness/scenarios');
const DECOMP = 'Xeeynamo/ff7-decomp@9411173 (reference only, no code) config/symbols.main.us.txt';

export const SAVE = 'disc1-wm1-kalm';
export const SAVE_ROW = 9; // semantic/menus.js MENUS.main.labels: 'Save' is row 9 (labels are a hypothesis; the row count and wrapping are confirmed)
export const WORLD = 3; // g_GameState world map (confirmed #80)
export const MENU = 5; // g_GameState menu (confirmed #76)

const MEMORY = {
  game_state: { addr: '0x8009c560', type: 'u16', description: `g_GameState (s16 as u16): world 3 (confirmed #80), menu 5 (confirmed #76). ${DECOMP}` },
  win0: {
    addr: '0x800832a0',
    type: 'u16',
    description: 'g_WindowData[0].state (confirmed #108): 0 closed, 6 text shown and waiting for Circle. Xeeynamo/ff7-decomp@d4db3de (reference only, no code) include/game.h WindowData.',
  },
  row0: { addr: '0x8009a0d3', type: 'u8', description: `menuCursor (confirmed #78): the main-menu cursor row. ${DECOMP}, include/game.h MenuTable` },
};

/** The plan to the Save row, from the row the menu opens on. */
export const savePlan = () => planCursorMove({ from: 0, to: SAVE_ROW, ...menuPlanArgs('main') });

const circle = { buttons: ['circle'], frames: 4 };
const wait = (frames) => ({ wait: { frames } });

/** Load the save, close the entry window, open the menu, move to Save. */
const TO_SAVE_ROW = () => [
  { wait: { until: { mem: 'game_state', equals: WORLD }, timeout: 3600, press: { buttons: ['circle'], every: 30, hold: 4 } } },
  { wait: { until: { mem: 'win0', equals: 0 }, timeout: 600 } },
  { wait: { until: { mem: 'win0', in: [1, 14] }, timeout: 1200 } },
  { wait: { until: { mem: 'win0', equals: 6 }, timeout: 1200 } },
  circle,
  { wait: { until: { mem: 'win0', equals: 0 }, timeout: 300 } },
  wait(30),
  { wait: { until: { mem: 'game_state', equals: MENU }, timeout: 600, press: { buttons: ['triangle'], every: 60, hold: 4 } }, metric: 'menu_wait' },
  wait(30),
  ...scriptFromPlan(savePlan(), 'row0'),
  wait(30),
];

/** Circle every 90 frames, `n` times. */
const circles = (n) => Array.from({ length: n }, () => [circle, wait(90)]).flat();

const SEQUENCES = {
  'save-boot-20a-world-save-circle': {
    what: 'then Circle 8 times, 90 frames apart (Save, the first card, the first file, then any prompt\'s default), and 120 frames still',
    input: [...circles(8), wait(120)],
  },
  'save-boot-20b-world-save-file2': {
    what: 'then Circle twice, 90 frames apart (Save, the first card), Down once (file 2, empty), then Circle 6 times, 90 frames apart, and 120 frames still',
    input: [...circles(2), { buttons: ['down'], frames: 4 }, wait(30), ...circles(6), wait(120)],
  },
};

export const SCENARIOS = Object.entries(SEQUENCES).map(([name, s]) => ({
  $schema: '../schema/scenario.schema.json',
  format: 2,
  tier: 2,
  name,
  description: `#226 attempt 1: an in-game save from the world map. Load ${SAVE} (Circle every 30 frames until g_GameState 3), close the entry message window (as save-boot-12c: wait for state 0, then open, then 6; Circle; wait for 0), press Triangle every 60 frames until g_GameState 5 (menu_wait), move the main-menu cursor to Save (row ${SAVE_ROW}) with the menu planner (one Up: the menu wraps), ${s.what}. The card check compares the slot 1 card at the end with the card at the start: card_ok 1 when a slot changed and the first changed one holds a save with a right checksum and module 3 (world map). c_n: slots changed; c_slot: the first; c_sum: 1 if its checksum is right; c_mod, c_loc: its savemap module and location. match: a rerun from the same snapshot. Only numbers leave.`,
  boot: { disc: 1, save: SAVE, slot: 1 },
  memory: MEMORY,
  input: [...TO_SAVE_ROW(), ...s.input],
  assert: [
    { card: { module: WORLD, report: { changed: 'c_n', slot: 'c_slot', checksum: 'c_sum', module: 'c_mod', location: 'c_loc' } }, metric: 'card_ok' },
    { sameState: 'rerun', metric: 'match' },
  ],
  metrics: ['menu_wait', 'card_ok', 'c_n', 'c_slot', 'c_sum', 'c_mod', 'c_loc', 'match'],
}));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const s of SCENARIOS) writeFileSync(path.join(OUT, `${s.name}.json`), `${JSON.stringify(s, null, 2)}\n`);
  console.log(`wrote ${SCENARIOS.length} scenarios`);
}
