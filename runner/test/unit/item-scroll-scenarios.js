// The Tier 2 scenarios of #256 part 1 (Item list past page 1), generated so
// the acceptance script is the semantic layer's own plan (itemSlotPlan and
// itemTargetPlan in semantic/item-screen.js), not hand-written.
// item-scroll.test.js checks the committed files equal this.
//
//   node runner/test/unit/item-scroll-scenarios.js    rewrite the files
//
// #135 confirmed the Item screen's cursors on page 1 (offset 0). Hypothesis
// H1 here: Down at list row 9 scrolls one entry (offset + 1, row stays 9),
// and list index = offset + row = inventory slot across empty slots, as
// #244/#246/#248 showed for the Materia list. The list layout is a fact
// from Xeeynamo/ff7-decomp@33ce78c (reference only, no code copied), as
// cited in semantic/addresses.js and notes/135-native-item.md.
// Original project code, GPL-2.0-or-later.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADDRESS_TABLE, MENU_OVERLAY_ITEM } from '../../../semantic/addresses.js';
import { itemSlotPlan, itemTargetPlan } from '../../../semantic/item-screen.js';
import { SCENARIO_DIR, scriptFromPlan, serialise } from './planner-scenarios.js';

const hex = (n) => `0x${n.toString(16)}`;
const entry = (name) => {
  const e = ADDRESS_TABLE.entries.find((x) => x.name === name);
  if (!e) throw new Error(`no address entry ${name}`);
  return e;
};
const INV = entry('inventorySlot');
const invAddr = (slot) => hex(INV.address + INV.stride * slot);
const hpAddr = (slot) => hex(entry(`partyHp${slot}`).address);

/** The save the scenarios load: harness/saves/disc1-md1stin-item-scroll.json. */
export const SAVE = 'disc1-md1stin-item-scroll';
/**
 * Author-chosen inventory: slots 0, 5 and 13 only, with empty slots between
 * them on both pages. Slot 13 (item index 0, a restorative; a source claim)
 * is past page 1 (rows 0-9).
 */
export const ITEMS = Object.freeze([
  Object.freeze({ slot: 0, index: 1, quantity: 2 }),
  Object.freeze({ slot: 5, index: 3, quantity: 2 }),
  Object.freeze({ slot: 13, index: 0, quantity: 5 }),
]);
/** The item used and the party slot it is used on (Barret, HP 300 of 333). */
export const USE = Object.freeze({ slot: 13, partySlot: 1 });
export const HP_BEFORE = 300;
export const HP_MAX = 333;
/** An inventory word: quantity << 9 | index (#117); an empty slot reads 0xFFFF. */
export const wordOf = ({ index, quantity }) => (quantity << 9) | index;
/** The list opens on row 0 of page 1 (#135 14c). */
export const LIST_START = Object.freeze({ row: 0, offset: 0 });
export const toFar = itemSlotPlan(LIST_START, USE.slot);
export const farEnd = toFar.steps.at(-1);
/** 31a: blind Downs from the top, as many as the plan to slot 13 presses. */
export const MEASURE_DOWNS = toFar.steps.length;
const SETTLE = 30;

