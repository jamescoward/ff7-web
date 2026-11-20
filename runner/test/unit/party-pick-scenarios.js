// The Tier 2 scenarios of #215: the main menu's party-pick cursor (which party
// slot is highlighted after Circle on a main-menu row that asks for a member,
// such as Equip). Generated so the main-menu move to Equip is the menu
// planner's output (semantic/menu-panel.js menuPanelPlan), not hand-written.
// party-pick.test.js checks the committed files equal this.
//
//   node runner/test/unit/party-pick-scenarios.js    rewrite the files
//
// Hypothesis under test (source claim): g_PartyMenuTables at 0x8009A0C8 holds
// three MenuTables of 0x12 bytes with the row at +0x0B
// (Xeeynamo/ff7-decomp@33ce78c config/symbols.main.us.txt and include/game.h,
// reference only, no code copied). Table 0's row is the confirmed menuCursor
// (#78); tables 1 and 2 stayed 0 in #78's checks, which never opened a party
// pick. So table 1's row, 0x8009A0E5, may be the party pick.
// Original project code, GPL-2.0-or-later.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADDRESS_TABLE, CHARACTER_RECORD_SIZE, MENU_OVERLAY_EQUIP } from '../../../semantic/addresses.js';
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
const recAddr = (name, record) => hex(entry(name).address + CHARACTER_RECORD_SIZE * record);

/** g_PartyMenuTables and the MenuTable layout (source claim, see the header). */
export const PARTY_MENU_TABLES = 0x8009a0c8;
export const MENU_TABLE_SIZE = 0x12;
export const MENU_TABLE_ROW = 0x0b;
/** The candidate: table 1's row. */
export const PICK_CANDIDATE = PARTY_MENU_TABLES + MENU_TABLE_SIZE * 1 + MENU_TABLE_ROW;
/** Table 2's row, read alongside in case the pick lives there instead. */
export const TABLE2_ROW = PARTY_MENU_TABLES + MENU_TABLE_SIZE * 2 + MENU_TABLE_ROW;

/** The save the scenarios load: harness/saves/disc1-md1stin-party3.json. */
export const SAVE = 'disc1-md1stin-party3';
/** Party: Cloud, Barret, Tifa, so party slot k holds character record k. */
export const PARTY = Object.freeze([0, 1, 2]);
export const EQUIP_ROW = MENUS.main.labels.indexOf('Equip');
export const OVERLAY_EQUIP = MENU_OVERLAY_EQUIP;
/**
 * Author-chosen spare weapons (item index = 128 + weapon), one each.
 * Weapon 1 is one Cloud can equip (#121, 15c). Weapons 17 and 33 are a
 * HYPOTHESIS: that the kernel's weapon list runs in blocks of 16 per
 * character after Cloud's, so one of them is Barret's and the other Tifa's,
 * whichever order the blocks are in. The Equip list shows only the weapons a
 * member can equip, so each member's list should then hold exactly one.
 * The scenarios read which weapon each member ends up with.
 */
export const ITEMS = Object.freeze([
  { slot: 0, index: 129, quantity: 1 },
  { slot: 1, index: 145, quantity: 1 },
  { slot: 2, index: 161, quantity: 1 },
]);
/** Frames after each Down in the party pick (the main-menu planner's settle is far less). */
export const PICK_GAP = 30;

const MEMORY = {
  game_state: { addr: '0x8009c560', type: 'u16', description: 'g_GameState (s16 as u16; confirmed #76): field 1, menu 5.' },
  map_cur: { addr: '0x8009a05c', type: 'u16', description: 'g_FieldCurrentMap (s16 as u16; confirmed #77): the field ID.' },
  loading: { addr: '0x800965e8', type: 'u16', description: 'g_IsFieldLoading (s16 as u16; confirmed #77): 2 in a settled field (the field-loaded segment waits on it).' },
  row0: { addr: '0x8009a0d3', type: 'u8', description: 'menuCursor (confirmed #78): the main-menu cursor, row 0 = Item; the row of g_PartyMenuTables[0].' },
  pick: {
    addr: hex(PICK_CANDIDATE),
    type: 'u8',
    description: `Candidate party-pick cursor (#215, hypothesis): the row (+0x0B) of g_PartyMenuTables[1] (0x8009A0C8 + 0x12). ${DECOMP} config/symbols.main.us.txt, include/game.h (MenuTable, 0x12 bytes).`,
  },
  t2row: {
    addr: hex(TABLE2_ROW),
    type: 'u8',
    description: `The row (+0x0B) of g_PartyMenuTables[2] (0x8009A0C8 + 0x24), read alongside the candidate. ${DECOMP}.`,
  },
  menu_ovl: { addr: hex(entry('menuOverlay').address), type: 'u32', description: 'menuOverlay (confirmed #135, #121): 4 = the Equip screen.' },
  ...Object.fromEntries(PARTY.map((r) => [`weapon${r}`, { addr: recAddr('characterWeapon', r), type: 'u8', description: `characterWeapon[record ${r}] (confirmed #117): the equipped weapon of party slot ${r}'s member, 0-127.` }])),
};

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

