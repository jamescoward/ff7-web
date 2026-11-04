// Benchmark report: statistics, threshold checks, and the "Report results"
// link. Pure functions, no DOM, so Node tests can run them. Original project
// code, GPL-2.0-or-later.
//
// The report is the object the page shows, downloads and puts in the GitHub
// link. It is kept compact by design (short keys, rounded numbers), so the
// whole report fits in the link: there is no second, lossy encoding.
// web/bench/report.schema.json describes it.

export const REPORT_FORMAT = 1;

/** Experiment 01 thresholds (docs/EXPERIMENT_01_IPHONE_BASELINE.md). */
export const THRESHOLDS = Object.freeze({
  speed: 1.5, // unthrottled emulated fps / real-time fps, at least
  p99Ms: 16.7, // real-time host time per emulated frame, at most
  underruns: 0, // audio underruns in the audio window, at most
  heapMB: 256, // peak Wasm heap, at most
});

/** Full-length run, as the experiment specifies. Query parameters shorten it. */
export const DEFAULT_PARAMS = Object.freeze({
  frames: 3000, // unthrottled frames
  seconds: 1200, // real-time run (20 min, the sustained/thermal run)
  audio: 600, // audio underrun window, from the start of the real-time run (10 min)
  window: 60, // first/last window compared for the thermal check (1 min)
  tris: 1000, // triangles per frame in the stress program
});

const LIMITS = Object.freeze({
  frames: [10, 100000], seconds: [1, 7200], audio: [1, 7200], window: [1, 600], tris: [1, 32767],
});

/** Benchmark parameters from a query string, clamped; `short` when below the defaults. */
export function parseParams(search = '') {
  const q = new URLSearchParams(search);
  const p = { ...DEFAULT_PARAMS };
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    if (!q.has(k)) continue;
    const v = Number(q.get(k));
    if (Number.isFinite(v)) p[k] = Math.min(hi, Math.max(lo, Math.round(v)));
  }
  p.audio = Math.min(p.audio, p.seconds);
  p.window = Math.min(p.window, Math.floor(p.seconds / 2) || 1);
  const short = ['frames', 'seconds', 'audio', 'window'].some((k) => p[k] < DEFAULT_PARAMS[k]);
  return { params: p, short, auto: q.get('auto') === '1' };
}

/** Nearest-rank percentile of an unsorted numeric array-like. NaN when empty. */
export function percentile(values, pct) {
  const n = values.length;
  if (!n) return NaN;
  const sorted = Float64Array.from(values).sort();
  const rank = Math.min(n, Math.max(1, Math.ceil((pct / 100) * n)));
  return sorted[rank - 1];
}

export const round = (v, digits = 1) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

/** { p50, p95, p99, max } in ms, rounded to 0.01. */
export function distribution(values) {
  if (!values.length) return { p50: null, p95: null, p99: null, max: null };
  let max = -Infinity;
  for (const v of values) if (v > max) max = v;
  return {
    p50: round(percentile(values, 50), 2),
    p95: round(percentile(values, 95), 2),
    p99: round(percentile(values, 99), 2),
    max: round(max, 2),
  };
}

/**
 * Summarise the real-time run.
 * @param {ArrayLike<number>} frameMs  host time per emulated frame
 * @param {ArrayLike<number>} atMs     start time of each frame, ms since the run began
 * @param {number} windowMs            first/last window for the thermal comparison
 */
export function summariseRealtime(frameMs, atMs, windowMs) {
  const n = frameMs.length;
  const end = n ? atMs[n - 1] : 0;
  const first = [];
  const last = [];
  for (let i = 0; i < n; i++) {
    if (atMs[i] < windowMs) first.push(frameMs[i]);
    if (atMs[i] >= end - windowMs) last.push(frameMs[i]);
  }
  const pick = (d) => ({ p50: d.p50, p99: d.p99 });
  return { ...distribution(frameMs), first: pick(distribution(first)), last: pick(distribution(last)) };
}

/** Parse a few facts out of the user agent; the owner may add the model. */
export function describeDevice(nav = {}, extra = {}) {
  const ua = String(nav.userAgent ?? '');
  const ios = /\b(?:iPhone|iPad|iPod)\b.*? OS (\d+)[_.](\d+)/.exec(ua);
  const safari = /Version\/(\d+(?:\.\d+)?)/.exec(ua);
  return {
    model: (extra.model ?? '').slice(0, 40) || null,
    os: ios ? `iOS ${ios[1]}.${ios[2]}` : null,
    safari: safari && /Safari\//.test(ua) && !/(Chrome|CriOS|FxiOS|Edg)\//.test(ua) ? safari[1] : null,
    mode: extra.standalone ? 'home-screen' : 'tab',
    screen: extra.screen ?? null,
    dpr: round(extra.dpr ?? null, 2),
    cores: Number.isInteger(nav.hardwareConcurrency) ? nav.hardwareConcurrency : null,
    ua: ua.slice(0, 200),
  };
}

