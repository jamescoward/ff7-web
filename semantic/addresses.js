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
// Tifa (notes/101-barret-party.md).
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
];

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
    source: `${BATTLE_MENU_SOURCE}. Tier 2 (#110, notes/110-battle-input.md): in the first guard battle it reads 1 once Cloud's ATB gauge fills (60 frames after the "battle" snapshot), 0 one frame after Circle on Attack (reactor-mode-4f), and -1 one frame after a second Circle takes Attack, still -1 10 frames later (reactor-mode-4h); in a random battle with party Cloud, Barret, Tifa it reads 1, 0, -1 and 1 again for the next member (save-boot-11c, 11d); reruns match. Sub-menu values were not read`,
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
    source: `${BATTLE_MENU_SOURCE}. Tier 2 (#110): 0 when Cloud's menu opens in the first guard battle (Cloud alone; reactor-mode-4f); with party Cloud, Barret, Tifa in a random battle, 2 when the first menu opens and 1 for the next after Attack is taken (save-boot-11d; save-boot-11c saw it change); reruns match`,
    status: 'confirmed',
    scenario: SC('reactor-mode-4f-battle-command-right'),
  },
  {
    name: 'battleCommandRow',
    address: BATTLE_MENU_SLOTS + 0x0b,
    type: 'u8',
    stride: BATTLE_MENU_SLOT_SIZE,
    count: 3,
    meaning: 'command menu cursor row of each party slot (D_800F90B4[slot].table00.row; 4 rows per column, 0 = the top row, Attack). Element i is party slot i; the column is the byte before',
    source: `${BATTLE_MENU_SOURCE}. Tier 2 (#110): slot 0's reads 0 when the menu opens, 1 after Down and 0 after Up, one frame after each press (reactor-mode-4f); slot 2's the same (save-boot-11d), and slot 1's 0 then 1 after Down (save-boot-11d); reruns match`,
    status: 'confirmed',
    scenario: SC('reactor-mode-4f-battle-command-right'),
  },
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
]);
