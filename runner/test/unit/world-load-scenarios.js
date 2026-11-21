#!/usr/bin/env node
// #228: generate the Tier 2 scenario that loads a world-map save back after
// a restart.
//
//   node runner/test/unit/world-load-scenarios.js
//
// Writes harness/scenarios/save-boot-20d-world-save-load.json. It plays
// save-boot-20a's script unchanged (the in-game save from the world map,
// #226), then a format 2 restart step: back to the title boot point with the
// card the game has just written. From there it loads file 1 as save-boot-1
// and save-boot-7 do (Circle every 30 frames until g_GameState 3), and checks
// the world map as save-boot-7-world-kalm does (600 frames, the entry window
// closed with three Circle presses, a mark, a walk Down+Left).
//
// The generated save in slot 1 is also a world-map save at location 2, so a
// load alone can't tell the game's save from ours. The card check says which:
// card_ok shows slot 1 changed and holds a valid world-map save, and c_data
// (the card check's "savemap" report) shows the savemap bytes themselves were
// rewritten, not only the directory frame. Only numbers leave.
// Original project code, GPL-2.0-or-later.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SAVE, SCENARIOS as SAVE_SCENARIOS, WORLD } from './world-save-scenarios.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../../../harness/scenarios');
const DECOMP = 'Xeeynamo/ff7-decomp@9411173 (reference only, no code)';

/** The save scenario whose script this one plays first (Tier 2 green twice, #226). */
export const SAVE_SCENARIO = 'save-boot-20a-world-save-circle';
const saveScenario = () => SAVE_SCENARIOS.find((s) => s.name === SAVE_SCENARIO);

/** The location the save names, and the one the game's save holds (save-boot-20a: c_loc 2). */
export const LOCATION = 2;

/** Locations save-boot-7-world-kalm reads, with its descriptions. */
const LOAD_MEMORY = {
  map_cur: {
    addr: '0x8009a05c',
    type: 'u16',
    description: 'g_FieldCurrentMap (s16 as u16; confirmed #77): in the world map, the entry point the save names (save-boot-7-world-kalm).',
  },
  pos_x: {
    addr: '0x8010a560',
    type: 'u32',
    description: `Player actor (pool element 7) + 0x0C pos.vx (s32), as save-boot-7-world-kalm. ${DECOMP} src/world/world.h WorldActor.`,
  },
};

const circle = { buttons: ['circle'], frames: 4 };
const wait = (frames) => ({ wait: { frames } });

/**
 * After the restart: load file 1 as save-boot-7-world-kalm does (Circle every
 * 30 frames until g_GameState 3: the title cursor starts on Continue, the
 * card cursor on card 1 and the file cursor on file 1), 600 frames, three
 * Circle presses a second apart (the entry window), wait for window 0 to read
 * 0 (win_ok), 60 frames, a mark, 60 frames of Down+Left and 10 still.
 */
export const LOAD_BACK = () => [
  { restart: 'keep-card', note: 'back to the title boot point with the card the game wrote (#228)' },
  { wait: { until: { mem: 'game_state', equals: WORLD }, timeout: 3600, press: { buttons: ['circle'], every: 30, hold: 4 } }, metric: 'w_state' },
  wait(600),
  ...Array.from({ length: 3 }, () => [circle, wait(56)]).flat(),
  { wait: { until: { mem: 'win0', equals: 0 }, timeout: 300 }, metric: 'win_ok' },
  wait(60),
  { mark: 'ready' },
  { buttons: ['down', 'left'], frames: 60 },
  wait(10),
];

/**
 * The save script's steps without the metric names its waits give (menu_wait):
 * a scenario must list every metric it names, and this one's 8 go to the load.
 */
export const unnamed = (steps) => steps.map(({ metric, ...rest }) => rest);

export function loadScenarioDoc() {
  const s = saveScenario();
  return {
    $schema: '../schema/scenario.schema.json',
    format: 2,
    tier: 2,
    name: 'save-boot-20d-world-save-load',
    description: `#228: a world-map save made in game loads back after a restart. Plays ${SAVE_SCENARIO}'s script unchanged, without its wait's metric name (load ${SAVE}, close the entry window, Triangle until the world loop's menu state, 600 frames, the planned Up to Save, Circle ×8, 120 frames: the game overwrites file 1). Then a restart step: the title boot point's state again, with the card as the game left it (the card is flagged as new, as for a save boot). Then load as save-boot-7-world-kalm does: Circle every 30 frames until g_GameState reads ${WORLD} (w_state), 600 frames, three Circle presses a second apart, window 0 reads 0 (win_ok: frames waited), 60 frames, a mark, 60 frames of Down+Left, 10 still. Checks: g_GameState ${WORLD} (world_ok); g_FieldCurrentMap names location ${LOCATION} (map_ok); the player's pos.vx changed since the mark (x_dir: the sign only); the card check over the whole script (card_ok: slot 1 changed and holds a world-map save with a right checksum; c_data: 1 if that slot's savemap bytes changed, so the game rewrote the save and not only its directory frame); a rerun from the same snapshot, restart included, ends in the same state (match). The generated save is also a world-map save at location ${LOCATION}, which is why card_ok and c_data are reported with the load. Only numbers leave.`,
    boot: s.boot,
    memory: { ...s.memory, ...LOAD_MEMORY },
    input: [...unnamed(s.input), ...LOAD_BACK()],
    assert: [
      { card: { module: WORLD, report: { savemap: 'c_data' } }, metric: 'card_ok' },
      { expect: { mem: 'game_state', equals: WORLD }, metric: 'world_ok' },
      { expect: { mem: 'map_cur', equals: LOCATION }, metric: 'map_ok' },
      { change: { mem: 'pos_x', is: 'changed', signed: true, since: 'ready' }, metric: 'x_dir' },
      { sameState: 'rerun', metric: 'match' },
    ],
    metrics: ['card_ok', 'c_data', 'w_state', 'win_ok', 'world_ok', 'map_ok', 'x_dir', 'match'],
  };
}

export const SCENARIOS = [loadScenarioDoc()];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const s of SCENARIOS) writeFileSync(path.join(OUT, `${s.name}.json`), `${JSON.stringify(s, null, 2)}\n`);
  console.log(`wrote ${SCENARIOS.length} scenario`);
}
