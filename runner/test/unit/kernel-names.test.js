// #260 part 1: name-table counts from a KERNEL.BIN archive (runner/kernel-names.js),
// and the shared section reader (runner/savegen/baseline.js kernelSection).
// The archive is synthetic: author-made strings in the documented encoding
// (ASCII - 0x20, FF end) and the documented BIN-GZIP layout. No game data.
// Original project code, GPL-2.0-or-later.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { gzipSync } from 'node:zlib';

import { KERNEL_NAME_SECTIONS, NAME_KIND_COUNTS } from '../../../semantic/game-text.js';
import { NAME_KINDS, NAME_REPORT, nameCounts, namesHold } from '../../kernel-names.js';
import { BaselineError, kernelSection, unpackSection, parseBinGzip } from '../../savegen/baseline.js';

const enc = (s) => [...s].map((c) => c.charCodeAt(0) - 0x20).concat([0xff]);

/** A text section: u16 LE offsets, then the strings (arrays are raw bytes). */
function section(strings) {
  const bodies = strings.map((s) => (Array.isArray(s) ? s : enc(s)));
  const out = [];
  let at = strings.length * 2;
  for (const b of bodies) {
    out.push(at & 0xff, at >> 8);
    at += b.length;
  }
  return Uint8Array.from([...out, ...bodies.flat()]);
}

/** A BIN-GZIP archive: per section u16 packed, u16 unpacked, u16 type, then gzip data. */
function archive(sections) {
  const parts = [];
  for (const data of sections) {
    const gz = gzipSync(data);
    parts.push(gz.length & 0xff, gz.length >> 8, data.length & 0xff, data.length >> 8, 0, 0, ...gz);
  }
  return Uint8Array.from(parts);
}

/** 27 sections; the name sections hold `names[kind]`, the rest one filler byte. */
function kernel(names = {}) {
  const secs = Array.from({ length: 27 }, () => Uint8Array.of(0));
  for (const [kind, strings] of Object.entries(names)) secs[KERNEL_NAME_SECTIONS[kind]] = section(strings);
  return archive(secs);
}

describe('kernelSection', () => {
  test('unpacks section i in archive order', () => {
    const k = archive([Uint8Array.of(1, 2), Uint8Array.of(3, 4, 5)]);
    assert.deepEqual([...kernelSection(k, 1)], [3, 4, 5]);
    assert.deepEqual([...unpackSection(k, parseBinGzip(k)[0])], [1, 2]);
  });
  test('refuses a missing index and a length that is not the header\'s', () => {
    const k = archive([Uint8Array.of(1, 2)]);
    assert.throws(() => kernelSection(k, 1), BaselineError);
    assert.throws(() => kernelSection(k, -1), BaselineError);
    k[2] = 3; // unpacked length 3, data 2
    assert.throws(() => kernelSection(k, 0), /section 0 is not the length its header gives/);
  });
});

describe('nameCounts', () => {
  test('counts entries, empty and failed entries per kind', () => {
    const k = kernel({ item: ['Pebble', '', 'Kettle'], weapon: ['Stick', [0xe0, 0xff]], materia: ['Glow'] });
    assert.deepEqual(nameCounts(k, 'item'), { built: 1, count: 3, empty: 1, failed: 0 });
    assert.deepEqual(nameCounts(k, 'weapon'), { built: 1, count: 2, empty: 0, failed: 1 });
    assert.deepEqual(nameCounts(k, 'materia'), { built: 1, count: 1, empty: 0, failed: 0 });
  });
  test('a section with no table, a short archive, or no archive: built 0', () => {
    const none = { built: 0, count: 0, empty: 0, failed: 0 };
    assert.deepEqual(nameCounts(kernel(), 'armor'), none); // one filler byte: too short for a table
    assert.deepEqual(nameCounts(archive([Uint8Array.of(0)]), 'item'), none);
    assert.deepEqual(nameCounts(null, 'item'), none);
    assert.throws(() => nameCounts(kernel(), 'key'), RangeError);
  });
  test('only numbers come out', () => {
    const out = nameCounts(kernel({ accessory: ['Ring'] }), 'accessory');
    assert.deepEqual(Object.keys(out), NAME_REPORT);
    assert.ok(Object.values(out).every((v) => Number.isInteger(v)));
  });
});

describe('namesHold', () => {
  test('builds, no failures, count in [min, max] (defaults 1 and the ID count)', () => {
    const c = { built: 1, count: 3, empty: 1, failed: 0 };
    assert.equal(namesHold(c, 'item'), true);
    assert.equal(namesHold({ ...c, failed: 1 }, 'item'), false);
    assert.equal(namesHold({ ...c, built: 0 }, 'item'), false);
    assert.equal(namesHold({ ...c, count: 0 }, 'item'), false);
    assert.equal(namesHold({ ...c, count: NAME_KIND_COUNTS.armor }, 'armor'), true);
    assert.equal(namesHold({ ...c, count: NAME_KIND_COUNTS.armor + 1 }, 'armor'), false);
    assert.equal(namesHold(c, 'item', { min: 4 }), false);
    assert.equal(namesHold(c, 'item', { max: 2 }), false);
  });
  test('the kinds are the name sections', () => {
    assert.deepEqual(NAME_KINDS, Object.keys(KERNEL_NAME_SECTIONS));
  });
});

describe('format 2 kernelNames check', async () => {
  const { readFileSync } = await import('node:fs');
  const { ScenarioError, loadScenario } = await import('../../scenario.js');
  const doc = JSON.parse(readFileSync(new URL('../../../harness/scenarios/kernel-names-3-materia.json', import.meta.url), 'utf8'));
  test('the Tier 2 scenarios load, and report only their counts', () => {
    const sc = loadScenario(doc, { allowTier2: true });
    const chk = sc.asserts.find((a) => a.kind === 'kernelNames');
    assert.equal(chk.names, 'materia');
    assert.deepEqual(Object.keys(chk.report).sort(), ['count', 'empty', 'failed']);
  });
  test('refuses a scenario that boots no disc, and an unknown kind', () => {
    const fx = { ...doc, tier: 1, boot: { fixture: 'pad-echo', from: 'pad-echo-ready' } };
    assert.throws(() => loadScenario(fx), (e) => e instanceof ScenarioError && /must boot a disc/.test(e.message));
    const bad = structuredClone(doc);
    bad.assert[0].kernelNames.kind = 'key';
    assert.throws(() => loadScenario(bad, { allowTier2: true }), ScenarioError);
  });
});
