// The address table: where the game keeps the state the semantic layer
// reads, with provenance. Original project code, GPL-2.0-or-later; the
// entries are facts (addresses, layouts) cited from public references, with
// no code copied from them.
//
// Every entry says:
//   name     what the readers call it
//   address  PS1 main-RAM address (KSEG0, 0x80000000..0x801FFFFF), or null
//            when no candidate is known yet. Nothing here is invented: a
//            null entry makes its reader answer "no address".
//   type     u8 | s8 | u16 | s16 | u32 | s32 (little endian)
//   meaning  one line on what the value is
//   source   where the claim comes from (repo note or issue, plus the
//            reference it cites)
//   status   "hypothesis", or "confirmed" together with `scenario`, the Tier 2
//            scenario file that confirmed it (harness/scenarios/...)
//   exe      SHA-1 of the boot executable the address applies to
//   stride, count  optional, together: the entry is an array of `count`
//            elements, element i at address + i * stride (address is element
//            0). Readers that index one say which index they read; status
//            applies to the layout, and a reader's confirmation also depends
//            on how it chose the index (#99)
//   values   optional: raw value -> label, for enumerations
//   confirmedValues  optional, on a confirmed enumeration: raw value -> the
//            Tier 2 scenario that observed it. Labels not listed here are
//            still hypotheses, even though the address is confirmed
//
// Reference for the hypotheses: Xeeynamo/ff7-decomp (AGPL; reference only,
// cited by commit, no code copied) and the ff7-mods flat wiki, as already
// recorded in notes/36-disc-boot.md and notes/32-save-format.md.
//
// Changing an entry to "confirmed" needs a Tier 2 scenario that checks it
// (issues #76 to #78). #76 confirmed gameState (field, battle, menu),
// prevGameState and movieFrame (notes/76-confirm-mode.md). #77 confirmed
// fieldId, fieldX, fieldY and fieldLoading (notes/77-field-position.md). #99
// added playerModel and made fieldX/fieldY arrays over the field models
// (notes/99-player-model.md). #78
// confirmed menuCursor, partySlot0..2 and partyHp0 (notes/78-menu-party.md);
// #101 confirmed partyHp1 and partyHp2 and saw slots 1 and 2 hold Barret and
// Tifa (notes/101-barret-party.md). #237 confirmed fieldZ, fieldTalkOff and
// fieldTalkRange at the mds7st1 talk (notes/237-talk-rule.md).
//
// Caveat for every confirmed entry (#88): the scenarios run as a chain of
// snapshots kept in memory. On the disc a state restored from a kept snapshot
// is not byte-identical to running on, but reruns from the same snapshot are,
// so the determinism checks compare reruns from the same snapshot.

/** USA SCUS_941.63, the boot executable of FF7 (USA) disc 1: published SHA-1. */
export const EXE_USA_SHA1 = 'a95e8b16b97071203b953bb81a33980509262f30';

const DECOMP = 'Xeeynamo/ff7-decomp@9411173034bde2ae4c9b0312167e79c3645ca1be';
/** The decomp commit #130 read (include/game.h ActiveCharacterData, SavePartyMember; src/battle/battle.h BattleWork). */
const DECOMP_130 = 'Xeeynamo/ff7-decomp@d4db3de3c3aaf61269e048cf3f6a458996290de0';

/** g_ActiveCharacters: one ActiveCharacterData (0x440 bytes) per party slot (#78, #101). */
const ACTIVE_CHARACTERS = 0x8009d84c;
const ACTIVE_CHARACTER_SIZE = 0x440;

/**
 * g_BattleWork, the battle module's work area (only meaningful in battle):
 * 0x800F5BB8 as the decomp's config/symbols.battle.txt says. #130's attempt 1
 * ruled out 0x800f5bbc (config/sym_export_battle.us.txt): its limitBar never
 * read the described values and its gauges never moved.
 */
export const BATTLE_WORK = 0x800f5bb8;
const BATTLE_TURN_SIZE = 0x44; // BattleTurnWork; turn[i] for party slot i
const BATTLE_PARTY = 0x2a8; // BattleWork.party[3] (BattlePartyWork, 0x34 bytes)
const BATTLE_PARTY_SIZE = 0x34;

/** Savemap character records: nine of 0x84 bytes from savemap + 0x0054 (#130). */
export const SAVEMAP = 0x8009c6e4;
export const CHARACTER_RECORDS = SAVEMAP + 0x54;
export const CHARACTER_RECORD_SIZE = 0x84;
export const CHARACTER_RECORD_COUNT = 9;
const SAVEMAP_NOTE = 'notes/32-save-format.md savemap layout (ff7-mods flat wiki)';

export const TYPES = Object.freeze({ u8: 1, s8: 1, u16: 2, s16: 2, u32: 4, s32: 4 });

/**
 * Raw `g_GameState` values (notes/36-disc-boot.md). Field, battle and menu are
 * confirmed (#76), world 3 and the motorcycle minigame 6 (#80), see
 * GAME_STATES_CONFIRMED. The other minigames (7-11, 14 in the decomp's
 * include/game.h) are not labelled yet, so they read 'unknown'. There is no
 * movie value: the field module plays movies, so g_GameState reads field
 * during one; movieFrame below tells a movie apart.
 */
const GAME_STATES = Object.freeze({ 1: 'field', 2: 'battle', 3: 'world', 5: 'menu', 6: 'minigame' });

/**
 * g_PrevGameState's labels: g_GameState's, plus 0 = none, which it holds from
 * a new game's start until the first mode change (#76, confirmed by #107).
 * g_GameState's own 0 (the title) stays unlabelled.
 */
const PREV_GAME_STATES = Object.freeze({ 0: 'none', ...GAME_STATES });

const SC = (name) => `harness/scenarios/${name}.json`;
const CAVEAT = 'chain of in-memory snapshots from reactor-entrance (#74); determinism = reruns from the same snapshot, not chain vs scratch (#88)';

/** Which Tier 2 scenario observed each confirmed g_GameState value (#76, #80). */
const GAME_STATES_CONFIRMED = Object.freeze({
  1: SC('reactor-mode-1-field'),
  2: SC('reactor-mode-4-battle'),
  3: SC('save-boot-7-world-kalm'),
  5: SC('reactor-mode-2-menu-open'),
  6: SC('save-boot-9-highway'),
});

/** Build a frozen table whose entries all apply to boot executable `exe`. */
export function makeTable(exe, entries) {
  const stamped = entries.map((e) => Object.freeze({ ...e, exe }));
  const names = new Set();
  for (const e of stamped) {
    if (names.has(e.name)) throw new Error(`duplicate address entry: ${e.name}`);
    names.add(e.name);
  }
  return Object.freeze({ exe, entries: Object.freeze(stamped) });
}

/**
 * Throw if a table breaks the rules above: a known type, an address in
 * KSEG0 RAM that fits its type (or null), a source, and confirmed entries
 * naming their scenario.
 */
export function validateTable(table) {
  if (!/^[0-9a-f]{40}$/.test(table.exe)) throw new Error('table exe must be a lower-case SHA-1');
  for (const e of table.entries) {
    const where = `entry ${e.name}`;
    if (e.exe !== table.exe) throw new Error(`${where}: exe differs from the table's`);
    if (!(e.type in TYPES)) throw new Error(`${where}: unknown type ${e.type}`);
    if ((e.stride === undefined) !== (e.count === undefined)) throw new Error(`${where}: stride and count go together`);
    if (e.stride !== undefined) {
      if (!Number.isInteger(e.stride) || e.stride < TYPES[e.type]) throw new Error(`${where}: stride must be an integer no smaller than the type`);
      if (!Number.isInteger(e.count) || e.count < 1) throw new Error(`${where}: count must be a positive integer`);
    }
    if (e.address !== null) {
      const last = e.address + ((e.count ?? 1) - 1) * (e.stride ?? 0);
      if (!Number.isInteger(e.address) || e.address < 0x80000000 || last + TYPES[e.type] > 0x80200000) {
        throw new Error(`${where}: address outside KSEG0 main RAM`);
      }
    }
    if (!e.meaning || !e.source) throw new Error(`${where}: meaning and source are required`);
    if (e.status === 'confirmed') {
      if (e.address === null) throw new Error(`${where}: confirmed without an address`);
      if (!e.scenario) throw new Error(`${where}: confirmed without the Tier 2 scenario that confirmed it`);
    } else if (e.status !== 'hypothesis') {
      throw new Error(`${where}: status must be hypothesis or confirmed`);
    }
  }
}

