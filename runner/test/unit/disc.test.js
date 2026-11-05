// Unit: runner/disc.js on synthetic images (runner/synth/iso9660.js), and
// the format 1 loader rules for disc boot (#36). No core needed.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DiscError, openDisc, parseBootLine, parseCue } from '../../disc.js';
import { loadScenario, resolveDisc, ScenarioError, SCHEMA_PATH } from '../../scenario.js';
import { validate } from '../../schema.js';
import { buildIso, cueFor } from '../../synth/iso9660.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SMOKE = path.resolve(HERE, '../../../harness/scenarios/disc-boot-smoke.json');

const exe = Buffer.from('PS-X EXE test body '.repeat(300)); // 5700 bytes: three sectors
const files = {
  'SYSTEM.CNF': 'BOOT = cdrom:\\GAME_123.45;1\r\nTCB = 4\r\nSTACK = 801FFF00\r\n',
  'GAME_123.45': exe,
  'MENU/A.MNU': Buffer.alloc(5000, 7),
};

let dir;
before(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ff7-disc-'));
});
after(() => rmSync(dir, { recursive: true, force: true }));

describe('disc reader', () => {
  for (const mode of ['MODE2/2352', 'MODE1/2352', 'MODE1/2048']) {
    test(`reads files and the boot path from a ${mode} image, bare and through a cue`, () => {
      const tag = mode.replace('/', '-');
      const bin = path.join(dir, `${tag}.bin`);
      writeFileSync(bin, buildIso({ files, mode }));
      writeFileSync(path.join(dir, `${tag}.cue`), cueFor(`${tag}.bin`, mode));
      for (const p of [bin, path.join(dir, `${tag}.cue`)]) {
        const disc = openDisc(p);
        try {
          assert.equal(disc.mode, mode);
          assert.equal(disc.bootPath(), 'GAME_123.45');
          assert.ok(disc.read('GAME_123.45').equals(exe));
          assert.ok(disc.read('game_123.45;1').equals(exe), 'case and version suffix are ignored');
          assert.ok(disc.read('MENU/A.MNU').equals(Buffer.alloc(5000, 7)));
          assert.ok(disc.read('menu\\a.mnu').equals(Buffer.alloc(5000, 7)));
          assert.throws(() => disc.read('MENU/B.MNU'), DiscError);
          assert.throws(() => disc.read('MENU'), /is a directory/);
          assert.throws(() => disc.read('GAME_123.45/X'), /not a directory/);
        } finally {
          disc.close();
        }
      }
    });
  }

  test('a cue resolves its FILE only next to itself', () => {
    const sub = mkdtempSync(path.join(dir, 'cue-'));
    writeFileSync(path.join(sub, 'x.bin'), buildIso({ files }));
    writeFileSync(path.join(sub, 'x.cue'), cueFor('../elsewhere/x.bin'));
    const disc = openDisc(path.join(sub, 'x.cue'));
    assert.equal(disc.image, path.join(sub, 'x.bin'));
    disc.close();
  });

  test('images without an ISO9660 volume are refused', () => {
    const junk = path.join(dir, 'junk.bin');
    writeFileSync(junk, Buffer.alloc(2352 * 20));
    assert.throws(() => openDisc(junk), /primary volume descriptor/);
    const odd = path.join(dir, 'odd.bin');
    writeFileSync(odd, Buffer.alloc(1000));
    assert.throws(() => openDisc(odd), /whole number/);
    assert.throws(() => openDisc(path.join(dir, 'missing.bin')), /cannot open/);
  });

  test('cue sheets', () => {
    assert.deepEqual(parseCue('FILE "disc-1.bin" BINARY\r\n  TRACK 01 MODE2/2352\r\n    INDEX 01 00:00:00\r\n  TRACK 02 AUDIO\r\n'),
      { file: 'disc-1.bin', mode: 'MODE2/2352' });
    assert.deepEqual(parseCue('FILE a.bin BINARY\nTRACK 1 mode1/2048\n'), { file: 'a.bin', mode: 'MODE1/2048' });
    assert.deepEqual(parseCue('\xEF\xBB\xBFFILE "a.bin" BINARY\nTRACK 01 MODE2/2352\n'), { file: 'a.bin', mode: 'MODE2/2352' }, 'UTF-8 BOM read as latin1');
    assert.deepEqual(parseCue('\uFEFFFILE "a.bin" BINARY\nTRACK 01 MODE2/2352\n'), { file: 'a.bin', mode: 'MODE2/2352' });
    assert.equal(new DiscError('x', 'cue').step, 'cue');
    assert.throws(() => parseCue('TRACK 01 MODE2/2352\n'), /no FILE/);
    assert.throws(() => parseCue('FILE "a.bin" BINARY\n'), /no TRACK/);
    assert.throws(() => parseCue('FILE "a.bin" BINARY\nTRACK 01 AUDIO\n'), /unsupported/);
  });

  test('SYSTEM.CNF boot lines', () => {
    assert.equal(parseBootLine('BOOT = cdrom:\\SCUS_000.01;1\r\n'), 'SCUS_000.01');
    assert.equal(parseBootLine('TCB=4\nBOOT=cdrom0:\\DIR\\MAIN.EXE;1\n'), 'DIR\\MAIN.EXE');
    assert.equal(parseBootLine('boot = cdrom:MAIN.EXE\n'), 'MAIN.EXE');
    assert.throws(() => parseBootLine('TCB = 4\n'), /no BOOT/);
  });
});

