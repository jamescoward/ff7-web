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
// prevGameState and movieFrame (notes/76-confirm-mode.md).
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

const noAddress = (why) => `no RAM address known yet; ${why}`;

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
    if (e.address !== null) {
      if (!Number.isInteger(e.address) || e.address < 0x80000000 || e.address + TYPES[e.type] > 0x80200000) {
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
    address: null,
    type: 'u16',
    meaning: 'current location (field ID); documented IDs 0x0000 to 0x0312',
    source: noAddress(`${SAVEMAP_NOTE}: savemap +0x0B96 is the saved copy; its RAM base is not in the repo. Issue #77`),
    status: 'hypothesis',
  },
  {
    name: 'fieldX',
    address: null,
    type: 's16',
    meaning: 'player field X position',
    source: noAddress(`${SAVEMAP_NOTE}: savemap +0x0B9A is the saved copy, not a live address. Issue #77`),
    status: 'hypothesis',
  },
  {
    name: 'fieldY',
    address: null,
    type: 's16',
    meaning: 'player field Y position',
    source: noAddress(`${SAVEMAP_NOTE}: savemap +0x0B9C is the saved copy, not a live address. Issue #77`),
    status: 'hypothesis',
  },
  {
    name: 'menuCursor',
    address: null,
    type: 'u8',
    meaning: 'main-menu cursor index (0 = first item)',
    source: noAddress('issue #78 asks for it; no candidate in the repo'),
    status: 'hypothesis',
  },
  ...[0, 1, 2].map((i) => ({
    name: `partySlot${i}`,
    address: null,
    type: 'u8',
    meaning: `character ID in party slot ${i} (0x00 to 0x0B, 0xFF = empty)`,
    source: noAddress(`${SAVEMAP_NOTE}: savemap +0x${(0x4f8 + i).toString(16).toUpperCase().padStart(4, '0')} is the saved copy. Issue #78`),
    status: 'hypothesis',
  })),
  ...[0, 1, 2].map((i) => ({
    name: `partyHp${i}`,
    address: null,
    type: 'u16',
    meaning: `current HP of the character in party slot ${i}`,
    source: noAddress('no RAM address in the repo; the savemap holds HP per character but its live location is unknown. Issue #78'),
    status: 'hypothesis',
  })),
]);
