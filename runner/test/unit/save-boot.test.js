// Boot from a generated save (#38): the New Game baseline reader on a
// synthetic KERNEL.BIN built from the documented structure, the wrong-
// checksum card, the "save" boot option, and mark steps with change "since".
// Tier 1: synthetic data only, no game bytes; no core build needed.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { SAVE_BOOT_POINT } from '../../bootpoints.js';
import { DiscError } from '../../disc.js';
import { loadSaveDescription, playScript, saveBootCard } from '../../format2.js';
import {
  BaselineError, INIT_OFFSET, KERNEL_INIT_TYPE, baselineFromDisc, baselineFromKernel, initData, newGameSavemap, parseBinGzip,
} from '../../savegen/baseline.js';
import { savemapChecksum } from '../../savegen/checksum.js';
import { generateCard } from '../../savegen/index.js';
import { BLOCK_SIZE, SAVEMAP_IN_BLOCK, SAVEMAP_SIZE } from '../../savegen/layout.js';
import { validate } from '../../schema.js';
import { DEFAULT_SAVES, SCHEMA_PATH, ScenarioError, loadScenario, savesDirFor } from '../../scenario.js';
import { buildIso } from '../../synth/iso9660.js';
import { findTier2Scenarios } from '../../tier2.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const clone = (o) => structuredClone(o);
const tmp = mkdtempSync(path.join(tmpdir(), 'ff7-save-boot-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

/** A synthetic pattern of `n` bytes: no game data. */
const pattern = (n, seed) => Uint8Array.from({ length: n }, (_, i) => (i * 113 + seed) & 0xff);

/**
 * A synthetic BIN-GZIP archive as the wiki documents it: per section a u16
 * packed length, u16 unpacked length, u16 file type, then gzip data.
 * KERNEL.BIN has 27 sections, file types 0-8 then 9 (wiki); `init` is the
 * type 3 section's content.
 */
function kernelArchive(init, { types = [0, 1, 2, 3, 4, 5, 6, 7, 8, ...Array(18).fill(9)], lie = 0 } = {}) {
  const parts = [];
  types.forEach((type, i) => {
    const data = type === KERNEL_INIT_TYPE ? init : pattern(40 + i, i);
    const gz = new Uint8Array(gzipSync(data));
    const h = new Uint8Array(6);
    const v = new DataView(h.buffer);
    v.setUint16(0, gz.length, true);
    v.setUint16(2, data.length + (type === KERNEL_INIT_TYPE ? lie : 0), true);
    v.setUint16(4, type, true);
    parts.push(h, gz);
  });
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// The length of the real section is not assumed: 0x0B08 here, the end of
// the savemap in another test.
const INIT = pattern(0x0b08, 7);

describe('baseline reader (synthetic KERNEL.BIN)', () => {
  test('splits the archive into its 27 sections with their types and lengths', () => {
    const k = kernelArchive(INIT);
    const secs = parseBinGzip(k);
    assert.equal(secs.length, 27);
    assert.deepEqual(secs.slice(0, 10).map((s) => s.type), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.equal(secs[3].unpacked, INIT.length);
    assert.equal(secs[0].offset, 6);
  });

  test('finds the type 3 section and decompresses it', () => {
    assert.deepEqual(initData(kernelArchive(INIT)), INIT);
  });

  test('the type decides, not the position', () => {
    assert.deepEqual(initData(kernelArchive(INIT, { types: [9, 3, 0] })), INIT);
  });

  test('a gzip member with a broken trailer is still read, and its length checked', () => {
    const k = kernelArchive(INIT);
    const s = parseBinGzip(k)[3];
    k[s.offset + s.packed - 5] ^= 0x55; // CRC-32 in the trailer
    assert.deepEqual(initData(k), INIT);
  });

  const bad = {
    'a truncated section header': (k) => k.subarray(0, k.length - 1).slice(0, 3),
    'a section running past the end': (k) => k.subarray(0, k.length - 1),
    'no section of type 3': () => kernelArchive(INIT, { types: [0, 1, 2, 4] }),
    'a length the header does not give': () => kernelArchive(INIT, { lie: 1 }),
    'data that is not gzip': (k) => {
      const c = k.slice();
      const s = parseBinGzip(k)[3];
      c[s.offset] = 0;
      return c;
    },
    'data too long for the savemap': () => kernelArchive(pattern(SAVEMAP_SIZE - INIT_OFFSET + 1, 1)),
  };
  for (const [name, make] of Object.entries(bad)) {
    test(`rejects ${name}`, () => {
      assert.throws(() => initData(make(kernelArchive(INIT))), BaselineError);
    });
  }

  test('the New Game savemap: the init data at 0x0054, then the values a New Game stores', () => {
    const sm = baselineFromKernel(kernelArchive(INIT));
    const v = new DataView(sm.buffer);
    assert.equal(sm.length, SAVEMAP_SIZE);
    // The init data, except what the savemap reset after the copy overrides.
    const overridden = new Set([0x04f8, 0x04f9, 0x04fa]);
    for (let i = 0; i < INIT.length; i++) {
      if (!overridden.has(INIT_OFFSET + i)) assert.equal(sm[INIT_OFFSET + i], INIT[i], `0x${(INIT_OFFSET + i).toString(16)}`);
    }
    // Hand-written from the notes (notes/38-generated-save-boot.md).
    assert.deepEqual([...sm.subarray(0, INIT_OFFSET)], Array(INIT_OFFSET).fill(0)); // header: the generator fills it
    assert.deepEqual([...sm.subarray(0x04f8, 0x04fb)], [0x00, 0xff, 0xff]); // party: Cloud alone
    assert.equal(v.getUint32(0x0b90, true), 0); // worldmap_exit_action
    assert.equal(v.getUint16(0x0b94, true), 1); // module: field
    assert.equal(v.getUint16(0x0b96, true), 0x74); // md1stin
    assert.equal(sm[0x0ea4], 1); // bank 4 byte 0: disc 1
    assert.equal(sm[0x0ea4 + 0x68], 0xff); // empty location name
    assert.deepEqual([sm[0x0ba4 + 0x1c], sm[0x0ba4 + 0x1d]], [0xff, 0xff]); // menu visibility
    assert.deepEqual([...sm.subarray(0x0ca4 + 9, 0x0ca4 + 12)], [0x00, 0xff, 0xff]);
    assert.equal(v.getUint16(0x10a6, true), 1); // phs visibility: Cloud
    assert.deepEqual([sm[0x10d8], sm[0x10d9], sm[0x10ec]], [128, 128, 128]);
    assert.equal(v.getUint16(0x10da, true), 0x41);
    assert.deepEqual([...sm.subarray(0x10dc, 0x10ec)], Array.from({ length: 16 }, (_, i) => i));
    assert.equal(v.getUint16(0x0ba4, true), 0); // progress: banks are zeroed
  });

  test('banks and config come from the New Game steps even when the init data covers them', () => {
    const init = pattern(SAVEMAP_SIZE - INIT_OFFSET, 3);
    const sm = newGameSavemap(init);
    assert.equal(sm[0x0ba4 + 0x40], 0); // bank 1, zeroed by the reset after the copy
    assert.equal(sm[0x10dc + 5], 5); // button map default after the copy
    assert.equal(sm[0x10f3], init[0x10f3 - INIT_OFFSET]); // past the config: the init data
  });

  test('reads INIT/KERNEL.BIN from a synthetic disc image', () => {
    const bin = path.join(tmp, 'disc-k.bin');
    writeFileSync(bin, buildIso({ files: { 'SYSTEM.CNF': Buffer.from('BOOT = cdrom:\\X.EXE;1\n'), 'INIT/KERNEL.BIN': Buffer.from(kernelArchive(INIT)) } }));
    assert.deepEqual(baselineFromDisc(bin), baselineFromKernel(kernelArchive(INIT)));
  });

  test('a disc without INIT/KERNEL.BIN is a DiscError', () => {
    const bin = path.join(tmp, 'disc-nok.bin');
    writeFileSync(bin, buildIso({ files: { 'SYSTEM.CNF': Buffer.from('BOOT = cdrom:\\X.EXE;1\n') } }));
    assert.throws(() => baselineFromDisc(bin), DiscError);
  });
});

const DESC = {
  format: 1,
  label: 'boot test',
  slot: 1,
  field: { id: 0x75, x: 32767, y: 0, triangle: 12, direction: 0 },
  party: [0, 255, 255],
  progress: 9,
};

describe('generated card with a wrong checksum', () => {
  const baseline = baselineFromKernel(kernelArchive(INIT));
  const right = generateCard(baseline, DESC).card;
  const wrong = generateCard(baseline, DESC, { checksum: 'wrong' }).card;
  const at = DESC.slot * BLOCK_SIZE + SAVEMAP_IN_BLOCK;
  const sm = (c) => c.subarray(at, at + SAVEMAP_SIZE);

  test('the right card stores the checksum of its savemap', () => {
    assert.equal(new DataView(sm(right).slice().buffer).getUint32(0, true), savemapChecksum(sm(right)));
  });

  test('the wrong card differs only in the checksum low word, inverted', () => {
    const r = new DataView(sm(right).slice().buffer).getUint32(0, true);
    const w = new DataView(sm(wrong).slice().buffer).getUint32(0, true);
    assert.equal(w, r ^ 0xffff);
    assert.ok(w <= 0xffff);
    const diff = [];
    for (let i = 0; i < right.length; i++) if (right[i] !== wrong[i]) diff.push(i - at);
    assert.deepEqual(diff.filter((d) => d > 1), []);
  });

  test('rejects an unknown checksum option', () => {
    assert.throws(() => generateCard(baseline, DESC, { checksum: 'off' }), /right.*wrong/);
  });

  test('saveBootCard builds the card from the disc baseline', () => {
    const bin = path.join(tmp, 'disc-card.bin');
    writeFileSync(bin, buildIso({ files: { 'SYSTEM.CNF': Buffer.from('BOOT = cdrom:\\X.EXE;1\n'), 'INIT/KERNEL.BIN': Buffer.from(kernelArchive(INIT)) } }));
    assert.deepEqual(saveBootCard({ desc: DESC, checksum: 'right' }, bin), right);
    assert.deepEqual(saveBootCard({ desc: DESC, checksum: 'wrong' }, bin), wrong);
  });
});

/** A save-boot scenario (tier 2) with a mark and a change since it. */
const saveDoc = () => ({
  format: 2,
  name: 'save-boot-test',
  tier: 2,
  boot: { disc: 1, save: 'sv', slot: 1 },
  memory: { pos: { addr: '0x80074eb0', type: 'u32' }, mode: { addr: '0x8009c560', type: 'u16' } },
  input: [
    { wait: { until: { mem: 'mode', equals: 1 }, timeout: 100 }, metric: 'w' },
    { mark: 'loaded' },
    { buttons: ['up'], frames: 10 },
  ],
  assert: [{ change: { mem: 'pos', is: 'changed', since: 'loaded' }, metric: 'moved' }],
  metrics: ['w', 'moved'],
});

describe('"save" boot option (schema and loader)', () => {
  const saves = path.join(tmp, 'saves');
  rmSync(saves, { recursive: true, force: true });
  writeFileSync(path.join(tmp, 'placeholder'), '');
  // eslint-disable-next-line no-sync
  mkdtempSync(path.join(tmp, 'x-'));
  const dir = mkdtempSync(path.join(tmp, 'saves-'));
  writeFileSync(path.join(dir, 'sv.json'), JSON.stringify(DESC));
  writeFileSync(path.join(dir, 'bad.json'), JSON.stringify({ ...DESC, progress: -1 }));
  writeFileSync(path.join(dir, 'notjson.json'), '{');
  const load = (d) => loadScenario(d, { allowTier2: true, savesDir: dir });

  test('a save boot is valid and starts from the title boot point with a card', () => {
    assert.deepEqual(validate(schema, saveDoc()), []);
    const sc = load(saveDoc());
    assert.equal(sc.bootPoint.name, SAVE_BOOT_POINT);
    assert.equal(sc.bootPoint.card, 'blank');
    assert.deepEqual(sc.save, { name: 'sv', desc: DESC, checksum: 'right', slot: 1 });
    assert.equal(sc.disc, 'disc-1');
  });

  test('checksum "wrong" and an explicit boot point with a card', () => {
    const d = saveDoc();
    d.boot.checksum = 'wrong';
    d.boot.from = 'title-card';
    assert.equal(load(d).save.checksum, 'wrong');
  });

  const schemaBad = {
    'disc 2': (d) => { d.boot.disc = 2; },
    'slot 2': (d) => { d.boot.slot = 2; },
    'no slot': (d) => { delete d.boot.slot; },
    'an unknown checksum option': (d) => { d.boot.checksum = 'none'; },
    'a fixture source': (d) => { delete d.boot.disc; d.boot.fixture = 'pad-echo'; },
    'a path as the save name': (d) => { d.boot.save = '../sv'; },
    'a mark with an unknown member': (d) => { d.input[1].frames = 1; },
    'an unknown member in boot': (d) => { d.boot.card = 'x'; },
  };
  for (const [name, mutate] of Object.entries(schemaBad)) {
    test(`the schema refuses ${name}`, () => {
      const d = saveDoc();
      mutate(d);
      assert.notDeepEqual(validate(schema, d), [], name);
      assert.throws(() => load(d), ScenarioError, name);
    });
  }

  const loaderBad = {
    'a boot point with no card': [(d) => { d.boot.from = 'title'; }, /no memory card/],
    'a missing description': [(d) => { d.boot.save = 'nope'; }, /no save description named "nope"/],
    'an invalid description': [(d) => { d.boot.save = 'bad'; }, /is not valid/],
    'a description that is not JSON': [(d) => { d.boot.save = 'notjson'; }, /save description "notjson"/],
    'change since an unknown mark': [(d) => { d.assert[0].change.since = 'other'; }, /no mark step named "other"/],
    'two marks of one name': [(d) => { d.input.push({ mark: 'loaded' }); }, /already set/],
  };
  for (const [name, [mutate, re]] of Object.entries(loaderBad)) {
    test(`the loader refuses ${name}`, () => {
      const d = saveDoc();
      mutate(d);
      assert.deepEqual(validate(schema, d), [], name);
      assert.throws(() => load(d), (e) => e instanceof ScenarioError && re.test(e.message), name);
    });
  }

  test('loadSaveDescription refuses names that are not plain names', () => {
    assert.throws(() => loadSaveDescription('../x', dir), /not a valid/);
    assert.throws(() => loadSaveDescription('sv', null), /no saves directory/);
  });

  test('the saves directory of a scenario file is harness/saves', () => {
    assert.equal(savesDirFor(path.resolve(HERE, '../../../harness/scenarios/x.json')), DEFAULT_SAVES);
  });

  test('tier2.js starts a save boot with no "from" from the title boot point', () => {
    const sdir = mkdtempSync(path.join(tmp, 'scen-'));
    writeFileSync(path.join(sdir, 'save-boot-test.json'), JSON.stringify(saveDoc()));
    const [found] = findTier2Scenarios(sdir);
    assert.equal(found.from, SAVE_BOOT_POINT);
    assert.equal(found.after, null);
  });
});

describe('mark steps and change "since"', () => {
  /** A fake backend: one u32 at 0x80000010 counts frames. */
  const fake = () => {
    let n = 0;
    return {
      setPad() {},
      stepFrame() {
        n += 1;
      },
      readMem(addr, len) {
        const b = new Uint8Array(len);
        if (addr === 0x80000010) new DataView(b.buffer).setUint32(0, n, true);
        return b;
      },
      frameHash: () => 'x',
    };
  };
  const memory = { count: { addr: 0x80000010, type: 'u32', len: 4 }, other: { addr: 0x80000020, type: 'u16', len: 2 } };

  test('a mark records every numeric location at that point and takes no frames', () => {
    const steps = [{ kind: 'wait', frames: 3 }, { kind: 'mark', name: 'a' }, { kind: 'wait', frames: 2 }, { kind: 'mark', name: 'b' }];
    const r = playScript(fake(), steps, memory);
    assert.equal(r.frames, 5);
    assert.deepEqual([...r.marks.get('a')], [['count', 3], ['other', 0]]);
    assert.deepEqual([...r.marks.get('b')], [['count', 5], ['other', 0]]);
  });

  test('a mark after a timed-out wait is not reached', () => {
    const cond = { mem: 'other', op: 'equals', value: 1 };
    const steps = [{ kind: 'until', cond, timeout: 2, press: null }, { kind: 'mark', name: 'a' }];
    const r = playScript(fake(), steps, memory);
    assert.equal(r.timedOut, true);
    assert.equal(r.marks.has('a'), false);
  });

  test('the loader keeps since on the check and refuses marks in boot point scripts', () => {
    const d = saveDoc();
    const dir = mkdtempSync(path.join(tmp, 'saves2-'));
    writeFileSync(path.join(dir, 'sv.json'), JSON.stringify(DESC));
    const sc = loadScenario(d, { allowTier2: true, savesDir: dir });
    assert.equal(sc.asserts[0].since, 'loaded');
    assert.equal(sc.steps[1].kind, 'mark');
    const points = { bp: { source: { disc: 1 }, script: [{ mark: 'x' }], note: 'test' } };
    const e = clone(d);
    e.boot = { disc: 1, from: 'bp' };
    assert.throws(() => loadScenario(e, { allowTier2: true, bootPoints: points }), /no marks/);
  });
});
