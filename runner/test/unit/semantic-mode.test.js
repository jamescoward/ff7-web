// Unit: mode() honours per-value confirmation and reports movies (#92), on
// synthetic memory images. No core, no game data.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ADDRESS_TABLE, EXE_USA_SHA1, makeTable } from '../../../semantic/addresses.js';
import { MOVIE_WINDOW, createSemantic, movieAdvancing, valueConfirmed } from '../../../semantic/layer.js';

const GAME_STATE = 0x8009c560;
const PREV_STATE = 0x800965ec;
const MOVIE_FRAME = 0x80071740;

/** A mutable synthetic RAM (the shipped table's three mode addresses) and readMem over it. */
function ram({ state = 1, prev = 5, movie = 0 } = {}) {
  const bytes = new Uint8Array(0x200000);
  const view = new DataView(bytes.buffer);
  const off = (a) => a & 0x1fffffff;
  const mem = {
    set state(v) { view.setInt16(off(GAME_STATE), v, true); },
    set prev(v) { view.setInt16(off(PREV_STATE), v, true); },
    set movie(v) { view.setUint32(off(MOVIE_FRAME), v, true); },
    readMem: (a, len) => bytes.slice(off(a), off(a) + len),
    writeMem: () => assert.fail('writeMem called'),
  };
  Object.assign(mem, { state, prev, movie });
  return mem;
}

const layerOver = (backend, table = ADDRESS_TABLE) => createSemantic({ backend, exeSha1: table.exe, table });

/** Call mode() once per value of the movie counter; return the last result. */
async function sampleMovie(layer, mem, frames) {
  let r;
  for (const f of frames) {
    mem.movie = f;
    r = await layer.mode();
  }
  return r;
}

describe('mode(): confirmation per raw value (shipped table)', () => {
  test('field 1, battle 2, world 3, menu 5 and minigame 6 are confirmed; anything else is unknown and unconfirmed', async () => {
    for (const [raw, mode, confirmed] of [[1, 'field', true], [2, 'battle', true], [5, 'menu', true], [3, 'world', true],
      [6, 'minigame', true], [0, 'unknown', false], [4, 'unknown', false], [7, 'unknown', false], [-1, 'unknown', false]]) {
      const layer = layerOver(ram({ state: raw, prev: 1 }));
      assert.deepEqual(await layer.mode(), { value: { mode, raw, previous: 'field' }, confirmed }, `raw ${raw}`);
    }
  });

  test('the previous mode follows the same rule: an unconfirmed previous value leaves the result unconfirmed', async () => {
    assert.equal((await layerOver(ram({ state: 1, prev: 2 })).mode()).confirmed, true);
    assert.deepEqual(await layerOver(ram({ state: 1, prev: 3 })).mode(), { value: { mode: 'field', raw: 1, previous: 'world' }, confirmed: false });
    // 0 before the first mode change of a new game: no label, so not confirmed.
    assert.deepEqual(await layerOver(ram({ state: 1, prev: 0 })).mode(), { value: { mode: 'field', raw: 1, previous: 'unknown' }, confirmed: false });
  });

  test('valueConfirmed: status, then labels, then confirmedValues', () => {
    const state = ADDRESS_TABLE.entries.find((e) => e.name === 'gameState');
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((v) => valueConfirmed(state, v)), [true, true, true, false, true, true, false]);
    const base = { name: 'x', status: 'confirmed', values: { 1: 'a', 2: 'b' } };
    assert.equal(valueConfirmed(base, 2), true, 'no confirmedValues: every labelled value of a confirmed entry');
    assert.equal(valueConfirmed(base, 3), false, 'an unlabelled value is never confirmed');
    assert.equal(valueConfirmed({ ...base, status: 'hypothesis' }, 1), false);
    assert.equal(valueConfirmed({ name: 'n', status: 'confirmed' }, 12345), true, 'a plain number entry');
  });
});