const verdictOf = (ok) => (ok === null ? 'n/a' : ok ? 'pass' : 'fail');

/** Pass/fail against THRESHOLDS. A missing measurement is "n/a", never a pass. */
export function checks(r) {
  const speed = r.unthrottled?.speed ?? null;
  const p99 = r.realtime?.p99 ?? null;
  const underruns = r.audio?.underruns ?? null;
  const heap = r.memory?.peakHeapMB ?? null;
  return {
    speed: verdictOf(speed === null ? null : speed >= THRESHOLDS.speed),
    p99: verdictOf(p99 === null ? null : p99 <= THRESHOLDS.p99Ms),
    audio: verdictOf(underruns === null ? null : underruns <= THRESHOLDS.underruns),
    heap: verdictOf(heap === null ? null : heap <= THRESHOLDS.heapMB),
    reload: verdictOf(r.memory ? !r.memory.lostRun : null),
  };
}

/** "pass" only when complete, full length, and every check passes. */
export function verdict(r) {
  const c = Object.values(r.checks);
  if (c.includes('fail')) return 'fail';
  if (r.status !== 'complete' || c.includes('n/a')) return 'incomplete';
  return r.short ? 'pass-short' : 'pass';
}

/** Assemble the report and add checks and verdict. */
export function buildReport(parts) {
  const r = {
    format: REPORT_FORMAT,
    kind: 'ff7-web-bench',
    status: parts.status,
    short: Boolean(parts.short),
    build: parts.build,
    program: parts.program,
    device: parts.device,
    params: parts.params,
    startup: parts.startup ?? null,
    unthrottled: parts.unthrottled ?? null,
    realtime: parts.realtime ?? null,
    audio: parts.audio ?? null,
    memory: parts.memory ?? null,
    wakeLock: parts.wakeLock ?? null,
  };
  if (parts.note) r.note = String(parts.note).slice(0, 120);
  r.checks = checks(r);
  r.verdict = verdict(r);
  return r;
}

export const DEFAULT_REPO = 'jamescoward/ff7-web';
/**
 * Upper bound for the whole "Report results" URL. GitHub answers 414 for
 * request lines past about 8 KB; this leaves room for redirects (sign-in)
 * that wrap the URL once more.
 */
export const MAX_REPORT_URL = 6000;

/** Title and Markdown body of the GitHub issue the report button opens. */
export function reportText(r) {
  const slot = r.build?.slot ?? 'local';
  const sha = (r.build?.sha ?? '').slice(0, 7) || 'unknown';
  const dev = [r.device?.model, r.device?.os, r.device?.mode].filter(Boolean).join(', ') || 'unknown device';
  const title = `Bench: ${r.verdict.toUpperCase()} on ${dev} (${slot} ${sha})`;
  const pr = /^pr-(\d+)$/.exec(slot);
  const lines = [];
  if (pr && r.build?.repo) lines.push(`Preview of https://github.com/${r.build.repo}/pull/${pr[1]}`);
  const T = THRESHOLDS;
  lines.push(
    '',
    '| Check | Result | Threshold |',
    '|---|---|---|',
    `| Unthrottled speed | ${r.unthrottled?.speed ?? '–'}× | ≥ ${T.speed}× (${r.checks.speed}) |`,
    `| Real-time p99 frame | ${r.realtime?.p99 ?? '–'} ms | ≤ ${T.p99Ms} ms (${r.checks.p99}) |`,
    `| Audio underruns | ${r.audio?.underruns ?? '–'} | ≤ ${T.underruns} (${r.checks.audio}) |`,
    `| Peak heap | ${r.memory?.peakHeapMB ?? '–'} MB | ≤ ${T.heapMB} MB (${r.checks.heap}) |`,
    `| No reload/kill | ${r.memory?.lostRun ? `lost in ${r.memory.lostRun}` : 'none'} | (${r.checks.reload}) |`,
    '',
    '```json',
    JSON.stringify(r),
    '```',
    '',
    'Feel / notes: ',
  );
  return { title, body: lines.join('\n') };
}

/** The pre-filled "new issue" URL for the report. Throws if it is too long. */
export function reportUrl(r, { limit = MAX_REPORT_URL } = {}) {
  const repo = /^[\w.-]+\/[\w.-]+$/.test(r.build?.repo ?? '') ? r.build.repo : DEFAULT_REPO;
  const { title, body } = reportText(r);
  const url = `https://github.com/${repo}/issues/new?${new URLSearchParams({ title, body })}`;
  if (url.length > limit) throw new Error(`report URL is ${url.length} characters, over ${limit}`);
  return url;
}
