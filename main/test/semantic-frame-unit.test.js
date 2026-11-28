// Unit (no browser): every web frontend passes the backend's frame number to
// the semantic layer (#181), so mode()'s movie window counts game frames
// (#146) whatever the frontend's polling rate. Synthetic memory only; no core,
// no game data.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { AUTO_FLAG, createAutoControls } from '../js/auto-controls.js';
import { HUD_FLAG, createBattleHud } from '../js/battle-hud.js';
import { TAPS_FLAG, createDialogueTaps } from '../js/dialogue-taps.js';
import { createInputMixer } from '../js/pad.js';
import { ADDRESS_TABLE } from '../js/semantic/addresses.js';
import { createSemantic } from '../js/semantic/layer.js';

// The same synthetic game as runner/test/unit/semantic-movie-frames.test.js:
// gameState field, movieFrame advancing by one every 4 frames from `start` to
// `stop` and held after. Addresses come from the shipped table.
const addr = (name) => ADDRESS_TABLE.entries.find((e) => e.name === name).address;
const off = (a) => a & 0x1fffffff;

function game({ start = 100, stop = 400 } = {}) {
  const bytes = new Uint8Array(0x200000);
  const view = new DataView(bytes.buffer);
  view.setInt16(off(addr('gameState')), 1, true);
  view.setInt16(off(addr('prevGameState')), 5, true);
  let now = 0;
  const counter = (f) => 1000 + Math.floor((Math.min(Math.max(f, start), stop) - start) / 4);
  // Shaped like web/js/backend.js: async readMem over the worker, a `frame`
  // getter, and more that the semantic layer must not be handed.
  const backend = {
    async readMem(a, len) {
      view.setUint32(off(addr('movieFrame')), counter(now), true);
      return bytes.slice(off(a), off(a) + len);
    },
    get frame() { return now; },
    pad: () => assert.fail('pad called through the semantic wrapper'),
    setState: () => assert.fail('setState called through the semantic wrapper'),
  };
  return { backend, setFrame(f) { now = f; } };
}

function fakeTimers() {
  const intervals = new Set();
  return {
    intervals,
    setInterval(fn) { const h = { fn }; intervals.add(h); return h; },
    clearInterval(h) { intervals.delete(h); },
    setTimeout(fn) { return { fn }; },
    clearTimeout() {},
    /** Run every interval callback once and wait for it. */
    async tick() { for (const h of [...intervals]) await h.fn(); },
  };
}

const labsWith = (flag) => ({ isOn: (n) => n === flag, onChange() {} });

/** semanticFor that builds the real layer and keeps the wrapper and mode() results. */
function capture() {
  const seen = { wrapper: null, modes: [] };
  const semanticFor = (opts) => {
    seen.wrapper = opts.backend;
    const layer = createSemantic(opts);
    const mode = layer.mode.bind(layer);
    layer.mode = async () => {
      const r = await mode();
      seen.modes.push(r);
      return r;
    };
    return layer;
  };
  return { seen, semanticFor };
}

// Each frontend, built over a captured layer, with its flag on.
const FRONTENDS = {
  'auto-controls': (timers, semanticFor) => createAutoControls({
    controls: { setAuto() {} }, labs: labsWith(AUTO_FLAG), timers, semanticFor,
  }),
  'battle-hud': (timers, semanticFor) => createBattleHud({
    root: { hidden: true, ownerDocument: { documentElement: { toggleAttribute() {} } } },
    labs: labsWith(HUD_FLAG), timers, semanticFor,
  }),
  'dialogue-taps': (timers, semanticFor) => createDialogueTaps({
    target: { addEventListener() {} }, mixer: createInputMixer(() => {}), labs: labsWith(TAPS_FLAG), timers, semanticFor,
  }),
};

const settle = () => new Promise((r) => setImmediate(r));

/** Build a frontend over game(); waits out the first tick it runs on start, at frame 0. */
async function start(name) {
  const g = game();
  const timers = fakeTimers();
  const { seen, semanticFor } = capture();
  const ui = FRONTENDS[name](timers, semanticFor);
  ui.setBackend(g.backend);
  ui.setGate({ active: true });
  await settle();
  return { g, timers, seen, ui };
}

