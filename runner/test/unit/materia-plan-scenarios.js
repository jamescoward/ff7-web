// The Tier 2 scenarios of #248 (Materia screen planner), generated so every
// cursor move is the semantic layer's own plan: the main-menu move to Materia
// (menuPanelPlan), the slot column (materiaColumnPlan) and the list index
// (materiaListPlan). materia-plan.test.js checks the committed files equal
// this.
//
//   node runner/test/unit/materia-plan-scenarios.js    rewrite the files
//
// #244 confirmed the cursors and that Down past list row 9 scrolls one entry
// (all 12 slots filled); #246 that empty slots keep their place (page 1
// only). Hypotheses here: H1, scrolling past page 1 across empty slots keeps
// index = offset + row = inventory slot; H2, Up after a scroll moves the row
// first, offset unchanged. The EQIPMENU overlay is not decompiled in
// Xeeynamo/ff7-decomp@33ce78c (reference only, no code copied).
// Original project code, GPL-2.0-or-later.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADDRESS_TABLE, MENU_OVERLAY_MATERIA } from '../../../semantic/addresses.js';
import { materiaColumnPlan, materiaListPlan } from '../../../semantic/materia-screen.js';
import { menuPanelPlan } from '../../../semantic/menu-panel.js';
import { MENUS } from '../../../semantic/menus.js';
import { SCENARIO_DIR, scriptFromPlan, serialise } from './planner-scenarios.js';

const hex = (n) => `0x${n.toString(16)}`;
const entry = (name) => {
  const e = ADDRESS_TABLE.entries.find((x) => x.name === name);
  if (!e) throw new Error(`no address entry ${name}`);
  return e;
};

/** The save the scenarios load: harness/saves/disc1-md1stin-materia-plan.json. */
export const SAVE = 'disc1-md1stin-materia-plan';
export const MATERIA_ROW = MENUS.main.labels.indexOf('Materia');
/**
 * Author-chosen materia: ID 49 (as #241-#246) in slots 2, 7 and 13 only, AP
 * equal to the slot so each word is distinct. Slot 13 is past page 1 (rows
 * 0-9), with empty slots before it on both pages.
 */
export const MATERIA = Object.freeze([2, 7, 13].map((slot) => Object.freeze({ slot, id: 49, ap: slot })));
/** An empty materia word (ID 0xFF; #117). */
export const MATERIA_EMPTY = 0xffffffff;
/** The packed materia word of a slot in the save (AP << 8 | ID; #117). */
export const wordOf = (slot) => {
  const m = MATERIA.find((x) => x.slot === slot);
  return m ? ((m.ap << 8) | m.id) >>> 0 : MATERIA_EMPTY;
};
/** The list opens on row 0 of page 1 (#244). */
export const LIST_START = Object.freeze({ row: 0, offset: 0 });
/** 27a and 27b: the far target, past page 1 (H1). */
export const FAR_SLOT = 13;
/** 27b: the target back up after the scroll (H2). */
export const BACK_SLOT = 7;
/** 27a: the weapon slot column the materia goes into (one Right; #244 25a). */
export const FAR_COLUMN = 1;
export const toFar = materiaListPlan(LIST_START, FAR_SLOT);
export const farEnd = toFar.steps.at(-1);
export const toBack = materiaListPlan(farEnd, BACK_SLOT);
export const backEnd = toBack.steps.at(-1);
export const toColumn = materiaColumnPlan(0, FAR_COLUMN);
const SETTLE = 30;

const matSlot = (i) => ({ addr: hex(entry('materiaSlot').address + 4 * i), type: 'u32', description: `materiaSlot[${i}] (confirmed #117).` });
const weaponSlot = (k) => ({ addr: hex(entry('characterWeaponMateria').address + 4 * k), type: 'u32', description: `characterWeaponMateria[record 0] + ${4 * k} (confirmed #117): Cloud's weapon materia slot ${k}; empty in the save.` });
const MEMORY = {
  game_state: { addr: '0x8009c560', type: 'u16', description: 'g_GameState (s16 as u16; confirmed #76): field 1, menu 5.' },
  map_cur: { addr: '0x8009a05c', type: 'u16', description: 'g_FieldCurrentMap (s16 as u16; confirmed #77): the field ID.' },
  loading: { addr: '0x800965e8', type: 'u16', description: 'g_IsFieldLoading (s16 as u16; confirmed #77): 2 in a settled field (the field-loaded segment waits on it).' },
  row0: { addr: '0x8009a0d3', type: 'u8', description: 'menuCursor (confirmed #78): the main-menu cursor, row 0 = Item.' },
  menu_ovl: { addr: hex(entry('menuOverlay').address), type: 'u32', description: 'menuOverlay (confirmed; 3 = the Materia screen, #241).' },
  col: { addr: hex(entry('materiaSlotColumn').address), type: 'u8', description: 'materiaSlotColumn (confirmed #244; s8 as u8): the slot cursor column.' },
  l_row: { addr: hex(entry('materiaListRow').address), type: 'u8', description: 'materiaListRow (confirmed #244): the highlighted row on the page, 0-9.' },
  l_off: { addr: hex(entry('materiaListOffset').address), type: 'u8', description: 'materiaListOffset (confirmed #244; low byte of an s16): the list index on the top row.' },
  wm0: weaponSlot(0),
  wm1: weaponSlot(1),
  mat2: matSlot(2),
  mat7: matSlot(7),
  mat13: matSlot(13),
};