const MEMORY = {
  game_state: { addr: '0x8009c560', type: 'u16', description: 'g_GameState (s16 as u16; confirmed #76): field 1, menu 5.' },
  map_cur: { addr: '0x8009a05c', type: 'u16', description: 'g_FieldCurrentMap (s16 as u16; confirmed #77): the field ID.' },
  loading: { addr: '0x800965e8', type: 'u16', description: 'g_IsFieldLoading (s16 as u16; confirmed #77): 2 in a settled field (the field-loaded segment waits on it).' },
  row0: { addr: '0x8009a0d3', type: 'u8', description: 'menuCursor (confirmed #78): the main-menu cursor, row 0 = Item.' },
  menu_ovl: { addr: hex(entry('menuOverlay').address), type: 'u32', description: `menuOverlay (confirmed #135): ${MENU_OVERLAY_ITEM} = the Item screen.` },
  item_screen: { addr: hex(entry('itemMenuScreen').address), type: 'u32', description: 'itemMenuScreen (confirmed #135): 1 the item list, 2 picking a party member.' },
  list_row: { addr: hex(entry('itemListRow').address), type: 'u8', description: 'itemListRow (confirmed #135): the item list cursor on the page, 0-9.' },
  list_off: { addr: hex(entry('itemListOffset').address), type: 'u16', description: 'itemListOffset (confirmed #135 at 0 only): the inventory slot on the top row. Scrolling is hypothesis H1 here.' },
  party_row: { addr: hex(entry('itemTargetSlot').address), type: 'u8', description: 'itemTargetSlot (confirmed #135): the party cursor.' },
  inv0: { addr: invAddr(0), type: 'u16', description: 'inventorySlot[0] (confirmed #117).' },
  inv5: { addr: invAddr(5), type: 'u16', description: 'inventorySlot[5] (confirmed #117).' },
  inv13: { addr: invAddr(13), type: 'u16', description: 'inventorySlot[13] (confirmed #117): the item used, past page 1.' },
  hp0: { addr: hpAddr(0), type: 'u16', description: 'partyHp0 (confirmed #78).' },
  hp1: { addr: hpAddr(1), type: 'u16', description: 'partyHp1 (confirmed #101): the slot the item is used on.' },
};

/** Load the save and open the field menu, as save-boot-14b does; the main-menu cursor is then on row 0 (Item). */
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
 * An itemSlotPlan as a script: each press, then a wait of at most
 * plan.timing.settle frames for the cursor that should change (the row, or
 * the offset on a scroll) to read its expected value, then a one-frame check
 * of the other. `metric` names the last step's wait.
 */
export function scriptFromSlotPlan(plan, from, metric) {
  const out = [];
  let prev = from;
  plan.steps.forEach((s, i) => {
    if (i > 0 && plan.timing.gap > 0) out.push({ wait: { frames: plan.timing.gap } });
    out.push({ buttons: [s.button], frames: plan.timing.hold });
    const scrolls = s.row === prev.row;
    const [moving, value, other, otherValue] = scrolls ? ['list_off', s.offset, 'list_row', s.row] : ['list_row', s.row, 'list_off', s.offset];
    out.push(until(moving, value, i === plan.steps.length - 1 ? metric : undefined, plan.timing.settle));
    out.push(until(other, otherValue, undefined, 1));
    prev = s;
  });
  return out;
}

const planText = (plan, from, metric) => {
  const scrolls = plan.steps.filter((s, i) => s.row === (i ? plan.steps[i - 1] : from).row).length;
  return `itemSlotPlan from row ${from.row} offset ${from.offset} to inventory slot ${plan.to}: ${plan.steps.length} ${plan.steps[0]?.button ?? 'no'} presses (${plan.steps.length - scrolls} row moves, ${scrolls} scrolls), each followed by a wait of at most ${plan.timing.settle} frames for the moving cursor and a one-frame check of the other (${metric} is the last)`;
};

