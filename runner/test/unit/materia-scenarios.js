// The Tier 2 scenarios of #241 (native Materia screen, game-state half),
// generated so the main-menu move to Materia is the menu planner's output
// (semantic/menu-panel.js menuPanelPlan), not hand-written. materia.test.js
// checks the committed files equal this.
//
//   node runner/test/unit/materia-scenarios.js    rewrite the files
//
// The Materia screen is in the same EQIPMENU overlay file as Equip.
// Xeeynamo/ff7-decomp@33ce78c (reference only, no code copied) names its
// overlay ids (src/main/1F6B4.c, enum YamadaOvl: 3 YAMA_EQIPMENU_MATERIA,
// 4 YAMA_EQIPMENU_EQUIP); 4 was confirmed by #121 (save-boot-15b). The overlay
// is not decompiled, so the Materia screen's cursors have no source. This run
// confirms only the overlay id and that a pad sequence puts a materia into a
// weapon slot, read from the savemap (confirmed #117). It follows
// equip-scenarios.js (#121 part 1).
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

/** The save the scenarios load: harness/saves/disc1-md1stin-materia.json. */
export const SAVE = 'disc1-md1stin-materia';
/** Main-menu row of Materia (MENUS.main.labels; #121 checked the order up to Equip through the overlay id). */
export const MATERIA_ROW = MENUS.main.labels.indexOf('Materia');
/** menuOverlay value expected for the Materia screen (enum YamadaOvl, YAMA_EQIPMENU_MATERIA): a hypothesis until Tier 2 reads it. */
export const OVERLAY_MATERIA = 3;
/** An empty materia word (ID 0xFF; #117, #130). The save empties every materia slot of record 0. */
export const MATERIA_EMPTY = 0xffffffff;
/**
 * Author-chosen materia in inventory slot 0 (ID and AP; no name is known or
 * needed). That the Materia screen opens on weapon slot 0, and that its list
 * shows inventory slot 0 first, are HYPOTHESES the acceptance checks.
 */
export const MATERIA = Object.freeze({ slot: 0, id: 49, ap: 0 });
/** The packed word (AP << 8 | ID) weapon materia slot 0 should read after the equip. */
export const MATERIA_WORD = ((MATERIA.ap << 8) | MATERIA.id) >>> 0;

const MEMORY = {
  game_state: { addr: '0x8009c560', type: 'u16', description: 'g_GameState (s16 as u16; confirmed #76): field 1, menu 5.' },
  map_cur: { addr: '0x8009a05c', type: 'u16', description: 'g_FieldCurrentMap (s16 as u16; confirmed #77): the field ID.' },
  loading: { addr: '0x800965e8', type: 'u16', description: 'g_IsFieldLoading (s16 as u16; confirmed #77): 2 in a settled field (the field-loaded segment waits on it).' },
  row0: { addr: '0x8009a0d3', type: 'u8', description: 'menuCursor (confirmed #78): the main-menu cursor, row 0 = Item.' },
  menu_ovl: {
    addr: hex(entry('menuOverlay').address),
    type: 'u32',
    description: `menuOverlay (confirmed for 0, 1 and 4; #135, #121): D_80062DD4, the menu overlay id SysMenuLoadMenuFileById last asked for. ${OVERLAY_MATERIA} = YAMA_EQIPMENU_MATERIA is a hypothesis this run checks. ${DECOMP} src/main/1F6B4.c`,
  },
  menu_prev: {
    addr: '0x80062dd0',
    type: 'u32',
    description: `D_80062DD0 (hypothesis): the overlay id before it. ${DECOMP} src/main/1F6B4.c`,
  },
  wm0: {
    addr: hex(entry('characterWeaponMateria').address + CHARACTER_RECORD_SIZE * 0),
    type: 'u32',
    description: "characterWeaponMateria[record 0], slot 0 (confirmed #117): Cloud's first weapon materia slot, AP << 8 | ID; 0xFFFFFFFF empty in the save.",
  },
  mat0: {
    addr: hex(entry('materiaSlot').address),
    type: 'u32',
    description: `materiaSlot[0] (confirmed #117): the materia inventory's slot 0; the author-chosen word ${hex(MATERIA_WORD)} in the save.`,
  },
};

/** Load the save and open the field menu, as save-boot-15a does; the main-menu cursor is then on row 0 (Item). */
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

