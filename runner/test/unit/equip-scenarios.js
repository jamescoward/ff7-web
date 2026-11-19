// The Tier 2 scenarios of #121 part 1 (native Equip screen, game-state half),
// generated so the main-menu move to Equip is the menu planner's output
// (semantic/menu-panel.js menuPanelPlan), not hand-written. equip.test.js
// checks the committed files equal this.
//
//   node runner/test/unit/equip-scenarios.js    rewrite the files
//
// The Equip screen is the EQIPMENU overlay. Xeeynamo/ff7-decomp@33ce78c
// (reference only, no code copied) names its overlay ids (src/main/1F6B4.c,
// enum YamadaOvl: 3 YAMA_EQIPMENU_MATERIA, 4 YAMA_EQIPMENU_EQUIP; "ids 1 to 10
// follow the order of the main menu entries") but does not decompile the
// overlay itself, so its cursor variables have no source. Part 1 therefore
// confirms only the overlay id and that a pad sequence changes the equipped
// weapon, read from the savemap (confirmed #117).
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
const DECOMP = 'Xeeynamo/ff7-decomp@33ce78c (reference only, no code)';
const INV = entry('inventorySlot');
const invAddr = (slot) => hex(INV.address + INV.stride * slot);
const recAddr = (name, record) => hex(entry(name).address + CHARACTER_RECORD_SIZE * record);

/** The save the scenarios load: harness/saves/disc1-md1stin-equip.json. */
export const SAVE = 'disc1-md1stin-equip';
/** Main-menu row of Equip (MENUS.main.labels; the order is a source claim this run checks through the overlay id). */
export const EQUIP_ROW = MENUS.main.labels.indexOf('Equip');
/** menuOverlay value expected for the Equip screen (enum YamadaOvl, YAMA_EQIPMENU_EQUIP): a hypothesis until Tier 2 reads it. */
export const OVERLAY_EQUIP = 4;
/** Cloud (record 0, alone in the party) starts with weapon 0. */
export const WEAPON_BEFORE = 0;
/**
 * Author-chosen spare weapons in the inventory (item index = 128 + weapon).
 * That record 0 can equip weapons 1 and 2 is a HYPOTHESIS (the kernel's equip
 * masks decide it; no source names which numbers are Cloud's), as is the
 * list order. The acceptance expects the first list entry to be weapon 1.
 */
export const ITEMS = Object.freeze([
  { slot: 0, index: 129, quantity: 1 },
  { slot: 1, index: 130, quantity: 1 },
]);
export const WEAPON_AFTER = ITEMS[0].index - 128;
const word = ({ index, quantity }) => (quantity << 9) | index;

const MEMORY = {
  game_state: { addr: '0x8009c560', type: 'u16', description: 'g_GameState (s16 as u16; confirmed #76): field 1, menu 5.' },
  map_cur: { addr: '0x8009a05c', type: 'u16', description: 'g_FieldCurrentMap (s16 as u16; confirmed #77): the field ID.' },
  loading: { addr: '0x800965e8', type: 'u16', description: 'g_IsFieldLoading (s16 as u16; confirmed #77): 2 in a settled field (the field-loaded segment waits on it).' },
  row0: { addr: '0x8009a0d3', type: 'u8', description: 'menuCursor (confirmed #78): the main-menu cursor, row 0 = Item.' },
  menu_ovl: {
    addr: hex(entry('menuOverlay').address),
    type: 'u32',
    description: `menuOverlay (confirmed for 0 and 1, #135): D_80062DD4, the menu overlay id SysMenuLoadMenuFileById last asked for. 4 = YAMA_EQIPMENU_EQUIP is a hypothesis this run checks. ${DECOMP} src/main/1F6B4.c`,
  },
  menu_prev: {
    addr: '0x80062dd0',
    type: 'u32',
    description: `D_80062DD0 (hypothesis): the overlay id before it. ${DECOMP} src/main/1F6B4.c`,
  },
  weapon0: { addr: recAddr('characterWeapon', 0), type: 'u8', description: 'characterWeapon[record 0] (confirmed #117): Cloud\'s equipped weapon, 0-127.' },
  inv0: { addr: invAddr(0), type: 'u16', description: 'inventorySlot[0] (confirmed #117): quantity << 9 | index; author-chosen weapon 1 in the save.' },
  inv1: { addr: invAddr(1), type: 'u16', description: 'inventorySlot[1] (confirmed #117): author-chosen weapon 2 in the save.' },
};

/** Load the save and open the field menu, as save-boot-14a does; the main-menu cursor is then on row 0 (Item). */
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