/** Load the save and open the field menu, as save-boot-26a does. */
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

/**
 * A materiaListPlan as a script: each press, then a wait of at most
 * plan.timing.settle frames for the cursor that should change (the row, or
 * the offset on a scroll) to read its expected value, then a one-frame check
 * of the other. `metric` names the last step's wait.
 */
export function scriptFromListPlan(plan, from, metric) {
  const out = [];
  let prev = from;
  plan.steps.forEach((s, i) => {
    if (i > 0 && plan.timing.gap > 0) out.push({ wait: { frames: plan.timing.gap } });
    out.push({ buttons: [s.button], frames: plan.timing.hold });
    const scrolls = s.row === prev.row;
    const [moving, value, other, otherValue] = scrolls ? ['l_off', s.offset, 'l_row', s.row] : ['l_row', s.row, 'l_off', s.offset];
    out.push(until(moving, value, i === plan.steps.length - 1 ? metric : undefined, plan.timing.settle));
    out.push(until(other, otherValue, undefined, 1));
    prev = s;
  });
  return out;
}

export function materiaPlanScenarios() {
  const openScreen = [
    ...OPEN_MENU,
    ...scriptFromPlan(menuPanelPlan(0, MATERIA_ROW), 'row0', undefined),
    { wait: { frames: 60 } },
    { wait: { until: { mem: 'menu_ovl', equals: MENU_OVERLAY_MATERIA }, timeout: 600, press: { buttons: ['circle'], every: 60, hold: 4 } }, metric: 'ovl_wait' },
    { wait: { frames: 120 } },
    until('col', 0, undefined, 1),
  ];
  const openList = [
    PRESS('circle'),
    { wait: { frames: 60 } },
    until('l_row', LIST_START.row, undefined, 1),
    until('l_off', LIST_START.offset, undefined, 1),
  ];
  const base = { $schema: '../schema/scenario.schema.json', format: 2, tier: 2, boot: { disc: 1, save: SAVE, slot: 1 }, memory: MEMORY };
  const opening = `Load harness/saves/${SAVE}.json (Cloud alone, materia slots empty, materia 49 in inventory slots 2, 7 and 13 only, AP = slot), open the field menu, plan the main-menu cursor 0 to ${MATERIA_ROW} (semantic/menu-panel.js), Circle every 60 frames until menu_ovl reads ${MENU_OVERLAY_MATERIA} (ovl_wait), 120 frames; the slot column reads 0.`;
  const listOpen = 'Circle (opens the list for the slot under the cursor, #241) and 60 frames; the list row and offset read 0 (#244).';
  const planText = (plan, from, name) => `${name}: materiaListPlan(${JSON.stringify(from)}, ${plan.to}) from semantic/materia-screen.js, ${plan.steps.length} ${plan.steps[0].button === 'down' ? 'Downs' : 'Ups'}, each a ${plan.timing.hold}-frame press, a wait of at most ${plan.timing.settle} frames for the cursor that should move (the row, or the offset on a scroll) and a one-frame check of the other, ${plan.timing.gap} frames between presses; it should end on row ${plan.steps.at(-1).row}, offset ${plan.steps.at(-1).offset}`;
  const unchanged = (slots) => slots.map((i) => ({ expect: { mem: `mat${i}`, equals: wordOf(i) } }));
  const take = (slot, mark) => [
    { mark },
    PRESS('circle'),
    { wait: { until: { mem: `mat${slot}`, equals: MATERIA_EMPTY }, timeout: 120 }, metric: 'eq_wait' },
    { wait: { frames: SETTLE } },
  ];

  const far = {
    ...base,
    name: 'save-boot-27a-materia-plan-scroll',
    description: `#248 (acceptance, hypothesis H1): the list plan scrolls past page 1 across empty slots, and the column plan picks the weapon slot. ${opening} materiaColumnPlan(0, ${FAR_COLUMN}): one Right, a wait of at most ${toColumn.timing.settle} frames for the column to read ${FAR_COLUMN} (w_col). Then ${listOpen} Then ${planText(toFar, LIST_START, 'w_far')}. Then mark, Circle, and wait until inventory slot ${FAR_SLOT} reads empty (eq_wait). Checks: slot ${FAR_SLOT} empty and changed since the mark (took_ok), slots 2 and 7 unchanged, Cloud's weapon slot ${FAR_COLUMN} holds slot ${FAR_SLOT}'s word ${hex(wordOf(FAR_SLOT))} and slot 0 is empty, still on overlay ${MENU_OVERLAY_MATERIA} in the menu, a rerun matches. Only frame counts, 1/0, indices and author-chosen words leave.`,
    input: [
      ...openScreen,
      ...scriptFromPlan(toColumn, 'col', 'w_col'),
      { wait: { frames: 10 } },
      ...openList,
      ...scriptFromListPlan(toFar, LIST_START, 'w_far'),
      { wait: { frames: 10 } },
      ...take(FAR_SLOT, 'before-take'),
    ],
    assert: [
      { expect: { mem: `mat${FAR_SLOT}`, equals: MATERIA_EMPTY }, metric: 'took_ok' },
      { change: { mem: `mat${FAR_SLOT}`, is: 'changed', since: 'before-take' } },
      ...unchanged([2, 7]),
      { expect: { mem: `wm${FAR_COLUMN}`, equals: wordOf(FAR_SLOT) } },
      { expect: { mem: 'wm0', equals: MATERIA_EMPTY } },
      { expect: { mem: 'menu_ovl', equals: MENU_OVERLAY_MATERIA } },
      { expect: { mem: 'game_state', equals: 5 } },
      { sameState: 'rerun', metric: 'match' },
    ],
    metrics: ['load_done', 'ovl_wait', 'w_col', 'w_far', 'eq_wait', 'took_ok', `wm${FAR_COLUMN}`, 'match'],
  };

  const back = {
    ...base,
    name: 'save-boot-27b-materia-plan-up',
    description: `#248 (acceptance, hypothesis H2): after a scroll, Up moves the row first, so the list plan back up holds. ${opening} ${listOpen} Then ${planText(toFar, LIST_START, 'w_far')}. Then 10 frames and ${planText(toBack, farEnd, 'w_back')} (under H2 the offset stays ${farEnd.offset}; if Up scrolled first, the first row wait fails). Then mark, Circle, and wait until inventory slot ${BACK_SLOT} reads empty (eq_wait). Checks: slot ${BACK_SLOT} empty and changed since the mark, slots 2 and 13 unchanged, Cloud's weapon slot 0 holds slot ${BACK_SLOT}'s word ${hex(wordOf(BACK_SLOT))}, still on overlay ${MENU_OVERLAY_MATERIA} in the menu, a rerun matches. Reports the raw list row and offset at the end. Only frame counts, 1/0, indices and author-chosen words leave.`,
    input: [
      ...openScreen,
      ...openList,
      ...scriptFromListPlan(toFar, LIST_START, 'w_far'),
      { wait: { frames: 10 } },
      ...scriptFromListPlan(toBack, farEnd, 'w_back'),
      { wait: { frames: 10 } },
      ...take(BACK_SLOT, 'before-take'),
    ],
    assert: [
      { expect: { mem: `mat${BACK_SLOT}`, equals: MATERIA_EMPTY } },
      { change: { mem: `mat${BACK_SLOT}`, is: 'changed', since: 'before-take' } },
      ...unchanged([2, 13]),
      { expect: { mem: 'wm0', equals: wordOf(BACK_SLOT) } },
      { expect: { mem: 'menu_ovl', equals: MENU_OVERLAY_MATERIA } },
      { expect: { mem: 'game_state', equals: 5 } },
      { sameState: 'rerun', metric: 'match' },
    ],
    metrics: ['load_done', 'ovl_wait', 'w_far', 'w_back', 'eq_wait', 'l_row', 'l_off', 'match'],
  };
  return [far, back];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const s of materiaPlanScenarios()) writeFileSync(path.join(SCENARIO_DIR, `${s.name}.json`), serialise(s));
}