describe('mode(): movies (movieFrame advancing while gameState reads field)', () => {
  test('a counter that advances gives movie, confirmed, with raw still 1', async () => {
    const mem = ram({ state: 1, prev: 0 });
    const layer = layerOver(mem);
    const r = await sampleMovie(layer, mem, [100, 104, 108]);
    assert.deepEqual(r.value, { mode: 'movie', raw: 1, previous: 'unknown' });
    // prev 0 is unlabelled (the opening of a new game), so this one is not confirmed; with a confirmed previous it is.
    const mem2 = ram({ state: 1, prev: 5 });
    assert.deepEqual(await sampleMovie(layerOver(mem2), mem2, [100, 104]), { value: { mode: 'movie', raw: 1, previous: 'menu' }, confirmed: true });
  });

  test('a single sample is never a movie', async () => {
    const mem = ram({ state: 1, movie: 500 });
    assert.equal((await layerOver(mem).mode()).value.mode, 'field');
  });

  test('a stuck counter is not a movie (1790 after the opening), even with a stray 0', async () => {
    const mem = ram({ state: 1 });
    const layer = layerOver(mem);
    assert.equal((await sampleMovie(layer, mem, [1790, 1790, 1790, 1790, 1790, 1790])).value.mode, 'field');
    assert.equal((await sampleMovie(layer, mem, [0])).value.mode, 'field');
    assert.equal((await sampleMovie(layer, mem, [1790])).value.mode, 'field');
  });

  test('0 before the movie is not a movie; the start is', async () => {
    const mem = ram({ state: 1 });
    const layer = layerOver(mem);
    assert.equal((await sampleMovie(layer, mem, [0, 0, 0])).value.mode, 'field');
    assert.equal((await sampleMovie(layer, mem, [1])).value.mode, 'field', 'one nonzero read is not yet an advance');
    assert.equal((await sampleMovie(layer, mem, [5])).value.mode, 'movie');
  });

  test('a counter that reads 0 on one sample mid-movie still counts as movie', async () => {
    const mem = ram({ state: 1, prev: 5 });
    const layer = layerOver(mem);
    assert.equal((await sampleMovie(layer, mem, [200, 204])).value.mode, 'movie');
    assert.deepEqual(await sampleMovie(layer, mem, [0]), { value: { mode: 'movie', raw: 1, previous: 'menu' }, confirmed: true }, 'the 0 sample itself');
    assert.equal((await sampleMovie(layer, mem, [212])).value.mode, 'movie', 'and the one after it');
  });

  test('a movie ends: once the counter holds still for the whole window, it is field again', async () => {
    const mem = ram({ state: 1 });
    const layer = layerOver(mem);
    assert.equal((await sampleMovie(layer, mem, [1780, 1785, 1790])).value.mode, 'movie');
    const held = [];
    for (let i = 0; i < MOVIE_WINDOW; i++) held.push((await sampleMovie(layer, mem, [1790])).value.mode);
    assert.equal(held.at(-1), 'field');
    assert.equal(held.indexOf('field'), MOVIE_WINDOW - 2, 'the advance 1785 -> 1790 leaves the window after MOVIE_WINDOW - 1 more samples');
  });

  test('a second movie that restarts the counter low is a movie once it advances', async () => {
    const mem = ram({ state: 1 });
    const layer = layerOver(mem);
    assert.equal((await sampleMovie(layer, mem, [1790, 1790, 3])).value.mode, 'field');
    assert.equal((await sampleMovie(layer, mem, [7])).value.mode, 'movie');
  });

  test('only the field state reports a movie', async () => {
    for (const state of [2, 3, 5, 0]) {
      const mem = ram({ state });
      const r = await sampleMovie(layerOver(mem), mem, [10, 14, 18]);
      assert.notEqual(r.value.mode, 'movie', `raw ${state}`);
      assert.equal(r.value.raw, state);
    }
  });

  test('without a movieFrame entry, or with a failing movieFrame read, mode() still answers and never says movie', async () => {
    const noMovie = makeTable(EXE_USA_SHA1, ADDRESS_TABLE.entries.filter((e) => e.name !== 'movieFrame').map(({ exe: _x, ...e }) => e));
    const mem = ram({ state: 1, prev: 5 });
    assert.deepEqual(await sampleMovie(layerOver(mem, noMovie), mem, [10, 14, 18]), { value: { mode: 'field', raw: 1, previous: 'menu' }, confirmed: true });

    const flaky = ram({ state: 1, prev: 5 });
    const backend = { readMem: (a, l) => { if (a === MOVIE_FRAME) throw new RangeError('boom'); return flaky.readMem(a, l); } };
    const layer = layerOver(backend);
    for (let i = 0; i < 3; i++) assert.deepEqual(await layer.mode(), { value: { mode: 'field', raw: 1, previous: 'menu' }, confirmed: true });
  });

  test('a movie is a hypothesis when movieFrame is', async () => {
    const hyp = makeTable(EXE_USA_SHA1, ADDRESS_TABLE.entries.map(({ exe: _x, ...e }) => {
      if (e.name !== 'movieFrame') return e;
      const { scenario: _s, ...rest } = e;
      return { ...rest, status: 'hypothesis' };
    }));
    const mem = ram({ state: 1, prev: 5 });
    assert.deepEqual(await sampleMovie(layerOver(mem, hyp), mem, [10, 14]), { value: { mode: 'movie', raw: 1, previous: 'menu' }, confirmed: false });
  });

  test('movieAdvancing skips 0 and failed reads', () => {
    assert.equal(movieAdvancing([]), false);
    assert.equal(movieAdvancing([5]), false);
    assert.equal(movieAdvancing([5, 6]), true);
    assert.equal(movieAdvancing([5, 0, 6]), true);
    assert.equal(movieAdvancing([5, null, 6]), true);
    assert.equal(movieAdvancing([6, 0, 6]), false);
    assert.equal(movieAdvancing([0, 0, 0]), false);
    assert.equal(movieAdvancing([9, 3]), false);
  });
});
