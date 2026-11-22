// The Tier 2 scenarios of #246 (Materia list order when the inventory has
// empty slots), generated so the main-menu move to Materia is the menu
// planner's output. materia-gap.test.js checks the committed files equal this.
//
//   node runner/test/unit/materia-gap-scenarios.js    rewrite the files
//
// #244 confirmed the list cursors (materiaListRow, materiaListOffset) and that
// list index 11 is inventory slot 11, but only for a save whose slots 0-11 are
// all filled. Here materia sits in slots 0, 3 and 5 only. Hypothesis H1: the
// list shows every inventory slot in order, empty ones included, so the list
// index is the inventory slot. The EQIPMENU overlay is not decompiled in
// Xeeynamo/ff7-decomp@33ce78c (reference only, no code copied).
// Original project code, GPL-2.0-or-later.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADDRESS_TABLE, CHARACTER_RECORD_SIZE, MENU_OVERLAY_MATERIA } from '../../../semantic/addresses.js';
import { menuPanelPlan } from '../../../semantic/menu-panel.js';
import { MENUS } from '../../../semantic/menus.js';
import { SCENARIO_DIR, scriptFromPlan, serialise } from './planner-scenarios.js';

const hex = (n) => `0x${n.toString(16)}`;
const entry = (name) => {
  const e = ADDRESS_TABLE.entries.find((x) => x.name === name);
  if (!e) throw new Error(`no address entry ${name}`);
  return e;
};

/** The save the scenarios load: harness/saves/disc1-md1stin-materia-gaps.json. */
export const SAVE = 'disc1-md1stin-materia-gaps';
export const MATERIA_ROW = MENUS.main.labels.indexOf('Materia');
/**
 * Author-chosen materia: the ID #241 and #244 used (49), in slots 0, 3 and 5
 * only, with AP equal to the slot so each slot's packed word is distinct.
 */
export const MATERIA = Object.freeze([0, 3, 5].map((slot) => Object.freeze({ slot, id: 49, ap: slot })));
/** The packed materia word of a slot in the save (AP << 8 | ID; #117). */
export const wordOf = (slot) => {
  const m = MATERIA.find((x) => x.slot === slot);
  return m ? ((m.ap << 8) | m.id) >>> 0 : MATERIA_EMPTY;
};
/** An empty materia word (ID 0xFF; #117). */
export const MATERIA_EMPTY = 0xffffffff;
/** 26a: Downs in the list before Circle. Under H1 the cursor lands on index 3, inventory slot 3 (filled, after two empty slots). */
export const GAP_DOWNS = 3;
/** 26b: Downs before Circle. Under H1 index 1 is inventory slot 1, which is empty. */
export const EMPTY_DOWNS = 1;
const SETTLE = 30;

const matSlot = (i) => ({ addr: hex(entry('materiaSlot').address + 4 * i), type: 'u32', description: `materiaSlot[${i}] (confirmed #117).` });
const MEMORY = {
  game_state: { addr: '0x8009c560', type: 'u16', description: 'g_GameState (s16 as u16; confirmed #76): field 1, menu 5.' },
  map_cur: { addr: '0x8009a05c', type: 'u16', description: 'g_FieldCurrentMap (s16 as u16; confirmed #77): the field ID.' },
  loading: { addr: '0x800965e8', type: 'u16', description: 'g_IsFieldLoading (s16 as u16; confirmed #77): 2 in a settled field (the field-loaded segment waits on it).' },
  row0: { addr: '0x8009a0d3', type: 'u8', description: 'menuCursor (confirmed #78): the main-menu cursor, row 0 = Item.' },
  menu_ovl: { addr: hex(entry('menuOverlay').address), type: 'u32', description: 'menuOverlay (confirmed; 3 = the Materia screen, #241).' },
  l_row: { addr: hex(entry('materiaListRow').address), type: 'u8', description: 'materiaListRow (confirmed #244): the highlighted row on the page, 0-9.' },
  l_off: { addr: hex(entry('materiaListOffset').address), type: 'u8', description: 'materiaListOffset (confirmed #244; low byte of an s16): the list index on the top row.' },
  wm0: { addr: hex(entry('characterWeaponMateria').address + CHARACTER_RECORD_SIZE * 0), type: 'u32', description: "characterWeaponMateria[record 0], slot 0 (confirmed #117): Cloud's first weapon materia slot; empty in the save." },
  mat0: matSlot(0),
  mat3: matSlot(3),
  mat5: matSlot(5),
};

/** Load the save and open the field menu, as save-boot-22a and 25b do. */
const OPEN_MENU = [
  { wait: { until: { mem: 'game_state', equals: 1 }, timeout: 3600, press: { buttons: ['circle'], every: 30, hold: 4 } } },
  { segment: 'field-loaded' },
  { wait: { until: { mem: 'map_cur', equals: 116 }, timeout: 1 } },
  { wait: { frames: 60 } },
  { wait: { until: { mem: 'game_state', equals: 5 }, timeout: 600, press: { buttons: ['triangle'], every: 60, hold: 4 } } },
  { wait: { frames: 60 } },
  { wait: { until: { mem: 'row0', equals: 0 }, timeout: 1 } },
];
const PRESS = (button) => ({ buttons: [button], frames: 4 });
const until = (mem, equals, metric, timeout = SETTLE) => ({ wait: { until: { mem, equals }, timeout }, ...(metric ? { metric } : {}) });
const GAP = { wait: { frames: 10 } };

