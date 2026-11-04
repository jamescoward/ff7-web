// Tier 1 unit tests for the benchmark page (issue #8): the stress program,
// statistics, checks, the report schema and the report URL length.
// Runs under Node; the core tests need runner/build.sh and skip without it.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkSchemaKeywords, validate } from '../../../runner/schema.js';
import {
  buildReport, checks, DEFAULT_PARAMS, describeDevice, MAX_REPORT_URL, parseParams, percentile,
  reportText, reportUrl, summariseRealtime,
} from '../report.js';
import * as stress from '../stress.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = JSON.parse(readFileSync(path.join(HERE, '..', 'report.schema.json'), 'utf8'));
const RUNNER_DIST = path.join(HERE, '..', '..', '..', 'runner', 'dist', 'core.mjs');
const NEEDS_RUNNER = existsSync(RUNNER_DIST) ? false : 'runner/dist is not built (core/build.sh, runner/build.sh)';

const sha = (b) => createHash('sha256').update(b).digest('hex');

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';

function sampleReport(over = {}) {
  return buildReport({
    status: 'complete',
    short: false,
    params: { ...DEFAULT_PARAMS },
    build: { slot: 'pr-27', sha: 'a'.repeat(40), repo: 'jamescoward/ff7-web', core: '7b0e8f8fadfb', wasm: '33987635ec11' },
    program: { name: stress.NAME, v: stress.VERSION, tris: 1000, sha: '0123456789abcdef' },
    device: describeDevice({ userAgent: IPHONE_UA, hardwareConcurrency: 6 }, { model: 'iPhone 14 Pro', screen: '393x852', dpr: 3 }),
    startup: { coreMs: 812, firstFrameMs: 901, frameMs: 3.2 },
    unthrottled: { frames: 3000, ms: 18000, fps: 166.7, speed: 2.78 },
    realtime: {
      seconds: 1200, frames: 71928, expected: 71928, late: 0,
      p50: 5.1, p95: 6.2, p99: 7.9, max: 21.3, first: { p50: 5, p99: 7.5 }, last: { p50: 5.3, p99: 8.4 },
    },
    audio: { state: 'running', rate: 48000, window: 600, underruns: 0, overflows: 3, total: 0 },
    memory: { peakHeapMB: 64, jsHeapMB: null, lostRun: null },
    wakeLock: true,
    ...over,
  });
}

