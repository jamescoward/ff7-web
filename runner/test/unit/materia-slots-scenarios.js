// The Tier 2 scenarios of #255 (Materia screen: armor row, slot columns
// >= 2, list scroll-back and the list end), generated so every cursor move
// is the semantic layer's own plan: menuPanelPlan, materiaRowPlan,
// materiaColumnPlan and materiaListPlan. materia-slots.test.js checks the
// committed files equal this.
//
//   node runner/test/unit/materia-slots-scenarios.js    rewrite the files
//
// The save gives Cloud weapon 4 and armor 8 (author-chosen numbers). That
// they have 8 and at least 1 materia slots is a source claim from general
// knowledge of the game, not read from any data: 30a measures the weapon's
// columns, and 30b only passes if column 7 exists. Hypotheses:
// - H3: on a weapon with 8 slots, Right moves the column 0 to 7 and never
//   wraps (30a, 30b);
// - H4: the armor row's list fills the armor's materia slots
//   (characterArmorMateria) as the weapon row's fills the weapon's (30c);
// - H2b: Up at list row 0 with offset > 0 scrolls back one entry, row
//   staying 0 (materiaListStep; 30c);
// - the list end: what Down does at inventory slot 199 is measured, not
//   assumed (30d); plans keep never wrapping.
// The EQIPMENU overlay is not decompiled in Xeeynamo/ff7-decomp@33ce78c
// (reference only, no code copied).
// Original project code, GPL-2.0-or-later.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADDRESS_TABLE, MENU_OVERLAY_MATERIA } from '../../../semantic/addresses.js';
import {
  MATERIA_INVENTORY_SLOTS, MATERIA_MAX_COLUMNS, MATERIA_ROW_ARMOR, MATERIA_ROW_WEAPON, materiaColumnPlan, materiaListPlan, materiaRowPlan,
} from '../../../semantic/materia-screen.js';
import { menuPanelPlan } from '../../../semantic/menu-panel.js';
import { MENUS } from '../../../semantic/menus.js';
import { scriptFromListPlan } from './materia-plan-scenarios.js';
import { SCENARIO_DIR, scriptFromPlan, serialise } from './planner-scenarios.js';

const hex = (n) => `0x${n.toString(16)}`;
const entry = (name) => {
  const e = ADDRESS_TABLE.entries.find((x) => x.name === name);
  if (!e) throw new Error(`no address entry ${name}`);
  return e;
};

/** The save the scenarios load: harness/saves/disc1-md1stin-materia-slots.json. */
export const SAVE = 'disc1-md1stin-materia-slots';
/** Author-chosen equipment numbers (weapon 0-127, armor 0-31); slot counts are a source claim (see the header). */
export const WEAPON = 4;
export const ARMOR = 8;
/** The weapon's claimed slot count (H3). */
export const WEAPON_COLUMNS = MATERIA_MAX_COLUMNS;
export const MATERIA_ROW = MENUS.main.labels.indexOf('Materia');
/** The last inventory slot: the list's end. */
export const LAST_SLOT = MATERIA_INVENTORY_SLOTS - 1;
/** Author-chosen materia: ID 49 in slots 2, 7, 13 and the last slot, AP = slot, so each word is distinct. */
export const MATERIA = Object.freeze([2, 7, 13, LAST_SLOT].map((slot) => Object.freeze({ slot, id: 49, ap: slot })));
export const MATERIA_EMPTY = 0xffffffff;
export const wordOf = (slot) => {
  const m = MATERIA.find((x) => x.slot === slot);
  return m ? ((m.ap << 8) | m.id) >>> 0 : MATERIA_EMPTY;
};
export const LIST_START = Object.freeze({ row: 0, offset: 0 });