describe('disc boot scenarios: loader', () => {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  const base = () => ({
    format: 1,
    name: 'd',
    tier: 2,
    boot: { disc: 'disc-1' },
    frames: 100,
    memory: { code: { addr: '0x80010000', type: 'bytes', len: 16 }, word: { addr: '0x80010000', type: 'u32' } },
    assert: [
      { discFile: 'SYSTEM.CNF:BOOT', sha1: 'a'.repeat(40), metric: 'exe_match' },
      { within: 100, mem: 'code', equalsDiscFile: { path: 'GAME_123.45', offset: 0 }, metric: 'code_frame' },
      { within: 50, mem: 'word', equals: '0x1' },
    ],
    probes: [{ within: 41, stillFrames: 60, metric: 'still_frame' }],
    metrics: ['exe_match', 'code_frame', 'still_frame', 'fps'],
  });

  test('the committed smoke scenario and the example load', () => {
    const smoke = JSON.parse(readFileSync(SMOKE, 'utf8'));
    assert.deepEqual(validate(schema, smoke), []);
    const sc = loadScenario(smoke, { allowTier2: true });
    assert.equal(sc.disc, 'disc-1');
    assert.equal(sc.fixture, null);
    assert.ok(sc.metrics.length <= 8);
    assert.deepEqual(validate(schema, base()), []);
    const b = loadScenario(base(), { allowTier2: true });
    assert.deepEqual(b.asserts.map((a) => a.kind), ['discFile', 'withinDisc', 'within']);
    assert.deepEqual(b.probes.map((a) => a.kind), ['still']);
  });

  const schemaRejects = {
    'disc name outside disc-1..3': (d) => { d.boot.disc = 'disc-4'; },
    'fixture and disc together': (d) => { d.boot.fixture = 'pad-echo'; },
    'upper-case sha1': (d) => { d.assert[0].sha1 = 'A'.repeat(40); },
    'disc path with ..': (d) => { d.assert[0].discFile = '../x'; },
    'probe that is a plain memory assertion': (d) => { d.probes.push({ at: 1, mem: 'word', equals: 1, metric: 'm' }); },
    'stillFrames of 1': (d) => { d.probes[0].stillFrames = 1; },
    'equalsDiscFile without offset': (d) => { delete d.assert[1].equalsDiscFile.offset; },
  };
  for (const [name, mutate] of Object.entries(schemaRejects)) {
    test(`schema rejects: ${name}`, () => {
      const d = base();
      mutate(d);
      assert.notDeepEqual(validate(schema, d), []);
      assert.throws(() => loadScenario(d, { allowTier2: true }), ScenarioError);
    });
  }

  const loaderRejects = {
    'disc checks on a fixture boot': [(d) => { d.boot = { fixture: 'pad-echo' }; }, /needs a disc boot/],
    'equalsDiscFile on a u32': [(d) => { d.assert[1].mem = 'word'; }, /needs a bytes location/],
    'within after the last frame': [(d) => { d.assert[2].within = 101; }, /after the last frame/],
    'still run that cannot finish': [(d) => { d.probes[0].within = 42; }, /within \+ stillFrames - 1/],
    'probe without a metric': [(d) => { delete d.probes[0].metric; d.metrics = d.metrics.filter((k) => k !== 'still_frame'); }, /must name its metric/],
    'metric named twice': [(d) => { d.assert[1].metric = 'exe_match'; d.metrics = ['exe_match', 'still_frame']; }, /already named/],
    'named metric not listed': [(d) => { d.metrics = ['exe_match', 'code_frame']; }, /not listed in metrics/],
    'named metric that is also a built-in': [(d) => { d.probes[0].metric = 'fps'; d.metrics = ['exe_match', 'code_frame', 'fps']; }, /also a built-in metric/],
    'named metric that is also a memory name': [(d) => { d.probes[0].metric = 'word'; d.metrics = ['exe_match', 'code_frame', 'word']; }, /also a memory name/],
    'unknown memory in within': [(d) => { d.assert[2].mem = 'nope'; }, /no memory location named "nope"/],
  };
  for (const [name, [mutate, re]] of Object.entries(loaderRejects)) {
    test(`loader rejects: ${name}`, () => {
      const d = base();
      mutate(d);
      assert.throws(() => loadScenario(d, { allowTier2: true }), (e) => e instanceof ScenarioError && re.test(e.message), name);
    });
  }

  test('resolveDisc: <name>.bin next to the image, then the image; a cue is never used; else "no disc"', () => {
    const sub = mkdtempSync(path.join(dir, 'resolve-'));
    const alias = path.join(sub, 'disc.bin');
    assert.throws(() => resolveDisc('disc-1', undefined), (e) => e instanceof ScenarioError && /^no disc/.test(e.message));
    assert.throws(() => resolveDisc('disc-1', alias), (e) => e instanceof ScenarioError && /^no disc/.test(e.message) && !e.message.includes(sub));
    writeFileSync(alias, '');
    assert.deepEqual(resolveDisc('disc-1', alias), { file: alias });
    writeFileSync(path.join(sub, 'disc-1.bin'), '');
    assert.deepEqual(resolveDisc('disc-1', alias), { file: path.join(sub, 'disc-1.bin') });
    // The core parses a same-named cue (or .toc/.ccd/.mds) instead of the
    // bin, so an image without one wins: the private eval's layout.
    for (const ext of ['.cue', '.toc', '.ccd', '.mds']) {
      writeFileSync(path.join(sub, `disc-1${ext}`), '');
      assert.deepEqual(resolveDisc('disc-1', alias), { file: alias }, ext);
      rmSync(path.join(sub, `disc-1${ext}`));
    }
    writeFileSync(path.join(sub, 'disc-1.cue'), '');
    writeFileSync(path.join(sub, 'disc.cue'), '');
    assert.deepEqual(resolveDisc('disc-1', alias), { file: path.join(sub, 'disc-1.bin') }, 'all have sidecars: the first');
  });
});