export function itemScrollScenarios() {
  const base = { $schema: '../schema/scenario.schema.json', format: 2, tier: 2, boot: { disc: 1, save: SAVE, slot: 1 }, memory: MEMORY };
  const used = { ...ITEMS[2], quantity: ITEMS[2].quantity - 1 };
  const target = itemTargetPlan(0, USE.partySlot);
  const { gap } = toFar.timing;

  // Measurement: blind Downs with no checks between them, so a different
  // scroll rule shows in the raw cursors instead of stopping the script.
  const measureInput = [
    ...OPEN_MENU,
    { wait: { until: { mem: 'menu_ovl', equals: MENU_OVERLAY_ITEM }, timeout: 600, press: { buttons: ['circle'], every: 60, hold: 4 } }, metric: 'ovl_wait' },
    { wait: { frames: 120 } },
    until('item_screen', 1, undefined, 1),
    until('list_row', 0, undefined, 1),
    until('list_off', 0, undefined, 1),
  ];
  for (let i = 0; i < MEASURE_DOWNS; i++) measureInput.push(PRESS('down'), { wait: { frames: 12 } });
  measureInput.push({ wait: { frames: 30 } });
  const measure = {
    ...base,
    name: 'save-boot-31a-item-list-scroll-measure',
    description: `#256 part 1 (measurement, H1): how the Item list moves past row 9. From harness/saves/${SAVE}.json (items in inventory slots 0, 5 and 13 only), open the field menu, Circle every 60 frames until menu_ovl reads ${MENU_OVERLAY_ITEM} (ovl_wait), 120 frames, check the list is open on row 0 offset 0, then ${MEASURE_DOWNS} Down presses (4 frames held, 12 frames apart) with no checks between them, then 30 frames. Reports the raw list_row and list_off (H1: row 9, offset ${MEASURE_DOWNS - 9}; a wrap or a skip over empty slots shows as other values) and item_screen. Checks only what holds whatever the answer: still on the item list in the menu.`,
    input: measureInput,
    assert: [
      { expect: { mem: 'item_screen', equals: 1 } },
      { expect: { mem: 'game_state', equals: 5 } },
    ],
    metrics: ['load_done', 'ovl_wait', 'list_row', 'list_off', 'item_screen', 'frames'],
  };

  const accept = {
    ...base,
    name: 'save-boot-31b-item-use-past-page1',
    description: `#256 part 1 (acceptance): the planned pad sequence uses an item past page 1, across empty slots. From harness/saves/${SAVE}.json (party slot 1 at HP ${HP_BEFORE}/${HP_MAX}; inventory slot ${USE.slot} = item index 0, quantity 5; slots 0 and 5 hold other items; every other slot empty), open the field menu, Circle on row 0 (Item), wait until item_screen reads 1 (scr1_wait), 30 frames, check row 0 offset 0. Then ${planText(toFar, LIST_START, 'w_far')}. Then Circle, wait until item_screen reads 2, itemTargetPlan 0 to ${USE.partySlot} (w_target), mark, Circle, and wait until inventory slot ${USE.slot} reads quantity 4 (use_wait). Checks: slot ${USE.slot} count one lower (count_ok); party slot 1 HP rose to ${HP_MAX} (hp_ok, and increased since the mark); party slot 0 HP and inventory slots 0 and 5 unchanged; still on the target page in the menu; a rerun matches. Only frame counts and 1/0 leave.`,
    input: [
      ...OPEN_MENU,
      PRESS('circle'),
      { wait: { until: { mem: 'item_screen', equals: 1 }, timeout: 120 }, metric: 'scr1_wait' },
      { wait: { frames: 30 } },
      until('list_row', LIST_START.row, undefined, 1),
      until('list_off', LIST_START.offset, undefined, 1),
      ...scriptFromSlotPlan(toFar, LIST_START, 'w_far'),
      { wait: { frames: gap } },
      PRESS('circle'),
      { wait: { until: { mem: 'item_screen', equals: 2 }, timeout: 60 } },
      { wait: { frames: gap } },
      ...scriptFromPlan(target, 'party_row', 'w_target'),
      { wait: { frames: gap } },
      { mark: 'before-use' },
      PRESS('circle'),
      { wait: { until: { mem: 'inv13', equals: wordOf(used) }, timeout: 60 }, metric: 'use_wait' },
      { wait: { frames: 20 } },
    ],
    assert: [
      { expect: { mem: 'inv13', equals: wordOf(used) }, metric: 'count_ok' },
      { expect: { mem: 'hp1', equals: HP_MAX }, metric: 'hp_ok' },
      { change: { mem: 'hp1', is: 'increased', since: 'before-use' } },
      { change: { mem: 'hp0', is: 'unchanged', since: 'before-use' } },
      { expect: { mem: 'inv0', equals: wordOf(ITEMS[0]) } },
      { expect: { mem: 'inv5', equals: wordOf(ITEMS[1]) } },
      { expect: { mem: 'item_screen', equals: 2 } },
      { expect: { mem: 'game_state', equals: 5 } },
      { sameState: 'rerun', metric: 'match' },
    ],
    metrics: ['load_done', 'scr1_wait', 'w_far', 'w_target', 'use_wait', 'count_ok', 'hp_ok', 'match'],
  };
  return [measure, accept];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const s of itemScrollScenarios()) writeFileSync(path.join(SCENARIO_DIR, `${s.name}.json`), serialise(s));
}