/** 30a: blind Rights on the weapon row, one more than H3's last column, so the end column tells a stop from a wrap. */
export const MEASURE_RIGHTS = WEAPON_COLUMNS;
/** 30b: the weapon column filled (the last under H3) and the inventory slot it takes. */
export const FAR_COLUMN = WEAPON_COLUMNS - 1;
export const toFarColumn = materiaColumnPlan(0, FAR_COLUMN, undefined, WEAPON_COLUMNS);
export const COLUMN_SLOT = 7;
export const toColumnSlot = materiaListPlan(LIST_START, COLUMN_SLOT);
/** 30c: the armor row, column 0; the list goes to slot 13 (past page 1) and back to slot 2, scrolling back twice (H2b). */
export const toArmor = materiaRowPlan(MATERIA_ROW_WEAPON, MATERIA_ROW_ARMOR);
export const toThirteen = materiaListPlan(LIST_START, 13);
export const BACK_SLOT = 2;
export const toBackSlot = materiaListPlan(toThirteen.steps.at(-1), BACK_SLOT);
/** 30d: the plan to the last slot, then one more Down. */
export const toLast = materiaListPlan(LIST_START, LAST_SLOT);
/** 30d: frames between Down presses on the way to slot 199 (the plan's hold + gap), and the wait's limit. */
export const LAST_EVERY = 12;
export const LAST_TIMEOUT = 6000;
const SETTLE = 30;

const matSlot = (i) => ({ addr: hex(entry('materiaSlot').address + 4 * i), type: 'u32', description: `materiaSlot[${i}] (confirmed #117).` });
const weaponSlot = (k) => ({ addr: hex(entry('characterWeaponMateria').address + 4 * k), type: 'u32', description: `characterWeaponMateria[record 0] + ${4 * k} (confirmed #117): Cloud's weapon materia slot ${k}; empty in the save.` });
const armorSlot = (k) => ({ addr: hex(entry('characterArmorMateria').address + 4 * k), type: 'u32', description: `characterArmorMateria[record 0] + ${4 * k} (confirmed #117): Cloud's armor materia slot ${k}; empty in the save.` });
const MEMORY = {
  game_state: { addr: '0x8009c560', type: 'u16', description: 'g_GameState (s16 as u16; confirmed #76): field 1, menu 5.' },
  map_cur: { addr: '0x8009a05c', type: 'u16', description: 'g_FieldCurrentMap (s16 as u16; confirmed #77): the field ID.' },
  loading: { addr: '0x800965e8', type: 'u16', description: 'g_IsFieldLoading (s16 as u16; confirmed #77): 2 in a settled field (the field-loaded segment waits on it).' },
  row0: { addr: '0x8009a0d3', type: 'u8', description: 'menuCursor (confirmed #78): the main-menu cursor, row 0 = Item.' },
  menu_ovl: { addr: hex(entry('menuOverlay').address), type: 'u32', description: 'menuOverlay (confirmed; 3 = the Materia screen, #241).' },
  col: { addr: hex(entry('materiaSlotColumn').address), type: 'u8', description: 'materiaSlotColumn (confirmed #244; s8 as u8): the slot cursor column.' },
  srow: { addr: hex(entry('materiaSlotRow').address), type: 'u8', description: 'materiaSlotRow (confirmed #244; s8 as u8): the slot cursor row, 0 weapon, 1 armor.' },
  l_row: { addr: hex(entry('materiaListRow').address), type: 'u8', description: 'materiaListRow (confirmed #244): the highlighted row on the page, 0-9.' },
  l_off: { addr: hex(entry('materiaListOffset').address), type: 'u8', description: 'materiaListOffset (confirmed #244; low byte of an s16): the list index on the top row.' },
  wm0: weaponSlot(0),
  [`wm${FAR_COLUMN}`]: weaponSlot(FAR_COLUMN),
  am0: armorSlot(0),
  mat2: matSlot(2),
  mat7: matSlot(7),
  mat13: matSlot(13),
  [`mat${LAST_SLOT}`]: matSlot(LAST_SLOT),
};

