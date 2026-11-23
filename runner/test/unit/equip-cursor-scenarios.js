// The Tier 2 scenarios of #216 (Equip screen slot and list cursors),
// generated so the main-menu move to Equip is the menu planner's output.
// equip-cursor.test.js checks the committed files equal this.
//
//   node runner/test/unit/equip-cursor-scenarios.js    rewrite the files
//
// The EQIPMENU overlay is not decompiled in Xeeynamo/ff7-decomp@33ce78c
// (reference only, no code copied), so its cursor variables have no source.
// These scenarios find candidates with track checks (#216): the cursor is
// moved by known pad steps between marks, and the run reports only the
// addresses whose byte read the expected index at every mark.
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

/** The save the scenarios load: harness/saves/disc1-md1stin-equip12.json. */
export const SAVE = 'disc1-md1stin-equip12';
export const EQUIP_ROW = MENUS.main.labels.indexOf('Equip');
/** menuOverlay value of the Equip screen (confirmed #121). */
export const OVERLAY_EQUIP = 4;
/**
 * Author-chosen spare weapons 1-12, one each, in inventory slots 0-11. That
 * Cloud (record 0, alone) can equip all twelve is a HYPOTHESIS (weapon 1 is
 * confirmed in #121; #215 saw 17 and 33 go to Tifa and Barret, which fits
 * blocks of 16 per character). The list's length matters only to 17c.
 */
export const ITEMS = Object.freeze(Array.from({ length: 12 }, (_, i) => ({ slot: i, index: 129 + i, quantity: 1 })));
/** Where the menu loads its overlays (#135: the Item overlay at 0x801D0000), to the end of RAM. */
export const OVERLAY_RANGE = Object.freeze({ from: 0x801d0000, bytes: 0x30000 });
/**
 * The main executable's data around the confirmed menu variables (menuOverlay
 * 0x80062DD4, g_PartyMenuTables 0x8009A0C8): 256 KiB from 0x80060000. In
 * case the overlay keeps its cursors in the main menu's tables.
 */
export const MAIN_RANGE = Object.freeze({ from: 0x80060000, bytes: 0x40000 });
/** Index sequence for the slot and list searches: Down, Down, Up, Up from the opening position. */
export const UP_DOWN = Object.freeze({ presses: ['down', 'down', 'up', 'up'], values: [0, 1, 2, 1, 0] });
/** 17c: Down presses before each mark (cumulative), and the page sizes tried. */
export const SCROLL_DOWNS = Object.freeze([0, 4, 5, 6, 7, 8, 9, 10]);
// Attempt 1 (0bc1fb7) also tried pages of 6 and 7 rows, and main data for 17a/17b: no byte matched
// (notes/216-equip-cursors.md). The scenarios keep only the searches that matched, as records.
export const PAGE_SIZES = Object.freeze([8]);
/** The list offset after d Downs from the top, if the list shows `page` rows and scrolls by one at the bottom. */
export const offsetAfter = (d, page, length = ITEMS.length) => Math.min(Math.max(0, d - (page - 1)), length - page);

/**
 * Candidates from attempt 1 (tier2 on 0bc1fb7, notes/216-equip-cursors.md):
 * the only byte in each search that followed the expected sequence. They sit
 * like the Item overlay's MenuTables (#135: 0x12 bytes, rowOffset at +0x02,
 * row at +0x0B): slot row, list row 0x12 later, list rowOffset 9 before it.
 */
export const CANDIDATES = Object.freeze({ slot: 0x801d8aab, listRow: 0x801d8abd, listOffset: 0x801d8ab4 });
/** The list shows 8 rows (17c: only the page-8 offset hypothesis matched). */
export const LIST_PAGE = 8;
/** 18b: Downs in the Weapon list, then Circle equips the entry at that index (row + offset). */
export const LIST_DOWNS = 9;
/** Hypothesis: the list holds the spare weapons in inventory order, so index 9 is weapon 10. */
export const WEAPON_AT_INDEX = (i) => ITEMS[i].index - 128;

