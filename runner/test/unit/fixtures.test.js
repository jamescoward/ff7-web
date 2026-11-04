// The fixture registry: every fixture records its licence and origin, and
// its pinned SHA-256 matches what is built or stored. No core build needed.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { DEFAULT_FIXTURES, ScenarioError, resolveFixture } from '../../scenario.js';
import { LOAD_ADDR, build } from '../../../harness/fixtures/pad-echo.js';

const reg = JSON.parse(readFileSync(`${DEFAULT_FIXTURES}/fixtures.json`, 'utf8'));

test('every fixture records a licence, origin and pinned hash, and matches it', async () => {
  const names = Object.keys(reg.fixtures);
  assert.ok(names.length >= 1);
  for (const name of names) {
    const e = reg.fixtures[name];
    assert.ok(e.licence && e.origin, `${name}: licence and origin recorded`);
    assert.equal(e.redistributable, true, `${name}: only redistributable fixtures are registered`);
    assert.match(e.sha256, /^[0-9a-f]{64}$/);
    const fx = await resolveFixture(name);
    assert.equal(fx.sha256, e.sha256);
  }
});

test('an unknown fixture is rejected', async () => {
  await assert.rejects(resolveFixture('no-such-fixture'), ScenarioError);
});

test('pad-echo is a well-formed, deterministic PS-X EXE', () => {
  const exe = build();
  assert.equal(exe.toString('latin1', 0, 8), 'PS-X EXE');
  assert.equal(exe.readUInt32LE(0x10), LOAD_ADDR);
  assert.equal(exe.length, 0x800 + exe.readUInt32LE(0x1c));
  assert.deepEqual(build(), exe);
});

test('a fixture whose bytes differ from the pinned hash is refused', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ff7-fixtures-'));
  try {
    writeFileSync(path.join(dir, 'stub.mjs'), "export const build = () => Buffer.from('not the pinned bytes');\n");
    const bad = structuredClone(reg);
    bad.fixtures['pad-echo'].module = 'stub.mjs';
    writeFileSync(path.join(dir, 'fixtures.json'), JSON.stringify(bad));
    await assert.rejects(resolveFixture('pad-echo', dir), /registry pins/);
    delete bad.fixtures['pad-echo'].licence;
    writeFileSync(path.join(dir, 'fixtures.json'), JSON.stringify(bad));
    await assert.rejects(resolveFixture('pad-echo', dir), /no recorded licence/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