const ACTIVE_SOURCE = `${DECOMP_130} include/game.h (ActiveCharacterData, size 0x440) and src/main/1F6B4.c, src/main/17238.c (the load sets hp/mp from the record's current values and the maximums from its base values plus materia, at least 10, and writes them back to the record's hp_max/mp_max); ff7-flat-wiki Battle_Mechanics "Active Character Data" (+0x12 Max HP, +0x14 Current MP, +0x16 Max MP)`;
const BATTLE_SOURCE = `${DECOMP_130} src/battle/battle.h (BattleWork: turn[10] of BattleTurnWork, 0x44 bytes, then party[3] of BattlePartyWork, 0x34 bytes, at +0x2A8), src/battle/batini.c (battle start: atbGauge 0, limitBar = the record's limit bar), src/battle/battle.c (damage raises limitBar, at most 255), src/battle/batres.c (written back to the record when the battle ends); g_BattleWork in config/symbols.battle.txt (0x800F5BB8; config/sym_export_battle.us.txt says 0x800f5bbc)`;

/**
 * #130: MP, maximums, limit and ATB per party slot (notes/130-party-status.md).
 * The maximums, MP and record limits equal the values of a generated save with
 * author-chosen stats (save-boot-10a/b/c); the battle limitBar holds them at
 * battle start (save-boot-11a) and rises with damage (reactor-mode-4e); the
 * ATB gauges rise from battle init (save-boot-11b), and slot 0's empties when
 * a command is taken and fills again (reactor-mode-4d).
 */
const STATS_10 = ['save-boot-10a-party-stats-menu-slot0', 'save-boot-10b-party-stats-menu-slot1', 'save-boot-10c-party-stats-menu-slot2'];
const STAT_ENTRIES = [
  ...[0, 1, 2].flatMap((i) => [
    ['partyMaxHp', 0x12, 'max HP (baseHp: base HP plus materia; what the menu shows as the maximum)'],
    ['partyMp', 0x14, 'current MP'],
    ['partyMaxMp', 0x16, 'max MP (baseMp: base MP plus materia)'],
  ].map(([name, off, what]) => ({
    name: `${name}${i}`,
    address: ACTIVE_CHARACTERS + i * ACTIVE_CHARACTER_SIZE + off,
    type: 's16',
    meaning: `${what} of the character in party slot ${i} (g_ActiveCharacters[${i}] + 0x${off.toString(16).toUpperCase().padStart(3, '0')}). Meaningless for an empty slot: check partySlot${i}`,
    source: `${ACTIVE_SOURCE}. Tier 2 (#130): equals the author-chosen value in the field menu after loading harness/saves/disc1-md1stin-stats.json (party Cloud, Barret, Tifa, materia slots empty); a rerun matches${name === 'partyMp' ? '. MP also holds in a random battle (save-boot-11a)' : ''}`,
    status: 'confirmed',
    scenario: SC(STATS_10[i]),
  }))),
  ...[0, 1, 2].map((i) => ({
    name: `partyLimit${i}`,
    address: BATTLE_WORK + BATTLE_PARTY + i * BATTLE_PARTY_SIZE + 0x08,
    type: 'u16',
    meaning: `limit gauge of party slot ${i} in battle (g_BattleWork.party[${i}].limitBar, 0-255; 255 = limit break ready). Only meaningful in battle; outside it read characterLimit`,
    source: `${BATTLE_SOURCE}. Tier 2 (#130): 91 frames into a random battle it holds each slot's author-chosen limit bar (Cloud 100, Barret 50, Tifa 200; save-boot-11a); slot 0 rises over 1800 frames of the first guard battle while Cloud takes damage (reactor-mode-4e); a rerun matches`,
    status: 'confirmed',
    scenario: SC(i === 0 ? 'reactor-mode-4e-limit-damage' : 'save-boot-11a-stats-battle-limit'),
  })),
  ...[0, 1, 2].map((i) => ({
    name: `partyAtb${i}`,
    address: BATTLE_WORK + i * BATTLE_TURN_SIZE + 0x04,
    type: 'u16',
    meaning: `ATB gauge of party slot ${i} in battle (g_BattleWork.turn[${i}].atbGauge: 0 empty, 0xFFFF full; it fills over time and empties when a command is taken). Only meaningful in battle`,
    source: `${BATTLE_SOURCE}. Tier 2 (#130): ${i === 0 ? 'in the first guard battle it reads lower after Cloud takes Attack than before, and higher 90 frames later (reactor-mode-4d); g_ActiveCharacters[0].atbTimer (+0x18) moves the same way' : `in a random battle with party Cloud, Barret, Tifa it rises over the 240 frames after battle init (save-boot-11b), as g_ActiveCharacters[${i}].atbTimer (+0x18) does`}; a rerun matches`,
    status: 'confirmed',
    scenario: SC(i === 0 ? 'reactor-mode-4d-atb-command' : 'save-boot-11b-stats-battle-atb-slots'),
  })),
  {
    name: 'characterLimit',
    address: CHARACTER_RECORDS + 0x0f,
    type: 'u8',
    stride: CHARACTER_RECORD_SIZE,
    count: CHARACTER_RECORD_COUNT,
    meaning: 'limit bar kept in each character record (0-255; 255 = limit break ready), indexed by record (0 Cloud, 1 Barret, 2 Tifa, 3 Aeris, 4 Red XIII, 5 Yuffie, 6 Cait Sith, 7 Vincent, 8 Cid). The battle works on its own copy (partyLimit) and writes it back here when it ends',
    source: `${DECOMP_130} include/game.h (SavePartyMember.limit_charge at +0x0F; Savemap.party at +0x54); ${SAVEMAP_NOTE}: "Character Record" +0x0F current limit bar. Tier 2 (#130): records 0, 1 and 2 hold the author-chosen limit bars after loading harness/saves/disc1-md1stin-stats.json (save-boot-10a/b/c); record 0 is unchanged during the first guard battle while the battle's copy rises (reactor-mode-4e)`,
    status: 'confirmed',
    scenario: SC(STATS_10[0]),
  },
];

/**
 * #108: message windows. g_WindowData is four WindowData records of 0x30
 * bytes from 0x80083274; window 0 is the one field and world scripts open
 * first (notes/108-dialogue-state.md). The field and world modules share it.
 */
const WINDOW_DATA = 0x80083274;
const WINDOW_SIZE = 0x30;
const WINDOW_SOURCE = `${DECOMP_130} config/symbols.main.us.txt (g_WindowData, size 0xC0), include/game.h (WindowData: pointerEnabled +0x1A, pointerY +0x26, state +0x2C; enum WindowState) and src/field/field_dialog.c (FieldDialogMessageUpdateStates, FieldDialogAskUpdateStates)`;

/** g_WindowData[i].state labels (include/game.h WindowState). */
const WINDOW_STATES = Object.freeze({
  0: 'closed', 1: 'show', 2: 'typing', 3: 'pause', 4: 'wait row', 5: 'unk5', 6: 'done', 7: 'closing',
  8: 'scroll row', 9: 'init next', 10: 'unkA', 11: 'pause scroll until ok', 12: 'scroll while ok',
  13: 'pause until ok', 14: 'wait next window',
});

/**
 * The states in which a window waits for Circle and nothing else moves it on
 * (field_dialog.c: each of these advances only on a Circle press).
 */
export const WINDOW_WAITING_STATES = Object.freeze([4, 6, 11, 13, 14]);
/** WSTATE_TXT_DONE: the text is shown; a choice window shows its pointer here. */
export const WINDOW_TXT_DONE = 6;
/** pointerY = line * 16 + 6 while a choice waits (FieldDialogAskUpdateStates). */
export const WINDOW_POINTER_Y0 = 6;
export const WINDOW_LINE_HEIGHT = 16;

