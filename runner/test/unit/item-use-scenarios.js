// The Tier 2 scenarios of #135 (native Item screen, game-state half),
// generated so the acceptance script is the menu planner's output
// (semantic/planner.js with semantic/menus.js itemList and itemTarget), not
// hand-written. item-use.test.js checks the committed files equal this.
//
//   node runner/test/unit/item-use-scenarios.js    rewrite the files
//
// Addresses are facts from Xeeynamo/ff7-decomp@33ce78c (reference only, no
// code copied), as cited in semantic/addresses.js.
// Original project code, GPL-2.0-or-later.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADDRESS_TABLE } from '../../../semantic/addresses.js';
import { menuPlanArgs } from '../../../semantic/menus.js';
import { planCursorMove } from '../../../semantic/planner.js';
import { SCENARIO_DIR, scriptFromPlan, serialise } from './planner-scenarios.js';

const hex = (n) => `0x${n.toString(16)}`;
const entry = (name) => {
  const e = ADDRESS_TABLE.entries.find((x) => x.name === name);
  if (!e) throw new Error(`no address entry ${name}`);
  return e;
};
const DECOMP = 'Xeeynamo/ff7-decomp@33ce78c (reference only, no code)';
const INV = entry('inventorySlot');
const invAddr = (slot) => hex(INV.address + INV.stride * slot);
const hpAddr = (slot) => hex(entry(`partyHp${slot}`).address);

/** The save the scenarios load: harness/saves/disc1-md1stin-potion.json. */
export const SAVE = 'disc1-md1stin-potion';
/** Author-chosen inventory of that save (index, quantity per slot). */
export const ITEMS = Object.freeze([
  { slot: 0, index: 1, quantity: 2 },
  { slot: 1, index: 3, quantity: 2 },
  { slot: 2, index: 0, quantity: 5 },
]);
/** The item used: slot 2, item index 0 (restores 100 HP in the field menu; a source claim). */
export const USE = Object.freeze({ listRow: 2, partySlot: 1 });
/** Party slot 1 is record 1 (Barret) at HP 300 of 333: a Potion fills it to 333. */
export const HP_BEFORE = 300;
export const HP_MAX = 333;
const word = ({ index, quantity }) => (quantity << 9) | index;

const MEMORY = {
  game_state: { addr: '0x8009c560', type: 'u16', description: 'g_GameState (s16 as u16; confirmed #76): field 1, menu 5.' },
  map_cur: { addr: '0x8009a05c', type: 'u16', description: 'g_FieldCurrentMap (s16 as u16; confirmed #77): the field ID.' },
  loading: { addr: '0x800965e8', type: 'u16', description: 'g_IsFieldLoading (s16 as u16; confirmed #77): 2 in a settled field.' },
  row0: { addr: '0x8009a0d3', type: 'u8', description: 'menuCursor (confirmed #78): the main-menu cursor, row 0 = Item.' },
  item_screen: {
    addr: hex(entry('itemMenuScreen').address),
    type: 'u32',
    description: `itemMenuScreen (hypothesis, #135): g_ItemMenuCurrentScreen, an Item-menu overlay variable: 1 the item list, 2 picking a party member. ${DECOMP} config/symbols.itemmenu.us.txt, src/menu/itemmenu.c`,
  },
  list_row: {
    addr: hex(entry('itemListRow').address),
    type: 'u8',
    description: `itemListRow (hypothesis, #135): g_ItemMenuWidgets[1] (0x801D3DDC + 0x12) + 0x0B row, the item list cursor on the page. ${DECOMP} include/game.h MenuTable`,
  },
  list_off: {
    addr: hex(entry('itemListOffset').address),
    type: 'u16',
    description: `itemListOffset (hypothesis, #135): g_ItemMenuWidgets[1] + 0x02 rowOffset, the slot on the top row. ${DECOMP}`,
  },
  party_row: {
    addr: hex(entry('itemTargetSlot').address),
    type: 'u8',
    description: `itemTargetSlot (hypothesis, #135): g_ItemMenuWidgets[2] (0x801D3DDC + 0x24) + 0x0B row, the party cursor. ${DECOMP}`,
  },
  menu_ovl: {
    addr: '0x80062dd4',
    type: 'u32',
    description: `D_80062DD4 (hypothesis, #135 attempt 2): the menu overlay id SysMenuLoadMenuFileById last asked for; 1 = the Item screen (ITEMMENU_Init is entry 1 of the init table D_800493A8). ${DECOMP} src/main/1F6B4.c, src/main/ovl.c`,
  },
  menu_prev: {
    addr: '0x80062dd0',
    type: 'u32',
    description: `D_80062DD0 (hypothesis): the overlay id before it. ${DECOMP} src/main/1F6B4.c`,
  },
  ovl_addr: {
    addr: '0x80062dec',
    type: 'u32',
    description: `D_80062DEC (hypothesis): the RAM address menu overlays are read to (0x801D0000 initially; a setter can change it). ${DECOMP} src/main/1F6B4.c LoadMenuOvl`,
  },
  inv0: { addr: invAddr(0), type: 'u16', description: 'inventorySlot[0] (confirmed #117): quantity << 9 | index.' },
  inv1: { addr: invAddr(1), type: 'u16', description: 'inventorySlot[1] (confirmed #117).' },
  inv2: { addr: invAddr(2), type: 'u16', description: 'inventorySlot[2] (confirmed #117): the item used.' },
  hp0: { addr: hpAddr(0), type: 'u16', description: 'partyHp0 (confirmed #78): g_ActiveCharacters[0].hp.' },
  hp1: { addr: hpAddr(1), type: 'u16', description: 'partyHp1 (confirmed #101): g_ActiveCharacters[1].hp, the slot the item is used on.' },
};

