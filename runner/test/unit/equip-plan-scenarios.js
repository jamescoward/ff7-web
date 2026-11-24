// The Tier 2 scenarios of #254 (native Equip v2), generated so every cursor
// move is the semantic layer's own plan: the main-menu move to Equip
// (menuPanelPlan), the party pick (planCursorMove over the confirmed
// partyPick, #215), the Equip slot cursor (equipSlotPlan) and the list index
// (equipListPlan). equip-plan.test.js checks the committed files equal this.
//
//   node runner/test/unit/equip-plan-scenarios.js    rewrite the files
//
// #216 confirmed the slot cursor (0-2) and, in the Weapon list, the list row
// and offset. New here (hypotheses):
// - H1: slot cursor 1 is Armor and 2 is Accessory: Circle there opens a list
//   whose entry Circle equips into that slot.
// - H2: those lists open on row 0, offset 0 and follow equipListStep, for a
//   member other than Cloud (party slots 1 and 2).
// - H3 (list contents, reported): the Armor and Accessory lists hold every
//   spare of that kind in inventory order, whoever the member is. The native
//   panel does not rely on H3; it reads the savemap after the press.
// The EQIPMENU overlay is not decompiled in Xeeynamo/ff7-decomp@33ce78c
// (reference only, no code copied).
// Original project code, GPL-2.0-or-later.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADDRESS_TABLE, CHARACTER_RECORD_SIZE, MENU_OVERLAY_EQUIP } from '../../../semantic/addresses.js';
import { equipListPlan, equipSlotPlan } from '../../../semantic/equip-screen.js';
import { menuPanelPlan } from '../../../semantic/menu-panel.js';
import { MENUS } from '../../../semantic/menus.js';
import { planCursorMove } from '../../../semantic/planner.js';
import { SCENARIO_DIR, scriptFromPlan, serialise } from './planner-scenarios.js';

const hex = (n) => `0x${n.toString(16)}`;
const entry = (name) => {
  const e = ADDRESS_TABLE.entries.find((x) => x.name === name);
  if (!e) throw new Error(`no address entry ${name}`);
  return e;
};
const recAddr = (name, r) => hex(entry(name).address + CHARACTER_RECORD_SIZE * r);

/** The save the scenarios load: harness/saves/disc1-md1stin-party3-gear.json. */
export const SAVE = 'disc1-md1stin-party3-gear';
/** Party: Cloud, Barret, Tifa, so party slot k holds character record k (as #215). */
export const PARTY = Object.freeze([0, 1, 2]);
export const EQUIP_ROW = MENUS.main.labels.indexOf('Equip');
/**
 * Author-chosen inventory: #215's spare weapons 1, 17, 33 in slots 0-2, then
 * armor 1, 2, 3 (item 257-259) in slots 3-5 and accessories 0, 1, 2 (item
 * 288-290) in slots 6-8, one each.
 */
export const ARMOR = Object.freeze([1, 2, 3]);
export const ACCESSORIES = Object.freeze([0, 1, 2]);
export const ITEMS = Object.freeze([
  ...[129, 145, 161].map((index, slot) => ({ slot, index, quantity: 1 })),
  ...ARMOR.map((a, i) => ({ slot: 3 + i, index: 256 + a, quantity: 1 })),
  ...ACCESSORIES.map((a, i) => ({ slot: 6 + i, index: 288 + a, quantity: 1 })),
]);
/** The list opens on row 0, offset 0 (#216 18b for the Weapon list; H2 here). */
export const LIST_START = Object.freeze({ row: 0, offset: 0 });
/** Frames after each Down in the party pick (#215). */
export const PICK_GAP = 30;

/**
 * The two cases: party slot, Equip slot row, list index, and the item number
 * H3 predicts (the index-th spare of that kind, in inventory order).
 */
export const CASES = Object.freeze([
  Object.freeze({ id: 'a', name: 'armor', member: 1, slot: 1, kind: 'armor', field: 'characterArmor', index: 2, expect: ARMOR[2] }),
  Object.freeze({ id: 'b', name: 'accessory', member: 2, slot: 2, kind: 'accessory', field: 'characterAccessory', index: 1, expect: ACCESSORIES[1] }),
]);

