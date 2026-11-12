// The semantic layer: typed readers over game memory, behind a hash gate.
// Original project code, GPL-2.0-or-later.
//
// Written only against the backend interface's readMem(addr, len), which
// returns bytes (synchronously in the Node runner, as a promise in the
// browser); there is no writeMem here and no Node API, so it runs in both.
//
// Every reader is async and returns { value, confirmed, reason? }:
//   value      the decoded state, or null when it can't be read
//   confirmed  true only if every address it used has status "confirmed"
//              and, for an enumeration, the raw value read is a labelled one
//              and listed in the entry's confirmedValues when it has them (#92)
//   reason     set when value is null: 'inactive' (the hash gate is off),
//              'no address' (no candidate known), 'read failed', or
//              'out of range' (an index read from memory is not an element
//              of the array it indexes)
// Unconfirmed values are still returned: callers decide whether to trust a
// hypothesis (the debug overlay, #79, shows them).

import { decodeItem, decodeMateria, ACCESSORY_NONE } from './inventory.js';
import { fieldUnits, nearbyFrom } from './nearby.js';
import { ADDRESS_TABLE, FIELD_GATEWAYS, TYPES, RECORD_WEAPON_MATERIA_SLOTS, RECORD_ARMOR_MATERIA_SLOTS, BATTLE_WIDGET_NONE, BATTLE_WIDGET_TARGET, WINDOW_WAITING_STATES, WINDOW_TXT_DONE, WINDOW_POINTER_Y0, WINDOW_LINE_HEIGHT } from './addresses.js';

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** SHA-1 of bytes as lower-case hex (Web Crypto: Node 22+, browsers in a secure context). */
export async function sha1Hex(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('SHA-1 needs Web Crypto (a secure context)');
  return hex(new Uint8Array(await subtle.digest('SHA-1', bytes)));
}

/**
 * SHA-1 of the boot executable of an opened ISO (runner/iso9660.js
 * openIso, or runner/disc.js openDisc): the file SYSTEM.CNF's BOOT line
 * names. The bytes stay in this function; only the hash is returned, and the
 * caller must not send it anywhere.
 */
export async function bootExeSha1(iso) {
  return sha1Hex(iso.read(iso.bootPath()));
}

/** Does the table apply to a disc whose boot executable has this SHA-1? */
export function evaluateGate(table, exeSha1) {
  if (typeof exeSha1 !== 'string') return { active: false, reason: 'no boot executable hash' };
  if (exeSha1.toLowerCase() !== table.exe) return { active: false, reason: 'boot executable is not the one the address table describes' };
  return { active: true, reason: null };
}

/**
 * How many mode() samples the movie test looks back over. movieFrame
 * advances once every 4 game frames (15 a second) and can read 0 on a single
 * frame mid-movie (#76), so one read can't tell a movie; five samples always
 * span an advance, even when sampled every frame. At the overlay's 4 Hz the
 * report lags a movie's start by one sample and its end by about a second.
 */
export const MOVIE_WINDOW = 5;

/** Raw g_GameState in battle (#76). */
const BATTLE_GAME_STATE = 2;

/**
 * Character records 0-8 (Cloud ... Cid). Party character IDs 0-8 name the
 * record of the same number; 9-11 (Young Cloud, Sephiroth, ...) share
 * records in a way no scenario has checked, so they have no record here.
 */
const CHARACTER_RECORDS = 9;

/** Raw g_GameState in a field, and g_IsFieldLoading once it has settled (#77). */
const FIELD_GAME_STATE = 1;
const FIELD_SETTLED = 2;
/** Main RAM in KSEG0. */
const RAM_START = 0x80000000;
const RAM_END = 0x80200000;

/** Raw g_GameState while a movie plays: the field module plays movies (#76). */
const MOVIE_GAME_STATE = 1;

/**
 * Is a movie playing, judging by movieFrame samples (oldest first, null when
 * a read failed)? Yes if, skipping 0 and null reads, some sample is greater
 * than the one before it. A counter stuck at one value (1790 after the
 * opening) is no movie, even with a stray 0 in between.
 */
