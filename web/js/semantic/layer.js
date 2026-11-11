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

import { ADDRESS_TABLE, TYPES, BATTLE_WIDGET_NONE, BATTLE_WIDGET_TARGET, WINDOW_WAITING_STATES, WINDOW_TXT_DONE, WINDOW_POINTER_Y0, WINDOW_LINE_HEIGHT } from './addresses.js';

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