/** Load, open the menu, plan to Equip, Circle once (the party pick opens), then Down k times. */
function toPick(k) {
  const toEquip = menuPanelPlan(0, EQUIP_ROW);
  const downs = [];
  for (let i = 0; i < k; i++) downs.push(PRESS('down'), { wait: { frames: PICK_GAP } });
  return [
    ...OPEN_MENU,
    ...scriptFromPlan(toEquip, 'row0', 'row_wait'),
    { wait: { frames: 60 } },
    PRESS('circle'),
    { wait: { frames: 60 } },
    ...downs,
  ];
}

export function partyPickScenarios() {
  const base = { $schema: '../schema/scenario.schema.json', format: 2, tier: 2, boot: { disc: 1, save: SAVE, slot: 1 }, memory: MEMORY };

  // Diagnostic: stop in the party pick after one Down, with no checks that
  // could end the script early, and report the raw candidates.
  const diag = {
    ...base,
    name: 'save-boot-16a-party-pick-down',
    description: `#215 (diagnostic): load harness/saves/${SAVE}.json (party Cloud, Barret, Tifa), open the field menu (as save-boot-15a), plan the main-menu cursor 0 to ${EQUIP_ROW} (Equip; semantic/menu-panel.js; row_wait), wait 60 frames, Circle once (15a: the overlay is not asked for, so a party pick opens), wait 60, Down once, wait ${PICK_GAP}. No check stops the script. Reports the raw pick (the candidate, g_PartyMenuTables[1]'s row; 1 if the hypothesis holds), t2row (table 2's row), row0 (stays ${EQUIP_ROW} if the main cursor is untouched), menu_ovl (0: no overlay yet) and game_state. Check: the field ID is unchanged.`,
    input: [...toPick(1), { wait: { frames: 30 } }],
    assert: [{ expect: { mem: 'map_cur', equals: 116 } }],
    metrics: ['load_done', 'row_wait', 'pick', 't2row', 'row0', 'menu_ovl', 'game_state', 'frames'],
  };

  // Acceptance, one per party slot k: the candidate reads k, then Circle
  // opens Equip for that member, and Circle, Circle changes that member's
  // weapon and no one else's.
  const accept = PARTY.map((k) => {
    const others = PARTY.filter((r) => r !== k);
    return {
      ...base,
      name: `save-boot-16${'bcd'[k]}-party-pick-slot${k}`,
      description: `#215 (acceptance, party slot ${k}): as 16a, but Down ${k} time(s) (${PICK_GAP} frames each) in the party pick, then wait until pick reads ${k} (pick_wait; timeout 30, so the script stops here if the candidate is wrong). Then Circle every 60 frames until menu_ovl reads ${OVERLAY_EQUIP} (ovl_wait; timeout 600), 120 frames, mark, Circle (the Weapon slot), 60 frames, Circle (the first list entry), 60 frames. Checks: pick reads ${k} (pick_wait); still the Equip overlay in the menu; weapon${k} (record ${k}, party slot ${k}'s member) changed since the mark (w_chg); weapon${others[0]} and weapon${others[1]} unchanged; a rerun matches (match). Reports the raw weapon${k}, to see which spare weapon (1, 17 or 33, author-chosen) the member took. Only frame counts, 1/0 and these values leave.`,
      input: [
        ...toPick(k),
        { wait: { until: { mem: 'pick', equals: k }, timeout: 30 }, metric: 'pick_wait' },
        { wait: { until: { mem: 'menu_ovl', equals: OVERLAY_EQUIP }, timeout: 600, press: { buttons: ['circle'], every: 60, hold: 4 } }, metric: 'ovl_wait' },
        { wait: { frames: 120 } },
        { mark: 'before-equip' },
        PRESS('circle'),
        { wait: { frames: 60 } },
        PRESS('circle'),
        { wait: { frames: 60 } },
      ],
      assert: [
        { expect: { mem: 'menu_ovl', equals: OVERLAY_EQUIP } },
        { expect: { mem: 'game_state', equals: 5 } },
        { change: { mem: `weapon${k}`, is: 'changed', since: 'before-equip' }, metric: 'w_chg' },
        ...others.map((r) => ({ change: { mem: `weapon${r}`, is: 'unchanged', since: 'before-equip' } })),
        { sameState: 'rerun', metric: 'match' },
      ],
      metrics: ['load_done', 'row_wait', 'pick_wait', 'ovl_wait', 'w_chg', `weapon${k}`, 'pick', 'match'],
    };
  });
  return [diag, ...accept];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const s of partyPickScenarios()) writeFileSync(path.join(SCENARIO_DIR, `${s.name}.json`), serialise(s));
}
