// Unit (#290): semantic/addresses.json is the address table as plain JSON,
// for code in another language (docs/ARCHITECTURE_SURVEY.md §8). It must
// match semantic/addresses.js exactly; regenerate it with
// node tools/semantic-json/export.js.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import * as addresses from '../../../semantic/addresses.js';
import { OUT, exportsOf, render, upToDate } from '../../../tools/semantic-json/export.js';

const json = () => JSON.parse(readFileSync(OUT, 'utf8'));

test('semantic/addresses.json is up to date (run node tools/semantic-json/export.js to fix)', () => {
  assert.ok(upToDate());
});

test('every address-table entry round-trips', () => {
  const doc = json();
  assert.equal(doc.ADDRESS_TABLE.exe, addresses.ADDRESS_TABLE.exe);
  assert.equal(doc.ADDRESS_TABLE.entries.length, addresses.ADDRESS_TABLE.entries.length);
  addresses.ADDRESS_TABLE.entries.forEach((e, i) => {
    const j = doc.ADDRESS_TABLE.entries[i];
    assert.deepEqual(j, JSON.parse(JSON.stringify(e)), e.name);
    // the fields a reader in another language relies on, spelled out
    for (const k of ['name', 'address', 'type', 'status', 'scenario', 'stride', 'count', 'exe']) assert.deepEqual(j[k], e[k], `${e.name}.${k}`);
    for (const [raw, label] of Object.entries(e.values ?? {})) assert.equal(j.values[raw], label, `${e.name}.values[${raw}]`);
  });
});

test('only functions are left out, and the constants come through', () => {
  const { left } = exportsOf(addresses);
  for (const name of left) assert.equal(typeof addresses[name], 'function', name);
  const doc = json();
  assert.deepEqual(doc._leftOut, left);
  for (const name of ['TYPES', 'SAVEMAP', 'CHARACTER_RECORDS', 'CHARACTER_RECORD_SIZE', 'FIELD_GATEWAYS', 'BATTLE_WIDGETS', 'WINDOW_WAITING_STATES', 'EXE_USA_SHA1']) {
    assert.deepEqual(doc[name], JSON.parse(JSON.stringify(addresses[name])), name);
  }
});

test('the export leaves out values JSON cannot hold, and is deterministic', () => {
  const mod = { B: 1, A: { x: [1, 2] }, f: () => 1, nan: Number.NaN, undef: undefined, inf: Infinity };
  const { kept, left } = exportsOf(mod);
  assert.deepEqual(Object.keys(kept), ['A', 'B']);
  assert.deepEqual(left, ['f', 'inf', 'nan', 'undef']);
  assert.equal(render(), render());
  assert.ok(render().endsWith('}\n'));
});
