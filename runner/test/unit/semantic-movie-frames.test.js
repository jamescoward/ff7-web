// Unit: mode()'s movie window counts game frames when the backend gives a
// frame number (#146), so the answer does not depend on the polling rate.
// Synthetic memory images only; no core, no game data.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ADDRESS_TABLE } from '../../../semantic/addresses.js';
import { MOVIE_SPAN_FRAMES, MOVIE_WINDOW, createSemantic, pushMovieSample } from '../../../semantic/layer.js';

const GAME_STATE = 0x8009c560;
const PREV_STATE = 0x800965ec;
const MOVIE_FRAME = 0x80071740;
const off = (a) => a & 0x1fffffff;

/**
 * A synthetic game: gameState field, and movieFrame advancing by one every
 * 4 frames from `start` to `stop` (as the game's counter does, #76), held
 * after. `frame` is a getter, as on the runner and web backends; `frame:
 * false` leaves it out.
 */
function game({ start = 100, stop = 400, from = 1000, frame = true, stray = [] } = {}) {
  const bytes = new Uint8Array(0x200000);
  const view = new DataView(bytes.buffer);
  view.setInt16(off(GAME_STATE), 1, true);
  view.setInt16(off(PREV_STATE), 5, true);
  let now = 0;
  const counter = (f) => (stray.includes(f) ? 0 : from + Math.floor((Math.min(Math.max(f, start), stop) - start) / 4));
  const backend = {
    readMem(a, len) {
      view.setUint32(off(MOVIE_FRAME), counter(now), true);
      return bytes.slice(off(a), off(a) + len);
    },
    writeMem: () => assert.fail('writeMem called'),
  };
  if (frame) Object.defineProperty(backend, 'frame', { get: () => now });
  return { backend, setFrame(f) { now = f; } };
}

const layerOver = (backend) => createSemantic({ backend, exeSha1: ADDRESS_TABLE.exe, table: ADDRESS_TABLE });

/** Poll mode() every `every` frames from 0 to `end`; a Map frame -> mode label. */
async function pollEvery(every, opts, end = 600) {
  const g = game(opts);
  const layer = layerOver(g.backend);
  const out = new Map();
  for (let f = 0; f <= end; f += every) {
    g.setFrame(f);
    out.set(f, (await layer.mode()).value.mode);
  }
  return out;
}

describe('mode() with a frame number (#146)', () => {
  test('a movie is reported the same polled every frame, every 4 frames and every 15 frames', async () => {
    const rates = [1, 4, 15];
    const runs = await Promise.all(rates.map((r) => pollEvery(r)));
    // Compare on the frames every rate sampled (multiples of 60).
    for (let f = 0; f <= 600; f += 60) {
      const labels = runs.map((m) => m.get(f));
      assert.ok(labels.every((l) => l === labels[0]), `frame ${f}: ${labels.join(', ')} for rates ${rates.join(', ')}`);
    }
    // Well inside the movie it is a movie; well before and after it is field.
    for (const m of runs) {
      assert.equal(m.get(0), 'field');
      assert.equal(m.get(180), 'movie');
      assert.equal(m.get(300), 'movie');
      assert.equal(m.get(540), 'field');
    }
  });

  test('a movie ends within MOVIE_SPAN_FRAMES frames at every rate', async () => {
    for (const every of [1, 4, 15]) {
      const m = await pollEvery(every, { stop: 300 });
      const after = [...m].filter(([f, l]) => f > 300 + MOVIE_SPAN_FRAMES && l === 'movie');
      assert.deepEqual(after, [], `rate ${every}`);
    }
  });

  test('a stuck counter is not a movie at any rate, even with stray 0 reads', async () => {
    for (const every of [1, 2, 4, 15, 30]) {
      const m = await pollEvery(every, { start: 0, stop: 0, from: 1790, stray: [120, 240, 241] });
      assert.deepEqual([...new Set(m.values())], ['field'], `rate ${every}`);
    }
  });

  test('polled less often than every 30 frames, the window holds one sample and reports no movie', async () => {
    const m = await pollEvery(61, { start: 0, stop: 600 });
    assert.deepEqual([...new Set(m.values())], ['field']);
  });

  test('a frame number that goes back (reset, loaded state) starts a new window', async () => {
    const g = game({ start: 0, stop: 200 });
    const layer = layerOver(g.backend);
    for (let f = 100; f <= 150; f += 10) { g.setFrame(f); await layer.mode(); }
    assert.equal((await layer.mode()).value.mode, 'movie');
    // Back to frame 10: the samples from frames 100-150 would otherwise stay in the window.
    g.setFrame(10);
    assert.equal((await layer.mode()).value.mode, 'field', 'one sample after going back');
    g.setFrame(20);
    assert.equal((await layer.mode()).value.mode, 'movie');
  });

  test('clearMovieWindow (#107) still forgets the samples', async () => {
    const g = game({ start: 0, stop: 1000 });
    const layer = layerOver(g.backend);
    for (let f = 0; f <= 60; f += 15) { g.setFrame(f); await layer.mode(); }
    assert.equal((await layer.mode()).value.mode, 'movie');
    layer.clearMovieWindow();
    g.setFrame(75);
    assert.equal((await layer.mode()).value.mode, 'field', 'one sample after the clear');
    g.setFrame(90);
    assert.equal((await layer.mode()).value.mode, 'movie');
  });
});