export function materiaScenarios() {
  const toMateria = menuPanelPlan(0, MATERIA_ROW);
  const base = { $schema: '../schema/scenario.schema.json', format: 2, tier: 2, boot: { disc: 1, save: SAVE, slot: 1 }, memory: MEMORY };

  // As #121's 15b: the planned move, then Circle every 60 frames (a party
  // pick comes first, #135 14f) until the overlay id is asked for, then let
  // the read finish.
  const openMateria = (rowMetric) => [
    ...OPEN_MENU,
    ...scriptFromPlan(toMateria, 'row0', rowMetric),
    { wait: { frames: 60 } },
    { wait: { until: { mem: 'menu_ovl', equals: OVERLAY_MATERIA }, timeout: 600, press: { buttons: ['circle'], every: 60, hold: 4 } }, metric: 'ovl_wait' },
    { wait: { frames: 120 } },
  ];

  const open = {
    ...base,
    name: 'save-boot-22a-materia-screen-open',
    description: `#241 (acceptance 1): the Materia screen asks for overlay ${OVERLAY_MATERIA}. Load harness/saves/${SAVE}.json (Cloud alone, every materia slot empty, materia ${MATERIA.id} in inventory slot 0), open the field menu (as save-boot-15a), plan the main-menu cursor 0 to ${MATERIA_ROW} (semantic/menu-panel.js; row_wait), wait 60 frames, then press Circle every 60 frames until menu_ovl reads ${OVERLAY_MATERIA} (ovl_wait; 0 = it never did within 600 frames, and the script stops there), then 120 frames with no input. Reports the raw menu_ovl (to refute the source claim if it is another id), menu_prev, wm0 and game_state. Checks: menu_ovl ${OVERLAY_MATERIA}, Cloud's weapon materia slot 0 still empty, still in the menu, field unchanged.`,
    input: openMateria('row_wait'),
    assert: [
      { expect: { mem: 'menu_ovl', equals: OVERLAY_MATERIA } },
      { expect: { mem: 'wm0', equals: MATERIA_EMPTY } },
      { expect: { mem: 'game_state', equals: 5 } },
      { expect: { mem: 'map_cur', equals: 116 } },
    ],
    metrics: ['load_done', 'row_wait', 'ovl_wait', 'menu_ovl', 'menu_prev', 'wm0', 'game_state', 'frames'],
  };

  // Acceptance 2: Circle on the slot the cursor is assumed to start on
  // (weapon slot 0), then Circle on the first entry of the materia list.
  // Both positions are hypotheses: no cursor is read, only the savemap.
  const accept = {
    ...base,
    name: 'save-boot-22b-materia-equip-plan',
    description: `#241 (acceptance 2): a pad sequence puts a materia into Cloud's weapon slot 0, by pad input only, confirmed by reading the savemap. As 22a (planned move to Materia, Circle until menu_ovl reads ${OVERLAY_MATERIA}, 120 frames), mark, Circle (weapon materia slot 0, where the cursor is assumed to start), 60 frames, Circle (the first entry of the materia list, assumed to be inventory slot 0), then wait until wm0 reads ${hex(MATERIA_WORD)} (eq_wait; timeout 120), then 30 frames. Checks: wm0 ${hex(MATERIA_WORD)} (mat_ok) and changed since the mark; still on overlay ${OVERLAY_MATERIA} in the menu; field unchanged; a rerun matches (match). Reports the raw wm0 and mat0 (author-chosen words, or 0xFFFFFFFF empty: where the materia went) and menu_ovl. Only frame counts, 1/0 and these values leave.`,
    input: [
      ...openMateria(undefined),
      { mark: 'before-equip' },
      PRESS('circle'),
      { wait: { frames: 60 } },
      PRESS('circle'),
      { wait: { until: { mem: 'wm0', equals: MATERIA_WORD }, timeout: 120 }, metric: 'eq_wait' },
      { wait: { frames: 30 } },
    ],
    assert: [
      { expect: { mem: 'wm0', equals: MATERIA_WORD }, metric: 'mat_ok' },
      { change: { mem: 'wm0', is: 'changed', since: 'before-equip' } },
      { expect: { mem: 'menu_ovl', equals: OVERLAY_MATERIA } },
      { expect: { mem: 'game_state', equals: 5 } },
      { expect: { mem: 'map_cur', equals: 116 } },
      { sameState: 'rerun', metric: 'match' },
    ],
    metrics: ['load_done', 'ovl_wait', 'eq_wait', 'mat_ok', 'wm0', 'mat0', 'menu_ovl', 'match'],
  };
  return [open, accept];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const s of materiaScenarios()) writeFileSync(path.join(SCENARIO_DIR, `${s.name}.json`), serialise(s));
}
