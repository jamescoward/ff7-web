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
const SAVEMAP_NOTE = 'notes/32-save-format.md savemap layout (ff7-mods flat wiki)';

export const TYPES = Object.freeze({ u8: 1, s8: 1, u16: 2, s16: 2, u32: 4, s32: 4 });

/**
 * Raw `g_GameState` values (notes/36-disc-boot.md). Field, battle and menu are
 * confirmed (#76, see GAME_STATES_CONFIRMED); world is still a hypothesis. There
 * is no movie value: the field module plays movies, so g_GameState reads field
 * during one; movieFrame below tells a movie apart.
 */
const GAME_STATES = Object.freeze({ 1: 'field', 2: 'battle', 3: 'world', 5: 'menu' });

const SC = (name) => `harness/scenarios/${name}.json`;
const CAVEAT = 'chain of in-memory snapshots from reactor-entrance (#74); determinism = reruns from the same snapshot, not chain vs scratch (#88)';

/** Which Tier 2 scenario observed each confirmed g_GameState value (#76). */
const GAME_STATES_CONFIRMED = Object.freeze({
  1: SC('reactor-mode-1-field'),
  2: SC('reactor-mode-4-battle'),
  5: SC('reactor-mode-2-menu-open'),
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

export const ADDRESS_TABLE = makeTable(EXE_USA_SHA1, [
  {
    name: 'gameState',
    address: 0x8009c560,
    type: 's16',
    meaning: 'current game mode (g_GameState): field = 1, battle = 2, menu = 5 (confirmed); world = 3 (hypothesis). Reads field during a movie; reads 0 on the title',
    source: `${DECOMP} config/symbols.main.us.txt: g_GameState; values: notes/36-disc-boot.md. Tier 2 (#76, notes/76-confirm-mode.md): 1 at reactor-entrance, after closing the menu and after the first battle; 5 with the menu open; 2 in the first guard battle; 1 during the opening movie; ${CAVEAT}`,
    status: 'confirmed',
    scenario: SC('reactor-mode-1-field'),
    values: GAME_STATES,
    confirmedValues: GAME_STATES_CONFIRMED,
  },
  {
    name: 'prevGameState',
    address: 0x800965ec,
    type: 's16',
    meaning: 'the previous game mode (g_PrevGameState), same values as gameState; 0 before the first mode change of a new game',
    source: `${DECOMP} config/symbols.main.us.txt: g_PrevGameState; notes/36-disc-boot.md. Tier 2 (#76): 0 at reactor-entrance, field 1 in the menu and in battle, menu 5 after closing the menu, battle 2 after the battle; ${CAVEAT}`,
    status: 'confirmed',
    scenario: SC('reactor-mode-3-menu-close'),
    values: GAME_STATES,
    confirmedValues: Object.freeze({ 1: SC('reactor-mode-2-menu-open'), 2: SC('reactor-mode-5-battle-end'), 5: SC('reactor-mode-3-menu-close') }),
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
]);
