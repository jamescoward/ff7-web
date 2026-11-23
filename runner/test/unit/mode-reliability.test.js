// Unit: the M2 exit mode-detection set (#81). Original project code, GPL-2.0-or-later.
//
// Owner decision on #81 (2026-11-18): Tier 2 scenarios check the raw inputs
// semantic/layer.js mode() reads (gameState, prevGameState, movieFrame) at
// each point, and this Tier 1 test feeds those checked values to mode() and
// checks its answer. The claim is "the inputs are right in the real game
// (Tier 2), and mode() is right given those inputs (here)".
//
// For every point below, the test reads the committed scenario and takes the
// values from its own checks (so the set cannot drift from what Tier 2
// checks), then replays them into mode() over a synthetic RAM image. No core,
// no game data.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ADDRESS_TABLE } from '../../../semantic/addresses.js';
import { MOVIE_SPAN_FRAMES, createSemantic } from '../../../semantic/layer.js';
import { MAX_METRICS, findTier2Scenarios } from '../../tier2.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SCENARIOS = path.join(ROOT, 'harness/scenarios');

const addrOf = (name) => ADDRESS_TABLE.entries.find((e) => e.name === name).address;
const GAME_STATE = addrOf('gameState');
const PREV_STATE = addrOf('prevGameState');
const MOVIE_FRAME = addrOf('movieFrame');

/** Stframe_no's held value after the opening movie ends (movie-3-end, movie-3a). */
const MOVIE_HELD = 1790;

/**
 * The set. `kind` is 'after' for a point just after a transition (the
 * scenario waits for the first frame of the new mode, then checks it 60
 * frames later) and 'settled' for a point well inside a mode. `prev` is the
 * prevGameState the scenario checks, when it checks one.
 */
export const MODE_SET = [
  { file: 'reactor-mode-1-field.json', mode: 'field', kind: 'settled', prev: 0 },
  { file: 'reactor-mode-3a-field-just-after-menu.json', mode: 'field', kind: 'after', prev: 5 },
  { file: 'reactor-mode-5a-field-just-after-battle.json', mode: 'field', kind: 'after', prev: 2 },
  { file: 'movie-3a-field-just-after-movie.json', mode: 'field', kind: 'after' },
  { file: 'reactor-mode-2-menu-open.json', mode: 'menu', kind: 'settled', prev: 1 },
  { file: 'reactor-mode-2a-menu-just-open.json', mode: 'menu', kind: 'after', prev: 1 },
  { file: 'reactor-mode-2e-party-menu.json', mode: 'menu', kind: 'settled' },
  { file: 'reactor-mode-4-battle.json', mode: 'battle', kind: 'settled', prev: 1 },
  { file: 'reactor-mode-4i-battle-just-started.json', mode: 'battle', kind: 'after', prev: 1 },
  { file: 'save-boot-11-party-stats-battle.json', mode: 'battle', kind: 'settled' },
  { file: 'save-boot-7-world-kalm.json', mode: 'world', kind: 'settled' },
  { file: 'save-boot-8-world-midgar.json', mode: 'world', kind: 'settled' },
  { file: 'save-boot-7a-world-just-loaded.json', mode: 'world', kind: 'after' },
  { file: 'save-boot-9-highway.json', mode: 'minigame', kind: 'settled' },
  { file: 'save-boot-9a-highway-just-loaded.json', mode: 'minigame', kind: 'after' },
  { file: 'movie-1a-just-started.json', mode: 'movie', kind: 'after' },
  { file: 'movie-2a-playing-window.json', mode: 'movie', kind: 'settled' },
];

const MODES = ['field', 'battle', 'menu', 'world', 'minigame', 'movie'];

const load = (file) => JSON.parse(readFileSync(path.join(SCENARIOS, file), 'utf8'));

/** The scenario's memory name for an address, or undefined. */
function memName(doc, address) {
  return Object.entries(doc.memory ?? {}).find(([, m]) => Number(m.addr) === address)?.[0];
}

/** The value an end-of-script `expect … equals` check holds the location to, or undefined. */
function expectedEquals(doc, name) {
  if (!name) return undefined;
  return (doc.assert ?? []).find((a) => a.expect?.mem === name && 'equals' in a.expect)?.expect.equals;
}

/** A `change` check on the location, or undefined. */
function changeCheck(doc, name) {
  if (!name) return undefined;
  return (doc.assert ?? []).find((a) => a.change?.mem === name)?.change;
}

/** Frames waited after a mark, from plain `wait.frames` steps and button steps. */
function framesAfterMark(doc, mark) {
  const steps = doc.input ?? [];
  const at = steps.findIndex((s) => s.mark === mark);
  assert.ok(at >= 0, `mark ${mark} missing`);
  let n = 0;
  for (const s of steps.slice(at + 1)) {
    if (s.wait?.frames !== undefined) n += s.wait.frames;
    else if (s.buttons) n += s.frames;
    else assert.fail(`step after mark ${mark} is not a fixed-length step: ${JSON.stringify(s)}`);
  }
  return n;
}

/**
 * What the scenario's checks say movieFrame did over the end of the script:
 * 'advancing', 'still', or null (not checked). A change check must span at
 * least mode()'s window (MOVIE_SPAN_FRAMES) to count.
 */
