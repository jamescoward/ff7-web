// #269: the private eval splits tier 2 into shards and passes each shard's
// names to runner/tier2.js as --only. These checks run the trusted split
// (harness/private-eval/eval/lib.js) over the committed scenarios and
// compare it with the runner's own reading of chains (findTier2Scenarios),
// so a chain can never be split, and check that --only filters before the
// 128-scenario cap. No core, no disc.
// Original project code, GPL-2.0-or-later.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import * as eval_ from '../../../harness/private-eval/eval/lib.js';
import * as t2 from '../../tier2.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const readFile = (f) => readFileSync(f, 'utf8');

let dir;
before(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ff7-tier2-shards-'));
});
after(() => rmSync(dir, { recursive: true, force: true }));

describe('#269 shards over the committed scenarios', () => {
  const found = t2.findTier2Scenarios(t2.DEFAULT_SCENARIOS);
  const shards = Array.from({ length: eval_.SHARDS }, (_, i) => eval_.buildExpect(REPO, { shard: i, shards: eval_.SHARDS }));
  const shardOfName = new Map();
  shards.forEach((e, i) => { for (const n of Object.keys(e.scenarios)) shardOfName.set(n, i); });

  test('every tier 2 scenario is in exactly one shard', () => {
    const all = shards.flatMap((e) => Object.keys(e.scenarios));
    assert.equal(all.length, new Set(all).size);
    assert.deepEqual(all.sort(), found.map((s) => s.name).sort());
    assert.deepEqual(Object.keys(eval_.buildExpect(REPO).scenarios).sort(), found.map((s) => s.name).sort(), 'one shard of one is everything');
  });

  test('a scenario that boots from a named snapshot is in the same shard as its keeper (the runner\'s reading)', () => {
    const keepers = new Map();
    for (const s of found) if (s.snapshot) keepers.set(s.snapshot, [...(keepers.get(s.snapshot) ?? []), s.name]);
    let linked = 0;
    for (const s of found) {
      for (const k of (s.after ? keepers.get(s.after) ?? [] : [])) {
        assert.equal(shardOfName.get(s.name), shardOfName.get(k), `${s.name} after ${s.after} (kept by ${k})`);
        linked++;
      }
    }
    assert.ok(linked > 0, 'the committed scenarios have chains');
  });

  test('the shards are roughly even (no shard over two thirds)', () => {
    for (const e of shards) assert.ok(Object.keys(e.scenarios).length <= Math.ceil((found.length * 2) / 3), JSON.stringify(shards.map((x) => Object.keys(x.scenarios).length)));
  });

  test('chainLinks reads after and keeps as findTier2Scenarios does', () => {
    for (const s of found) {
      const doc = JSON.parse(readFile(s.file));
      const { after: a, keeps } = eval_.chainLinks(doc);
      if (s.after !== null) assert.equal(a, s.after, s.name);
      assert.equal(keeps, s.snapshot, s.name);
    }
  });
});

describe('#269 --only', () => {
  const sc = (name) => JSON.stringify({ format: 1, name, tier: 2, boot: { fixture: 'pad-echo' }, frames: 1 });
  test('picks only the named scenarios, and filters before the cap', () => {
    const sdir = path.join(dir, 'many');
    mkdirSync(sdir, { recursive: true });
    const n = t2.MAX_SCENARIOS + 5;
    for (let i = 0; i < n; i++) writeFileSync(path.join(sdir, `s${String(i).padStart(3, '0')}.json`), sc(`s${String(i).padStart(3, '0')}`));
    assert.equal(t2.findTier2Scenarios(sdir).length, t2.MAX_SCENARIOS);
    const last = `s${String(n - 1).padStart(3, '0')}`;
    assert.deepEqual(t2.findTier2Scenarios(sdir, new Set(['s000', last, 'nope'])).map((s) => s.name), ['s000', last]);
  });

  test('the sandbox command adds the shard\'s names, sorted', () => {
    assert.deepEqual(eval_.sandboxCommand({ format: 1, scenarios: { b: [], a: ['x'] } }), [...eval_.SANDBOX_COMMAND, '--only', 'a,b']);
  });
});
