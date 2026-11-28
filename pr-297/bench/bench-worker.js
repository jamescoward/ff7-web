// Benchmark worker (issue #8): the same core as the app, with timing.
// Original project code, GPL-2.0-or-later.
//
// The real-time loop, the frame conversion and the audio drain repeat
// web/js/emu-worker.js (tick, grabFrame, drainAudio), so the measurement
// covers the work the app does per frame. Keep them in step: if the app's
// pacing changes, change it here too, or the benchmark measures something
// else. (They aren't shared because emu-worker.js isn't a module that
// exports them; see notes/8-bench-page.md.)
//
// Messages in:
//   { type: 'init' }
//   { type: 'load', exe: Uint8Array }         boot from memory, run one frame
//   { type: 'unthrottled', frames }           as fast as possible, no video/audio out
//   { type: 'realtime', seconds }             paced at the core's fps, video and audio out
//   { type: 'stop' }                          end the current phase early
//   { type: 'readU32', id, addr }             main RAM word (homebrew state, for tests)
//   { type: 'recycle', buffer }
// Messages out:
//   { type: 'ready', buildInfo, heap } / { type: 'loaded', fps, sampleRate, firstFrameMs, heap }
//   { type: 'progress', phase, done, total, heap }
//   { type: 'unthrottled', frames, ms, heap, stopped }
//   { type: 'realtime', frames, expected, late, ms, frameMs, atMs, heap, stopped }
//   { type: 'frame', frame, width, height, buffer } / { type: 'audio', samples }
//   { type: 'reply', id, value } / { type: 'error', message, id? }

import init from '../core/core.mjs';

const MAX_CATCH_UP = 4; // as web/js/emu-worker.js
const CHUNK_MS = 50; // unthrottled: yield to the message loop this often
const PROGRESS_MS = 500;
const RAM_SIZE = 0x200000;

let m;
let loaded = false;
let frame = 0;
let fps = 60;
let peakHeap = 0;
let stopFlag = false;
const spare = [];

const post = (msg, transfer) => self.postMessage(msg, transfer ?? []);
const heap = () => {
  const n = m?.HEAPU8?.buffer?.byteLength ?? 0;
  if (n > peakHeap) peakHeap = n;
  return peakHeap;
};

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
  const hp = m.HEAPU8;
  if (fmt === 1) {
    const src = new Uint32Array(hp.buffer, ptr, (pitch / 4) * h);
    for (let y = 0; y < h; y++) {
      const row = y * (pitch / 4);
      for (let x = 0; x < w; x++) {
        const p = src[row + x];
        out[y * w + x] = 0xff000000 | ((p & 0xff) << 16) | (p & 0xff00) | ((p >>> 16) & 0xff);
      }
    }
  } else {
    const src = new Uint16Array(hp.buffer, ptr, (pitch / 2) * h);
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
  const src = new Int16Array(m.HEAPU8.buffer, m._fe_audio_ptr(), n * 2);
  const samples = new Float32Array(n * 2);
  for (let i = 0; i < samples.length; i++) samples[i] = src[i] / 32768;
  m._fe_audio_clear();
  post({ type: 'audio', samples }, [samples.buffer]);
}

const yieldToMessages = () => new Promise((r) => setTimeout(r, 0));

async function unthrottled({ frames }) {
  stopFlag = false;
  let done = 0;
  let ms = 0;
  let lastProgress = performance.now();
  while (done < frames && !stopFlag) {
    const t0 = performance.now();
    while (done < frames && performance.now() - t0 < CHUNK_MS) {
      m._fe_run_frame();
      m._fe_audio_clear();
      frame++;
      done++;
    }
    ms += performance.now() - t0; // time spent emulating, not yielding
    if (performance.now() - lastProgress > PROGRESS_MS) {
      lastProgress = performance.now();
      post({ type: 'progress', phase: 'unthrottled', done, total: frames, heap: heap() });
    }
    await yieldToMessages();
  }
  post({ type: 'unthrottled', frames: done, ms, heap: heap(), stopped: stopFlag });
}