function movieEvidence(doc) {
  const name = memName(doc, MOVIE_FRAME);
  const c = changeCheck(doc, name);
  if (c) {
    assert.ok(c.since, 'a movie change check must be since a mark');
    assert.ok(framesAfterMark(doc, c.since) >= MOVIE_SPAN_FRAMES, `${doc.name}: movie window shorter than ${MOVIE_SPAN_FRAMES} frames`);
    if (c.is === 'increased') return 'advancing';
    if (c.is === 'unchanged') return 'still';
  }
  if (expectedEquals(doc, name) === MOVIE_HELD) return 'still';
  return null;
}

/** The raw values a point's Tier 2 checks establish. */
function rawOf(point) {
  const doc = load(point.file);
  assert.equal(doc.tier, 2, `${point.file} is not a Tier 2 scenario`);
  const gameState = expectedEquals(doc, memName(doc, GAME_STATE));
  const prev = expectedEquals(doc, memName(doc, PREV_STATE));
  return { doc, gameState, prev, movie: movieEvidence(doc) };
}

/** A synthetic RAM holding the three mode addresses, with a frame counter. */
function ram() {
  const bytes = new Uint8Array(0x200000);
  const view = new DataView(bytes.buffer);
  const off = (a) => a & 0x1fffffff;
  return {
    frame: 0,
    set(state, prev, movie) {
      view.setInt16(off(GAME_STATE), state, true);
      view.setInt16(off(PREV_STATE), prev, true);
      view.setUint32(off(MOVIE_FRAME), movie, true);
    },
    readMem: (a, len) => bytes.slice(off(a), off(a) + len),
    writeMem: () => assert.fail('writeMem called'),
  };
}

/**
 * Replay a point into mode(): poll every 15 frames (the overlay's 4 Hz) over
 * one MOVIE_SPAN_FRAMES window, with movieFrame advancing (15 a second, as a
 * PS1 movie streams) or held, and return the last answer.
 */
async function replay({ gameState, prev, movie }) {
  const mem = ram();
  const layer = createSemantic({ backend: mem, exeSha1: ADDRESS_TABLE.exe });
  let r;
  for (let f = 0; f <= MOVIE_SPAN_FRAMES; f += 15) {
    mem.frame = f;
    mem.set(gameState, prev ?? 1, movie === 'advancing' ? 100 + f / 4 : MOVIE_HELD);
    r = await layer.mode();
  }
  return r;
}

describe('#81 mode-detection set: each point\'s Tier 2 checks, fed to mode()', () => {
  for (const point of MODE_SET) {
    test(`${point.file}: ${point.mode} (${point.kind})`, async () => {
      const raw = rawOf(point);
      assert.notEqual(raw.gameState, undefined, 'the scenario checks no gameState value');
      if (point.prev !== undefined) assert.equal(raw.prev, point.prev, 'prevGameState check');
      // movieFrame only matters while gameState reads field: there the set needs evidence either way.
      if (raw.gameState === 1) assert.notEqual(raw.movie, null, 'a field-state point must check movieFrame');
      const r = await replay(raw);
      assert.equal(r.value.mode, point.mode);
      assert.equal(r.value.raw, raw.gameState);
      if (point.prev !== undefined) assert.equal(r.confirmed, true, 'gameState and prevGameState values both confirmed');
    });
  }
});

describe('#81 mode-detection set: coverage', () => {
  test('every mode has at least two points, one of them just after a transition', () => {
    for (const mode of MODES) {
      const points = MODE_SET.filter((p) => p.mode === mode);
      assert.ok(points.length >= 2, `${mode}: ${points.length} points`);
      assert.ok(points.some((p) => p.kind === 'after'), `${mode}: no point just after a transition`);
    }
  });

  test('"after" points check 60 frames after the first frame of the new mode (or the movie\'s first or last frame)', () => {
    for (const point of MODE_SET.filter((p) => p.kind === 'after')) {
      const { doc } = rawOf(point);
      const steps = doc.input;
      const mark = steps.findIndex((s) => s.mark);
      assert.ok(mark >= 0, `${point.file}: no mark`);
      assert.ok(mark === 0 || steps[mark - 1].wait?.until, `${point.file}: the mark must follow the transition wait`);
      assert.equal(framesAfterMark(doc, steps[mark].mark), MOVIE_SPAN_FRAMES, point.file);
    }
  });

  test('the whole set runs in one Tier 2 run and reports within the metric limit', () => {
    const found = new Map(findTier2Scenarios(SCENARIOS).map((s) => [path.basename(s.file), s]));
    for (const point of MODE_SET) {
      assert.ok(found.has(point.file), `${point.file} not in the Tier 2 run`);
      assert.ok(load(point.file).metrics.length <= MAX_METRICS, point.file);
    }
    assert.ok(MODE_SET.length <= 32, 'the contract allows at most 32 scenarios in the set');
  });

  test('a movie point is told from a field point only by movieFrame (the replay is not vacuous)', async () => {
    assert.equal((await replay({ gameState: 1, prev: 0, movie: 'advancing' })).value.mode, 'movie');
    assert.equal((await replay({ gameState: 1, prev: 0, movie: 'still' })).value.mode, 'field');
  });
});
