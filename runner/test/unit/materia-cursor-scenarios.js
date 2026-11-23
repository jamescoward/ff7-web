// The Tier 2 scenarios of #244 (Materia screen slot and list cursors),
// generated so the main-menu move to Materia is the menu planner's output.
// materia-cursor.test.js checks the committed files equal this.
//
//   node runner/test/unit/materia-cursor-scenarios.js    rewrite the files
//
// The Materia screen is in the EQIPMENU overlay, which is not decompiled in
// Xeeynamo/ff7-decomp@33ce78c (reference only, no code copied), so its cursor
// variables have no source. As #216 did for Equip, these scenarios find
// candidates with track checks: the cursor is moved by known pad steps between
// marks, and the run reports only the addresses whose byte read the expected
// index at every mark (runner/format2.js, the `overlay` window, #221).
// Original project code, GPL-2.0-or-later.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADDRESS_TABLE, CHARACTER_RECORD_SIZE } from '../../../semantic/addresses.js';
import { menuPanelPlan } from '../../../semantic/menu-panel.js';
import { MENUS } from '../../../semantic/menus.js';
import { SCENARIO_DIR, scriptFromPlan, serialise } from './planner-scenarios.js';

const hex = (n) => `0x${n.toString(16)}`;
const entry = (name) => {
  const e = ADDRESS_TABLE.entries.find((x) => x.name === name);
  if (!e) throw new Error(`no address entry ${name}`);
  return e;
};

/** The save the scenarios load: harness/saves/disc1-md1stin-materia12.json. */
export const SAVE = 'disc1-md1stin-materia12';
export const MATERIA_ROW = MENUS.main.labels.indexOf('Materia');
/** menuOverlay value of the Materia screen (confirmed #241, save-boot-22a). */
export const OVERLAY_MATERIA = 3;
/**
 * Author-chosen materia in inventory slots 0-11: the ID #241 equipped (49,
 * AP 0), twelve times, so no new ID is assumed. The list needs entries only
 * so the cursor has somewhere to move.
 */
export const MATERIA = Object.freeze(Array.from({ length: 12 }, (_, i) => Object.freeze({ slot: i, id: 49, ap: 0 })));
/** The `overlay` track window (runner/format2.js TRACK_WINDOWS): 0x801D0000 to the end of RAM. */
export const OVERLAY_RANGE = Object.freeze({ from: 0x801d0000, bytes: 0x30000 });

/**
 * 24a: on the opening screen (cursor on weapon slot 0, #241), Right, Left,
 * Right, Left, Down, Up. Hypotheses: the column reads 0, 1, 0, 1, 0 over the
 * first five marks (Cloud's starting weapon has at least two slots); the row
 * reads 0 on the weapon row and 1 on the armor row (the armor may have no
 * slots, so the cursor may not move there: that search may miss).
 */
export const SLOT_STEPS = Object.freeze(['right', 'left', 'right', 'left', 'down', 'up']);
export const COLUMN_VALUES = Object.freeze([0, 1, 0, 1, 0]);
export const ROW_VALUES = Object.freeze([0, 0, 0, 0, 0, 1, 0]);
/** 24b: in the open list (first Circle, #241), Down, Down, Up, Up. Hypothesis: the list row reads 0, 1, 2, 1, 0. */
export const UP_DOWN = Object.freeze({ presses: ['down', 'down', 'up', 'up'], values: [0, 1, 2, 1, 0] });
/**
 * 24c: Down presses before each mark (cumulative). With at most 11 Downs the
 * offset prediction is the same whether the list holds only the 12 filled
 * entries or all 200 inventory slots (offsetAfter below), so the list's
 * length is not a hypothesis here.
 */
export const SCROLL_DOWNS = Object.freeze([0, 6, 7, 8, 9, 10, 11]);
/** Page sizes tried: one search each, all `mayMiss` (at most one is right). */
export const PAGE_SIZES = Object.freeze([8, 9, 10]);
/** The list offset after d Downs from the top, if the list shows `page` rows and scrolls by one at the bottom. */
export const offsetAfter = (d, page, length = MATERIA.length) => Math.min(Math.max(0, d - (page - 1)), length - page);

/**
 * Candidates from attempt 1 (tier2 on f7b13b1, notes/244-materia-cursors.md):
 * the only byte each search found (the list offset search for 10 rows found
 * two; the first is used). They sit like the Equip and Item overlays'
 * MenuTables (#135, #216: 0x12 bytes, rowOffset at +0x02, row at +0x0B): a
 * slot table at 0x801DF5A2 with the column at +0x0A and the row at +0x0B,
 * and the list table two tables later (0x801DF5C6).
 */
