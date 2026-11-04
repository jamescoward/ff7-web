// Asset guard on synthetic temp trees. No real game data: every "disc",
// "save" or "executable" here is a few bytes made up by the test.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DEFAULTS, FORBIDDEN_EXTENSIONS, checkTree, loadAllowlist, loadDenylist } from '../guard.js';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../check.js');
const sha = (b) => createHash('sha256').update(b).digest('hex');

let root;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'asset-guard-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const put = (rel, data = 'text\n') => {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, data);
  return abs;
};
const rules = (r) => r.violations.map((v) => `${v.path}:${v.rule}`);
const binary = (n) => Buffer.alloc(n, 0); // NUL bytes: binary
const json = (rel, obj) => put(rel, JSON.stringify(obj));

describe('forbidden extensions', () => {
  for (const [cat, exts] of Object.entries(FORBIDDEN_EXTENSIONS)) {
    for (const ext of exts) {
      test(`${ext} (${cat}) fails, in any case and directory`, () => {
        put(`a/b/file${ext}`, 'x');
        put(`UPPER${ext.toUpperCase()}`, 'x');
        assert.deepEqual(rules(checkTree(root)).sort(), [`UPPER${ext.toUpperCase()}:forbidden-extension`, `a/b/file${ext}:forbidden-extension`].sort());
      });
    }
  }

  test('numbered save-state slots fail', () => {
    put('game.state1', 'x');
    put('game.state12', 'x');
    assert.deepEqual(rules(checkTree(root)), ['game.state1:forbidden-extension', 'game.state12:forbidden-extension']);
  });

  test('an allow-list entry does not override a forbidden extension', () => {
    const data = 'tiny';
    put('ok.bin', data);
    const allowlist = new Map([['ok.bin', { path: 'ok.bin', sha256: sha(data) }]]);
    assert.deepEqual(rules(checkTree(root, { allowlist })), ['ok.bin:forbidden-extension']);
  });
});

describe('names and content', () => {
  test('PS1 disc executable names fail', () => {
    for (const n of ['SLUS_123.45', 'scus_942.01', 'SLES-12345', 'SLPS_000.00;1']) put(`d/${n}`, 'x');
    put('d/SLUSH.txt', 'x'); // not a disc executable name
    assert.deepEqual(rules(checkTree(root)).filter((r) => r.endsWith('disc-executable-name')).length, 4);
    assert.ok(!rules(checkTree(root)).some((r) => r.startsWith('d/SLUSH.txt')));
  });

  test('a PS-X EXE header fails under any name', () => {
    put('innocent.dat', Buffer.concat([Buffer.from('PS-X EXE'), binary(64)]));
    assert.deepEqual(rules(checkTree(root)), ['innocent.dat:content-signature']);
  });

  test('raw CD sector sync fails under any name', () => {
    const sync = Buffer.from([0, ...Array(10).fill(0xff), 0]);
    put('track.raw', Buffer.concat([sync, binary(100)]));
    assert.deepEqual(rules(checkTree(root)), ['track.raw:content-signature']);
  });

  test('an ISO9660 volume descriptor fails, cooked or raw', () => {
    const cooked = binary(0x8000 + 8);
    cooked.write('CD001', 0x8001, 'latin1');
    put('cooked.dat', cooked);
    const raw = Buffer.alloc(16 * 2352 + 32, 1); // no NULs at the start, no sync
    raw.write('CD001', 16 * 2352 + 24 + 1, 'latin1');
    put('raw.dat', raw);
    const r = checkTree(root, { limits: { maxBinaryBytes: 1e9 } });
    assert.deepEqual(rules(r), ['cooked.dat:content-signature', 'raw.dat:content-signature']);
  });

  test('ordinary source files pass', () => {
    put('src/a.js', 'export const x = 1;\n');
    put('docs/b.md', '# hi\n');
    put('small.png', binary(1000));
    assert.deepEqual(checkTree(root).violations, []);
  });
});

describe('size limits', () => {
  test('a binary over the limit fails; at the limit it passes', () => {
    put('big.wasm', binary(DEFAULTS.maxBinaryBytes + 1));
    put('edge.wasm', binary(DEFAULTS.maxBinaryBytes));
    assert.deepEqual(rules(checkTree(root)), ['big.wasm:oversize-binary']);
  });

  test('a large text file passes up to the file limit, then fails', () => {
    put('big.txt', 'a'.repeat(DEFAULTS.maxBinaryBytes * 2));
    assert.deepEqual(checkTree(root).violations, []);
    put('huge.txt', 'a'.repeat(DEFAULTS.maxFileBytes + 1));
    assert.deepEqual(rules(checkTree(root)), ['huge.txt:oversize-file']);
  });

  test('limits are configurable', () => {
    put('mid.wasm', binary(1000));
    assert.deepEqual(rules(checkTree(root, { limits: { maxBinaryBytes: 999 } })), ['mid.wasm:oversize-binary']);
  });
});