const MEMORY = {
  game_state: { addr: '0x8009c560', type: 'u16', description: 'g_GameState (s16 as u16; confirmed #76): field 1, menu 5.' },
  map_cur: { addr: '0x8009a05c', type: 'u16', description: 'g_FieldCurrentMap (s16 as u16; confirmed #77): the field ID.' },
  loading: { addr: '0x800965e8', type: 'u16', description: 'g_IsFieldLoading (s16 as u16; confirmed #77): 2 in a settled field (the field-loaded segment waits on it).' },
  row0: { addr: '0x8009a0d3', type: 'u8', description: 'menuCursor (confirmed #78): the main-menu cursor, row 0 = Item.' },
  menu_ovl: { addr: hex(entry('menuOverlay').address), type: 'u32', description: 'menuOverlay (confirmed; 4 = the Equip screen, #121).' },
  slot: { addr: hex(CANDIDATES.slot), type: 'u8', description: 'Equip screen slot cursor (candidate, #216): 0 Weapon, 1 Armor, 2 Accessory. In the EQIPMENU overlay; meaningful only while menuOverlay reads 4.' },
  l_row: { addr: hex(CANDIDATES.listRow), type: 'u8', description: 'Equip screen list cursor (candidate, #216): the highlighted row on the page, 0-7.' },
  l_off: { addr: hex(CANDIDATES.listOffset), type: 'u8', description: 'Equip screen list offset (candidate, #216): the index of the list entry on the top row.' },
  weapon0: { addr: hex(entry('characterWeapon').address + CHARACTER_RECORD_SIZE * 0), type: 'u8', description: 'characterWeapon[record 0] (confirmed #117).' },
};

/** Load the save and open the field menu, as save-boot-15b does. */
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
const range = (r) => ({ from: hex(r.from), bytes: r.bytes });