export function materiaGapScenarios() {
  const openList = [
    ...OPEN_MENU,
    ...scriptFromPlan(menuPanelPlan(0, MATERIA_ROW), 'row0', undefined),
    { wait: { frames: 60 } },
    { wait: { until: { mem: 'menu_ovl', equals: MENU_OVERLAY_MATERIA }, timeout: 600, press: { buttons: ['circle'], every: 60, hold: 4 } }, metric: 'ovl_wait' },
    { wait: { frames: 120 } },
    PRESS('circle'),
    { wait: { frames: 60 } },
    until('l_row', 0, undefined, 1),
    until('l_off', 0, undefined, 1),
  ];
  const downs = (n, metric) => {
    const out = [];
    for (let k = 1; k <= n; k++) out.push(PRESS('down'), until('l_row', k, k === n ? metric : undefined), GAP);
    return out;
  };
  const base = { $schema: '../schema/scenario.schema.json', format: 2, tier: 2, boot: { disc: 1, save: SAVE, slot: 1 }, memory: MEMORY };
  const opening = `Load harness/saves/${SAVE}.json (Cloud alone, materia slots empty, materia 49 in inventory slots 0, 3 and 5 only, AP = slot), open the field menu, plan the main-menu cursor 0 to ${MATERIA_ROW} (semantic/menu-panel.js), Circle every 60 frames until menu_ovl reads ${MENU_OVERLAY_MATERIA} (ovl_wait), 120 frames, Circle (opens the list for weapon slot 0, #241) and 60 frames; the list row and offset read 0 (#244).`;
  const unchanged = (slots) => slots.map((i) => ({ expect: { mem: `mat${i}`, equals: wordOf(i) } }));

  const gap = {
    ...base,
    name: 'save-boot-26a-materia-list-gap',
    description: `#246 (acceptance, hypothesis H1): the Materia list keeps empty inventory slots in place, so list index = inventory slot. ${opening} Down ${GAP_DOWNS} times, each a 4-frame press, a wait of at most ${SETTLE} frames for the list row to read the next index (w_row3 for the last; under H2, a compacted list, the row stops at 2 and that wait fails), then 10 frames. Then mark, Circle, and wait until inventory slot 3 reads empty (eq_wait). Checks: slot 3 empty and changed since the mark (took_ok), slots 0 and 5 unchanged, Cloud's weapon slot 0 holds slot 3's word ${hex(wordOf(3))}, the offset still 0, still on overlay ${MENU_OVERLAY_MATERIA} in the menu, a rerun matches. Reports the raw list row at the end. Only frame counts, 1/0, indices and author-chosen words leave.`,
    input: [
      ...openList,
      ...downs(GAP_DOWNS, 'w_row3'),
      { mark: 'before-equip' },
      PRESS('circle'),
      { wait: { until: { mem: 'mat3', equals: MATERIA_EMPTY }, timeout: 120 }, metric: 'eq_wait' },
      { wait: { frames: SETTLE } },
    ],
    assert: [
      { expect: { mem: 'mat3', equals: MATERIA_EMPTY }, metric: 'took_ok' },
      { change: { mem: 'mat3', is: 'changed', since: 'before-equip' } },
      ...unchanged([0, 5]),
      { expect: { mem: 'wm0', equals: wordOf(3) } },
      { expect: { mem: 'l_off', equals: 0 } },
      { expect: { mem: 'menu_ovl', equals: MENU_OVERLAY_MATERIA } },
      { expect: { mem: 'game_state', equals: 5 } },
      { sameState: 'rerun', metric: 'match' },
    ],
    metrics: ['load_done', 'ovl_wait', 'w_row3', 'eq_wait', 'took_ok', 'wm0', 'l_row', 'match'],
  };

  const empty = {
    ...base,
    name: 'save-boot-26b-materia-list-empty-entry',
    description: `#246 (acceptance, hypothesis H1): Circle on an empty list entry moves no materia. ${opening} Down ${EMPTY_DOWNS} time (4-frame press, a wait of at most ${SETTLE} frames for the list row to read 1, w_row1), 10 frames, mark, Circle, 120 frames. Checks: Cloud's weapon slot 0 still empty and unchanged since the mark, inventory slots 0, 3 and 5 unchanged, still on overlay ${MENU_OVERLAY_MATERIA} in the menu, a rerun matches. Reports the raw list row and offset at the end (where the cursor went after Circle). Only frame counts, 1/0 and indices leave.`,
    input: [
      ...openList,
      ...downs(EMPTY_DOWNS, 'w_row1'),
      { mark: 'before-circle' },
      PRESS('circle'),
      { wait: { frames: 120 } },
    ],
    assert: [
      { expect: { mem: 'wm0', equals: MATERIA_EMPTY }, metric: 'wm0_empty' },
      { change: { mem: 'wm0', is: 'unchanged', since: 'before-circle' } },
      ...unchanged([0, 3, 5]),
      { expect: { mem: 'menu_ovl', equals: MENU_OVERLAY_MATERIA } },
      { expect: { mem: 'game_state', equals: 5 } },
      { sameState: 'rerun', metric: 'match' },
    ],
    metrics: ['load_done', 'ovl_wait', 'w_row1', 'wm0_empty', 'l_row', 'l_off', 'match'],
  };
  return [gap, empty];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const s of materiaGapScenarios()) writeFileSync(path.join(SCENARIO_DIR, `${s.name}.json`), serialise(s));
}