export function movieAdvancing(samples) {
  const seen = samples.filter((v) => v !== null && v !== 0);
  for (let i = 1; i < seen.length; i++) if (seen[i] > seen[i - 1]) return true;
  return false;
}

/** Does this entry confirm this raw value? (status, then the enumeration's labels and confirmedValues) */
export function valueConfirmed(e, raw) {
  if (e.status !== 'confirmed') return false;
  if (e.values && !(raw in e.values)) return false;
  if (e.confirmedValues && !(raw in e.confirmedValues)) return false;
  return true;
}

const DECODERS = {
  u8: (v) => v.getUint8(0),
  s8: (v) => v.getInt8(0),
  u16: (v) => v.getUint16(0, true),
  s16: (v) => v.getInt16(0, true),
  u32: (v) => v.getUint32(0, true),
  s32: (v) => v.getInt32(0, true),
};

/**
 * Build the layer for a backend ({ readMem }) and the SHA-1 of the boot
 * executable. With the gate off every reader answers inactive and reads
 * nothing.
 */
export function createSemantic({ backend, exeSha1, table = ADDRESS_TABLE }) {
  const gate = evaluateGate(table, exeSha1);
  const entries = new Map(table.entries.map((e) => [e.name, e]));

  /**
   * Read named entries: { values: {name: n}, confirmed } or { reason }. For
   * an array entry, `index` picks the element (default 0).
   */
  async function read(names, index = 0) {
    if (!gate.active) return { reason: 'inactive' };
    const values = {};
    let confirmed = true;
    for (const name of names) {
      const e = entries.get(name);
      if (!e || e.address === null) return { reason: 'no address' };
      if (index !== 0 && !(Number.isInteger(index) && index > 0 && index < (e.count ?? 1))) return { reason: 'out of range' };
      try {
        const bytes = await backend.readMem(e.address + index * (e.stride ?? 0), TYPES[e.type]);
        values[name] = DECODERS[e.type](new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      } catch {
        return { reason: 'read failed' };
      }
      confirmed &&= valueConfirmed(e, values[name]);
    }
    return { values, confirmed };
  }

  /**
   * Read `n` consecutive elements of an entry's type, starting at element
   * `index` (address + index * stride), in one readMem: { values: [..], confirmed }
   * or { reason }. For an array whose stride is its type's size this is a
   * run of the array; otherwise the run is what the entry's meaning says
   * follows each element (#117: a record's materia slots).
   */
  async function readRun(name, index, n) {
    if (!gate.active) return { reason: 'inactive' };
    const e = entries.get(name);
    if (!e || e.address === null) return { reason: 'no address' };
    if (!(Number.isInteger(index) && index >= 0 && index < (e.count ?? 1))) return { reason: 'out of range' };
    const size = TYPES[e.type];
    let bytes;
    try {
      bytes = await backend.readMem(e.address + index * (e.stride ?? 0), n * size);
    } catch {
      return { reason: 'read failed' };
    }
    if (!bytes || bytes.length !== n * size) return { reason: 'read failed' };
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const values = [];
    for (let i = 0; i < n; i++) values.push(DECODERS[e.type](new DataView(view.buffer, view.byteOffset + i * size, size)));
    return { values, confirmed: e.status === 'confirmed' };
  }

  /**
   * Read elements 0 .. n-1 of several array entries in one readMem (#112:
   * the field model arrays, interleaved in one struct array): { values:
   * { name: [..] }, confirmed } or { reason }.
   */
  async function readArrays(names, n) {
    if (!gate.active) return { reason: 'inactive' };
    const es = names.map((name) => entries.get(name));
    if (es.some((e) => !e || e.address === null)) return { reason: 'no address' };
    if (es.some((e) => !(Number.isInteger(n) && n >= 1 && n <= (e.count ?? 1)))) return { reason: 'out of range' };
    const start = Math.min(...es.map((e) => e.address));
    const end = Math.max(...es.map((e) => e.address + (n - 1) * (e.stride ?? 0) + TYPES[e.type]));
    let bytes;
    try {
      bytes = await backend.readMem(start, end - start);
    } catch {
      return { reason: 'read failed' };
    }
    if (!bytes || bytes.length !== end - start) return { reason: 'read failed' };
    const values = {};
    for (const e of es) {
      values[e.name] = [];
      for (let i = 0; i < n; i++) {
        const at = e.address - start + i * (e.stride ?? 0);
        values[e.name].push(DECODERS[e.type](new DataView(bytes.buffer, bytes.byteOffset + at, TYPES[e.type])));
      }
    }
    return { values, confirmed: es.every((e) => e.status === 'confirmed') };
  }

  const fail = (r) => ({ value: null, confirmed: false, reason: r.reason });
  const label = (name, raw) => entries.get(name)?.values?.[raw] ?? 'unknown';
  const movieSamples = []; // the last MOVIE_WINDOW movieFrame reads, oldest first

  return {
    active: gate.active,
    inactiveReason: gate.reason,
    table,

    /**
     * { value: { mode: 'field'|'battle'|'world'|'menu'|'minigame'|'movie'|'unknown', raw, previous } }
     * confirmed only for confirmed raw values (#76: field 1, battle 2, menu 5;
     * #80: world 3, minigame 6 = the motorcycle game; an unlabelled value,
     * such as another minigame, is 'unknown', never confirmed). 'movie' is reported while gameState reads field and
     * movieFrame advanced over the last MOVIE_WINDOW calls; raw stays 1. Each
     * call is one sample, so call it at a steady rate (the overlay: 4 Hz).
     */
    async mode() {
      const r = await read(['gameState', 'prevGameState']);
      if (!r.values) return fail(r);
      // A table without movieFrame (or a failed read) just never reports a movie.
      const m = await read(['movieFrame']);
      movieSamples.push(m.values ? m.values.movieFrame : null);
      if (movieSamples.length > MOVIE_WINDOW) movieSamples.shift();
      const { gameState: raw, prevGameState: prev } = r.values;
      const previous = label('prevGameState', prev);
      if (raw === MOVIE_GAME_STATE && m.values && movieAdvancing(movieSamples)) {
        return { value: { mode: 'movie', raw, previous }, confirmed: r.confirmed && m.confirmed };
      }
      return { value: { mode: label('gameState', raw), raw, previous }, confirmed: r.confirmed };
    },

    /**
     * Forget the movieFrame samples mode() looks back over (#107). The overlay
     * calls it each time it starts polling, so samples taken before it was
     * switched off can't make the first new ones read as a movie.
     */
    clearMovieWindow() {
      movieSamples.length = 0;
    },

    /** { value: field id } */
    async fieldId() {
      const r = await read(['fieldId']);
      return r.values ? { value: r.values.fieldId, confirmed: r.confirmed } : fail(r);
    },

    /**
     * { value: { x, y, model } }: the position of field model `model`
     * (playerModel, g_PlayerModelId), the player (#99). Confirmed only if
     * the model index read is a confirmed one (0 so far) and the position
     * entries are confirmed.
     */
    async playerPosition() {
      const m = await read(['playerModel']);
      if (!m.values) return fail(m);
      const model = m.values.playerModel;
      const r = await read(['fieldX', 'fieldY'], model);
      if (!r.values) return fail(r);
      return { value: { x: r.values.fieldX, y: r.values.fieldY, model }, confirmed: m.confirmed && r.confirmed };
    },

    /** { value: cursor index } */
    async menuCursor() {
      const r = await read(['menuCursor']);
      return r.values ? { value: r.values.menuCursor, confirmed: r.confirmed } : fail(r);
    },

    /** { value: [id|null, id|null, id|null] }; 0xFF (empty slot) is null */
    async party() {
      const r = await read(['partySlot0', 'partySlot1', 'partySlot2']);
      if (!r.values) return fail(r);
      const ids = [r.values.partySlot0, r.values.partySlot1, r.values.partySlot2].map((id) => (id === 0xff ? null : id));
      return { value: ids, confirmed: r.confirmed };
    },

    /**
     * #130: { value: { hp, maxHp, mp, maxMp, limit, atb } } for party slot
     * 0-2. A field is null unless its address entry (and the game state that
     * picks it) is confirmed, or when it can't be read. In battle (gameState
     * 2) limit and atb come from the battle's own copies (partyLimit,
     * partyAtb); elsewhere limit is the character record's (characterLimit,
     * for characters 0-8) and atb is null. An empty slot (0xFF) gives value
     * null with reason 'empty slot'. confirmed: the slot and game state reads
     * were confirmed.
     */
    async partyStatus(slot) {
      if (!(Number.isInteger(slot) && slot >= 0 && slot <= 2)) return { value: null, confirmed: false, reason: 'out of range' };
      const p = await read([`partySlot${slot}`]);
      if (!p.values) return fail(p);
      const id = p.values[`partySlot${slot}`];
      if (id === 0xff) return { value: null, confirmed: p.confirmed, reason: 'empty slot' };
      const g = await read(['gameState']);
      if (!g.values) return fail(g);
      const inBattle = g.confirmed && g.values.gameState === BATTLE_GAME_STATE;
      // Only confirmed values are reported; a hypothesis or a failed read is null.
      const one = async (name, index = 0) => {
        const r = await read([name], index);
        return r.values && r.confirmed ? r.values[name] : null;
      };
      const value = {
        hp: await one(`partyHp${slot}`),
        maxHp: await one(`partyMaxHp${slot}`),
        mp: await one(`partyMp${slot}`),
        maxMp: await one(`partyMaxMp${slot}`),
        limit: null,
        atb: null,
      };
      if (inBattle) {
        value.limit = await one(`partyLimit${slot}`);
        value.atb = await one(`partyAtb${slot}`);
      } else if (g.confirmed && id < CHARACTER_RECORDS) {
        value.limit = await one('characterLimit', id);
      }
      return { value, confirmed: p.confirmed && g.confirmed };
    },

    /**
     * #108: message window 0. { value: { open, waiting, choice: null | { row } } }.
     * open: a window shows (state not 0). waiting: it waits for Circle (the
     * text has finished, not still typing). choice: a choice window waiting
     * for a pick, with row = the pointer's line in the window (0 = the
     * window's first line; options under a question start at 1 or more).
     * As in partyStatus, choice is reported only from confirmed entries:
     * until dialogPointer and dialogPointerY are confirmed (#168) it is
     * always null, and a choice window reads as a plain waiting message.
     * confirmed: the state read is a confirmed value (0 closed, 6 done).
     */
    async dialogue() {
      const s = await read(['dialogState']);
      if (!s.values) return fail(s);
      const raw = s.values.dialogState;
      const open = raw !== 0;
      const waiting = WINDOW_WAITING_STATES.includes(raw);
      let choice = null;
      const pointerConfirmed = ['dialogPointer', 'dialogPointerY'].every((n) => entries.get(n)?.status === 'confirmed');
      if (raw === WINDOW_TXT_DONE && pointerConfirmed) {
        const p = await read(['dialogPointer', 'dialogPointerY']);
        if (p.values && p.confirmed && p.values.dialogPointer === 1) {
          choice = { row: Math.floor((p.values.dialogPointerY - WINDOW_POINTER_Y0) / WINDOW_LINE_HEIGHT) };
        }
      }
      return { value: { open, waiting, choice }, confirmed: s.confirmed };
    },

    /**
     * #110: the battle menu. { value: { actor, row, targeting: null | { index } } }.
     * actor: the party slot (0-2) whose command menu is open, null when none
     * is (or not in battle). row: that slot's command cursor row. targeting:
     * target selection is showing, with index = the unit the cursor is on.
     * As in partyStatus, every field comes only from confirmed entries and is
     * null otherwise. confirmed: the game state and widget reads were
     * confirmed values.
     */
    async battleInput() {
      const none = { actor: null, row: null, targeting: null };
      const g = await read(['gameState']);
      if (!g.values) return fail(g);
      if (!(g.confirmed && g.values.gameState === BATTLE_GAME_STATE)) return { value: none, confirmed: g.confirmed, reason: 'not in battle' };
      const w = await read(['battleMenuWidget']);
      if (!w.values) return fail(w);
      if (!w.confirmed) return { value: none, confirmed: false };
      const widget = w.values.battleMenuWidget;
      if (widget === BATTLE_WIDGET_NONE) return { value: none, confirmed: true };
      const one = async (name, index = 0) => {
        const r = await read([name], index);
        return r.values && r.confirmed ? r.values[name] : null;
      };
      const actor = await one('battleActor');
      const value = { actor: actor !== null && actor <= 2 ? actor : null, row: null, targeting: null };
      if (value.actor !== null) value.row = await one(`battleCommandRow${value.actor}`);
      if (widget === BATTLE_WIDGET_TARGET) {
        const index = await one('battleTarget');
        value.targeting = index === null ? null : { index };
      }
      return { value, confirmed: true };
    },

    /**
     * #117: the item inventory. { value: [{ slot, index, quantity, kind, number }] }
     * for each non-empty slot, in slot order (semantic/inventory.js
     * decodeItem). IDs only: names are game data.
     */
    async inventory() {
      const e = entries.get('inventorySlot');
      const r = await readRun('inventorySlot', 0, e?.count ?? 0);
      if (!r.values) return fail(r);
      const value = [];
      r.values.forEach((word, slot) => {
        const it = decodeItem(word);
        if (it) value.push({ slot, ...it });
      });
      return { value, confirmed: r.confirmed };
    },

    /** #117: the materia inventory. { value: [{ slot, id, ap }] } for each non-empty slot, in slot order. */
    async materia() {
      const e = entries.get('materiaSlot');
      const r = await readRun('materiaSlot', 0, e?.count ?? 0);
      if (!r.values) return fail(r);
      const value = [];
      r.values.forEach((word, slot) => {
        const m = decodeMateria(word);
        if (m) value.push({ slot, ...m });
      });
      return { value, confirmed: r.confirmed };
    },

    /**
     * #117: the equipment of the character in party slot 0-2.
     * { value: { record, weapon, armor, accessory, weaponMateria, armorMateria } }:
     * weapon, armor and accessory are numbers within their kind (accessory
     * null for none); the materia lists hold one { id, ap } or null per slot.
     * An empty party slot gives value null with reason 'empty slot'; a
     * character without a record of its own (IDs 9-11) reason 'no record'.
     * confirmed: every read was a confirmed entry.
     */
    async equipment(slot) {
      if (!(Number.isInteger(slot) && slot >= 0 && slot <= 2)) return { value: null, confirmed: false, reason: 'out of range' };
      const p = await read([`partySlot${slot}`]);
      if (!p.values) return fail(p);
      const record = p.values[`partySlot${slot}`];
      if (record === 0xff) return { value: null, confirmed: p.confirmed, reason: 'empty slot' };
      if (record >= CHARACTER_RECORDS) return { value: null, confirmed: p.confirmed, reason: 'no record' };
      const eq = await read(['characterWeapon', 'characterArmor', 'characterAccessory'], record);
      if (!eq.values) return fail(eq);
      const wm = await readRun('characterWeaponMateria', record, RECORD_WEAPON_MATERIA_SLOTS);
      if (!wm.values) return fail(wm);
      const am = await readRun('characterArmorMateria', record, RECORD_ARMOR_MATERIA_SLOTS);
      if (!am.values) return fail(am);
      const acc = eq.values.characterAccessory;
      return {
        value: {
          record,
          weapon: eq.values.characterWeapon,
          armor: eq.values.characterArmor,
          accessory: acc === ACCESSORY_NONE ? null : acc,
          weaponMateria: wm.values.map(decodeMateria),
          armorMateria: am.values.map(decodeMateria),
        },
        confirmed: p.confirmed && eq.confirmed && wm.confirmed && am.confirmed,
      };
    },

    /**
     * #112: what is around the player in a settled field: semantic/nearby.js
     * nearbyFrom's list ({ kind: 'npc'|'exit'|'unknown', dx, dy, inRange, ... },
     * nearest first; 'save' is not reported yet). Outside a settled field
     * (gameState not field, or g_IsFieldLoading not 2) value is [] with
     * reason 'not in field'. confirmed: every entry read is confirmed (none
     * of #112's are yet: notes/112-field-interactables.md).
     */
    async nearby() {
      const g = await read(['gameState', 'fieldLoading']);
      if (!g.values) return fail(g);
      if (g.values.gameState !== FIELD_GAME_STATE || g.values.fieldLoading !== FIELD_SETTLED) {
        return { value: [], confirmed: g.confirmed, reason: 'not in field' };
      }
      const c = await read(['playerModel', 'fieldModelCount']);
      if (!c.values) return fail(c);
      const { playerModel: p, fieldModelCount: n } = c.values;
      if (!(n >= 1 && n <= 16 && p >= 0 && p < n)) return { value: null, confirmed: false, reason: 'out of range' };
      const m = await readArrays(['fieldX', 'fieldY', 'fieldZ', 'fieldDir', 'fieldSolidRange', 'fieldTalkOff', 'fieldTalkRange'], n);
      if (!m.values) return fail(m);
      const v = m.values;
      const models = v.fieldX.map((x, i) => ({
        x: fieldUnits(x), y: fieldUnits(v.fieldY[i]), z: fieldUnits(v.fieldZ[i]), talkOff: v.fieldTalkOff[i] !== 0, talkRange: v.fieldTalkRange[i],
      }));
      const player = { ...models[p], dir: v.fieldDir[p], solidRange: v.fieldSolidRange[p], model: p };
      const t = await read(['fieldTriggers']);
      if (!t.values) return fail(t);
      const at = t.values.fieldTriggers + FIELD_GATEWAYS.offset;
      const len = FIELD_GATEWAYS.count * FIELD_GATEWAYS.size;
      if (!(at >= RAM_START && at + len <= RAM_END)) return { value: null, confirmed: false, reason: 'out of range' };
      let bytes;
      try {
        bytes = await backend.readMem(at, len);
      } catch {
        return fail({ reason: 'read failed' });
      }
      if (!bytes || bytes.length !== len) return fail({ reason: 'read failed' });
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const gateways = [];
      for (let i = 0; i < FIELD_GATEWAYS.count; i++) {
        const o = i * FIELD_GATEWAYS.size;
        const s16 = (k) => view.getInt16(o + 2 * k, true);
        gateways.push({ x1: s16(0), y1: s16(1), z1: s16(2), x2: s16(3), y2: s16(4), z2: s16(5), to: view.getUint16(o + FIELD_GATEWAYS.to, true) });
      }
      return { value: nearbyFrom({ player, models, gateways }), confirmed: g.confirmed && c.confirmed && m.confirmed && t.confirmed };
    },

    /** { value: [hp, hp, hp] } for party slots 0 to 2 (meaningless for an empty slot: see party()) */
    async partyHp() {
      const r = await read(['partyHp0', 'partyHp1', 'partyHp2']);
      return r.values ? { value: [r.values.partyHp0, r.values.partyHp1, r.values.partyHp2], confirmed: r.confirmed } : fail(r);
    },
  };
}

/**
 * Hash the boot executable of an opened ISO and build the layer: the gate
 * as the app uses it. A disc that can't be read leaves the layer off.
 */
export async function activateSemantic({ iso, backend, table = ADDRESS_TABLE }) {
  let exeSha1 = null;
  try {
    exeSha1 = await bootExeSha1(iso);
  } catch {
    // unreadable disc or no Web Crypto: the layer stays off
  }
  return createSemantic({ backend, exeSha1, table });
}
