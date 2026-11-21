// Benchmark page (issue #8): runs the Experiment 01 measurements on the
// homebrew stress program and reports them. Original project code,
// GPL-2.0-or-later.
//
// Startup is measured on page load. One tap on Start then runs, unattended:
//   1. unthrottled: `frames` emulated frames as fast as possible;
//   2. real time: `seconds` paced like the app, with video and audio out.
//      Audio underruns are counted over the first `audio` seconds, and the
//      first and last `window` seconds are compared (sustained/thermal).
// Query parameters shorten the run (tests): ?frames=&seconds=&audio=&window=&tris=&auto=1

import { createAudio } from '../js/audio.js';
import {
  buildReport, describeDevice, parseParams, reportUrl, round, summariseRealtime, THRESHOLDS,
} from './report.js';
import * as stress from './stress.js';

const $ = (id) => document.getElementById(id);
const LOST_KEY = 'ff7web-bench-running';
const MODEL_KEY = 'ff7web-bench-model';
const MB = 1024 * 1024;

const store = {
  get(k) {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k, v) {
    try { localStorage.setItem(k, v); } catch { /* private mode: no lost-run detection */ }
  },
  del(k) {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  },
};

const { params, short, auto } = parseParams(location.search);
const state = { phase: 'loading', report: null, error: null };
let resolveDone;
const done = new Promise((r) => { resolveDone = r; });