export function equipScenarios() {
  const toEquip = menuPanelPlan(0, EQUIP_ROW);
  const toEquipSteps = (metric) => [...scriptFromPlan(toEquip, 'row0', metric), { wait: { frames: 60 } }];
  const TO_EQUIP = toEquipSteps('row_wait');
  const base = { $schema: '../schema/scenario.schema.json', format: 2, tier: 2, boot: { disc: 1, save: SAVE, slot: 1 }, memory: MEMORY };

  // Diagnostic: does one Circle on Equip load the overlay, or go to a party
  // pick first? (#135 14f: Circle on row 2, Materia, left menu_ovl at 0.)
  const once = {
    ...base,
    name: 'save-boot-15a-equip-row-circle',
    description: `#121 part 1 (diagnostic): what the menu's overlay bookkeeping reads after one Circle on the Equip row. Load harness/saves/${SAVE}.json (Cloud alone, weapon ${WEAPON_BEFORE}), open the field menu (as save-boot-14a), plan the main-menu cursor 0 to ${EQUIP_ROW} (semantic/menu-panel.js; row_wait), wait 60 frames, press Circle once, then 300 frames with no checks. Reports the raw menu_ovl (${OVERLAY_EQUIP} if the Equip overlay was asked for, 0 if a party pick comes first), menu_prev, row0, weapon0 and game_state. Check: the field ID is unchanged.`,
    input: [...OPEN_MENU, ...TO_EQUIP, PRESS('circle'), { wait: { frames: 300 } }],
    assert: [{ expect: { mem: 'map_cur', equals: 116 } }],
    metrics: ['load_done', 'row_wait', 'menu_ovl', 'menu_prev', 'row0', 'weapon0', 'game_state', 'frames'],
  };

  // Circle until the Equip overlay id is asked for, then let the read finish.
  const openEquip = (rowMetric) => [
    ...OPEN_MENU,
    ...toEquipSteps(rowMetric),
    { wait: { until: { mem: 'menu_ovl', equals: OVERLAY_EQUIP }, timeout: 600, press: { buttons: ['circle'], every: 60, hold: 4 } }, metric: 'ovl_wait' },
    { wait: { frames: 120 } },
  ];
  const open = {
    ...base,
    name: 'save-boot-15b-equip-screen-open',
    description: `#121 part 1 (diagnostic): as 15a, but Circle is pressed every 60 frames until menu_ovl reads ${OVERLAY_EQUIP} (ovl_wait; 0 = it never did within 600 frames, and the script stops there), then 120 frames pass with no input. Reports the raw menu_ovl, menu_prev, row0, weapon0 and game_state. Checks: menu_ovl ${OVERLAY_EQUIP}, weapon unchanged, still in the menu.`,
    input: openEquip('row_wait'),
    assert: [
      { expect: { mem: 'menu_ovl', equals: OVERLAY_EQUIP } },
      { expect: { mem: 'weapon0', equals: WEAPON_BEFORE } },
      { expect: { mem: 'game_state', equals: 5 } },
    ],
    metrics: ['load_done', 'row_wait', 'ovl_wait', 'menu_ovl', 'menu_prev', 'weapon0', 'game_state', 'frames'],
  };

  // Acceptance: Circle on the Equip screen's first slot (Weapon, where the
  // cursor is assumed to start), then Circle on the first list entry. Both
  // cursor positions are hypotheses: no cursor address is read, only the
  // equipped weapon in the savemap.
  const accept = {
    ...base,
    name: 'save-boot-15c-equip-weapon-plan',
    description: `#121 part 1 (acceptance): a pad sequence equips a different weapon, by pad input only, confirmed by reading the savemap. As 15b (planned move to Equip, Circle until menu_ovl reads ${OVERLAY_EQUIP}, 120 frames), mark, Circle (the Weapon slot, where the cursor is assumed to start), 60 frames, Circle (the first entry of the weapon list), then wait until weapon0 reads ${WEAPON_AFTER} (eq_wait; timeout 120). Inventory slots 0 and 1 hold weapons ${ITEMS[0].index - 128} and ${ITEMS[1].index - 128} (author-chosen); that Cloud can equip them and that weapon ${WEAPON_AFTER} is listed first are hypotheses. Checks: weapon0 ${WEAPON_AFTER} (weap_ok) and changed since the mark; still on the Equip overlay in the menu; field unchanged; a rerun matches (match). Reports the raw weapon0, inv0 and inv1 (author-chosen indices, to see where the old weapon went). Only frame counts, 1/0 and these values leave.`,
    input: [...openEquip(undefined), { mark: 'before-equip' }, PRESS('circle'), { wait: { frames: 60 } }, PRESS('circle'), { wait: { until: { mem: 'weapon0', equals: WEAPON_AFTER }, timeout: 120 }, metric: 'eq_wait' }, { wait: { frames: 30 } }],
    assert: [
      { expect: { mem: 'weapon0', equals: WEAPON_AFTER }, metric: 'weap_ok' },
      { change: { mem: 'weapon0', is: 'changed', since: 'before-equip' } },
      { expect: { mem: 'menu_ovl', equals: OVERLAY_EQUIP } },
      { expect: { mem: 'game_state', equals: 5 } },
      { expect: { mem: 'map_cur', equals: 116 } },
      { sameState: 'rerun', metric: 'match' },
    ],
    metrics: ['load_done', 'ovl_wait', 'eq_wait', 'weap_ok', 'weapon0', 'inv0', 'inv1', 'match'],
  };
  return [once, open, accept];
}

/** The inventory words the save writes (for the test). */
export const ITEM_WORDS = ITEMS.map(word);

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const s of equipScenarios()) writeFileSync(path.join(SCENARIO_DIR, `${s.name}.json`), serialise(s));
}