const WINDOW_ENTRIES = [
  {
    name: 'dialogState',
    address: WINDOW_DATA + 0x2c,
    type: 's16',
    meaning: 'state of message window 0 (g_WindowData[0].state): 0 = closed; 1-14 open (2 typing, 6 text done and waiting for Circle, 7 closing; see WINDOW_STATES). dialogOpen = not 0; dialogWaiting = one of WINDOW_WAITING_STATES',
    source: `${WINDOW_SOURCE}. Tier 2 (#108, notes/108-dialogue-state.md): after a generated save loads into the world map outside Kalm (disc1-wm1-kalm), window 0 reads 0 on entry, opens 475 frames later, reads open but not 6 for 110 frames while its text types, then 6 (save-boot-12b); after one Circle press (held 4 frames) it leaves 6 and, with no further input, reads 0 (save-boot-12c); reruns match. #140 saw 6 there after 600 frames (save-boot-7h-world-kalm-window). Only 0 and 6 are confirmed values; the typing and closing values were not read individually`,
    status: 'confirmed',
    scenario: SC('save-boot-12b-dialog-world-open'),
    values: WINDOW_STATES,
    confirmedValues: Object.freeze({ 0: SC('save-boot-12c-dialog-world-circle'), 6: SC('save-boot-12b-dialog-world-open') }),
  },
  {
    name: 'dialogPointer',
    address: WINDOW_DATA + 0x1a,
    type: 'u8',
    meaning: 'pointerEnabled of message window 0: 1 while a choice window (the field script opcode ask) waits in state 6 for a pick; 0 for a plain message. It blinks while a window closes, so read it only in state 6',
    source: `${WINDOW_SOURCE}. Tier 2 (#108): 0 in the plain message window of save-boot-12b (state 6). No choice window has been reached yet (#168)`,
    status: 'hypothesis',
  },
  {
    name: 'dialogPointerY',
    address: WINDOW_DATA + 0x26,
    type: 's16',
    meaning: 'pointerY of message window 0: the chosen line * 16 + 6 while a choice waits (the line counts from the window\'s first line, so the first option is often line 1 under a question)',
    source: `${WINDOW_SOURCE}. Not seen in Tier 2 yet: no choice window has been reached (#168)`,
    status: 'hypothesis',
  },
  // #224: windows 1-3 (notes/224-window1-state.md). A field script names the
  // window it opens; #168 saw a message in window 1 with window 0 closed.
  ...[1, 2, 3].map((i) => ({
    name: `dialogState${i}`,
    address: WINDOW_DATA + i * WINDOW_SIZE + 0x2c,
    type: 's16',
    meaning: `state of message window ${i} (g_WindowData[${i}].state), with the same values as dialogState (window 0)`,
    values: WINDOW_STATES,
    ...(i === 1
      ? {
        source: `${WINDOW_SOURCE}. Tier 2 (#224, notes/224-window1-state.md): in mds7st1 (disc1-mds7st1), after Down 300 frames and one Circle press, it reads 6 28 frames later with window 0 at 0 and pointerEnabled 0, a plain message (save-boot-19a); one more Circle takes it out of 6 and it reads 0 three frames after (save-boot-19b); reruns match. With the walk alone and no Circle it stays 0, so the Circle talk opens it. Only 0 and 6 are confirmed values`,
        status: 'confirmed',
        scenario: SC('save-boot-19a-window1-open'),
        confirmedValues: Object.freeze({ 0: SC('save-boot-19b-window1-circle'), 6: SC('save-boot-19a-window1-open') }),
      }
      : {
        source: `${WINDOW_SOURCE}. Not seen open in Tier 2 (#168 and #224 read 0 in every diagnostic)`,
        status: 'hypothesis',
      }),
  })),
];

/** Message windows dialogue() may read, in order: window 0, then 1-3 (#224). */
export const DIALOG_STATE_ENTRIES = Object.freeze(['dialogState', 'dialogState1', 'dialogState2', 'dialogState3']);

/**
 * #110: the battle menu (notes/110-battle-input.md). Candidates from
 * Xeeynamo/ff7-decomp@d4db3de (reference only, no code copied):
 * config/symbols.battle.txt and src/battle/battle3.c, battle_private.h.
 */
const BATTLE_MENU_SOURCE = `${DECOMP_130} config/symbols.battle.txt (g_BattleMenuModalWidgetId 0x800F3896, g_BattleMenuPartySlot 0x800F38A0), src/battle/battle3.c (BattleMenuInit, BattleMenuUpdate, BattleMenuWidgetCommandReset, BattleMenuFindTargetCharacterIndex), src/battle/battle_private.h (BattleMenuSlot D_800F90B4[], 0x240 bytes per party slot), include/game.h (MenuTable: row at +0x0B)`;
/** g_BattleMenuModalWidgetId: the battle menu widget taking input. */
export const BATTLE_WIDGETS = Object.freeze({ '-1': 'none', 0: 'target', 1: 'command' });
export const BATTLE_WIDGET_NONE = -1;
export const BATTLE_WIDGET_TARGET = 0;
export const BATTLE_WIDGET_COMMAND = 1;
const BATTLE_MENU_SLOTS = 0x800f90b4;
const BATTLE_MENU_SLOT_SIZE = 0x240;

const BATTLE_MENU_ENTRIES = [
  {
    name: 'battleMenuWidget',
    address: 0x800f3896,
    type: 's16',
    meaning: 'battle menu widget taking input (g_BattleMenuModalWidgetId): -1 none (no command menu open), 1 the command menu, 0 target selection; other values are sub-menus (magic, item, ...) and stay unlabelled',
    source: `${BATTLE_MENU_SOURCE}. Tier 2 (#110, notes/110-battle-input.md): in the first guard battle it reads 1 once Cloud's ATB gauge fills (60 frames after the "battle" snapshot), 0 one frame after Circle on Attack (reactor-mode-4f), and -1 one frame after a second Circle takes Attack, still -1 10 frames later (reactor-mode-4h); in a random battle with party Cloud, Barret, Tifa it reads 1, 0, -1 and 1 again for the next member (save-boot-11c); reruns match. Sub-menu values were not read`,
    status: 'confirmed',
    scenario: SC('reactor-mode-4f-battle-command-right'),
    values: BATTLE_WIDGETS,
    confirmedValues: Object.freeze({ '-1': SC('reactor-mode-4h-battle-command-taken'), 0: SC('reactor-mode-4f-battle-command-right'), 1: SC('reactor-mode-4f-battle-command-right') }),
  },
  {
    name: 'battleActor',
    address: 0x800f38a0,
    type: 'u8',
    meaning: 'party slot (0-2) whose battle command menu is shown (g_BattleMenuPartySlot). Meaningful only while battleMenuWidget is not -1',
    source: `${BATTLE_MENU_SOURCE}. Tier 2 (#110): 0 when Cloud's menu opens in the first guard battle (Cloud alone; reactor-mode-4f); with party Cloud, Barret, Tifa in a random battle, 30 frames after the first menu opens it reads more than it does 30 frames after the next menu opens (Attack taken in between), and then it reads 1 (save-boot-11c). #171 reads it directly: 2 30 frames after the first menu opens (save-boot-11d) and 1 30 frames after the next one (save-boot-11e); reruns match`,
    status: 'confirmed',
    scenario: SC('reactor-mode-4f-battle-command-right'),
  },
  ...[0, 1, 2].map((i) => ({
    name: `battleCommandRow${i}`,
    address: BATTLE_MENU_SLOTS + i * BATTLE_MENU_SLOT_SIZE + 0x0b,
    type: 'u8',
    meaning: `command menu cursor row of party slot ${i} (D_800F90B4[${i}].table00.row; 4 rows per column, 0 = the top row, Attack; a row with no command is skipped, so without materia Down goes from 0 to 3; the column is the byte before)`,
    source: i === 0
      ? `${BATTLE_MENU_SOURCE}. Tier 2 (#110): reads 0 when Cloud's menu opens in the first guard battle, 1 one frame after Down and 0 one frame after Up (reactor-mode-4f); a rerun matches`
      : `${BATTLE_MENU_SOURCE} (slot ${i} at + ${i} * 0x240). Tier 2 (#171, notes/171-battle-rows.md): with party Cloud, Barret, Tifa and no materia (stats-battle), 30 frames after slot ${i}'s command menu opens (${i === 2 ? 'the first menu' : 'the next menu, after Tifa takes Attack'}) it reads 0, one Down press makes it 3 (Attack to Item: without materia there is no Magic or Summon row, and the cursor skips them) and Up makes it 0 again, while the other slots' rows stay 0; a rerun matches`,
    status: 'confirmed',
    scenario: i === 0 ? SC('reactor-mode-4f-battle-command-right') : SC(i === 2 ? 'save-boot-11d-battle-command-rows' : 'save-boot-11e-battle-command-row-slot1'),
  })),
  {
    name: 'battleTarget',
    address: 0x800f38a9,
    type: 'u8',
    meaning: 'target cursor during target selection: the battle unit index the cursor is on (the decomp numbers the party 0-2 and the enemies from 4; which value is which unit is not checked)',
    source: `${BATTLE_MENU_SOURCE}: D_800F38A9 (the targeting draw and the Circle check use bit D_800F38A9 of the target mask). Tier 2 (#110): in target selection in the first guard battle (two guards) it reads lower after Right than before (reactor-mode-4f; D_800F38A7 moved the same way); Down changed neither byte (attempt 1 diagnostic, removed). Only the direction was read, not which unit each value is`,
    status: 'confirmed',
    scenario: SC('reactor-mode-4f-battle-command-right'),
  },
];