describe('stress program', () => {
  test('is deterministic, and its bytes are pinned (bump VERSION when changing it)', () => {
    const a = stress.build();
    assert.deepEqual(a, stress.build());
    assert.equal(String.fromCharCode(...a.subarray(0, 8)), 'PS-X EXE');
    assert.equal(a.length % 0x800, 0);
    assert.equal(stress.VERSION, 1);
    assert.equal(sha(a), PINNED_SHA256);
  });

  test('the triangle count changes the program and is range-checked', () => {
    assert.notEqual(sha(stress.build({ triangles: 10 })), sha(stress.build()));
    assert.throws(() => stress.build({ triangles: 0 }), RangeError);
    assert.throws(() => stress.build({ triangles: 40000 }), RangeError);
    assert.throws(() => stress.build({ triangles: 1.5 }), RangeError);
  });

  test('runs on the core: counts frames, the GTE projects the probe, the picture changes', { skip: NEEDS_RUNNER }, async () => {
    const { createBackend } = await import('../../../runner/backend.js');
    const dir = mkdtempSync(path.join(tmpdir(), 'ff7-bench-'));
    try {
      const exe = path.join(dir, 'stress.exe');
      writeFileSync(exe, stress.build());
      const b = await createBackend();
      b.loadProgram(exe);
      b.runFrames(10);
      const h10 = b.frameHash();
      b.runFrames(1);
      const h11 = b.frameHash();
      assert.equal(b.readU32(stress.COUNTER_ADDR), 11, 'one VBLANK per emulated frame');
      assert.equal(b.readU32(stress.MARKER_ADDR), stress.MARKER);
      const probe = b.readU32(stress.PROBE_ADDR);
      const want = stress.expectedProbe();
      const got = { x: (probe << 16) >> 16, y: probe >> 16 };
      assert.ok(Math.abs(got.x - want.x) <= 1 && Math.abs(got.y - want.y) <= 1,
        `probe at ${JSON.stringify(got)}, expected ${JSON.stringify(want)} ±1`);
      const last = b.readU32(stress.LAST_ADDR);
      assert.notEqual(last, 0, 'triangles were transformed');
      assert.notEqual(h10, h11, 'the picture changes every frame');
      b.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('statistics', () => {
  test('nearest-rank percentiles', () => {
    const v = Array.from({ length: 100 }, (_, i) => 100 - i); // 100..1, unsorted
    assert.equal(percentile(v, 50), 50);
    assert.equal(percentile(v, 99), 99);
    assert.equal(percentile(v, 100), 100);
    assert.equal(percentile([7], 99), 7);
    assert.ok(Number.isNaN(percentile([], 50)));
  });

  test('first and last windows are compared separately', () => {
    const frameMs = [];
    const atMs = [];
    for (let i = 0; i < 600; i++) {
      atMs.push(i * 16.68);
      frameMs.push(i < 120 ? 4 : i >= 480 ? 9 : 6);
    }
    const s = summariseRealtime(Float32Array.from(frameMs), Float32Array.from(atMs), 2000);
    assert.equal(s.first.p99, 4);
    assert.equal(s.last.p99, 9);
    assert.equal(s.p50, 6);
    assert.equal(s.max, 9);
  });

  test('query parameters shorten the run, are clamped, and mark it short', () => {
    assert.deepEqual(parseParams(''), { params: { ...DEFAULT_PARAMS }, short: false, auto: false });
    const s = parseParams('?frames=120&seconds=4&audio=10&window=60&auto=1');
    assert.equal(s.short, true);
    assert.equal(s.auto, true);
    assert.equal(s.params.audio, 4, 'audio window fits in the run');
    assert.equal(s.params.window, 2, 'thermal windows are at most half the run');
    assert.equal(parseParams('?frames=1').params.frames, 10);
    assert.equal(parseParams('?frames=abc').params.frames, DEFAULT_PARAMS.frames);
  });

  test('device facts come from the user agent', () => {
    const d = describeDevice({ userAgent: IPHONE_UA, hardwareConcurrency: 6 }, { model: 'iPhone 14 Pro', standalone: true });
    assert.equal(d.os, 'iOS 18.6');
    assert.equal(d.safari, '26.0');
    assert.equal(d.mode, 'home-screen');
    assert.equal(d.cores, 6);
    const c = describeDevice({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0 Safari/537.36' });
    assert.equal(c.os, null);
    assert.equal(c.safari, null);
  });
});

describe('checks and verdict', () => {
  test('a good full run passes', () => {
    const r = sampleReport();
    assert.deepEqual(r.checks, { speed: 'pass', p99: 'pass', audio: 'pass', heap: 'pass', reload: 'pass' });
    assert.equal(r.verdict, 'pass');
  });

  test('each threshold fails on its own', () => {
    const base = sampleReport();
    assert.equal(checks({ ...base, unthrottled: { ...base.unthrottled, speed: 1.49 } }).speed, 'fail');
    assert.equal(checks({ ...base, realtime: { ...base.realtime, p99: 16.71 } }).p99, 'fail');
    assert.equal(checks({ ...base, audio: { ...base.audio, underruns: 1 } }).audio, 'fail');
    assert.equal(checks({ ...base, memory: { ...base.memory, peakHeapMB: 257 } }).heap, 'fail');
    assert.equal(sampleReport({ memory: { peakHeapMB: 64, jsHeapMB: null, lostRun: 'realtime' } }).verdict, 'fail');
  });

  test('a missing measurement is n/a and never a pass', () => {
    const r = sampleReport({ audio: { state: 'suspended', rate: null, window: 600, underruns: null, overflows: null, total: null } });
    assert.equal(r.checks.audio, 'n/a');
    assert.equal(r.verdict, 'incomplete');
  });

  test('short and interrupted runs are labelled', () => {
    assert.equal(sampleReport({ short: true }).verdict, 'pass-short');
    assert.equal(sampleReport({ status: 'interrupted', note: 'page hidden' }).verdict, 'incomplete');
  });
});

describe('report schema', () => {
  test('uses only keywords the validator implements', () => {
    checkSchemaKeywords(SCHEMA);
  });

  test('complete, interrupted and lost reports match it', () => {
    for (const r of [
      sampleReport(),
      sampleReport({ status: 'interrupted', note: 'stopped' }),
      buildReport({
        status: 'lost', short: false, params: { ...DEFAULT_PARAMS }, build: null, program: null,
        device: describeDevice({}), memory: { peakHeapMB: 80, jsHeapMB: null, lostRun: 'realtime' },
      }),
    ]) {
      assert.deepEqual(validate(SCHEMA, r), [], JSON.stringify(r));
    }
  });

  test('rejects an unknown field and a bad verdict', () => {
    assert.notDeepEqual(validate(SCHEMA, { ...sampleReport(), extra: 1 }), []);
    assert.notDeepEqual(validate(SCHEMA, { ...sampleReport(), verdict: 'ok' }), []);
  });
});

describe('report link', () => {
  test('is a pre-filled new-issue URL that carries the whole report', () => {
    const r = sampleReport();
    const url = new URL(reportUrl(r));
    assert.equal(url.origin + url.pathname, 'https://github.com/jamescoward/ff7-web/issues/new');
    const body = url.searchParams.get('body');
    assert.match(url.searchParams.get('title'), /^Bench: PASS on iPhone 14 Pro, iOS 18\.6, tab \(pr-27 aaaaaaa\)$/);
    assert.match(body, /https:\/\/github\.com\/jamescoward\/ff7-web\/pull\/27/);
    const json = /```json\n(.*)\n```/.exec(body)[1];
    assert.deepEqual(JSON.parse(json), r, 'the link round-trips the report exactly');
  });

  test(`stays under ${MAX_REPORT_URL} characters in the worst case`, () => {
    const big = 99999.99;
    const r = sampleReport({
      status: 'interrupted',
      note: 'n'.repeat(500),
      device: {
        ...describeDevice({ userAgent: `${IPHONE_UA} ${'x'.repeat(400)}`, hardwareConcurrency: 64 },
          { model: 'M'.repeat(100), screen: '99999x99999', dpr: 3.33 }),
        os: 'iOS 99.99', safari: '99.99',
      },
      params: { frames: 100000, seconds: 7200, audio: 7200, window: 600, tris: 32767 },
      build: { slot: 'pr-9999999', sha: 'f'.repeat(40), repo: `${'o'.repeat(39)}/${'r'.repeat(100)}`, core: 'f'.repeat(12), wasm: 'f'.repeat(12) },
      startup: { coreMs: big, firstFrameMs: big, frameMs: big },
      unthrottled: { frames: 100000, ms: big, fps: big, speed: big },
      realtime: {
        seconds: big, frames: 999999, expected: 999999, late: 99999,
        p50: big, p95: big, p99: big, max: big, first: { p50: big, p99: big }, last: { p50: big, p99: big },
      },
      audio: { state: 'interrupted', rate: 192000, window: 7200, underruns: 99999, overflows: 99999, total: 99999 },
      memory: { peakHeapMB: big, jsHeapMB: big, lostRun: 'realtime' },
    });
    assert.deepEqual(validate(SCHEMA, r), []);
    const url = reportUrl(r);
    assert.ok(url.length <= MAX_REPORT_URL, `${url.length} characters`);
    assert.throws(() => reportUrl(r, { limit: 100 }), /over 100/);
  });

  test('an untrusted repo name falls back to the project repo', () => {
    const r = sampleReport({ build: { slot: 'main', sha: null, repo: 'evil.example/../x?y', core: null, wasm: null } });
    assert.ok(reportUrl(r).startsWith('https://github.com/jamescoward/ff7-web/issues/new?'));
    assert.doesNotMatch(reportText(r).body, /pull\//);
  });
});

// The stress program's SHA-256 at VERSION 1 with the default triangle count.
const PINNED_SHA256 = '16ab2f50cf2c08768852ac0aa14a945e455ad69150c55353e3f4fc5eebb8a992';