export function equipCursorScenarios() {
  const openEquip = [
    ...OPEN_MENU,
    ...scriptFromPlan(menuPanelPlan(0, EQUIP_ROW), 'row0', undefined),
    { wait: { frames: 60 } },
    { wait: { until: { mem: 'menu_ovl', equals: OVERLAY_EQUIP }, timeout: 600, press: { buttons: ['circle'], every: 60, hold: 4 } }, metric: 'ovl_wait' },
    { wait: { frames: 120 } },
  ];
  const base = { $schema: '../schema/scenario.schema.json', format: 2, tier: 2, boot: { disc: 1, save: SAVE, slot: 1 }, memory: MEMORY };
  /** Marks p0..p4 around Down, Down, Up, Up. */
  const upDown = (p) => [
    { mark: `${p}0` },
    ...UP_DOWN.presses.flatMap((b, i) => [PRESS(b), { wait: { frames: SETTLE } }, { mark: `${p}${i + 1}` }]),
  ];
  const marks = (p) => UP_DOWN.values.map((_, i) => `${p}${i}`);
  const searches = (p, prefix) => [
    { track: { ...range(OVERLAY_RANGE), marks: marks(p), values: [...UP_DOWN.values], found: [`${prefix}_a1`, `${prefix}_a2`, `${prefix}_a3`] }, metric: `${prefix}_n`, note: 'overlay range' },
  ];
  const what = `Only match counts and addresses leave the run (track checks, #216).`;

  const slot = {
    ...base,
    name: 'save-boot-17a-equip-slot-track',
    description: `#216 (diagnostic): candidates for the Equip screen's slot cursor (Weapon, Armor, Accessory). Load harness/saves/${SAVE}.json (Cloud alone, spare weapons 1-12), open the field menu, plan the main-menu cursor 0 to ${EQUIP_ROW} (semantic/menu-panel.js), Circle every 60 frames until menu_ovl reads ${OVERLAY_EQUIP} (ovl_wait), 120 frames (the screen opens on the Weapon slot, #121). Then mark, and Down, Down, Up, Up, each followed by ${SETTLE} frames and a mark. Hypothesis: the slot cursor reads 0, 1, 2, 1, 0 at the marks. Searches the overlay range (${hex(OVERLAY_RANGE.from)}, ${hex(OVERLAY_RANGE.bytes)} bytes; s_n matches, s_a1-s_a3 the first three). (Attempt 1 also searched main data, ${hex(MAIN_RANGE.from)} for ${hex(MAIN_RANGE.bytes)} bytes: no match.) ${what}`,
    input: [...openEquip, ...upDown('s')],
    assert: searches('s', 's'),
    metrics: ['load_done', 'ovl_wait', 's_n', 's_a1', 's_a2', 's_a3'],
  };

  const list = {
    ...base,
    name: 'save-boot-17b-equip-list-track',
    description: `#216 (diagnostic): candidates for the Equip screen's list cursor. As 17a to the open screen, then Circle (opens the Weapon list, #121 15c) and 60 frames. Then mark, and Down, Down, Up, Up, each followed by ${SETTLE} frames and a mark. Hypothesis: the list cursor reads 0, 1, 2, 1, 0 at the marks (the slot cursor stays 0, so it does not match). Searches the overlay range as 17a (l_n, l_a1-l_a3). ${what}`,
    input: [...openEquip, PRESS('circle'), { wait: { frames: 60 } }, ...upDown('l')],
    assert: searches('l', 'l'),
    metrics: ['load_done', 'ovl_wait', 'l_n', 'l_a1', 'l_a2', 'l_a3'],
  };

  const scrollInput = [...openEquip, PRESS('circle'), { wait: { frames: 60 } }];
  SCROLL_DOWNS.forEach((d, i) => {
    const before = i === 0 ? 0 : SCROLL_DOWNS[i - 1];
    for (let k = before; k < d; k++) scrollInput.push(PRESS('down'), { wait: { frames: SETTLE } });
    scrollInput.push({ mark: `d${d}` });
  });
  const scroll = {
    ...base,
    name: 'save-boot-17c-equip-list-offset-track',
    description: `#216 (diagnostic): candidates for the Equip list's scroll offset. As 17b to the open Weapon list, then Down presses (each followed by ${SETTLE} frames) with a mark after ${SCROLL_DOWNS.join(', ')} presses in all. Hypothesis: the list shows P rows and, with ${ITEMS.length} entries, its offset after d presses is min(max(0, d - (P - 1)), ${ITEMS.length} - P). One search of the overlay range per P in ${PAGE_SIZES.join(', ')} (o<P>_n matches, o<P>_a the first). Attempt 1 also tried pages of 6 and 7 rows: no match. ${what}`,
    input: scrollInput,
    assert: PAGE_SIZES.map((P) => ({
      track: { ...range(OVERLAY_RANGE), marks: SCROLL_DOWNS.map((d) => `d${d}`), values: SCROLL_DOWNS.map((d) => offsetAfter(d, P)), found: [`o${P}_a`] },
      metric: `o${P}_n`,
      note: `page of ${P} rows`,
    })),
    metrics: ['load_done', 'ovl_wait', ...PAGE_SIZES.flatMap((P) => [`o${P}_n`, `o${P}_a`])],
  };
  // Acceptance: each candidate reads the expected index after known presses,
  // checked with plain waits on the candidate address.
  const until = (mem, equals, metric, timeout = SETTLE) => ({ wait: { until: { mem, equals }, timeout }, ...(metric ? { metric } : {}) });
  /** Frames after a value is seen before the next press, as the menu planner's gap. */
  const GAP = { wait: { frames: 10 } };
  const slotAccept = {
    ...base,
    name: 'save-boot-18a-equip-slot-cursor',
    description: `#216 (acceptance): the slot cursor candidate ${hex(CANDIDATES.slot)} follows Down and Up on the Equip screen. As 17a to the open screen; slot reads 0; then Down (slot 1, w_s1), Down (2, w_s2), Up (1, w_u1), Up (0, w_u0), each a 4-frame press, a wait of at most ${SETTLE} frames for the value, then 10 frames. Checks: the list cursor and offset candidates read 0, still on the Equip overlay in the menu, a rerun matches (match). Reports the raw slot at the end. Only frame counts, 1/0 and indices leave.`,
    input: [
      ...openEquip,
      until('slot', 0, undefined, 1),
      PRESS('down'), until('slot', 1, 'w_s1'), GAP,
      PRESS('down'), until('slot', 2, 'w_s2'), GAP,
      PRESS('up'), until('slot', 1, 'w_u1'), GAP,
      PRESS('up'), until('slot', 0, 'w_u0'),
      { wait: { frames: SETTLE } },
    ],
    assert: [
      { expect: { mem: 'slot', equals: 0 } },
      { expect: { mem: 'l_row', equals: 0 } },
      { expect: { mem: 'l_off', equals: 0 } },
      { expect: { mem: 'menu_ovl', equals: OVERLAY_EQUIP } },
      { expect: { mem: 'game_state', equals: 5 } },
      { sameState: 'rerun', metric: 'match' },
    ],
    metrics: ['load_done', 'ovl_wait', 'w_s1', 'w_s2', 'w_u1', 'w_u0', 'slot', 'match'],
  };

  const listSteps = [];
  for (let k = 1; k <= LIST_DOWNS; k++) {
    listSteps.push(PRESS('down'));
    if (k < LIST_PAGE) listSteps.push(until('l_row', k, k === LIST_PAGE - 1 ? 'w_row7' : undefined));
    else listSteps.push(until('l_off', k - (LIST_PAGE - 1), k === LIST_DOWNS ? 'w_off2' : undefined));
    listSteps.push(GAP);
  }
  const index = LIST_PAGE - 1 + (LIST_DOWNS - (LIST_PAGE - 1));
  const weaponAfter = WEAPON_AT_INDEX(index);
  const listAccept = {
    ...base,
    name: 'save-boot-18b-equip-list-cursor',
    description: `#216 (acceptance): the list cursor ${hex(CANDIDATES.listRow)} and list offset ${hex(CANDIDATES.listOffset)} candidates follow Down in the Weapon list, and the entry they point at is the one Circle equips. As 17b to the open Weapon list; row and offset read 0; Down ${LIST_DOWNS} times (4-frame presses, each followed by a wait of at most ${SETTLE} frames for the value, then 10 frames): the row reads 1 to ${LIST_PAGE - 1} after the first ${LIST_PAGE - 1} (w_row7 for the last), then the offset reads 1 and 2 (w_off2 for the last) while the row stays ${LIST_PAGE - 1}. Then mark, Circle, and wait until weapon0 changes (eq_wait). Hypothesis (list order): the entry at index ${index} is weapon ${weaponAfter} (inventory slot ${index}). Checks: weapon0 ${weaponAfter} (w_idx) and changed since the mark; the slot cursor reads 0; still on the Equip overlay in the menu; a rerun matches. Reports the raw weapon0 (an author-chosen weapon number).`,
    input: [
      ...openEquip,
      PRESS('circle'), { wait: { frames: 60 } },
      until('l_row', 0, undefined, 1),
      until('l_off', 0, undefined, 1),
      ...listSteps,
      { wait: { until: { mem: 'l_row', equals: LIST_PAGE - 1 }, timeout: 1 } },
      { mark: 'before-equip' },
      PRESS('circle'),
      { wait: { until: { mem: 'weapon0', differs: 0 }, timeout: 120 }, metric: 'eq_wait' },
      { wait: { frames: SETTLE } },
    ],
    assert: [
      { expect: { mem: 'weapon0', equals: weaponAfter }, metric: 'w_idx' },
      { change: { mem: 'weapon0', is: 'changed', since: 'before-equip' } },
      { expect: { mem: 'slot', equals: 0 } },
      { expect: { mem: 'menu_ovl', equals: OVERLAY_EQUIP } },
      { expect: { mem: 'game_state', equals: 5 } },
      { sameState: 'rerun', metric: 'match' },
    ],
    metrics: ['load_done', 'ovl_wait', 'w_row7', 'w_off2', 'eq_wait', 'w_idx', 'weapon0', 'match'],
  };
  return [slot, list, scroll, slotAccept, listAccept];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const s of equipCursorScenarios()) writeFileSync(path.join(SCENARIO_DIR, `${s.name}.json`), serialise(s));
}