describe('the main-thread wrappers pass the frame number (#181)', () => {
  for (const name of Object.keys(FRONTENDS)) {
    test(`${name}: the wrapper is readMem plus an integer frame that follows the backend`, async () => {
      const { g, timers, seen } = await start(name);
      await timers.tick();
      assert.ok(seen.wrapper, 'the layer was built');
      // Read-only: nothing else of the backend reaches the layer.
      assert.deepEqual(Object.keys(seen.wrapper).sort(), ['frame', 'readMem']);
      for (const f of [0, 1, 15, 600, 12345]) {
        g.setFrame(f);
        assert.ok(Number.isInteger(seen.wrapper.frame));
        assert.equal(seen.wrapper.frame, f);
      }
    });
  }
});

describe('the movie report does not depend on the polling rate (#181)', () => {
  // 4 Hz at 60 fps is one poll every 15 frames; 20 Hz is every 3 frames.
  const RATES = { '4 Hz': 15, '20 Hz': 3 };

  /** Poll through the frontend's own interval: a Map frame -> mode label. */
  async function poll(name, every, end = 600) {
    const { g, timers, seen } = await start(name);
    const out = new Map();
    for (let f = 0; f <= end; f += every) {
      g.setFrame(f);
      const n = seen.modes.length;
      await timers.tick();
      assert.equal(seen.modes.length, n + 1, `one mode() call at frame ${f}`);
      out.set(f, seen.modes.at(-1).value.mode);
    }
    return out;
  }

  // dialogue-taps polls dialogue(), not mode(); its wrapper is checked above.
  for (const name of ['auto-controls', 'battle-hud']) {
    test(`${name}: a movie is reported at 4 Hz and 20 Hz alike`, async () => {
      const runs = {};
      for (const [rate, every] of Object.entries(RATES)) runs[rate] = await poll(name, every);
      // Frames both rates sample: multiples of 15 and 3, so of 15.
      for (let f = 0; f <= 600; f += 15) {
        assert.equal(runs['4 Hz'].get(f), runs['20 Hz'].get(f), `frame ${f}`);
      }
      for (const m of Object.values(runs)) {
        assert.equal(m.get(0), 'field');
        assert.equal(m.get(180), 'movie');
        assert.equal(m.get(300), 'movie');
        assert.equal(m.get(540), 'field');
      }
    });
  }

  test('dialogue-taps: its layer reports a movie at 4 Hz and 20 Hz alike', async () => {
    for (const every of Object.values(RATES)) {
      const { g, timers, seen, ui } = await start('dialogue-taps');
      await timers.tick();
      // Drive mode() on the layer the frontend built, over its wrapper.
      const layer = createSemantic({ backend: seen.wrapper, exeSha1: ADDRESS_TABLE.exe });
      const labels = new Map();
      for (let f = 0; f <= 600; f += every) {
        g.setFrame(f);
        labels.set(f, (await layer.mode()).value.mode);
      }
      assert.equal(labels.get(180), 'movie', `every ${every}`);
      assert.equal(labels.get(540), 'field', `every ${every}`);
      ui.setGate({ active: false });
    }
  });
});

describe('the worker overlay passes the frame number (#181)', () => {
  // The worker runs the core and opens the semantic gate only for the USA
  // disc, so Tier 1 can't run its layer. Check the source instead: the
  // wrapper is readMem plus a getter over the core frame counter.
  test('emu-worker.js builds its layer over { readMem: peek, get frame() }', () => {
    const src = readFileSync(new URL('../js/emu-worker.js', import.meta.url), 'utf8');
    assert.match(src, /createSemantic\(\{ backend: \{ readMem: peek, get frame\(\) \{ return frame; \} \}/);
    // `frame` is the counter the run loop advances once per core frame.
    assert.match(src, /m\._fe_run_frame\(\);\s*\n\s*frame \+= 1;/);
  });
});
