// The gh-pages checkout and push scripts, against a local bare repository
// standing in for GitHub (PREVIEW_REMOTE_URL). No network, no token.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildSite, placeSlot, removeSlot } from '../lib.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECKOUT = path.resolve(HERE, '../gh-pages-checkout.sh');
const PUSH = path.resolve(HERE, '../gh-pages-push.sh');

let tmp;
let env;
beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'gh-pages-'));
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', path.join(tmp, 'remote.git')]);
  env = {
    ...process.env,
    PREVIEW_REMOTE_URL: path.join(tmp, 'remote.git'),
    GITHUB_REPOSITORY: 'o/r',
    GITHUB_OUTPUT: path.join(tmp, 'out.txt'),
    GH_TOKEN: '',
    GITHUB_ACTIONS: '',
  };
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const p = (...xs) => path.join(tmp, ...xs);
const sh = (script, ...args) => {
  const r = spawnSync('bash', [script, ...args], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r.stdout;
};
const remoteGit = (...args) => execFileSync('git', ['--git-dir', p('remote.git'), ...args], { encoding: 'utf8' }).trim();
const outputs = () => readFileSync(p('out.txt'), 'utf8');
const site = (name, slot) => {
  buildSite({ out: p(name), webDir: p('none'), slot, sha: 'b'.repeat(40) });
  return p(name);
};

test('--existing-only does nothing when gh-pages is missing', () => {
  assert.match(sh(CHECKOUT, p('pages'), '--existing-only'), /nothing to do/);
  assert.ok(!existsSync(p('pages')));
  assert.match(outputs(), /exists=false/);
});

test('first deploy creates gh-pages; later ones replace it with one parentless commit', () => {
  sh(CHECKOUT, p('pages'));
  placeSlot({ pages: p('pages'), slot: 'pr-4', site: site('s4', 'pr-4') });
  assert.match(sh(PUSH, p('pages'), 'Preview pr-4'), /updated/);
  assert.deepEqual(remoteGit('ls-tree', '--name-only', 'gh-pages').split('\n'), ['.nojekyll', 'index.html', 'pr-4']);

  rmSync(p('pages'), { recursive: true });
  sh(CHECKOUT, p('pages'));
  assert.match(outputs(), /exists=true/);
  placeSlot({ pages: p('pages'), slot: 'main', site: site('sm', 'main') });
  sh(PUSH, p('pages'), 'Preview main');
  assert.equal(remoteGit('rev-list', '--count', 'gh-pages'), '1', 'no history kept');
  assert.equal(remoteGit('log', '-1', '--format=%an %s', 'gh-pages'), 'github-actions[bot] Preview main');
  assert.deepEqual(remoteGit('ls-tree', '--name-only', 'gh-pages').split('\n'), ['.nojekyll', 'index.html', 'main', 'pr-4']);
});

test('an unchanged tree is not pushed again', () => {
  sh(CHECKOUT, p('pages'));
  placeSlot({ pages: p('pages'), slot: 'pr-1', site: site('s1', 'pr-1') });
  sh(PUSH, p('pages'), 'first');
  const before = remoteGit('rev-parse', 'gh-pages');
  rmSync(p('pages'), { recursive: true });
  sh(CHECKOUT, p('pages'));
  placeSlot({ pages: p('pages'), slot: 'pr-1', site: site('s1b', 'pr-1') });
  assert.match(sh(PUSH, p('pages'), 'again'), /unchanged/);
  assert.equal(remoteGit('rev-parse', 'gh-pages'), before);
});

test('cleanup removes a closed PR folder from the published branch', () => {
  sh(CHECKOUT, p('pages'));
  placeSlot({ pages: p('pages'), slot: 'pr-2', site: site('s2', 'pr-2') });
  placeSlot({ pages: p('pages'), slot: 'pr-3', site: site('s3', 'pr-3') });
  sh(PUSH, p('pages'), 'two previews');
  rmSync(p('pages'), { recursive: true });

  sh(CHECKOUT, p('pages'), '--existing-only');
  removeSlot({ pages: p('pages'), slot: 'pr-2' });
  sh(PUSH, p('pages'), 'Remove preview pr-2');
  assert.deepEqual(remoteGit('ls-tree', '--name-only', 'gh-pages').split('\n'), ['.nojekyll', 'index.html', 'pr-3']);
  assert.doesNotMatch(remoteGit('show', 'gh-pages:index.html'), /pr-2/);
});

test('an unreachable remote is an error, not a fresh branch', () => {
  env.PREVIEW_REMOTE_URL = p('does-not-exist.git');
  const r = spawnSync('bash', [CHECKOUT, p('pages')], { encoding: 'utf8', env });
  assert.notEqual(r.status, 0);
  assert.ok(!existsSync(p('pages')));
});
