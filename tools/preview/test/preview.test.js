// Preview assembly and gh-pages layout, on temp trees.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildSite, checkSite, listSlots, placeSlot, removeSlot } from '../lib.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.resolve(HERE, '../build.js');
const PUBLISH = path.resolve(HERE, '../publish.js');
const GUARD = path.resolve(HERE, '../../asset-guard/check.js');
const SHA = 'a'.repeat(40);

let tmp;
beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'preview-'));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const p = (...xs) => path.join(tmp, ...xs);
const put = (rel, data = 'x') => {
  mkdirSync(path.dirname(p(rel)), { recursive: true });
  writeFileSync(p(rel), data);
};
const read = (rel) => readFileSync(p(rel), 'utf8');
const site = (name, slot) => {
  buildSite({ out: p(name), webDir: p('no-web'), slot, sha: SHA, repo: 'o/r' });
  return p(name);
};

describe('buildSite', () => {
  test('writes a placeholder when web/ does not exist', () => {
    const files = buildSite({ out: p('out'), webDir: p('web'), slot: 'pr-14', sha: SHA, repo: 'o/r' });
    assert.deepEqual(files, ['index.html', 'preview.json']);
    assert.match(read('out/index.html'), /PR #14 at commit <a href="https:\/\/github.com\/o\/r\/commit\/a{40}">a{7}<\/a>/);
    assert.match(read('out/index.html'), /name="viewport"/);
    assert.deepEqual(JSON.parse(read('out/preview.json')), { format: 1, slot: 'pr-14', sha: SHA, repo: 'o/r', source: 'placeholder' });
  });

  test('copies web/ when it exists', () => {
    put('web/index.html', '<!doctype html>');
    put('web/js/app.mjs', 'export {}');
    put('web/core.wasm', '\0asm');
    const files = buildSite({ out: p('out'), webDir: p('web'), slot: 'main', sha: SHA });
    assert.deepEqual(files, ['core.wasm', 'index.html', 'js/app.mjs', 'preview.json']);
    assert.equal(JSON.parse(read('out/preview.json')).source, 'web/');
  });

  test('refuses file types off the allow-list', () => {
    put('web/index.html');
    put('web/disc.bin');
    put('web/notes.md');
    assert.throws(() => buildSite({ out: p('out'), webDir: p('web'), slot: 'main' }), /disc\.bin, notes\.md/);
  });

  test('refuses dotfiles and symlinks', () => {
    put('web/index.html');
    put('web/.env', 'SECRET=1');
    assert.throws(() => buildSite({ out: p('o1'), webDir: p('web'), slot: 'main' }), /dotfiles: \.env/);
    rmSync(p('web/.env'));
    symlinkSync('/etc/hostname', p('web/x.txt'));
    assert.throws(() => buildSite({ out: p('o2'), webDir: p('web'), slot: 'main' }), /symlinks: x\.txt/);
  });

  test('needs an index.html', () => {
    put('web/app.js');
    assert.throws(() => buildSite({ out: p('out'), webDir: p('web'), slot: 'main' }), /no index\.html/);
  });

  test('refuses bad slot names and an existing output dir', () => {
    for (const slot of ['pr-0', 'pr-01', 'pr-x', '../main', 'main/x', 'PR-1', '']) {
      assert.throws(() => buildSite({ out: p(`o-${Math.random()}`), slot }), /bad preview slot/, slot);
    }
    mkdirSync(p('exists'));
    assert.throws(() => buildSite({ out: p('exists'), slot: 'main' }), /already exists/);
  });

  test('a built placeholder passes the asset guard', () => {
    site('out', 'pr-3');
    const r = spawnSync(process.execPath, [GUARD, '--root', p('out'), '--walk'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
});

describe('gh-pages layout', () => {
  beforeEach(() => {
    mkdirSync(p('pages'));
    put('pages/CNAME-like-unrelated.txt', 'keep me');
  });

  test('place creates pr-<n>/ and main/ with an index listing them, main first', () => {
    placeSlot({ pages: p('pages'), slot: 'pr-12', site: site('s12', 'pr-12') });
    placeSlot({ pages: p('pages'), slot: 'pr-3', site: site('s3', 'pr-3') });
    placeSlot({ pages: p('pages'), slot: 'main', site: site('sm', 'main') });
    assert.deepEqual(listSlots(p('pages')), ['main', 'pr-3', 'pr-12']);
    assert.ok(existsSync(p('pages/pr-12/index.html')));
    assert.ok(existsSync(p('pages/.nojekyll')));
    const index = read('pages/index.html');
    assert.ok(index.indexOf('./main/') < index.indexOf('./pr-3/') && index.indexOf('./pr-3/') < index.indexOf('./pr-12/'));
    assert.match(index, /<code>aaaaaaa<\/code>/);
    assert.equal(read('pages/CNAME-like-unrelated.txt'), 'keep me');
  });

  test('place replaces the whole folder, so removed files disappear', () => {
    put('web/index.html');
    put('web/old.js');
    buildSite({ out: p('v1'), webDir: p('web'), slot: 'pr-5' });
    placeSlot({ pages: p('pages'), slot: 'pr-5', site: p('v1') });
    rmSync(p('web/old.js'));
    buildSite({ out: p('v2'), webDir: p('web'), slot: 'pr-5' });
    placeSlot({ pages: p('pages'), slot: 'pr-5', site: p('v2') });
    assert.ok(!existsSync(p('pages/pr-5/old.js')));
  });

  test('remove deletes only that PR folder and updates the index', () => {
    placeSlot({ pages: p('pages'), slot: 'pr-7', site: site('s7', 'pr-7') });
    placeSlot({ pages: p('pages'), slot: 'pr-8', site: site('s8', 'pr-8') });
    removeSlot({ pages: p('pages'), slot: 'pr-7' });
    assert.deepEqual(listSlots(p('pages')), ['pr-8']);
    assert.doesNotMatch(read('pages/index.html'), /pr-7/);
    assert.equal(read('pages/CNAME-like-unrelated.txt'), 'keep me');
    removeSlot({ pages: p('pages'), slot: 'pr-7' }); // already gone: no-op
    removeSlot({ pages: p('pages'), slot: 'pr-8' });
    assert.match(read('pages/index.html'), /No previews yet/);
  });

  test('place re-checks the site, so an unchecked folder cannot be published', () => {
    put('bad/index.html');
    put('bad/save.mcr');
    assert.throws(() => placeSlot({ pages: p('pages'), slot: 'pr-9', site: p('bad') }), /save\.mcr/);
    assert.ok(!existsSync(p('pages/pr-9')));
  });

  test('checkSite lists files for a valid site', () => {
    assert.deepEqual(checkSite(site('ok', 'main')), ['index.html', 'preview.json']);
  });
});

describe('CLIs', () => {
  const node = (...args) => spawnSync(process.execPath, args, { encoding: 'utf8' });

  test('build, place and remove end to end', () => {
    mkdirSync(p('pages'));
    let r = node(BUILD, '--out', p('site'), '--slot', 'pr-21', '--sha', SHA, '--web', p('none'));
    assert.equal(r.status, 0, r.stderr);
    r = node(PUBLISH, 'place', '--pages', p('pages'), '--slot', 'pr-21', '--site', p('site'));
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(p('pages/pr-21/index.html')));
    r = node(PUBLISH, 'remove', '--pages', p('pages'), '--slot', 'pr-21');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!existsSync(p('pages/pr-21')));
  });

  test('usage errors exit 2', () => {
    assert.equal(node(BUILD, '--slot', 'main').status, 2);
    assert.equal(node(PUBLISH, 'explode', '--pages', tmp, '--slot', 'main').status, 2);
    assert.equal(node(PUBLISH, 'remove', '--pages', tmp, '--slot', '../etc').status, 2);
  });
});