const SETTLE = 30;
const PRESS = (button) => ({ buttons: [button], frames: 4 });
const until = (mem, equals, metric, timeout = SETTLE) => ({ wait: { until: { mem, equals }, timeout }, ...(metric ? { metric } : {}) });

const MEMORY = {
  game_state: { addr: '0x8009c560', type: 'u16', description: 'g_GameState (s16 as u16; confirmed #76): field 1, menu 5.' },
  map_cur: { addr: '0x8009a05c', type: 'u16', description: 'g_FieldCurrentMap (s16 as u16; confirmed #77): the field ID.' },
  loading: { addr: '0x800965e8', type: 'u16', description: 'g_IsFieldLoading (s16 as u16; confirmed #77): 2 in a settled field (the field-loaded segment waits on it).' },
  row0: { addr: '0x8009a0d3', type: 'u8', description: 'menuCursor (confirmed #78): the main-menu cursor, row 0 = Item.' },
  pick: { addr: hex(entry('partyPick').address), type: 'u8', description: 'partyPick (confirmed #215): the party slot picked for Equip.' },
  menu_ovl: { addr: hex(entry('menuOverlay').address), type: 'u32', description: 'menuOverlay (confirmed; 4 = the Equip screen, #121).' },
  slot: { addr: hex(entry('equipSlotCursor').address), type: 'u8', description: 'equipSlotCursor (confirmed #216; s8 as u8): 0 Weapon, 1 and 2 the other rows.' },
  l_row: { addr: hex(entry('equipListRow').address), type: 'u8', description: 'equipListRow (confirmed #216; s8 as u8): the highlighted row on the page, 0-7.' },
  l_off: { addr: hex(entry('equipListOffset').address), type: 'u8', description: 'equipListOffset (confirmed #216; low byte of an s16): the list index on the top row.' },
  ...Object.fromEntries(PARTY.flatMap((r) => [
    [`weapon${r}`, { addr: recAddr('characterWeapon', r), type: 'u8', description: `characterWeapon[record ${r}] (confirmed #117).` }],
    [`armor${r}`, { addr: recAddr('characterArmor', r), type: 'u8', description: `characterArmor[record ${r}] (confirmed #117).` }],
    [`acc${r}`, { addr: recAddr('characterAccessory', r), type: 'u8', description: `characterAccessory[record ${r}] (confirmed #117; 0xFF none).` }],
  ])),
};

/** Load the save and open the field menu, as save-boot-16b does. */
const OPEN_MENU = [
  { wait: { until: { mem: 'game_state', equals: 1 }, timeout: 3600, press: { buttons: ['circle'], every: 30, hold: 4 } } },
  { segment: 'field-loaded' },
  { wait: { until: { mem: 'map_cur', equals: 116 }, timeout: 1 } },
  { wait: { frames: 60 } },
  { wait: { until: { mem: 'game_state', equals: 5 }, timeout: 600, press: { buttons: ['triangle'], every: 60, hold: 4 } } },
  { wait: { frames: 60 } },
  { wait: { until: { mem: 'row0', equals: 0 }, timeout: 1 } },
];

/**
 * An equipListPlan as a script, as #248's scriptFromListPlan: each press, a
 * wait of at most plan.timing.settle frames for the cursor that should move
 * (the row, or the offset on a scroll), then a one-frame check of the other.
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

/** The plans of one case. */
export function casePlans(c) {
  return {
    pick: planCursorMove({ from: 0, to: c.member, rows: PARTY.length, wraps: false, timing: { hold: 4, settle: SETTLE, gap: PICK_GAP } }),
    slot: equipSlotPlan(0, c.slot),
    list: equipListPlan(LIST_START, c.index),
  };
}