/** Load the save and open the field menu, as save-boot-27a does. */
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

const OPEN_SCREEN = [
  ...OPEN_MENU,
  ...scriptFromPlan(menuPanelPlan(0, MATERIA_ROW), 'row0', undefined),
  { wait: { frames: 60 } },
  { wait: { until: { mem: 'menu_ovl', equals: MENU_OVERLAY_MATERIA }, timeout: 600, press: { buttons: ['circle'], every: 60, hold: 4 } }, metric: 'ovl_wait' },
  { wait: { frames: 120 } },
  until('col', 0, undefined, 1),
  until('srow', MATERIA_ROW_WEAPON, undefined, 1),
];
const OPEN_LIST = [
  PRESS('circle'),
  { wait: { frames: 60 } },
  until('l_row', LIST_START.row, undefined, 1),
  until('l_off', LIST_START.offset, undefined, 1),
];
const take = (slot, mark) => [
  { mark },
  PRESS('circle'),
  { wait: { until: { mem: `mat${slot}`, equals: MATERIA_EMPTY }, timeout: 120 }, metric: 'eq_wait' },
  { wait: { frames: SETTLE } },
];
const unchanged = (slots) => slots.map((i) => ({ expect: { mem: `mat${i}`, equals: wordOf(i) } }));

export function materiaSlotsScenarios() {
  const base = { $schema: '../schema/scenario.schema.json', format: 2, tier: 2, boot: { disc: 1, save: SAVE, slot: 1 }, memory: MEMORY };
  const opening = `Load harness/saves/${SAVE}.json (Cloud alone with weapon ${WEAPON} and armor ${ARMOR}, author-chosen numbers whose slot counts, 8 and at least 1, are a source claim; materia slots empty; materia 49 in inventory slots 2, 7, 13 and ${LAST_SLOT} only, AP = slot), open the field menu, plan the main-menu cursor 0 to ${MATERIA_ROW} (semantic/menu-panel.js), Circle every 60 frames until menu_ovl reads ${MENU_OVERLAY_MATERIA} (ovl_wait), 120 frames; the slot cursor reads row 0, column 0.`;
  const listOpen = 'Circle (opens the list for the slot under the cursor, #241) and 60 frames; the list row and offset read 0 (#244).';
  const planText = (plan, from, name) => `${name}: materiaListPlan(${JSON.stringify({ row: from.row, offset: from.offset })}, ${plan.to}), ${plan.steps.length} ${plan.steps[0].button === 'down' ? 'Downs' : 'Ups'}, each a ${plan.timing.hold}-frame press, a wait of at most ${plan.timing.settle} frames for the cursor that should move (the row, or the offset on a scroll) and a one-frame check of the other, ${plan.timing.gap} frames between presses; it should end on row ${plan.steps.at(-1).row}, offset ${plan.steps.at(-1).offset}`;
  const tail = 'Only frame counts, 1/0, cursor indices and author-chosen words leave.';

  const measure = {
    ...base,
    name: 'save-boot-30a-materia-columns-measure',
    description: `#255 (measurement for H3): how far Right moves the weapon row's slot cursor. ${opening} Then ${MEASURE_RIGHTS} Rights, each a 4-frame press and 20 frames, nothing checked between them. Reports the column and row at the end (col: ${WEAPON_COLUMNS - 1} if the weapon has ${WEAPON_COLUMNS} columns and Right stops at the last; n - 1 for n columns and a stop; something smaller after a wrap). Checks: still on overlay ${MENU_OVERLAY_MATERIA} in the menu, materia untouched, a rerun matches. ${tail}`,
    input: [...OPEN_SCREEN, ...Array.from({ length: MEASURE_RIGHTS }, () => [PRESS('right'), { wait: { frames: 20 } }]).flat()],
    assert: [
      { expect: { mem: 'menu_ovl', equals: MENU_OVERLAY_MATERIA } },
      { expect: { mem: 'game_state', equals: 5 } },
      ...unchanged([2, 7, 13, LAST_SLOT]),
      { sameState: 'rerun', metric: 'match' },
    ],
    metrics: ['load_done', 'ovl_wait', 'col', 'srow', 'match'],
  };

  const column = {
    ...base,
    name: 'save-boot-30b-materia-column-far',
    description: `#255 (acceptance, H3): the column plan past column 1. ${opening} materiaColumnPlan(0, ${FAR_COLUMN}, columns ${WEAPON_COLUMNS}): ${toFarColumn.steps.length} Rights, each waiting at most ${toFarColumn.timing.settle} frames for the next column (w_col: the last). Then ${listOpen} Then ${planText(toColumnSlot, LIST_START, 'w_list')}. Then mark, Circle, and wait until inventory slot ${COLUMN_SLOT} reads empty (eq_wait). Checks: slot ${COLUMN_SLOT} empty and changed since the mark (took_ok), slots 2, 13 and ${LAST_SLOT} unchanged, Cloud's weapon slot ${FAR_COLUMN} holds ${hex(wordOf(COLUMN_SLOT))} and slot 0 is empty, still on overlay ${MENU_OVERLAY_MATERIA} in the menu, a rerun matches. ${tail}`,
    input: [
      ...OPEN_SCREEN,
      ...scriptFromPlan(toFarColumn, 'col', 'w_col'),
      { wait: { frames: 10 } },
      ...OPEN_LIST,
      ...scriptFromListPlan(toColumnSlot, LIST_START, 'w_list'),
      { wait: { frames: 10 } },
      ...take(COLUMN_SLOT, 'before-take'),
    ],
    assert: [
      { expect: { mem: `mat${COLUMN_SLOT}`, equals: MATERIA_EMPTY }, metric: 'took_ok' },
      { change: { mem: `mat${COLUMN_SLOT}`, is: 'changed', since: 'before-take' } },
      ...unchanged([2, 13, LAST_SLOT]),
      { expect: { mem: `wm${FAR_COLUMN}`, equals: wordOf(COLUMN_SLOT) } },
      { expect: { mem: 'wm0', equals: MATERIA_EMPTY } },
      { expect: { mem: 'menu_ovl', equals: MENU_OVERLAY_MATERIA } },
      { expect: { mem: 'game_state', equals: 5 } },
      { sameState: 'rerun', metric: 'match' },
    ],
    metrics: ['load_done', 'ovl_wait', 'w_col', 'w_list', 'eq_wait', 'took_ok', `wm${FAR_COLUMN}`, 'match'],
  };

  const thirteenEnd = toThirteen.steps.at(-1);
  const armor = {
    ...base,
    name: 'save-boot-30c-materia-armor-scroll-back',
    description: `#255 (acceptance, H4 and H2b): the armor row, and Up scrolling back at list row 0. ${opening} materiaRowPlan(0, 1): one Down, a wait of at most ${toArmor.timing.settle} frames for the slot row to read 1 (w_row); the column still reads 0. Then ${listOpen} Then ${planText(toThirteen, LIST_START, 'w_far')}. Then 10 frames and ${planText(toBackSlot, thirteenEnd, 'w_back')} (its last ${toBackSlot.steps.filter((s) => s.row === 0 && s.offset < thirteenEnd.offset).length} Ups are at row 0 and should lower the offset, H2b). Then mark, Circle, and wait until inventory slot ${BACK_SLOT} reads empty (eq_wait). Checks: slot ${BACK_SLOT} empty and changed since the mark, slots 7, 13 and ${LAST_SLOT} unchanged, Cloud's armor slot 0 holds ${hex(wordOf(BACK_SLOT))} (took_ok) and weapon slot 0 is empty, still on overlay ${MENU_OVERLAY_MATERIA} in the menu, a rerun matches. ${tail}`,
    input: [
      ...OPEN_SCREEN,
      ...scriptFromPlan(toArmor, 'srow', 'w_row'),
      until('col', 0, undefined, 1),
      { wait: { frames: 10 } },
      ...OPEN_LIST,
      ...scriptFromListPlan(toThirteen, LIST_START, 'w_far'),
      { wait: { frames: 10 } },
      ...scriptFromListPlan(toBackSlot, thirteenEnd, 'w_back'),
      { wait: { frames: 10 } },
      ...take(BACK_SLOT, 'before-take'),
    ],
    assert: [
      { expect: { mem: `mat${BACK_SLOT}`, equals: MATERIA_EMPTY } },
      { change: { mem: `mat${BACK_SLOT}`, is: 'changed', since: 'before-take' } },
      ...unchanged([7, 13, LAST_SLOT]),
      { expect: { mem: 'am0', equals: wordOf(BACK_SLOT) }, metric: 'took_ok' },
      { expect: { mem: 'wm0', equals: MATERIA_EMPTY } },
      { expect: { mem: 'menu_ovl', equals: MENU_OVERLAY_MATERIA } },
      { expect: { mem: 'game_state', equals: 5 } },
      { sameState: 'rerun', metric: 'match' },
    ],
    metrics: ['load_done', 'ovl_wait', 'w_row', 'w_far', 'w_back', 'eq_wait', 'took_ok', 'match'],
  };

  const lastEnd = toLast.steps.at(-1);
  const end = {
    ...base,
    name: 'save-boot-30d-materia-list-end',
    description: `#255 (measurement): what Down does at the list's last slot. ${opening} ${listOpen} Then Down (${toLast.timing.hold} frames) every ${LAST_EVERY} frames until the list offset is ${lastEnd.offset} (w_last: frames; at most ${LAST_TIMEOUT}), which only the press onto slot ${LAST_SLOT} reaches, then the row must be ${lastEnd.row}, and still the offset after ${SETTLE} frames (materiaListPlan's ${toLast.steps.length} steps are proved stepwise by 30b and 30c; written out here they pass the 64 KiB scenario file limit). Then one more Down (4 frames) and ${SETTLE} frames, nothing checked. Reports the list row and offset at the end: row ${lastEnd.row}, offset ${lastEnd.offset} if Down stops at slot ${LAST_SLOT}; row 0, offset 0 if it wraps to slot 0. Checks: still on overlay ${MENU_OVERLAY_MATERIA} in the menu, materia untouched, a rerun matches. ${tail}`,
    input: [
      ...OPEN_SCREEN,
      ...OPEN_LIST,
      // The plan's own steps are proved by 30b and 30c; written out for 199
      // slots they make the file larger than the sandbox's 64 KiB scenario
      // limit. So Down is pressed every LAST_EVERY frames until the offset
      // reaches the last page (only the press onto slot 199 gets there),
      // and the row is checked.
      { wait: { until: { mem: 'l_off', equals: lastEnd.offset }, timeout: LAST_TIMEOUT, press: { buttons: ['down'], every: LAST_EVERY, hold: toLast.timing.hold } }, metric: 'w_last' },
      until('l_row', lastEnd.row, undefined, 1),
      { wait: { frames: SETTLE } },
      until('l_off', lastEnd.offset, undefined, 1),
      PRESS('down'),
      { wait: { frames: SETTLE } },
    ],
    assert: [
      { expect: { mem: 'menu_ovl', equals: MENU_OVERLAY_MATERIA } },
      { expect: { mem: 'game_state', equals: 5 } },
      ...unchanged([2, 7, 13, LAST_SLOT]),
      { sameState: 'rerun', metric: 'match' },
    ],
    metrics: ['load_done', 'ovl_wait', 'w_last', 'l_row', 'l_off', 'match'],
  };
  return [measure, column, armor, end];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const s of materiaSlotsScenarios()) writeFileSync(path.join(SCENARIO_DIR, `${s.name}.json`), serialise(s));
}