function realtime({ seconds }) {
  stopFlag = false;
  const cap = Math.ceil(seconds * fps * 1.05) + 64;
  const frameMs = new Float32Array(cap);
  const atMs = new Float32Array(cap);
  let n = 0;
  let late = 0;
  const start = performance.now();
  const endAt = start + seconds * 1000;
  let baseTime = start;
  let baseFrame = frame;
  let lastProgress = start;

  const runFrames = (count) => {
    for (let i = 0; i < count && n < cap; i++) {
      const t0 = performance.now();
      m._fe_run_frame();
      const t1 = performance.now();
      frame++;
      frameMs[n] = t1 - t0;
      atMs[n] = t0 - start;
      n++;
    }
    const t2 = performance.now();
    drainAudio();
    const f = grabFrame();
    if (f) post({ type: 'frame', frame, ...f }, [f.buffer]);
    if (n) frameMs[n - 1] += performance.now() - t2; // the batch's output work
  };

  return new Promise((resolve) => {
    const finish = () => {
      const ms = performance.now() - start;
      const ft = frameMs.slice(0, n);
      const at = atMs.slice(0, n);
      post({
        type: 'realtime', frames: n, expected: Math.floor((ms * fps) / 1000), late, ms,
        frameMs: ft, atMs: at, heap: heap(), stopped: stopFlag,
      }, [ft.buffer, at.buffer]);
      resolve();
    };
    const tick = () => {
      const now = performance.now();
      if (stopFlag || now >= endAt || n >= cap) return finish();
      const due = baseFrame + Math.floor(((now - baseTime) * fps) / 1000) - frame;
      if (due > MAX_CATCH_UP) {
        runFrames(MAX_CATCH_UP);
        baseTime = now;
        baseFrame = frame;
        late++;
      } else if (due > 0) {
        runFrames(due);
      }
      if (now - lastProgress > PROGRESS_MS) {
        lastProgress = now;
        post({ type: 'progress', phase: 'realtime', done: (now - start) / 1000, total: seconds, heap: heap() });
      }
      const next = baseTime + ((frame + 1 - baseFrame) * 1000) / fps;
      setTimeout(tick, Math.max(0, next - performance.now()));
    };
    tick();
  });
}

const handlers = {
  async init() {
    m = await init({
      print: (s) => console.log(`[core] ${s}`),
      printErr: (s) => console.warn(`[core] ${s}`),
    });
    if (m._fe_init(0) !== 1) throw new Error('unexpected libretro API version');
    let buildInfo = null;
    try {
      buildInfo = await (await fetch(new URL('../core/BUILD_INFO.json', import.meta.url))).json();
    } catch {
      // provenance is informative only
    }
    post({ type: 'ready', buildInfo, heap: heap() });
  },
  load({ exe }) {
    if (loaded) throw new Error('already loaded');
    m.FS.writeFile('/bench.exe', exe);
    const p = m.stringToNewUTF8('/bench.exe');
    try {
      if (!m._fe_load_game(p)) throw new Error('the core could not load the stress program');
    } finally {
      m._free(p);
    }
    loaded = true;
    fps = m._fe_fps() || 60;
    const t0 = performance.now();
    m._fe_run_frame();
    m._fe_audio_clear();
    frame++;
    post({ type: 'loaded', fps, sampleRate: m._fe_sample_rate(), firstFrameMs: performance.now() - t0, heap: heap() });
  },
  unthrottled,
  realtime,
  stop() {
    stopFlag = true;
  },
  recycle({ buffer }) {
    if (spare.length < 3) spare.push(buffer);
  },
  readU32({ id, addr }) {
    const off = (addr & 0x1fffffff) >>> 0;
    if (!loaded || off + 4 > RAM_SIZE) throw new RangeError('address outside main RAM');
    const b = m.HEAPU8.subarray(m._fe_ram_ptr() + off);
    post({ type: 'reply', id, value: (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0 });
  },
};

self.onmessage = async ({ data }) => {
  try {
    await handlers[data.type]?.(data);
  } catch (e) {
    post({ type: 'error', message: e.message, id: data.id });
  }
};