describe('allow-list', () => {
  const big = binary(DEFAULTS.maxBinaryBytes + 10);
  const entry = (p, h) => ({ path: p, sha256: h, licence: 'MIT', origin: 'test', reason: 'test' });

  test('an allow-listed file with a matching hash passes', () => {
    put('vendor/blob.wasm', big);
    const allowlist = new Map([['vendor/blob.wasm', entry('vendor/blob.wasm', sha(big))]]);
    assert.deepEqual(checkTree(root, { allowlist }).violations, []);
  });

  test('an allow-listed file that changed fails', () => {
    put('vendor/blob.wasm', big);
    const allowlist = new Map([['vendor/blob.wasm', entry('vendor/blob.wasm', '0'.repeat(64))]]);
    assert.deepEqual(rules(checkTree(root, { allowlist })), [
      'vendor/blob.wasm:allowlist-hash-mismatch',
      'vendor/blob.wasm:oversize-binary',
    ]);
  });

  test('entries need hash, licence, origin and reason', () => {
    const p = json('allow.json', { files: [{ path: 'x', sha256: '0'.repeat(64), licence: 'MIT', origin: 'o' }] });
    assert.throws(() => loadAllowlist(p), /needs "reason"/);
    const q = json('allow2.json', { files: [{ ...entry('x', 'nothex'), reason: 'r' }] });
    assert.throws(() => loadAllowlist(q), /not a SHA-256/);
  });
});

describe('deny-list', () => {
  test('a file whose hash is deny-listed fails under any name', () => {
    const data = 'pretend this is a known game file';
    put('notes/readme.txt', data);
    put('other.txt', 'fine');
    const denylist = loadDenylist([json('deny.json', { sha256: [sha(data).toUpperCase()] })]);
    // The deny-list file itself is in the tree; it holds only hashes, so it passes.
    assert.deepEqual(rules(checkTree(root, { denylist })), ['notes/readme.txt:deny-listed-hash']);
  });

  test('bad hashes in a deny-list are a configuration error', () => {
    assert.throws(() => loadDenylist([json('deny.json', { sha256: ['abc'] })]), /bad SHA-256/);
  });
});

describe('tree modes', () => {
  test('git mode checks tracked and untracked files but not ignored ones', () => {
    execFileSync('git', ['init', '-q'], { cwd: root });
    put('.gitignore', '/ignored/\n');
    put('ignored/disc.iso', 'x');
    put('untracked.cue', 'x');
    put('tracked.txt', 'x');
    execFileSync('git', ['add', 'tracked.txt', '.gitignore'], { cwd: root });
    const r = checkTree(root);
    assert.equal(r.mode, 'git');
    assert.deepEqual(rules(r), ['untracked.cue:forbidden-extension']);
  });

  test('git mode checks a force-added file even if it is ignored', () => {
    execFileSync('git', ['init', '-q'], { cwd: root });
    put('.gitignore', '*.iso\n');
    put('forced.iso', 'x');
    execFileSync('git', ['add', '-f', 'forced.iso'], { cwd: root });
    assert.deepEqual(rules(checkTree(root)), ['forced.iso:forbidden-extension']);
  });

  test('git mode reports stale allow-list entries', () => {
    execFileSync('git', ['init', '-q'], { cwd: root });
    const allowlist = new Map([['gone.wasm', { path: 'gone.wasm', sha256: '0'.repeat(64) }]]);
    assert.deepEqual(rules(checkTree(root, { allowlist })), ['gone.wasm:allowlist-stale']);
  });

  test('walk mode skips .git and does not follow symlinks', () => {
    put('.git/objects/pack.iso', 'x');
    put('site/index.html', '<!doctype html>');
    symlinkSync('/dev/null', path.join(root, 'site', 'link.txt'));
    const r = checkTree(root, { mode: 'walk' });
    assert.equal(r.mode, 'walk');
    assert.deepEqual(r.violations, []);
    assert.equal(r.checked, 2);
  });
});

describe('CLI', () => {
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, ASSET_GUARD_DENYLIST: '' } });

  test('exits 0 on a clean tree and 1 with violations, naming files and rules only', () => {
    put('ok.txt', 'fine');
    assert.equal(cli('--root', root, '--walk').status, 0);
    put('secret/disc.chd', 'SECRET-CONTENT');
    const r = cli('--root', root, '--walk');
    assert.equal(r.status, 1);
    assert.match(r.stdout, /secret\/disc\.chd: forbidden-extension/);
    assert.doesNotMatch(r.stdout + r.stderr, /SECRET-CONTENT/);
  });

  test('--json output, --max-binary-bytes, and deny-lists from the environment', () => {
    const data = 'known file';
    put('a.txt', data);
    const deny = json('../deny-env.json', { sha256: [sha(data)] });
    const r = spawnSync(process.execPath, [CLI, '--root', root, '--walk', '--json'], {
      encoding: 'utf8',
      env: { ...process.env, ASSET_GUARD_DENYLIST: deny },
    });
    rmSync(deny);
    assert.equal(r.status, 1);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, false);
    assert.deepEqual(out.violations, [{ path: 'a.txt', rule: 'deny-listed-hash', detail: 'matches a known game file' }]);

    rmSync(path.join(root, 'a.txt'));
    put('b.wasm', binary(500));
    assert.equal(cli('--root', root, '--walk', '--max-binary-bytes', '100').status, 1);
    assert.equal(cli('--root', root, '--walk', '--max-binary-bytes', 'lots').status, 2);
  });

  test('a broken config file is a usage error (exit 2)', () => {
    const bad = put('bad.json', '{');
    assert.equal(cli('--root', root, '--allowlist', bad).status, 2);
  });

  test('the repository itself is clean', () => {
    const r = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
});