/**
 * #117: the item and materia inventories and each record's equipment, all
 * in the savemap (notes/117-inventory-equipment.md). A generated save with
 * author-chosen values (harness/saves/disc1-md1stin-inventory.json) loads,
 * and each value reads back in RAM in the field menu (save-boot-13a/b).
 * Encodings: semantic/inventory.js.
 */
const INVENTORY_SOURCE = `${DECOMP_130} include/game.h (SaveWork: inventory u16[320] at +0x4FC, materia s32[200] at +0x77C; SavePartyMember: weapon, armor, accessory at +0x1C-0x1E, materia_weapon[8] at +0x40, materia_armor[8] at +0x60); ${SAVEMAP_NOTE}: "Party Item stock", "Party Materia stock", "Character Record", "Save Item List", "Save Materia List"`;
const INV_13A = 'save-boot-13a-inventory-menu';
const INV_13B = 'save-boot-13b-equipment-menu';
/** Consecutive u32 materia slots per record from each of these entries. */
export const RECORD_WEAPON_MATERIA_SLOTS = 8;
export const RECORD_ARMOR_MATERIA_SLOTS = 8;

// The field menu's Item screen (#135). Its code and variables are an overlay
// the menu loads at 0x801D0000 when Item is chosen, so these addresses hold
// other data whenever the Item screen is not open: read them only in menu
// mode (gameState 5) after itemMenuScreen has been seen at a known value.
const ITEM_MENU_SOURCE = 'Xeeynamo/ff7-decomp@33ce78c (reference only, no code) config/symbols.itemmenu.us.txt and src/menu/itemmenu.c (ITEMMENU_Init, ITEMMENU_Main); include/game.h MenuTable (size 0x12, rowOffset at +0x02, row at +0x0B)';
const ITEM_MENU_ENTRIES = [
  {
    name: 'itemMenuScreen',
    address: 0x801d3e48,
    type: 's32',
    meaning: 'Item screen page (g_ItemMenuCurrentScreen): 0 the Use/Arrange/Key Items tabs, 1 the item list (where opening Item starts), 2 an item chosen and a party member being picked, 3 key items, 4 and 5 arrange. Overlay variable: meaningless unless the Item screen is open',
    source: `${ITEM_MENU_SOURCE}. Tier 2 (#135): 1 after Item is chosen from the main menu (menu overlay id D_80062DD4 reads 1, overlays are read to 0x801D0000; save-boot-14a, 14c), 2 after Circle on a usable item (save-boot-14b), 0 (the tabs) after Cross on the list (save-boot-14d). Circle pressed 30 frames after the field menu opens is ignored; 60 frames works`,
    status: 'confirmed',
    scenario: SC('save-boot-14a-item-screen-open'),
    values: Object.freeze({ 0: 'tabs', 1: 'list', 2: 'target', 3: 'keyItems', 4: 'arrange', 5: 'arrangeCustom' }),
    confirmedValues: Object.freeze({ 0: SC('save-boot-14d-item-screen-cross'), 1: SC('save-boot-14a-item-screen-open'), 2: SC('save-boot-14b-item-use-plan') }),
  },
  {
    name: 'itemListRow',
    address: 0x801d3df9,
    type: 's8',
    meaning: 'Item screen list cursor, the row on the visible page (g_ItemMenuWidgets[1].row; 10 rows a page). The inventory slot under the cursor is itemListRow + itemListOffset',
    source: `${ITEM_MENU_SOURCE}: g_ItemMenuWidgets at 0x801D3DDC, entry 1 at +0x12. Tier 2 (#135): 0 when the list opens (save-boot-14a, 14c); two planned Downs read 1 then 2, and Circle then uses inventory slot 2 (save-boot-14b)`,
    status: 'confirmed',
    scenario: SC('save-boot-14b-item-use-plan'),
  },
  {
    name: 'itemListOffset',
    address: 0x801d3df0,
    type: 's16',
    meaning: 'Item screen list scroll: the inventory slot on the top visible row (g_ItemMenuWidgets[1].rowOffset)',
    source: `${ITEM_MENU_SOURCE}. Tier 2 (#135): 0 when the list opens (save-boot-14c). Scrolling is not checked`,
    status: 'confirmed',
    scenario: SC('save-boot-14c-item-screen-press'),
  },
  {
    name: 'itemTargetSlot',
    address: 0x801d3e0b,
    type: 's8',
    meaning: 'Item screen party cursor on the target page (itemMenuScreen 2): the party slot an item is used on (g_ItemMenuWidgets[2].row, 3 rows)',
    source: `${ITEM_MENU_SOURCE}: entry 2 at +0x24. Tier 2 (#135): 0 on the target page; one planned Down reads 1, and Circle then raises party slot 1's HP (save-boot-14b)`,
    status: 'confirmed',
    scenario: SC('save-boot-14b-item-use-plan'),
  },
];

// The menu's overlay bookkeeping (#135 part 2): which menu overlay was last
// asked for. The native Item screen is shown only while it names the Item
// overlay, so the overlay variables above are never read for another page.
/** menuOverlay value for the Item screen (ITEMMENU_Init is entry 1 of the init table). */
export const MENU_OVERLAY_ITEM = 1;
/**
 * menuOverlay value for the Equip screen (#121; enum YamadaOvl,
 * YAMA_EQIPMENU_EQUIP). Circle on the main menu's Equip row first picks a
 * party member (the id stays 0, save-boot-15a); the next Circle asks for 4.
 */
export const MENU_OVERLAY_EQUIP = 4;
/**
 * menuOverlay value for the Materia screen (#241; enum YamadaOvl,
 * YAMA_EQIPMENU_MATERIA). As for Equip, Circle on the Materia row first picks
 * a party member; the next Circle asks for 3 (save-boot-22a).
 */
