// The emulator core, running in a dedicated module Worker.
//
// Messages in (from backend.js):
//   { type: 'init', options }                    core options, before load
//   { type: 'load', files: File[], card }        mount and boot; card = Uint8Array|null
//   { type: 'pad', port, mask }
//   { type: 'run' } / { type: 'pause' }
//   { type: 'setCard', bytes }                   replace the slot 1 card
//   { type: 'getCard', id } / { type: 'readMem', id, addr, len }
//   { type: 'getState', id } / { type: 'setState', id, bytes }   suspend/resume (#119): the whole emulator state; a failed load leaves the game as it was; the memory card is kept as it was
//   { type: 'discKey', id }                      on-device key of the loaded disc (state-file.js)
//   { type: 'recycle', buffer }                  a frame buffer to reuse
//   { type: 'speed', speed }                     1, 2 or 3 core frames per displayed frame (#118); audio is dropped above 1x
//   { type: 'overlay', on }                      start/stop sampling game state for the debug overlay (#79)
// Messages out:
//   { type: 'ready', buildInfo } / { type: 'loaded', path, fps, sampleRate }
//   { type: 'frame', frame, width, height, buffer }   RGBA, transferred; targetFrames: frames the time base asked for (#173)
//   { type: 'audio', samples }                   Float32 stereo interleaved
//   { type: 'card', bytes }                      the card changed
//   { type: 'semantic', active, reason }         the semantic layer's hash gate (#75)
//   { type: 'speed', speed, auto: true }         the worker could not keep up and stepped down (#118)
//   { type: 'state', sample }                    a changed overlay sample, only while the overlay is on (#79)
//   { type: 'reply', id, value } / { type: 'error', message, id? }

import init from '../core/core.mjs';
import { gateForFiles, pickImage } from './disc-gate.js';
import { pickBootFile } from './files.js';
import { discKey } from './state-file.js';
import { clampSpeed, createGovernor, stepDown } from './speed.js';
import { createStatePoller } from './overlay-state.js';
import { ADDRESS_TABLE } from './semantic/addresses.js';
import { createSemantic } from './semantic/layer.js';

const MOUNT = '/game';
const MAX_CATCH_UP = 4; // frames run per tick (per speed step) before giving up on real time
const CARD_CHECK_EVERY = 30; // frames between memory card change checks
const RAM_SIZE = 0x200000;

let m;
let loaded = false;
let running = false;
let frame = 0;
let fps = 60;
let baseTime = 0;
let baseFrame = 0;
// Frames the time base has asked for since boot (fps * speed per second of
// wall time), whether or not the host could run them all (#173 test hook).
let targetFrames = 0;
let speed = 1; // core frames per displayed frame (#118)
const governor = createGovernor();
let cardDigest = 0;
let timer = 0;
let poller = null; // the overlay's state sampler; exists only when the hash gate is on
let overlayOn = false;
let keyFile = null; // the file the disc key is taken from
let keyPromise = null;
const spare = [];

const post = (msg, transfer) => self.postMessage(msg, transfer ?? []);

function withCString(s, fn) {
  const p = m.stringToNewUTF8(s);
  try {
    return fn(p);
  } finally {
    m._free(p);
  }
}