export function equipPlanScenarios() {
  const base = { $schema: '../schema/scenario.schema.json', format: 2, tier: 2, boot: { disc: 1, save: SAVE, slot: 1 }, memory: MEMORY };
  return CASES.map((c) => {
    const plans = casePlans(c);
    const others = PARTY.filter((r) => r !== c.member);
    const mem = { armor: 'armor', accessory: 'acc' }[c.kind] + c.member;
    const kindsLeft = ['weapon', 'armor', 'acc'].filter((k) => `${k}${c.member}` !== mem);
    return {
      ...base,
      name: `save-boot-28${c.id}-equip-plan-${c.name}`,
      description: `#254 (acceptance, H1 and H2; H3 reported): the Equip ${c.name} slot and list plans for party slot ${c.member}. Load harness/saves/${SAVE}.json (party Cloud, Barret, Tifa; spare weapons 1, 17, 33, armor ${ARMOR.join(', ')}, accessories ${ACCESSORIES.join(', ')}, one each, author-chosen), open the field menu, plan the main-menu cursor 0 to ${EQUIP_ROW} (semantic/menu-panel.js), 60 frames, Circle (the party pick opens), 60 frames, the party-pick plan 0 to ${c.member} (${plans.pick.steps.length} Down, wait for pick), then Circle every 60 frames until menu_ovl reads ${MENU_OVERLAY_EQUIP} (ovl_wait), 120 frames; the slot cursor reads 0. equipSlotPlan(0, ${c.slot}) from semantic/equip-screen.js: ${plans.slot.steps.length} Down, each waiting for the slot cursor (w_slot). Circle (H1: opens the ${c.name} list) and 60 frames; the list row and offset read 0 (H2). equipListPlan(${JSON.stringify(LIST_START)}, ${c.index}): ${plans.list.steps.length} Downs, each waiting for the row and checking the offset (w_list). Then mark, Circle, and 60 frames (as #215 16b; the baseline value is not known, so no wait on a value). Checks: ${mem} changed since the mark; the member's other equipment and the other members' ${c.name} unchanged; still the Equip overlay in the menu; a rerun matches. Reports e_idx: 1 if ${mem} reads ${c.expect}, the index-${c.index} ${c.name} in inventory order (H3). Only frame counts and 1/0 leave.`,
      input: [
        ...OPEN_MENU,
        ...scriptFromPlan(menuPanelPlan(0, EQUIP_ROW), 'row0', undefined),
        { wait: { frames: 60 } },
        PRESS('circle'),
        { wait: { frames: 60 } },
        ...scriptFromPlan(plans.pick, 'pick', undefined),
        { wait: { until: { mem: 'menu_ovl', equals: MENU_OVERLAY_EQUIP }, timeout: 600, press: { buttons: ['circle'], every: 60, hold: 4 } }, metric: 'ovl_wait' },
        { wait: { frames: 120 } },
        until('slot', 0, undefined, 1),
        ...scriptFromPlan(plans.slot, 'slot', 'w_slot'),
        { wait: { frames: 10 } },
        PRESS('circle'),
        { wait: { frames: 60 } },
        until('l_row', LIST_START.row, undefined, 1),
        until('l_off', LIST_START.offset, undefined, 1),
        ...scriptFromListPlan(plans.list, LIST_START, 'w_list'),
        { wait: { frames: 10 } },
        { mark: 'before-equip' },
        PRESS('circle'),
        { wait: { frames: 60 } },
      ],
      assert: [
        { change: { mem, is: 'changed', since: 'before-equip' }, metric: 'e_chg' },
        ...kindsLeft.map((k) => ({ change: { mem: `${k}${c.member}`, is: 'unchanged', since: 'before-equip' } })),
        ...others.map((r) => ({ change: { mem: `${{ armor: 'armor', accessory: 'acc' }[c.kind]}${r}`, is: 'unchanged', since: 'before-equip' } })),
        { expect: { mem: 'menu_ovl', equals: MENU_OVERLAY_EQUIP } },
        { expect: { mem: 'game_state', equals: 5 } },
        { expect: { mem, equals: c.expect }, metric: 'e_idx' },
        { sameState: 'rerun', metric: 'match' },
      ],
      metrics: ['load_done', 'ovl_wait', 'w_slot', 'w_list', 'e_chg', 'e_idx', 'match'],
    };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const s of equipPlanScenarios()) writeFileSync(path.join(SCENARIO_DIR, `${s.name}.json`), serialise(s));
}