export const MENU_OVERLAY_MATERIA = 3;
// The Equip screen (#216). The EQIPMENU overlay is not decompiled, so these
// have no source: they were found by track searches in the private eval
// (notes/216-equip-cursors.md) and sit like the Item overlay's MenuTables
// (0x12 bytes, rowOffset at +0x02, row at +0x0B): a slot table at 0x801D8AA0
// and a list table at 0x801D8AB2. Overlay variables: read them only while a
// confirmed menuOverlay names the Equip overlay.
const EQUIP_MENU_SOURCE = 'no source (EQIPMENU is not decompiled in Xeeynamo/ff7-decomp@33ce78c); found by track checks (#216): the only byte in the overlay area (0x801D0000 to the end of RAM) that followed the pad steps (save-boot-17a to 17c); layout as include/game.h MenuTable (size 0x12, rowOffset at +0x02, row at +0x0B)';
const EQUIP_MENU_ENTRIES = [
  {
    name: 'equipSlotCursor',
    address: 0x801d8aab,
    type: 's8',
    meaning: 'Equip screen slot cursor: 0 Weapon, 1 Armor, 2 Accessory (the row of the slot MenuTable at 0x801D8AA0). Overlay variable: meaningless unless menuOverlay names the Equip overlay',
    source: `${EQUIP_MENU_SOURCE}. Tier 2 (#216): 0 when the Equip screen opens; Down, Down, Up, Up read 1, 2, 1, 0 (save-boot-17a, 18a); it stays 0 in the Weapon list and after a weapon is equipped (save-boot-18b); a rerun matches`,
    status: 'confirmed',
    scenario: SC('save-boot-18a-equip-slot-cursor'),
  },
  {
    name: 'equipListRow',
    address: 0x801d8abd,
    type: 's8',
    meaning: 'Equip screen list cursor, the row on the visible page (the row of the list MenuTable at 0x801D8AB2; 8 rows a page). The list entry under the cursor is equipListRow + equipListOffset. Meaningful only while the list is open; no page variable is read, so callers track it',
    source: `${EQUIP_MENU_SOURCE}. Tier 2 (#216): 0 when the Weapon list opens; Down, Down, Up, Up read 1, 2, 1, 0 (save-boot-17b); seven Downs read 1 to 7, and it stays 7 while the list scrolls (save-boot-18b); 0 on the slot page (save-boot-18a); a rerun matches`,
    status: 'confirmed',
    scenario: SC('save-boot-18b-equip-list-cursor'),
  },
  {
    name: 'equipListOffset',
    address: 0x801d8ab4,
    type: 's16',
    meaning: 'Equip screen list scroll: the list entry on the top visible row (rowOffset of the list MenuTable)',
    source: `${EQUIP_MENU_SOURCE}. Tier 2 (#216): 0 when the Weapon list opens; with 12 entries, Downs 8 and 9 read 1 and 2 (save-boot-17c, 18b), and Circle then equips the entry at index 9 (row 7 + offset 2), weapon 10 from inventory slot 9 (save-boot-18b); a rerun matches`,
    status: 'confirmed',
    scenario: SC('save-boot-18b-equip-list-cursor'),
  },
];

// The Materia screen (#244). Same overlay file as Equip, same method: found
// by track searches in the private eval (notes/244-materia-cursors.md), and
// laid out as MenuTables (0x12 bytes, rowOffset at +0x02, row at +0x0B): a
// slot table at 0x801DF5A2 (column at +0x0A) and a list table at 0x801DF5C6.
// Overlay variables: read them only while a confirmed menuOverlay names the
// Materia overlay.
const MATERIA_MENU_SOURCE = 'no source (EQIPMENU is not decompiled in Xeeynamo/ff7-decomp@33ce78c); found by track checks (#244): the only byte in the overlay area (0x801D0000 to the end of RAM) that followed the pad steps (save-boot-24a to 24c); layout as include/game.h MenuTable (size 0x12, rowOffset at +0x02, row at +0x0B; the column at +0x0A is observed, not sourced)';
const MATERIA_MENU_ENTRIES = [
  {
    name: 'materiaSlotColumn',
    address: 0x801df5ac,
    type: 's8',
    meaning: 'Materia screen slot cursor, the column: the materia slot index on the selected row (+0x0A of the slot MenuTable at 0x801DF5A2). Overlay variable: meaningless unless menuOverlay names the Materia overlay',
    source: `${MATERIA_MENU_SOURCE}. Tier 2 (#244): 0 when the Materia screen opens; Right, Left read 1, 0 (save-boot-24a, 25a); a rerun matches`,
    status: 'confirmed',
    scenario: SC('save-boot-25a-materia-slot-cursor'),
  },
  {
    name: 'materiaSlotRow',
    address: 0x801df5ad,
    type: 's8',
    meaning: 'Materia screen slot cursor, the row: 0 weapon, 1 armor (the row of the slot MenuTable at 0x801DF5A2)',
    source: `${MATERIA_MENU_SOURCE}. Tier 2 (#244): 0 when the Materia screen opens; Down, Up read 1, 0 (save-boot-24a, 25a); a rerun matches`,
    status: 'confirmed',
    scenario: SC('save-boot-25a-materia-slot-cursor'),
  },
  {
    name: 'materiaListRow',
    address: 0x801df5d1,
    type: 's8',
    meaning: 'Materia list cursor, the row on the visible page (the row of the list MenuTable at 0x801DF5C6; 10 rows a page). The list entry under the cursor is materiaListRow + materiaListOffset. Meaningful only while the list is open; no page variable is read, so callers track it',
    source: `${MATERIA_MENU_SOURCE}. Tier 2 (#244): 0 when the list opens; Down, Down, Up, Up read 1, 2, 1, 0 (save-boot-24b); nine Downs read 1 to 9, and it stays 9 while the list scrolls (save-boot-25b); 0 on the slot page (save-boot-25a); a rerun matches`,
    status: 'confirmed',
    scenario: SC('save-boot-25b-materia-list-cursor'),
  },
  {
    name: 'materiaListOffset',
    address: 0x801df5c8,
    type: 's16',
    meaning: 'Materia list scroll: the list entry on the top visible row (rowOffset of the list MenuTable)',
    source: `${MATERIA_MENU_SOURCE}. Tier 2 (#244): 0 when the list opens; with 12 entries, Downs 10 and 11 read 1 and 2 (save-boot-24c, 25b), and Circle then takes the entry at index 11 (row 9 + offset 2), emptying inventory slot 11 (save-boot-25b); a rerun matches`,
    status: 'confirmed',
    scenario: SC('save-boot-25b-materia-list-cursor'),
  },
];

const MENU_OVERLAY_ENTRIES = [
  {
    name: 'menuOverlay',
    address: 0x80062dd4,
    type: 'u32',
    meaning: 'the menu overlay id last asked for (D_80062DD4, set by SysMenuLoadMenuFileById): 1 = the Item screen; 3 = the Materia screen; 4 = the Equip screen; 0 back on the main menu',
    source: `Xeeynamo/ff7-decomp@33ce78c (reference only, no code) src/main/1F6B4.c, src/main/ovl.c; the init table D_800493A8 has ITEMMENU_Init as entry 1. Tier 2 (#135): reads 1 one frame after Circle on the main menu's Item row (save-boot-14a, 14c) and still 1 on the Item screen's tab row after one Cross (14d); reads 0 after a second Cross returns to the main menu (14e) and after Circle on main-menu row 2 (14f), while itemMenuScreen holds stale or unrelated data (0, 0x43784343). Tier 2 (#121): one Circle on the Equip row (row 3) leaves it at 0, a party pick coming first (save-boot-15a); the next Circle, 60 frames later, makes it read 4 (YAMA_EQIPMENU_EQUIP in the decomp's enum YamadaOvl), and the Weapon slot and list then equip a spare weapon (15b, 15c). Tier 2 (#241): on the Materia row (row 2) the same Circle every 60 frames makes it read 3 (YAMA_EQIPMENU_MATERIA) at the second press (ovl_wait 61, save-boot-22a); Circle, Circle then moves inventory materia slot 0 into Cloud's weapon materia slot 0 (22b); a rerun matches`,
    status: 'confirmed',
    scenario: SC('save-boot-14e-item-screen-cross-twice'),
    values: Object.freeze({ 0: 'other', 1: 'item', 3: 'materia', 4: 'equip' }),
    confirmedValues: Object.freeze({ 0: SC('save-boot-14e-item-screen-cross-twice'), 1: SC('save-boot-14a-item-screen-open'), 3: SC('save-boot-22a-materia-screen-open'), 4: SC('save-boot-15b-equip-screen-open') }),
  },
];