/** Load the save and open the field menu, as save-boot-10b does; the main-menu cursor is then on row 0 (Item). */
const OPEN_MENU = [
  { wait: { until: { mem: 'game_state', equals: 1 }, timeout: 3600, press: { buttons: ['circle'], every: 30, hold: 4 } } },
  { segment: 'field-loaded' },
  { wait: { until: { mem: 'map_cur', equals: 116 }, timeout: 1 } },
  { wait: { frames: 60 } },
  { wait: { until: { mem: 'game_state', equals: 5 }, timeout: 600, press: { buttons: ['triangle'], every: 60, hold: 4 } }, metric: 'menu_wait' },
  { wait: { frames: 60 } },
];
/** One press of `button`, held 4 frames as the planner does. */
const PRESS = (button) => ({ buttons: [button], frames: 4 });

export function itemUseScenarios() {
  const list = planCursorMove({ from: 0, to: USE.listRow, ...menuPlanArgs('itemList') });
  const target = planCursorMove({ from: 0, to: USE.partySlot, ...menuPlanArgs('itemTarget') });
  const { gap } = list.timing;
  const used = { ...ITEMS[2], quantity: ITEMS[2].quantity - 1 };

  // Attempt 1 (3fa3585): one Circle 30 frames after the menu opened, then 90
  // frames: item_screen read 0x43784343, list_row 255, list_off 5887 (not the
  // overlay's variables). 14a reports which menu overlay was asked for and
  // where overlays are read to; 14c keeps pressing Circle until the overlay
  // id reads 1, then waits for the read to finish. Neither stops early.
  const diag = {
    $schema: '../schema/scenario.schema.json',
    format: 2,
    tier: 2,
    name: 'save-boot-14a-item-screen-open',
    description: `#135 (diagnostic, attempt 2): what the menu's overlay bookkeeping and the Item screen's hypothesised variables read after Item is chosen. Load harness/saves/${SAVE}.json, open the field menu (as save-boot-10b) and wait 60 frames, check the main-menu cursor is on row 0 (Item), press Circle once, wait 300 frames with no checks, then report the raw menu_ovl (expected 1), menu_prev, ovl_addr (expected 0x801D0000), item_screen (expected 1), list_row (expected 0), row0 and game_state. Checks: menu_ovl 1, item_screen 1, still in the menu.`,
    boot: { disc: 1, save: SAVE, slot: 1 },
    memory: MEMORY,
    input: [...OPEN_MENU.map(({ metric, ...step }) => step), { wait: { until: { mem: 'row0', equals: 0 }, timeout: 1 } }, PRESS('circle'), { wait: { frames: 300 } }],
    assert: [
      { expect: { mem: 'menu_ovl', equals: 1 } },
      { expect: { mem: 'item_screen', equals: 1 } },
      { expect: { mem: 'game_state', equals: 5 } },
    ],
    metrics: ['load_done', 'menu_ovl', 'menu_prev', 'ovl_addr', 'item_screen', 'list_row', 'row0', 'game_state'],
  };

  const diagPress = {
    $schema: '../schema/scenario.schema.json',
    format: 2,
    tier: 2,
    name: 'save-boot-14c-item-screen-press',
    description: `#135 (diagnostic, attempt 2): as 14a, but Circle is pressed every 60 frames until menu_ovl reads 1 (ovl_wait; 0 = it never did within 600 frames, and the script stops there), then 120 frames pass with no input. Reports the raw item_screen, list_row, list_off, party_row and ovl_addr. Checks: item_screen 1, list_row 0, list_off 0.`,
    boot: { disc: 1, save: SAVE, slot: 1 },
    memory: MEMORY,
    input: [
      ...OPEN_MENU.map(({ metric, ...step }) => step),
      { wait: { until: { mem: 'menu_ovl', equals: 1 }, timeout: 600, press: { buttons: ['circle'], every: 60, hold: 4 } }, metric: 'ovl_wait' },
      { wait: { frames: 120 } },
    ],
    assert: [
      { expect: { mem: 'item_screen', equals: 1 } },
      { expect: { mem: 'list_row', equals: 0 } },
      { expect: { mem: 'list_off', equals: 0 } },
    ],
    metrics: ['load_done', 'ovl_wait', 'item_screen', 'list_row', 'list_off', 'party_row', 'ovl_addr', 'frames'],
  };

  const accept = {
    $schema: '../schema/scenario.schema.json',
    format: 2,
    tier: 2,
    name: 'save-boot-14b-item-use-plan',
    description: `#135 (acceptance): a planned pad sequence uses an author-chosen restorative item on a party slot below max HP, by pad input only. From harness/saves/${SAVE}.json (party Cloud, Barret, Tifa; party slot 1 at HP ${HP_BEFORE}/${HP_MAX}; inventory slot 2 = item index 0, quantity 5), open the field menu, Circle on row 0 (Item) and wait until item_screen reads 1 (scr1_wait), then 30 frames. The cursor moves are semantic/planner.js output (generated by runner/test/unit/item-use-scenarios.js): itemList row 0 to ${USE.listRow} (w_list), Circle until item_screen reads 2 (a timeout there shows as w_target 0 after a non-zero w_list), itemTarget row 0 to ${USE.partySlot} (w_target), mark, Circle, wait until inventory slot 2 reads quantity 4 (use_wait). Checks: slot 2 count one lower (count_ok); slot 1 HP rose to ${HP_MAX} (hp_ok, and increased since the mark); slot 0 HP and inventory slots 0-1 unchanged; still on the target page in the menu; a rerun matches (match). Only frame counts and 1/0 leave.`,
    boot: { disc: 1, save: SAVE, slot: 1 },
    memory: MEMORY,
    input: [
      ...OPEN_MENU.map(({ metric, ...step }) => step), // metrics: at most 8
      { wait: { until: { mem: 'row0', equals: 0 }, timeout: 1 } },
      PRESS('circle'),
      { wait: { until: { mem: 'item_screen', equals: 1 }, timeout: 120 }, metric: 'scr1_wait' },
      { wait: { frames: 30 } },
      ...scriptFromPlan(list, 'list_row', 'w_list'),
      { wait: { frames: gap } },
      PRESS('circle'),
      { wait: { until: { mem: 'item_screen', equals: 2 }, timeout: 60 } },
      { wait: { frames: gap } },
      ...scriptFromPlan(target, 'party_row', 'w_target'),
      { wait: { frames: gap } },
      { mark: 'before-use' },
      PRESS('circle'),
      { wait: { until: { mem: 'inv2', equals: word(used) }, timeout: 60 }, metric: 'use_wait' },
      { wait: { frames: 20 } },
    ],
    assert: [
      { expect: { mem: 'inv2', equals: word(used) }, metric: 'count_ok' },
      { expect: { mem: 'hp1', equals: HP_MAX }, metric: 'hp_ok' },
      { change: { mem: 'hp1', is: 'increased', since: 'before-use' } },
      { change: { mem: 'hp0', is: 'unchanged', since: 'before-use' } },
      { expect: { mem: 'inv0', equals: word(ITEMS[0]) } },
      { expect: { mem: 'inv1', equals: word(ITEMS[1]) } },
      { expect: { mem: 'item_screen', equals: 2 } },
      { expect: { mem: 'game_state', equals: 5 } },
      { sameState: 'rerun', metric: 'match' },
    ],
    metrics: ['load_done', 'scr1_wait', 'w_list', 'w_target', 'use_wait', 'count_ok', 'hp_ok', 'match'],
  };
  return [diag, accept, diagPress];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const s of itemUseScenarios()) writeFileSync(path.join(SCENARIO_DIR, `${s.name}.json`), serialise(s));
}