describe('mode() without a frame number keeps the per-call window', () => {
  test('a backend with no frame counts calls (MOVIE_WINDOW samples), whatever the frames between them', async () => {
    const g = game({ frame: false, start: 0, stop: 10_000 });
    const layer = layerOver(g.backend);
    // One call per 4 frames is a movie; then MOVIE_WINDOW calls on a held counter end it.
    for (let f = 0; f < 20; f += 4) { g.setFrame(f); await layer.mode(); }
    g.setFrame(20);
    assert.equal((await layer.mode()).value.mode, 'movie');
    const held = game({ frame: false, start: 0, stop: 0 });
    const layer2 = layerOver(held.backend);
    for (let i = 0; i < MOVIE_WINDOW + 1; i++) assert.equal((await layer2.mode()).value.mode, 'field');
  });

  test('a non-integer, negative or throwing frame is treated as no frame number', async () => {
    const bad = [undefined, null, -1, 1.5, '12', NaN, () => { throw new Error('no frame'); }];
    for (const v of bad) {
      const g = game({ frame: false, start: 0, stop: 10_000 });
      Object.defineProperty(g.backend, 'frame', { get: typeof v === 'function' ? v : () => v });
      const layer = layerOver(g.backend);
      // Two calls 4 frames apart see an advance: per call that is a movie. Had the bad
      // value been taken as one frame number, the second read would replace the first.
      g.setFrame(0); assert.equal((await layer.mode()).value.mode, 'field', String(v));
      g.setFrame(4); assert.equal((await layer.mode()).value.mode, 'movie', String(v));
    }
  });
});

describe('pushMovieSample', () => {
  test('per call: keeps the last MOVIE_WINDOW values', () => {
    const s = [];
    for (let i = 0; i < 8; i++) pushMovieSample(s, null, i);
    assert.deepEqual(s.map((x) => x.value), [3, 4, 5, 6, 7]);
  });

  test('per frame: keeps frames within MOVIE_SPAN_FRAMES, the current one included', () => {
    const s = [];
    for (let f = 0; f <= 120; f += 15) pushMovieSample(s, f, f);
    assert.deepEqual(s.map((x) => x.frame), [60, 75, 90, 105, 120]);
  });

  test('a second read on the same frame replaces the first', () => {
    const s = [];
    pushMovieSample(s, 10, 1);
    pushMovieSample(s, 10, 2);
    assert.deepEqual(s, [{ frame: 10, value: 2 }]);
  });

  test('a frame that goes back, or a switch between having and not having a frame, starts a new window', () => {
    const s = [];
    pushMovieSample(s, 50, 1);
    pushMovieSample(s, 40, 2);
    assert.deepEqual(s, [{ frame: 40, value: 2 }]);
    pushMovieSample(s, null, 3);
    assert.deepEqual(s, [{ frame: null, value: 3 }]);
    pushMovieSample(s, 41, 4);
    assert.deepEqual(s, [{ frame: 41, value: 4 }]);
  });
});