const INVENTORY_ENTRIES = [
  {
    name: 'inventorySlot',
    address: SAVEMAP + 0x4fc,
    type: 'u16',
    stride: 2,
    count: 320,
    meaning: 'item inventory slot (Savemap inventory[i]): quantity << 9 | item index (0-127 items, 128-255 weapons, 256-287 armor, 288-319 accessories); 0xFFFF = empty. semantic/inventory.js decodeItem',
    source: `${INVENTORY_SOURCE}. Tier 2 (#117): slots 0, 1, 2 and 319 hold the author-chosen words of harness/saves/disc1-md1stin-inventory.json in the field menu after the load (${INV_13A}); a rerun matches`,
    status: 'confirmed',
    scenario: SC(INV_13A),
  },
  {
    name: 'materiaSlot',
    address: SAVEMAP + 0x77c,
    type: 'u32',
    stride: 4,
    count: 200,
    meaning: 'materia inventory slot (Savemap materia[i]): AP << 8 | materia ID; ID 0xFF = empty. semantic/inventory.js decodeMateria',
    source: `${INVENTORY_SOURCE}. Tier 2 (#117): slots 0, 1 and 199 hold the author-chosen words in the field menu after the load (${INV_13A}); a rerun matches`,
    status: 'confirmed',
    scenario: SC(INV_13A),
  },
  ...[['characterWeapon', 0x1c, 'equipped weapon (0-127: weapon item index - 128)'], ['characterArmor', 0x1d, 'equipped armor (0-31: armor item index - 256)'], ['characterAccessory', 0x1e, 'equipped accessory (0-31: accessory item index - 288; 0xFF = none)']].map(([name, off, what]) => ({
    name,
    address: CHARACTER_RECORDS + off,
    type: 'u8',
    stride: CHARACTER_RECORD_SIZE,
    count: CHARACTER_RECORD_COUNT,
    meaning: `${what} in each character record, indexed by record (0 Cloud ... 8 Cid)`,
    source: `${INVENTORY_SOURCE}. Tier 2 (#117): records 0 and 1 hold the author-chosen values in the field menu after the load (${INV_13B}${name === 'characterAccessory' ? '; record 1 holds 0xFF, none' : ''}); a rerun matches`,
    status: 'confirmed',
    scenario: SC(INV_13B),
  })),
  ...[['characterWeaponMateria', 0x40, 'weapon', RECORD_WEAPON_MATERIA_SLOTS], ['characterArmorMateria', 0x60, 'armor', RECORD_ARMOR_MATERIA_SLOTS]].map(([name, off, what, n]) => ({
    name,
    address: CHARACTER_RECORDS + off,
    type: 'u32',
    stride: CHARACTER_RECORD_SIZE,
    count: CHARACTER_RECORD_COUNT,
    meaning: `first of the ${n} ${what} materia slots of each character record (u32 each, consecutive; AP << 8 | ID, ID 0xFF = empty), indexed by record`,
    source: `${INVENTORY_SOURCE}. Tier 2 (#117): record 0's ${what} slots 0 and 1 hold the author-chosen words in the field menu after the load (${INV_13B}); a rerun matches`,
    status: 'confirmed',
    scenario: SC(INV_13B),
  })),
];

/**
 * #112: what is around the player (notes/112-field-interactables.md,
 * semantic/nearby.js). More of each FieldEntity (g_FieldEntity, 16 models of
 * 0x84 bytes from 0x80074EA4; PosX/PosY are fieldX/fieldY above), the
 * field's model count, and its gateways, which sit in the field file the
 * game loaded, behind the pointer g_FieldTriggers.
 */
const DECOMP_112 = 'Xeeynamo/ff7-decomp@2c9239a4da08f039b1dcd4a3c9c34fe3fe7287fe';
const FIELD_ENTITY = 0x80074ea4;
const FIELD_ENTITY_SIZE = 0x84;
const FIELD_STATE = 0x8009abf4;
const ENTITY_SOURCE = `${DECOMP_112} include/game.h (FieldEntity, size 0x84) and src/field/field_entity.c (FieldEntityCheckTalk: a Circle press talks to a model whose TalkOff is clear, within its TalkRange plus the player's SolidRange on the ground, within 256 in height, and faced within 64/256 of a turn)`;
/**
 * FieldTriggers.gateways (include/game.h): 12 FieldGateway records of 0x18
 * bytes at +0x38 of what g_FieldTriggers points to. Each starts with a line
 * (x1, y1, z1, x2, y2, z2, s16, field units) and has the field it leads to
 * at +0x12 (u16; GATEWAY_UNUSED 0x7FFF = unused slot).
 */
export const FIELD_GATEWAYS = Object.freeze({ offset: 0x38, size: 0x18, count: 12, to: 0x12 });

const FIELD_ENTRIES = [
  {
    name: 'fieldModelCount',
    address: FIELD_STATE + 0x28,
    type: 's16',
    meaning: 'number of field models in the current field (g_FieldState.modelCount): elements 0 .. this - 1 of the field model arrays are in use (at most 16)',
    source: `${DECOMP_112} config/symbols.main.us.txt (g_FieldState 0x8009ABF4) and include/game.h (FieldState: modelCount at +0x28, pcModelId at +0x2A); src/field/field_entity.c loops over it for talk and collision. g_FieldModelCount (0x8009C6C4, u8) is a second candidate. ${'Tier 2 (#112, notes/112-field-interactables.md): at md1stin from after-battle'} it reads 1..16, equals g_FieldModelCount, and g_PlayerModelId is below it (reactor-next-4-models); two runs agree`,
    status: 'confirmed',
    scenario: SC('reactor-next-4-models'),
  },
  {
    name: 'fieldZ',
    address: FIELD_ENTITY + 0x14,
    type: 's32',
    stride: FIELD_ENTITY_SIZE,
    count: 16,
    meaning: 'field Z (height) position of each field model (g_FieldEntity[i].PosZ, raw units; >> 12 for field units)',
    source: `${ENTITY_SOURCE}: PosZ at +0x14. Tier 2 (#237, notes/237-talk-rule.md): in mds7st1 (disc1-mds7st1) after holding Down 300 frames, where Circle opens a message (#224's save-boot-19a), model 7 is the only model whose ground distance is below its TalkRange plus the player's SolidRange; its TalkOff reads 0; models 8 and 9 (TalkOff 0) are out of range, as models 4-6 were in #168, and models 1-3 have TalkOff set (#168); after half the walk no model is in range and Circle opens no window (save-boot-21c). Facing was not checked, and no address names the talker: the rule's prediction matches the game at one talk and one no-talk point. The distance, TalkOff and control readings agree over three runs; the exact height check (|dz| < 256) is newer and was first green on 9785d05; at that point the player is 224..239 field units (PosZ >> 12) above model 7, inside the 256 limit (save-boot-21a, exact in floored field units). Only one height difference was measured`,
    status: 'confirmed',
    scenario: SC('save-boot-21a-talk-rule-talker'),
  },
  {
    name: 'fieldDir',
    address: FIELD_ENTITY + 0x38,
    type: 'u8',
    stride: FIELD_ENTITY_SIZE,
    count: 16,
    meaning: 'facing of each field model (g_FieldEntity[i].Dir), in 1/256 turns: 64 more than the angle from +x towards +y (semantic/nearby.js directionTo)',
    source: `${ENTITY_SOURCE}: Dir at +0x38; FieldEntityDirByVec gives the convention. ${'Tier 2 (#112, notes/112-field-interactables.md): at md1stin from after-battle'}, element 0 (the player) reads 32..96 after holding right for 30 frames, when PosX rises (#77): +x is 64, as the convention says. Only that direction was checked; two runs agree`,
    status: 'confirmed',
    scenario: SC('reactor-next-4-models'),
  },
  {
    name: 'fieldSolidRange',
    address: FIELD_ENTITY + 0x6c,
    type: 'u16',
    stride: FIELD_ENTITY_SIZE,
    count: 16,
    meaning: 'collision radius of each field model (g_FieldEntity[i].SolidRange, field units); the player\'s is set from the field scale when the field loads, and gateways trigger within it',
    source: `${ENTITY_SOURCE}: SolidRange at +0x6C; FieldEntityInitPos sets the player's to 34 * scale >> 9, FieldEntityGatewayCheck compares the squared distance to a gateway line with it. ${'Tier 2 (#112, notes/112-field-interactables.md): at md1stin from after-battle'}, element 0 (the player) reads 1..255 (reactor-next-4-models); the value itself was not read; two runs agree`,
    status: 'confirmed',
    scenario: SC('reactor-next-4-models'),
  },
  {
    name: 'fieldTalkOff',
    address: FIELD_ENTITY + 0x5b,
    type: 'u8',
    stride: FIELD_ENTITY_SIZE,
    count: 16,
    meaning: 'non-zero when a field model can not be talked to (g_FieldEntity[i].TalkOff, set by the field script)',
    source: `${ENTITY_SOURCE}: TalkOff at +0x5B. Tier 2 (#237, notes/237-talk-rule.md): in mds7st1 (disc1-mds7st1) after holding Down 300 frames, where Circle opens a message (#224's save-boot-19a), model 7 is the only model whose ground distance is below its TalkRange plus the player's SolidRange; its TalkOff reads 0; models 8 and 9 (TalkOff 0) are out of range, as models 4-6 were in #168, and models 1-3 have TalkOff set (#168); after half the walk no model is in range and Circle opens no window (save-boot-21c). Facing was not checked, and no address names the talker: the rule's prediction matches the game at one talk and one no-talk point. The distance, TalkOff and control readings agree over three runs; the exact height check (|dz| < 256) is newer and was first green on 9785d05. Only 0 was seen on a model that talks; that a non-zero value blocks a talk is the reference's claim, not measured`,
    status: 'confirmed',
    scenario: SC('save-boot-21a-talk-rule-talker'),
  },
  {
    name: 'fieldTalkRange',
    address: FIELD_ENTITY + 0x6e,
    type: 'u16',
    stride: FIELD_ENTITY_SIZE,
    count: 16,
    meaning: 'talk radius of each field model (g_FieldEntity[i].TalkRange, field units)',
    source: `${ENTITY_SOURCE}: TalkRange at +0x6E. Tier 2 (#237, notes/237-talk-rule.md): in mds7st1 (disc1-mds7st1) after holding Down 300 frames, where Circle opens a message (#224's save-boot-19a), model 7 is the only model whose ground distance is below its TalkRange plus the player's SolidRange; its TalkOff reads 0; models 8 and 9 (TalkOff 0) are out of range, as models 4-6 were in #168, and models 1-3 have TalkOff set (#168); after half the walk no model is in range and Circle opens no window (save-boot-21c). Facing was not checked, and no address names the talker: the rule's prediction matches the game at one talk and one no-talk point. The distance, TalkOff and control readings agree over three runs; the exact height check (|dz| < 256) is newer and was first green on 9785d05`,
    status: 'confirmed',
    scenario: SC('save-boot-21a-talk-rule-talker'),
  },
  {
    name: 'fieldTriggers',
    address: 0x800716c4,
    type: 'u32',
    meaning: 'pointer to the current field\'s FieldTriggers (g_FieldTriggers), inside the field file loaded at 0x80115000; its gateways are FIELD_GATEWAYS. Only meaningful in a settled field',
    source: `${DECOMP_112} config/symbols.main.us.txt (g_FieldTriggers 0x800716C4), include/game.h (FieldTriggers, FieldGateway, LinePos), src/field/field_private.h (FieldDatHeader.triggers; field file at 0x80115000) and src/field/field_entity.c (FieldEntityGatewayCheck skips gateways whose fieldMapId is 0x7FFF). ${'Tier 2 (#112, notes/112-field-interactables.md): at md1stin from after-battle'} it points into 0x80115000..0x80127FFF; gateway 0's fieldMapId (+0x38 + 0x12) is md1_1 (0x75), the field #77's up-left walk leads to, and gateway 1's is not; both ends of gateway 0's line (x1, y1, x2, y2 at +0x38 + 0, 2, 6, 8) are left of the player's PosX >> 12 and above its PosY >> 12, the side that walk leaves by (reactor-next-3-exit-side, signs only); two runs agree. The z values were not checked`,
    status: 'confirmed',
    scenario: SC('reactor-next-3-exit-side'),
  },
];

