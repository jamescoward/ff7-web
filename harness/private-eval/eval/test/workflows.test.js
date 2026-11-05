// Static checks on the Tier 2 workflow files (issue #35). Tier 1.
// The YAML is kept thin; these tests pin down the few properties that live
// in the YAML itself rather than in lib.js.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WF = path.resolve(HERE, '../../../../.github/workflows');
const build = readFileSync(path.join(WF, 'tier2-build.yml'), 'utf8');
const evalWf = readFileSync(path.join(WF, 'tier2-eval.yml'), 'utf8');
const code = (text) => text.split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n');

/** Split a workflow into its steps: the text from one `- ` item under `steps:` to the next. */
function steps(text) {
  const out = [];
  let cur = null;
  let inSteps = false;
  for (const line of code(text).split('\n')) {
    if (/^ {4}steps:\s*$/.test(line)) {
      inSteps = true;
      continue;
    }
    if (/^ {2}\S/.test(line) || /^ {4}\S/.test(line)) inSteps = false;
    if (!inSteps) continue;
    if (/^ {6}- /.test(line)) {
      cur = [line];
      out.push(cur);
    } else if (cur) {
      cur.push(line);
    }
  }
  return out.map((l) => l.join('\n'));
}

/** The text of each step's run: block. */
const runBlocks = (text) => steps(text).map((s) => s.split(/\n\s+run: ?/)[1] ?? '').filter(Boolean)
  .map((r) => r.split(/\n {8}[a-z-]+:/)[0]);

test('workflows: every action is pinned to a full commit id', () => {
  for (const [name, text] of [['build', build], ['eval', evalWf]]) {
    const uses = [...code(text).matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
    assert.ok(uses.length > 0, name);
    for (const u of uses) assert.match(u, /^[a-z0-9-]+\/[a-z0-9-]+@[0-9a-f]{40}$/, `${name}: ${u}`);
  }
});

test('workflows: no ${{ }} expression inside a run: block (no script injection)', () => {
  for (const [name, text] of [['build', build], ['eval', evalWf]]) {
    const blocks = runBlocks(text);
    assert.ok(blocks.length > 3, name);
    for (const b of blocks) assert.ok(!b.includes('${{'), `${name}: ${b.slice(0, 60)}`);
  }
});

test('build: untrusted half has no secrets, no environment, and a read-only token', () => {
  const c = code(build);
  assert.ok(!/secrets\./.test(c));
  assert.ok(!/environment:/.test(c));
  assert.ok(!/pull_request_target|workflow_run/.test(c));
  assert.match(c, /^permissions:\n {2}contents: read\n/m);
  assert.ok(!/write/.test(c.match(/^permissions:[\s\S]*?\n\S/m)[0]));
  assert.match(c, /name: tier2-build\n/);
  assert.match(c, /retention-days: 1/);
});

test('eval: triggers are workflow_run of tier2-build and workflow_dispatch only', () => {
  const on = code(evalWf).match(/^on:\n([\s\S]*?)\n\S/m)[1];
  const triggers = [...on.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]);
  assert.deepEqual(triggers, ['workflow_run', 'workflow_dispatch']);
  assert.match(on, /workflows: \[tier2-build\]/);
  assert.match(code(evalWf), /^permissions: \{\}$/m);
});

test('eval: secrets appear only in the disc step, which runs only in the main-only environment', () => {
  const s = steps(evalWf);
  const withSecrets = s.filter((x) => x.includes('secrets.'));
  assert.equal(withSecrets.length, 1);
  assert.match(withSecrets[0], /name: Fetch the disc/);
  assert.match(withSecrets[0], /if: steps\.work\.outputs\.scenarios != '0'/);
  const jobs = code(evalWf).split(/\n {2}(?=[a-z]+:\n)/);
  const gate = jobs.find((j) => j.startsWith('gate:'));
  const ev = jobs.find((j) => j.startsWith('eval:'));
  assert.ok(!gate.includes('secrets.') && !gate.includes('environment:'), 'the gate holds no secrets');
  assert.match(ev, /environment: tier2-private/);
  assert.match(ev, /if: needs\.gate\.outputs\.run == 'true'/);
});

test('eval: the disc never reaches the cache or an artifact, and is deleted even on failure', () => {
  const c = code(evalWf);
  assert.ok(!/actions\/cache|upload-artifact|^\s+cache:/m.test(c));
  const s = steps(evalWf);
  const last = s[s.length - 1];
  assert.match(last, /name: Delete the disc and the build/);
  assert.match(last, /if: always\(\)\n/);
  assert.match(last, /tier2\.js cleanup --root/);
  const disc = s.find((x) => x.includes('Fetch the disc'));
  assert.match(disc, /"\$T2\/disc\//, 'the disc goes under the job root that cleanup removes');
});

test('eval: the artifact is downloaded into the empty directory prepare made, then checked before anything else', () => {
  const s = steps(evalWf);
  const idx = (re) => s.findIndex((x) => re.test(x));
  const prep = idx(/tier2\.js prepare/);
  const dl = idx(/actions\/download-artifact@/);
  const check = idx(/tier2\.js check-work/);
  const disc = idx(/Fetch the disc/);
  const run = idx(/tier2\.js evaluate/);
  assert.ok(prep >= 0 && prep < dl && dl < check && check < disc && disc < run, [prep, dl, check, disc, run].join());
  assert.match(s[dl], /path: \$\{\{ runner\.temp \}\}\/tier2\/work$/m);
  assert.match(s[dl], /name: tier2-build\n/);
  // Nothing from the artifact is executed on the host: every run: block calls
  // trusted code from the checkout, or moves the disc.
  for (const b of runBlocks(evalWf)) {
    for (const line of b.split('\n').map((l) => l.trim()).filter((l) => l && l !== '|')) {
      assert.match(line, /^(node harness\/private-eval\/eval\/tier2\.js |echo "T2=|aws s3 cp |--endpoint-url |chmod 0644 "\$T2\/disc\/|mv "\$T2\/disc\/|git status|test -z)/, line);
    }
  }
});

test('eval: checkouts never keep credentials', () => {
  for (const text of [build, evalWf]) {
    const n = (code(text).match(/actions\/checkout@/g) ?? []).length;
    assert.equal((code(text).match(/persist-credentials: false/g) ?? []).length, n);
  }
});