function digest(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function cardView() {
  const ptr = m._fe_card_ptr();
  const size = m._fe_card_size();
  return ptr && size ? m.HEAPU8.subarray(ptr, ptr + size) : null;
}

/** Copy the last frame out as RGBA (alpha 255). */
function grabFrame() {
  const ptr = m._fe_fb_data();
  const w = m._fe_fb_width();
  const h = m._fe_fb_height();
  if (!ptr || !w || !h) return null;
  const pitch = m._fe_fb_pitch();
  const fmt = m._fe_fb_format();
  const need = w * h * 4;
  let buf = spare.pop();
  if (!buf || buf.byteLength !== need) buf = new ArrayBuffer(need);
  const out = new Uint32Array(buf);
  const heap = m.HEAPU8;
  // Little-endian Uint32 writes bytes R,G,B,A for 0xAABBGGRR.
  if (fmt === 1) {
    const src = new Uint32Array(heap.buffer, ptr, (pitch / 4) * h);
    for (let y = 0; y < h; y++) {
      const row = y * (pitch / 4);
      for (let x = 0; x < w; x++) {
        const p = src[row + x];
        out[y * w + x] = 0xff000000 | ((p & 0xff) << 16) | (p & 0xff00) | ((p >>> 16) & 0xff);
      }
    }
  } else {
    const src = new Uint16Array(heap.buffer, ptr, (pitch / 2) * h);
    const rgb565 = fmt === 2;
    for (let y = 0; y < h; y++) {
      const row = y * (pitch / 2);
      for (let x = 0; x < w; x++) {
        const p = src[row + x];
        let r, g, b;
        if (rgb565) {
          r = (p >> 11) & 31; g = (p >> 5) & 63; b = p & 31;
          g = (g << 2) | (g >> 4);
        } else {
          r = (p >> 10) & 31; g = (p >> 5) & 31; b = p & 31;
          g = (g << 3) | (g >> 2);
        }
        r = (r << 3) | (r >> 2);
        b = (b << 3) | (b >> 2);
        out[y * w + x] = 0xff000000 | (b << 16) | (g << 8) | r;
      }
    }
  }
  return { width: w, height: h, buffer: buf };
}

function drainAudio() {
  const n = m._fe_audio_count();
  if (!n) return;
  if (speed > 1) {
    // Fast-forward is muted: the samples are dropped, so nothing queues up
    // in the page and 1x starts from an empty buffer.
    m._fe_audio_clear();
    return;
  }
  const src = new Int16Array(m.HEAPU8.buffer, m._fe_audio_ptr(), n * 2);
  const samples = new Float32Array(n * 2);
  for (let i = 0; i < samples.length; i++) samples[i] = src[i] / 32768;
  m._fe_audio_clear();
  post({ type: 'audio', samples }, [samples.buffer]);
}

function checkCard() {
  const card = cardView();
  if (!card) return;
  const d = digest(card);
  if (d !== cardDigest) {
    cardDigest = d;
    post({ type: 'card', bytes: card.slice() });
  }
}

function runFrames(n) {
  for (let i = 0; i < n; i++) {
    m._fe_run_frame();
    frame += 1;
    if (frame % CARD_CHECK_EVERY === 0) checkCard();
  }
  drainAudio();
  const f = grabFrame();
  if (f) post({ type: 'frame', frame, targetFrames, ...f }, [f.buffer]);
}

function tick() {
  timer = 0;
  if (!running) return;
  const now = performance.now();
  const rate = fps * speed;
  const cap = MAX_CATCH_UP * speed;
  const due = baseFrame + Math.floor(((now - baseTime) * rate) / 1000) - frame;
  const behind = due > cap;
  if (due > 0) targetFrames += due;
  if (behind) {
    // Too far behind (slow device, or the tab was throttled): run a batch
    // and re-anchor real time instead of fast-forwarding.
    runFrames(cap);
    baseTime = now;
    baseFrame = frame;
  } else if (due > 0) {
    runFrames(due);
  }
  if (speed > 1 && governor.note(now, behind)) {
    setSpeed(stepDown(speed));
    post({ type: 'speed', speed, auto: true });
  }
  // One tick per displayed frame: `speed` core frames apart.
  const next = baseTime + ((frame + speed - baseFrame) * 1000) / rate;
  timer = setTimeout(tick, Math.max(0, next - performance.now()));
}

function setSpeed(v) {
  speed = clampSpeed(v);
  baseTime = performance.now();
  baseFrame = frame;
  governor.reset();
}

function start() {
  if (!loaded || running) return;
  running = true;
  baseTime = performance.now();
  baseFrame = frame;
  governor.reset();
  tick();
}

function stop() {
  running = false;
  if (timer) clearTimeout(timer);
  timer = 0;
  if (loaded) checkCard();
}

function setCard(bytes) {
  const card = cardView();
  if (!card) throw new Error('the core has no slot 1 memory card');
  if (bytes.length !== card.length) throw new Error(`card must be ${card.length} bytes`);
  card.set(bytes);
  cardDigest = digest(card);
}

/** A copy of main RAM at a PS1 address (KUSEG/KSEG0/KSEG1). Never writes. */
function peek(addr, len) {
  if (!loaded) throw new Error('no program loaded');
  const off = (addr & 0x1fffffff) >>> 0;
  if (off + len > RAM_SIZE) throw new RangeError('address outside main RAM');
  const p = m._fe_ram_ptr();
  return m.HEAPU8.slice(p + off, p + off + len);
}

/** Whole-emulator state as a fresh byte array. Only the core's own serializer touches the heap. */
function readState() {
  if (!loaded) throw new Error('no program loaded');
  const size = m._fe_state_size();
  const p = m._malloc(size);
  if (!p) throw new Error('out of memory while saving the state');
  try {
    if (!m._fe_state_save(p, size)) throw new Error('the core could not save its state');
    return m.HEAPU8.slice(p, p + size);
  } finally {
    m._free(p);
  }
}

function loadStateBytes(bytes) {
  if (!loaded) throw new Error('no program loaded');
  const size = m._fe_state_size();
  if (!(bytes instanceof Uint8Array) || bytes.length !== size) throw new Error('this state does not fit the running core');
  const backup = readState();
  const p = m._malloc(size);
  if (!p) throw new Error('out of memory while loading the state');
  const card = cardView()?.slice() ?? null; // the memory card is not part of resume
  try {
    m.HEAPU8.set(bytes, p);
    if (!m._fe_state_load(p, size)) {
      // The core may have half-applied it: put everything back.
      m.HEAPU8.set(backup, p);
      m._fe_state_load(p, size);
      throw new Error('the core refused the state');
    }
  } finally {
    m._free(p);
    const c = cardView();
    if (card && c) {
      c.set(card);
      cardDigest = digest(c);
    }
  }
  m._fe_audio_clear();
  // Re-anchor real time so the loaded state does not fast-forward to catch up.
  baseTime = performance.now();
  baseFrame = frame;
  governor.reset();
}

const handlers = {
  async init({ options }) {
    m = await init({
      print: (s) => console.log(`[core] ${s}`),
      printErr: (s) => console.warn(`[core] ${s}`),
    });
    if (m._fe_init(0) !== 1) throw new Error('unexpected libretro API version');
    for (const [k, v] of Object.entries(options ?? {})) {
      if (!withCString(k, (kp) => withCString(String(v), (vp) => m._fe_set_option(kp, vp)))) {
        throw new Error(`could not set core option ${k}`);
      }
    }
    let buildInfo = null;
    try {
      buildInfo = await (await fetch(new URL('../core/BUILD_INFO.json', import.meta.url))).json();
    } catch {
      // provenance is informative only
    }
    post({ type: 'ready', buildInfo });
  },

  load({ files, card }) {
    if (loaded) throw new Error('a program is already loaded; reload the page to change it');
    const boot = pickBootFile(files.map((f) => f.name));
    if (!boot) throw new Error('no disc image or PS-X EXE among the chosen files');
    keyFile = (/\.cue$/i.test(boot) ? pickImage(files) : null) ?? files.find((f) => f.name === boot);
    m.FS.mkdir(MOUNT);
    m.FS.mount(m.WORKERFS, { files }, MOUNT);
    const path = `${MOUNT}/${boot}`;
    if (!withCString(path, (p) => m._fe_load_game(p))) throw new Error(`the core could not load ${boot}`);
    loaded = true;
    if (card) setCard(card);
    else {
      const c = cardView();
      cardDigest = c ? digest(c) : 0;
    }
    fps = m._fe_fps() || 60;
    post({ type: 'loaded', path: boot, fps, sampleRate: m._fe_sample_rate() });
    start();
    // The disc's boot executable is hashed here, on the device, and only the
    // verdict leaves this function.
    gateForFiles(files)
      .catch((e) => ({ active: false, reason: e.message }))
      .then(({ active, reason }) => {
        if (active) {
          // Read-only: the layer gets a readMem over the core's RAM and the core
          // frame counter, nothing else. The frame lets mode()'s movie window
          // count game frames rather than calls (#146, #181).
          const semantic = createSemantic({ backend: { readMem: peek, get frame() { return frame; } }, exeSha1: ADDRESS_TABLE.exe });
          poller = createStatePoller({ semantic, post: (sample) => post({ type: 'state', sample }) });
          if (overlayOn) poller.start();
        }
        post({ type: 'semantic', active, reason });
      });
  },

  pad({ port, mask }) {
    m?._fe_set_pad(port, mask);
  },
  run: start,
  pause: stop,
  setCard({ bytes }) {
    if (loaded) setCard(bytes);
  },
  recycle({ buffer }) {
    if (spare.length < 3) spare.push(buffer);
  },
  getCard({ id }) {
    const c = loaded ? cardView() : null;
    post({ type: 'reply', id, value: c ? c.slice() : null });
  },
  readMem({ id, addr, len }) {
    post({ type: 'reply', id, value: peek(addr, len) });
  },
  getState({ id }) {
    const bytes = readState();
    post({ type: 'reply', id, value: bytes.buffer }, [bytes.buffer]);
  },
  setState({ id, bytes }) {
    loadStateBytes(bytes);
    post({ type: 'reply', id, value: true });
  },
  async discKey({ id }) {
    if (!keyFile) throw new Error('no program loaded');
    keyPromise ??= discKey(keyFile);
    post({ type: 'reply', id, value: await keyPromise });
  },
  speed({ speed: v }) {
    setSpeed(v);
  },
  overlay({ on }) {
    overlayOn = on === true;
    if (!poller) return;
    if (overlayOn) poller.start();
    else poller.stop();
  },
};

self.onmessage = async ({ data }) => {
  try {
    await handlers[data.type]?.(data);
  } catch (e) {
    post({ type: 'error', message: e.message, id: data.id });
  }
};