export const ADDRESS_TABLE = makeTable(EXE_USA_SHA1, [
  {
    name: 'gameState',
    address: 0x8009c560,
    type: 's16',
    meaning: 'current game mode (g_GameState): field = 1, battle = 2, world map = 3, menu = 5, motorcycle minigame = 6 (confirmed); the other minigames (7-11, 14) are unlabelled. Reads field during a movie; reads 0 on the title',
    source: `${DECOMP} config/symbols.main.us.txt: g_GameState; values: notes/36-disc-boot.md. Tier 2 (#76, notes/76-confirm-mode.md): 1 at reactor-entrance, after closing the menu and after the first battle; 5 with the menu open; 2 in the first guard battle; 1 during the opening movie; ${CAVEAT}. Tier 2 (#80, notes/80-boot-catalogue.md): 3 for 690 frames after a generated save loads into the world map outside Kalm and outside Midgar; 6 for 600 frames after one loads into the motorcycle minigame, while its track position advances`,
    status: 'confirmed',
    scenario: SC('reactor-mode-1-field'),
    values: GAME_STATES,
    confirmedValues: GAME_STATES_CONFIRMED,
  },
  {
    name: 'prevGameState',
    address: 0x800965ec,
    type: 's16',
    meaning: 'the previous game mode (g_PrevGameState), same values as gameState, plus none = 0 before the first mode change of a new game',
    source: `${DECOMP} config/symbols.main.us.txt: g_PrevGameState; notes/36-disc-boot.md. Tier 2 (#76): 0 at reactor-entrance, field 1 in the menu and in battle, menu 5 after closing the menu, battle 2 after the battle; ${CAVEAT}. Tier 2 (#107): 0 at reactor-entrance is a check, not only a metric`,
    status: 'confirmed',
    scenario: SC('reactor-mode-3-menu-close'),
    values: PREV_GAME_STATES,
    confirmedValues: Object.freeze({ 0: SC('reactor-mode-1-field'), 1: SC('reactor-mode-2-menu-open'), 2: SC('reactor-mode-5-battle-end'), 5: SC('reactor-mode-3-menu-close') }),
  },
  {
    name: 'movieFrame',
    address: 0x80071740,
    type: 'u32',
    meaning: 'frame number of the playing movie (Stframe_no, the streaming library): it advances (15 a second) while a movie plays and holds its last value afterwards (1790 after the opening). It can read 0 on single frames during a movie, so judge over a window: a movie is playing when gameState is field and this value advances',
    source: `${DECOMP} config/symbols.main.us.txt: Stframe_no. Tier 2 (#76): 0 until the opening movie starts, 150 more after 10 s, 1790 at its end and unchanged at reactor-entrance; one 0 read mid-movie (attempt 1). The first candidate, g_MovieLock (0x800716CC), read 0 throughout the opening; ${CAVEAT}`,
    status: 'confirmed',
    scenario: SC('movie-2-playing'),
  },
  {
    name: 'fieldId',
    address: 0x8009a05c,
    type: 's16',
    meaning: 'current location (field ID, g_FieldCurrentMap); documented IDs 0x0000 to 0x0312 (ff7-flat-wiki Field_ID). It changes as soon as the player walks through an exit, before the new field has loaded (see fieldLoading)',
    source: `${DECOMP} config/symbols.main.us.txt and include/game.h: g_FieldCurrentMap. Tier 2 (#77, notes/77-field-position.md): md1stin (0x74) at reactor-entrance, md1_1 (0x75) after walking up-left off it, as the wiki documents; the savemap copy (0x8009C6E4 + 0x0B96) reads the same at md1stin. ${CAVEAT}`,
    status: 'confirmed',
    scenario: SC('reactor-field-1-id'),
  },
  {
    name: 'playerModel',
    address: 0x800965e0,
    type: 's16',
    meaning: 'field model index of the player (g_PlayerModelId): the element of fieldX/fieldY that is the player. Only 0 is confirmed (md1stin); another value is a hypothesis until a Tier 2 scenario sees it',
    source: `${DECOMP} config/symbols.main.us.txt: g_PlayerModelId. Tier 2: 0 at md1stin with model 0 the one that moves with the pad (#77, reactor-field-2-still; #38, save-boot-1-load), and 0 at nmkin_1 with model 0 moving under the pad and model 1 still (#99, save-boot-3-player-model-nmkin-1). #99 found no reachable state where it is not 0: Cloud or Barret leading, in md1stin, md1_1, md1_2, nmkin_1, md8_1, mds7st1 and mds7 (notes/99-player-model.md); ${CAVEAT}`,
    status: 'confirmed',
    scenario: SC('reactor-field-2-still'),
    values: Object.freeze({ 0: 'model 0' }),
    confirmedValues: Object.freeze({ 0: SC('save-boot-3-player-model-nmkin-1') }),
  },
  {
    name: 'fieldX',
    address: 0x80074eb0,
    type: 's32',
    stride: 0x84,
    count: 16,
    meaning: 'field X position of each field model (g_FieldEntity[i].PosX, raw units); element playerModel is the player. At md1stin (model 0) screen right raises it and left lowers it',
    source: `${DECOMP} config/symbols.main.us.txt (g_FieldEntity at 0x80074EA4; g_FieldModelAnimStatus follows 16 elements on) and include/game.h (FieldEntity, size 0x84, PosX at +0x0C). Tier 2 (#77), element 0: unchanged for 120 frames without input; +1 sign walking right and up, -1 walking left and down, in two runs; ${CAVEAT}`,
    status: 'confirmed',
    scenario: SC('reactor-field-3-walk-right'),
  },
  {
    name: 'fieldY',
    address: 0x80074eb4,
    type: 's32',
    stride: 0x84,
    count: 16,
    meaning: 'field Y position of each field model (g_FieldEntity[i].PosY, raw units); element playerModel is the player. At md1stin (model 0) screen up raises it and down lowers it',
    source: `${DECOMP} include/game.h (FieldEntity, size 0x84, PosY at +0x10). Tier 2 (#77), element 0: unchanged for 120 frames without input; +1 sign walking up, -1 walking down, in two runs; ${CAVEAT}`,
    status: 'confirmed',
    scenario: SC('reactor-field-5-walk-up'),
  },
  {
    name: 'fieldLoading',
    address: 0x800965e8,
    type: 's16',
    meaning: 'field load state (g_IsFieldLoading): 2 in a settled field; another value (1 was seen) while a field loads. The field ID changes first and the load starts later (114 frames later at md1stin -> md1_1), so 2 alone does not mean loaded: a field is loaded when, after the field ID changed, this has left 2 and read 2 again (gameState field)',
    source: `${DECOMP} config/symbols.main.us.txt: g_IsFieldLoading. Tier 2 (#77, notes/77-field-position.md): 2 at md1stin; after walking off to md1_1 it left 2 114 frames after the ID changed and read 2 again 66 frames later, in two runs; ${CAVEAT}`,
    status: 'confirmed',
    scenario: SC('reactor-next-2-load-sequence'),
    values: Object.freeze({ 2: 'settled' }),
    confirmedValues: Object.freeze({ 2: SC('reactor-next-2-load-sequence') }),
  },
  {
    name: 'menuCursor',
    address: 0x8009a0d3,
    type: 's8',
    meaning: 'field main-menu cursor index (0 = the first item; the row of g_PartyMenuTables[0]). Only the main menu is checked; sub-menu cursors (Materia, Equip) are elsewhere',
    source: `${DECOMP} config/symbols.main.us.txt (g_PartyMenuTables at 0x8009A0C8, three tables) and include/game.h (MenuTable, size 0x12, row at +0x0B). Tier 2 (#78, notes/78-menu-party.md): 0 with the menu just open, Down 1, Down 2, Up 1, Up 0; the rows of tables 1 and 2 stay 0; ${CAVEAT}`,
    status: 'confirmed',
    scenario: SC('reactor-mode-2d-cursor-sequence'),
  },
  {
    name: 'partyPick',
    address: 0x8009a0e5,
    type: 's8',
    meaning: 'main-menu party pick: the party slot (0-2) highlighted after Circle on a main-menu row that asks for a member (Equip), and the member whose Equip screen then opens (the row of g_PartyMenuTables[1]). Only the party pick and the Equip screen are checked; elsewhere it may hold a stale value',
    source: `Xeeynamo/ff7-decomp@33ce78c (reference only, no code) config/symbols.main.us.txt (g_PartyMenuTables at 0x8009A0C8) and include/game.h (MenuTable, size 0x12, row at +0x0B): table 1's row. Tier 2 (#215, notes/215-party-pick.md): from a generated save with party Cloud, Barret, Tifa, after the planned move to Equip and Circle, Down 0, 1 or 2 times reads 0, 1 or 2 (save-boot-16a to 16d); Circle then opens the Equip screen (menuOverlay 4) for that slot's member, and Circle, Circle changes only that member's weapon; it still reads the slot on the Equip screen; table 2's row stays 0; a rerun matches`,
    status: 'confirmed',
    scenario: SC('save-boot-16c-party-pick-slot1'),
  },
  ...[0, 1, 2].map((i) => ({
    name: `partySlot${i}`,
    address: 0x8009c6e4 + 0x4f8 + i,
    type: 'u8',
    meaning: `character ID in party slot ${i} (Savemap partyID[${i}]: 0x00 Cloud, 0x01 Barret, ... 0x0B; 0xFF = empty). The game uses this copy live (field scripts and the menu read it)`,
    source: `${DECOMP} include/game.h (SaveWork partyID at +0x4F8; Savemap at 0x8009C6E4); ${SAVEMAP_NOTE}: savemap +0x${(0x4f8 + i).toString(16).toUpperCase().padStart(4, '0')}. Tier 2 (#78): Cloud (0x00), empty, empty in the field menu at reactor-entrance and in the first guard battle (Cloud is alone there); ${CAVEAT}.${[
      '',
      ' Tier 2 (#101): Barret (0x01) from a generated save with party Cloud, Barret, empty, in the field menu and in a random battle in md1_1',
      ' Tier 2 (#101): Tifa (0x02) from a generated save with party Cloud, Barret, Tifa, in a random battle in md1_1',
    ][i]}`,
    status: 'confirmed',
    scenario: SC(['reactor-mode-4a-party-slots', 'save-boot-4-party-barret-menu', 'save-boot-6-party-tifa-battle'][i]),
  })),
  ...[0, 1, 2].map((i) => ({
    name: `partyHp${i}`,
    address: 0x8009d84c + i * 0x440 + 0x10,
    type: 's16',
    meaning: `current HP of the character in party slot ${i} (g_ActiveCharacters[${i}].hp; the array is indexed by party slot). Meaningless for an empty slot: check partySlot${i}`,
    source: `${DECOMP} config/symbols.main.us.txt (g_ActiveCharacters at 0x8009D84C), include/game.h (ActiveCharacterData, size 0x440, hp at +0x10) and src/menu/savemenu.c (reads g_ActiveCharacters[i] for party slot i); ff7-flat-wiki Battle_Mechanics "Active Character Data" (+0x10 current HP). ${[
      `Tier 2 (#78): slot 0 (Cloud) in 1..9999 in the field menu and in the first guard battle, and it falls while the guards attack with max HP unchanged; ${CAVEAT}`,
      'Tier 2 (#101): slot 1 (Barret, generated save) in 1..9999 in the field menu and in a random battle in md1_1, and it falls over 2400 frames of that battle with max HP (+0x12) unchanged; a rerun matches',
      'Tier 2 (#101): slot 2 (Tifa, generated save with party Cloud, Barret, Tifa) in 1..9999 in a random battle in md1_1, and it falls over 3000 frames of that battle with max HP (+0x12) unchanged; a rerun matches',
    ][i]}. The byte at +0x000 is not the character ID: it read 0 for Barret and Tifa (#101)`,
    status: 'confirmed',
    scenario: SC(['reactor-mode-4c-party-hp-damage', 'save-boot-5-party-barret-battle', 'save-boot-6-party-tifa-battle'][i]),
  })),
  ...STAT_ENTRIES,
  ...WINDOW_ENTRIES,
  ...BATTLE_MENU_ENTRIES,
  ...INVENTORY_ENTRIES,
  ...ITEM_MENU_ENTRIES,
  ...EQUIP_MENU_ENTRIES,
  ...MATERIA_MENU_ENTRIES,
  ...MENU_OVERLAY_ENTRIES,
  ...FIELD_ENTRIES,
]);