const setStatus = (t) => { $('status').textContent = t; };
const fmtTime = (s) => (s >= 90 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`);

$('plan').textContent += ` This run: ${params.frames} unthrottled frames, then ${fmtTime(params.seconds)} in real time`
  + ` (audio over the first ${fmtTime(params.audio)}; first and last ${fmtTime(params.window)} compared).`;

const modelInput = $('model');
modelInput.value = store.get(MODEL_KEY) ?? '';
modelInput.addEventListener('change', () => store.set(MODEL_KEY, modelInput.value.trim()));

function device() {
  return describeDevice(navigator, {
    model: modelInput.value.trim(),
    standalone: navigator.standalone === true || matchMedia('(display-mode: standalone)').matches,
    screen: `${screen.width}x${screen.height}`,
    dpr: devicePixelRatio,
  });
}

// --- build provenance -------------------------------------------------------
async function previewInfo() {
  try {
    const r = await fetch(new URL('../preview.json', import.meta.url), { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

async function sha256Hex(bytes) {
  if (!crypto?.subtle) return null;
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// --- worker -----------------------------------------------------------------
const worker = new Worker(new URL('./bench-worker.js', import.meta.url), { type: 'module' });
const waiters = new Map();
let nextId = 1;
let onProgress = () => {};
let pendingFrame = null;
let lastFrameBuf = null;
let audio = null;
let peakHeap = 0;

const once = (type) => new Promise((resolve, reject) => {
  waiters.set(type, { resolve, reject });
});

worker.onerror = (e) => fail(e.message || 'the benchmark worker failed to start');
worker.onmessage = ({ data }) => {
  if (data.heap > peakHeap) peakHeap = data.heap;
  switch (data.type) {
    case 'frame':
      if (lastFrameBuf) worker.postMessage({ type: 'recycle', buffer: lastFrameBuf }, [lastFrameBuf]);
      lastFrameBuf = null;
      pendingFrame = data;
      return;
    case 'audio':
      audio?.push(data.samples);
      return;
    case 'progress':
      onProgress(data);
      return;
    case 'reply':
      waiters.get(data.id)?.resolve(data.value);
      waiters.delete(data.id);
      return;
    case 'error': {
      const w = waiters.get(data.id) ?? [...waiters.values()][0];
      if (w) w.reject(new Error(data.message));
      else fail(data.message);
      waiters.clear();
      return;
    }
    default: {
      const w = waiters.get(data.type);
      waiters.delete(data.type);
      w?.resolve(data);
    }
  }
};
const call = (msg, reply) => {
  const p = once(reply);
  worker.postMessage(msg);
  return p;
};
const readU32 = (addr) => new Promise((resolve, reject) => {
  const id = nextId++;
  waiters.set(id, { resolve, reject });
  worker.postMessage({ type: 'readU32', id, addr });
});

const canvas = $('screen');
const ctx2d = canvas.getContext('2d', { alpha: false });
let drawn = 0;
function draw() {
  requestAnimationFrame(draw);
  const f = pendingFrame;
  if (!f) return;
  pendingFrame = null;
  if (canvas.width !== f.width || canvas.height !== f.height) {
    canvas.width = f.width;
    canvas.height = f.height;
  }
  ctx2d.putImageData(new ImageData(new Uint8ClampedArray(f.buffer), f.width, f.height), 0, 0);
  lastFrameBuf = f.buffer;
  drawn = f.frame;
}
requestAnimationFrame(draw);

// --- lost runs (reload or kill during a run) --------------------------------
let lost = null;
try {
  lost = JSON.parse(store.get(LOST_KEY) ?? 'null');
} catch {
  lost = null;
}

let base = null; // { build, program, startup, fps, sampleRate }

function partsCommon() {
  return {
    short, params, device: device(),
    build: base?.build ?? null, program: base?.program ?? null,
  };
}

function showLost() {
  if (!lost) return;
  $('lost').hidden = false;
  $('lost-text').textContent = `It stopped during the ${lost.phase} phase, ${fmtTime(lost.elapsed ?? 0)} in`
    + ` (peak heap so far ${lost.heapMB ?? '?'} MB). Safari may have reloaded or closed the tab.`;
  const r = buildReport({
    ...partsCommon(),
    status: 'lost',
    params: lost.params ?? params,
    short: lost.short ?? short,
    memory: { peakHeapMB: lost.heapMB ?? null, jsHeapMB: null, lostRun: lost.phase },
  });
  $('lost-report').href = reportUrl(r);
  state.lostReport = r;
}

function markRunning(phase, extra = {}) {
  store.set(LOST_KEY, JSON.stringify({ phase, params, short, heapMB: round(peakHeap / MB), ...extra }));
}

// --- the run ----------------------------------------------------------------
function fail(message) {
  state.phase = 'error';
  state.error = message;
  setStatus(`Error: ${message}`);
  $('start').disabled = true;
  resolveDone(null);
}

async function prepare() {
  const ready = await call({ type: 'init' }, 'ready');
  const coreMs = performance.now();
  const exe = stress.build({ triangles: params.tris });
  const [sha, preview] = await Promise.all([sha256Hex(exe), previewInfo()]);
  const loaded = await call({ type: 'load', exe }, 'loaded');
  const firstFrameMs = performance.now();
  const bi = ready.buildInfo ?? {};
  base = {
    fps: loaded.fps,
    sampleRate: loaded.sampleRate,
    build: {
      slot: preview?.slot ?? 'local',
      sha: preview?.sha || null,
      repo: preview?.repo || null,
      core: bi.pcsx_rearmed_commit?.slice(0, 12) ?? null,
      wasm: bi.wasm_sha256?.slice(0, 12) ?? null,
    },
    program: { name: stress.NAME, v: stress.VERSION, tris: params.tris, sha: sha?.slice(0, 16) ?? null },
    startup: { coreMs: round(coreMs, 0), firstFrameMs: round(firstFrameMs, 0), frameMs: round(loaded.firstFrameMs, 1) },
  };
  showLost();
  state.phase = 'ready';
  setStatus(`Ready. First frame ${base.startup.firstFrameMs} ms after page load. Tap Start; the run takes about ${fmtTime(params.seconds + params.frames / 60)}.`);
  $('start').disabled = false;
  $('start').textContent = 'Start';
}

let wakeLock = null;
async function keepAwake() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
    return Boolean(wakeLock);
  } catch {
    return false;
  }
}

let interrupted = null;
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (state.phase === 'unthrottled' || state.phase === 'realtime')) {
    interrupted = 'page hidden';
    worker.postMessage({ type: 'stop' });
  }
});
$('stop').addEventListener('click', () => {
  interrupted = 'stopped';
  worker.postMessage({ type: 'stop' });
});

async function run() {
  $('start').disabled = true;
  $('stop').hidden = false;
  $('lost').hidden = true;
  store.del(LOST_KEY);
  // Audio must start inside this tap on iOS: create it before any await.
  audio = createAudio({ sourceRate: base.sampleRate });
  const unlocking = audio.unlock();
  const awake = keepAwake();
  const bar = $('progress');
  bar.hidden = false;
  const runStart = performance.now();

  state.phase = 'unthrottled';
  markRunning('unthrottled', { elapsed: 0 });
  onProgress = (p) => {
    bar.value = p.done / p.total;
    setStatus(p.phase === 'unthrottled'
      ? `Unthrottled: ${p.done} / ${p.total} frames`
      : `Real time: ${fmtTime(p.done)} of ${fmtTime(p.total)}`);
    markRunning(p.phase, { elapsed: round((performance.now() - runStart) / 1000, 0) });
  };
  setStatus('Unthrottled…');
  const u = await call({ type: 'unthrottled', frames: params.frames }, 'unthrottled');
  const uFps = u.ms > 0 ? (u.frames * 1000) / u.ms : 0;
  const unthrottled = { frames: u.frames, ms: round(u.ms, 0), fps: round(uFps, 1), speed: round(uFps / base.fps, 2) };

  await unlocking;
  const audioState = audio.state;
  const audioOk = audioState === 'running';
  const before = audioOk ? await audio.stats() : null;
  let atWindow = null;
  const windowTimer = setTimeout(async () => {
    atWindow = audioOk ? await audio.stats() : null;
  }, params.audio * 1000);

  state.phase = 'realtime';
  markRunning('realtime', { elapsed: round((performance.now() - runStart) / 1000, 0) });
  // Stopped or hidden during the unthrottled phase: don't spend the real-time run.
  const rt = interrupted
    ? { ms: 0, frames: 0, expected: 0, late: 0, frameMs: [], atMs: [], heap: 0 }
    : await call({ type: 'realtime', seconds: params.seconds }, 'realtime');
  clearTimeout(windowTimer);
  const after = audioOk ? await audio.stats() : null;
  if (audioOk && !atWindow && rt.ms >= params.audio * 1000 - 50) atWindow = after;

  const realtime = {
    seconds: round(rt.ms / 1000, 1),
    frames: rt.frames,
    expected: rt.expected,
    late: rt.late,
    ...summariseRealtime(rt.frameMs, rt.atMs, params.window * 1000),
  };
  const audioPart = {
    state: audioState,
    rate: audio.context?.sampleRate ?? null,
    window: params.audio,
    underruns: before && atWindow ? atWindow.underruns - before.underruns : null,
    overflows: before && atWindow ? atWindow.overflows - before.overflows : null,
    total: before && after ? after.underruns - before.underruns : null,
  };
  const memory = {
    peakHeapMB: round(Math.max(peakHeap, rt.heap) / MB),
    jsHeapMB: performance.memory ? round(performance.memory.usedJSHeapSize / MB) : null,
    lostRun: null,
  };
  store.del(LOST_KEY);
  wakeLock?.release?.().catch(() => {});

  const counter = await readU32(stress.COUNTER_ADDR);
  const report = buildReport({
    ...partsCommon(),
    status: interrupted ? 'interrupted' : 'complete',
    startup: base.startup,
    unthrottled,
    realtime,
    audio: audioPart,
    memory,
    wakeLock: await awake,
    note: interrupted ?? undefined,
  });
  state.counter = counter;
  showResults(report);
}

function showResults(report) {
  state.report = report;
  state.phase = 'done';
  $('stop').hidden = true;
  $('progress').hidden = true;
  setStatus(report.status === 'complete' ? 'Done.' : `Ended early (${report.note}).`);
  $('results').hidden = false;
  const v = $('verdict');
  v.textContent = report.verdict;
  v.dataset.v = report.verdict;
  const T = THRESHOLDS;
  const rows = [
    ['Unthrottled speed', `${report.unthrottled?.speed ?? '–'}× (≥ ${T.speed}×)`, report.checks.speed],
    ['Real-time p99 frame', `${report.realtime?.p99 ?? '–'} ms (≤ ${T.p99Ms})`, report.checks.p99],
    ['Audio underruns', `${report.audio?.underruns ?? '–'} (≤ ${T.underruns})`, report.checks.audio],
    ['Peak heap', `${report.memory?.peakHeapMB ?? '–'} MB (≤ ${T.heapMB})`, report.checks.heap],
    ['First / last p99', `${report.realtime?.first.p99 ?? '–'} / ${report.realtime?.last.p99 ?? '–'} ms`, ''],
    ['Startup', `${report.startup?.firstFrameMs ?? '–'} ms`, ''],
  ];
  const table = $('checks');
  table.replaceChildren(...rows.map(([name, val, check]) => {
    const tr = document.createElement('tr');
    for (const [text, v2] of [[name], [val], [check, check]]) {
      const td = document.createElement('td');
      td.textContent = text;
      if (v2) td.dataset.v = v2;
      tr.append(td);
    }
    return tr;
  }));
  const json = JSON.stringify(report, null, 2);
  $('json').textContent = json;
  try {
    $('report').href = reportUrl(report);
  } catch (e) {
    $('report').removeAttribute('href');
    $('report').textContent = 'Report too long: use Copy';
    console.warn(e.message);
  }
  $('copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(json);
      $('copy').textContent = 'Copied';
    } catch {
      $('copy').textContent = 'Copy failed: select the text below';
    }
  };
  $('download').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = `ff7-web-bench-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  resolveDone(report);
}

$('start').addEventListener('click', () => {
  if (state.phase !== 'ready') return;
  run().catch((e) => fail(e.message));
});

prepare().then(() => {
  if (auto) $('start').click();
}).catch((e) => fail(e.message));

// For tests. Exposes timings and the homebrew's own counters, no game data.
window.ff7bench = {
  get state() { return state; },
  params,
  done,
  readU32,
  drawnFrame: () => drawn,
};