export const CANDIDATES = Object.freeze({ column: 0x801df5ac, row: 0x801df5ad, listRow: 0x801df5d1, listOffset: 0x801df5c8 });
/** The list shows 10 rows (24c: only the page-10 offset hypothesis matched). */
export const LIST_PAGE = 10;
/** 25b: Downs in the list; Circle then takes the entry at that index (row 9 + offset 2 = 11). */
export const LIST_DOWNS = 11;
/** An empty materia word (ID 0xFF; #117). */
export const MATERIA_EMPTY = 0xffffffff;
/** The packed word of the save's materia (AP << 8 | ID); every slot 0-11 holds it. */
export const MATERIA_WORD = ((MATERIA[0].ap << 8) | MATERIA[0].id) >>> 0;

const MEMORY = {
  game_state: { addr: '0x8009c560', type: 'u16', description: 'g_GameState (s16 as u16; confirmed #76): field 1, menu 5.' },
  map_cur: { addr: '0x8009a05c', type: 'u16', description: 'g_FieldCurrentMap (s16 as u16; confirmed #77): the field ID.' },
  loading: { addr: '0x800965e8', type: 'u16', description: 'g_IsFieldLoading (s16 as u16; confirmed #77): 2 in a settled field (the field-loaded segment waits on it).' },
  row0: { addr: '0x8009a0d3', type: 'u8', description: 'menuCursor (confirmed #78): the main-menu cursor, row 0 = Item.' },
  menu_ovl: { addr: hex(entry('menuOverlay').address), type: 'u32', description: 'menuOverlay (confirmed; 3 = the Materia screen, #241).' },
  col: { addr: hex(CANDIDATES.column), type: 'u8', description: 'Materia screen slot column (candidate, #244 24a): 0 on weapon slot 0. In the EQIPMENU overlay; meaningful only while menuOverlay reads 3.' },
  row: { addr: hex(CANDIDATES.row), type: 'u8', description: 'Materia screen slot row (candidate, #244 24a): 0 weapon, 1 armor.' },
  l_row: { addr: hex(CANDIDATES.listRow), type: 'u8', description: 'Materia list cursor (candidate, #244 24b): the highlighted row on the page, 0-9.' },
  l_off: { addr: hex(CANDIDATES.listOffset), type: 'u8', description: 'Materia list offset (candidate, #244 24c): the index of the list entry on the top row.' },
  wm0: { addr: hex(entry('characterWeaponMateria').address + CHARACTER_RECORD_SIZE * 0), type: 'u32', description: "characterWeaponMateria[record 0], slot 0 (confirmed #117): Cloud's first weapon materia slot; 0xFFFFFFFF empty in the save." },
  mat0: { addr: hex(entry('materiaSlot').address), type: 'u32', description: 'materiaSlot[0] (confirmed #117).' },
  mat11: { addr: hex(entry('materiaSlot').address + 4 * 11), type: 'u32', description: 'materiaSlot[11] (confirmed #117): the last filled inventory slot in the save.' },
};

/** Load the save and open the field menu, as save-boot-22a does. */
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
const SETTLE = 30;
const range = () => ({ from: hex(OVERLAY_RANGE.from), bytes: OVERLAY_RANGE.bytes });

export function materiaCursorScenarios() {
  const openMateria = [
    ...OPEN_MENU,
    ...scriptFromPlan(menuPanelPlan(0, MATERIA_ROW), 'row0', undefined),
    { wait: { frames: 60 } },
    { wait: { until: { mem: 'menu_ovl', equals: OVERLAY_MATERIA }, timeout: 600, press: { buttons: ['circle'], every: 60, hold: 4 } }, metric: 'ovl_wait' },
    { wait: { frames: 120 } },
  ];
  const base = { $schema: '../schema/scenario.schema.json', format: 2, tier: 2, boot: { disc: 1, save: SAVE, slot: 1 }, memory: MEMORY };
  /** A mark, then each press followed by SETTLE frames and a mark: p0..pN. */
  const stepsWithMarks = (p, presses) => [
    { mark: `${p}0` },
    ...presses.flatMap((b, i) => [PRESS(b), { wait: { frames: SETTLE } }, { mark: `${p}${i + 1}` }]),
  ];
  const marks = (p, n) => Array.from({ length: n }, (_, i) => `${p}${i}`);
  const what = 'Only match counts and addresses leave the run (track checks, #216, #221).';
  const opening = `Load harness/saves/${SAVE}.json (Cloud alone, materia slots empty, materia 49 in inventory slots 0-11), open the field menu, plan the main-menu cursor 0 to ${MATERIA_ROW} (semantic/menu-panel.js), Circle every 60 frames until menu_ovl reads ${OVERLAY_MATERIA} (ovl_wait), 120 frames (the screen opens on weapon slot 0, #241).`;

  const slot = {
    ...base,
    name: 'save-boot-24a-materia-slot-track',
    description: `#244 (diagnostic): candidates for the Materia screen's slot cursor. ${opening} Then mark, and ${SLOT_STEPS.join(', ')}, each followed by ${SETTLE} frames and a mark (c0-c6). Hypotheses: the column reads ${COLUMN_VALUES.join(', ')} at c0-c4 (the starting weapon has at least two slots; may miss); the row reads ${ROW_VALUES.join(', ')} at c0-c6 (the armor row may have no slots, so the cursor may not go there; may miss). Searches the overlay window (${hex(OVERLAY_RANGE.from)}, ${hex(OVERLAY_RANGE.bytes)} bytes): c_n/c_a1/c_a2 for the column, r_n/r_a1/r_a2 for the row. ${what}`,
    input: [...openMateria, ...stepsWithMarks('c', SLOT_STEPS)],
    assert: [
      { track: { ...range(), marks: marks('c', COLUMN_VALUES.length), values: [...COLUMN_VALUES], found: ['c_a1', 'c_a2'], mayMiss: true }, metric: 'c_n', note: 'slot column' },
      { track: { ...range(), marks: marks('c', ROW_VALUES.length), values: [...ROW_VALUES], found: ['r_a1', 'r_a2'], mayMiss: true }, metric: 'r_n', note: 'slot row' },
    ],
    metrics: ['load_done', 'ovl_wait', 'c_n', 'c_a1', 'c_a2', 'r_n', 'r_a1', 'r_a2'],
  };

  const openList = [...openMateria, PRESS('circle'), { wait: { frames: 60 } }];
  const list = {
    ...base,
    name: 'save-boot-24b-materia-list-track',
    description: `#244 (diagnostic): candidates for the Materia list's row cursor. As 24a to the open screen, then Circle (opens the materia list for weapon slot 0, #241 22b) and 60 frames. Then mark, and Down, Down, Up, Up, each followed by ${SETTLE} frames and a mark. Hypothesis: the list row reads ${UP_DOWN.values.join(', ')} at the marks (the slot column stays 0, so it does not match). Searches the overlay window as 24a (l_n, l_a1-l_a3). ${what}`,
    input: [...openList, ...stepsWithMarks('l', UP_DOWN.presses)],
    assert: [
      { track: { ...range(), marks: marks('l', UP_DOWN.values.length), values: [...UP_DOWN.values], found: ['l_a1', 'l_a2', 'l_a3'] }, metric: 'l_n', note: 'list row' },
    ],
    metrics: ['load_done', 'ovl_wait', 'l_n', 'l_a1', 'l_a2', 'l_a3'],
  };

  const scrollInput = [...openList];
  SCROLL_DOWNS.forEach((d, i) => {
    const before = i === 0 ? 0 : SCROLL_DOWNS[i - 1];
    for (let k = before; k < d; k++) scrollInput.push(PRESS('down'), { wait: { frames: SETTLE } });
    scrollInput.push({ mark: `d${d}` });
  });
  const scroll = {
    ...base,
    name: 'save-boot-24c-materia-list-offset-track',
    description: `#244 (diagnostic): candidates for the Materia list's scroll offset. As 24b to the open list, then Down presses (each followed by ${SETTLE} frames) with a mark after ${SCROLL_DOWNS.join(', ')} presses in all. Hypothesis: the list shows P rows and scrolls by one at the bottom, so its offset after d presses is max(0, d - (P - 1)) (with d <= 11 the same whether the list holds 12 entries or 200). One search of the overlay window per P in ${PAGE_SIZES.join(', ')} (o<P>_n matches, o<P>_a the first), each may miss. ${what}`,
    input: scrollInput,
    assert: PAGE_SIZES.map((P) => ({
      track: { ...range(), marks: SCROLL_DOWNS.map((d) => `d${d}`), values: SCROLL_DOWNS.map((d) => offsetAfter(d, P)), found: [`o${P}_a`], mayMiss: true },
      metric: `o${P}_n`,
      note: `page of ${P} rows`,
    })),
    metrics: ['load_done', 'ovl_wait', ...PAGE_SIZES.flatMap((P) => [`o${P}_n`, `o${P}_a`])],
  };

  // Acceptance (step 2): each candidate reads the expected index after known
  // presses, checked with plain waits on the candidate address.
  const until = (mem, equals, metric, timeout = SETTLE) => ({ wait: { until: { mem, equals }, timeout }, ...(metric ? { metric } : {}) });
  /** Frames after a value is seen before the next press, as the menu planner's gap. */
  const GAP = { wait: { frames: 10 } };
  const slotAccept = {
    ...base,
    name: 'save-boot-25a-materia-slot-cursor',
    description: `#244 (acceptance): the slot column ${hex(CANDIDATES.column)} and row ${hex(CANDIDATES.row)} candidates follow Right, Left, Down and Up on the Materia screen. As 24a to the open screen; column and row read 0; then Right (column 1, w_c1), Left (0, w_c0), Down (row 1, w_r1), Up (row 0, w_r0), each a 4-frame press, a wait of at most ${SETTLE} frames for the value, then 10 frames. Checks: the column reads 0 at the end, the list row and offset candidates read 0, still on overlay ${OVERLAY_MATERIA} in the menu, no materia moved (wm0 empty), a rerun matches (match). Reports the raw column at the end. Only frame counts, 1/0 and indices leave.`,
    input: [
      ...openMateria,
      until('col', 0, undefined, 1),
      until('row', 0, undefined, 1),
      PRESS('right'), until('col', 1, 'w_c1'), GAP,
      PRESS('left'), until('col', 0, 'w_c0'), GAP,
      PRESS('down'), until('row', 1, 'w_r1'), GAP,
      PRESS('up'), until('row', 0, 'w_r0'),
      { wait: { frames: SETTLE } },
    ],
    assert: [
      { expect: { mem: 'col', equals: 0 } },
      { expect: { mem: 'row', equals: 0 } },
      { expect: { mem: 'l_row', equals: 0 } },
      { expect: { mem: 'l_off', equals: 0 } },
      { expect: { mem: 'wm0', equals: MATERIA_EMPTY } },
      { expect: { mem: 'menu_ovl', equals: OVERLAY_MATERIA } },
      { expect: { mem: 'game_state', equals: 5 } },
      { sameState: 'rerun', metric: 'match' },
    ],
    metrics: ['load_done', 'ovl_wait', 'w_c1', 'w_c0', 'w_r1', 'w_r0', 'col', 'match'],
  };

  const listSteps = [];
  for (let k = 1; k <= LIST_DOWNS; k++) {
    listSteps.push(PRESS('down'));
    if (k < LIST_PAGE) listSteps.push(until('l_row', k, k === LIST_PAGE - 1 ? 'w_row9' : undefined));
    else listSteps.push(until('l_off', k - (LIST_PAGE - 1), k === LIST_DOWNS ? 'w_off2' : undefined));
    listSteps.push(GAP);
  }
  const index = LIST_DOWNS;
  const listAccept = {
    ...base,
    name: 'save-boot-25b-materia-list-cursor',
    description: `#244 (acceptance): the list row ${hex(CANDIDATES.listRow)} and list offset ${hex(CANDIDATES.listOffset)} candidates follow Down in the materia list, and the entry they point at is the one Circle takes. As 24b to the open list; row and offset read 0; Down ${LIST_DOWNS} times (4-frame presses, each followed by a wait of at most ${SETTLE} frames for the value, then 10 frames): the row reads 1 to ${LIST_PAGE - 1} after the first ${LIST_PAGE - 1} (w_row9 for the last), then the offset reads 1 and 2 (w_off2 for the last) while the row stays ${LIST_PAGE - 1}. Then mark, Circle, and wait until inventory slot ${index} reads empty (eq_wait). Hypothesis (list order): the entry at index ${index} is inventory slot ${index}. Checks: materiaSlot[${index}] empty and changed since the mark (took_ok), materiaSlot[0] unchanged, Cloud's weapon materia slot 0 holds ${hex(MATERIA_WORD)}, still on overlay ${OVERLAY_MATERIA} in the menu, a rerun matches. Reports the raw wm0 (an author-chosen word).`,
    input: [
      ...openList,
      until('l_row', 0, undefined, 1),
      until('l_off', 0, undefined, 1),
      ...listSteps,
      { wait: { until: { mem: 'l_row', equals: LIST_PAGE - 1 }, timeout: 1 } },
      { mark: 'before-equip' },
      PRESS('circle'),
      { wait: { until: { mem: 'mat11', equals: MATERIA_EMPTY }, timeout: 120 }, metric: 'eq_wait' },
      { wait: { frames: SETTLE } },
    ],
    assert: [
      { expect: { mem: 'mat11', equals: MATERIA_EMPTY }, metric: 'took_ok' },
      { change: { mem: 'mat11', is: 'changed', since: 'before-equip' } },
      { expect: { mem: 'mat0', equals: MATERIA_WORD } },
      { expect: { mem: 'wm0', equals: MATERIA_WORD } },
      { expect: { mem: 'menu_ovl', equals: OVERLAY_MATERIA } },
      { expect: { mem: 'game_state', equals: 5 } },
      { sameState: 'rerun', metric: 'match' },
    ],
    metrics: ['load_done', 'ovl_wait', 'w_row9', 'w_off2', 'eq_wait', 'took_ok', 'wm0', 'match'],
  };
  return [slot, list, scroll, slotAccept, listAccept];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const s of materiaCursorScenarios()) writeFileSync(path.join(SCENARIO_DIR, `${s.name}.json`), serialise(s));
}
