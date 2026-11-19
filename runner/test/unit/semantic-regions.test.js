// Unit (Tier 1): semantic/regions.js (#24), the mode gate for the picture crop.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CROP_REGIONS, MAX_SIDE_SHARE, MODE_LABELS, cropFor } from '../../../semantic/regions.js';
import { ADDRESS_TABLE } from '../../../semantic/addresses.js';

const ALLOWED = new Set(['field', 'battle']);
const SIZES = [[320, 240], [320, 224], [256, 240], [368, 240], [512, 240], [640, 480], [64, 32]];

test('the table covers every mode() label, and nothing else', () => {
  assert.deepEqual(Object.keys(CROP_REGIONS).sort(), [...MODE_LABELS].sort());
  // Every gameState label the address table can report is a covered mode label.
  const states = Object.values(ADDRESS_TABLE.entries.find((e) => e.name === 'gameState')?.values ?? {});
  for (const s of states) assert.ok(MODE_LABELS.includes(s), `gameState label ${s} has a row`);
});

test('every mode label x confirmed/unconfirmed x display size', () => {
  for (const mode of MODE_LABELS) {
    for (const confirmed of [true, false, undefined, null, 'true', 1]) {
      for (const [w, h] of SIZES) {
        const r = cropFor(mode, confirmed, w, h);
        if (confirmed === true && ALLOWED.has(mode)) {
          assert.ok(r && r.detect === true, `${mode} confirmed ${w}x${h} crops`);
          for (const side of ['top', 'bottom']) {
            assert.ok(r.maxInsets[side] >= 0 && r.maxInsets[side] <= Math.floor(h * MAX_SIDE_SHARE), `${mode} ${side} cap`);
          }
          for (const side of ['left', 'right']) {
            assert.ok(r.maxInsets[side] >= 0 && r.maxInsets[side] <= Math.floor(w * MAX_SIDE_SHARE), `${mode} ${side} cap`);
          }
        } else {
          assert.equal(r, null, `${mode} confirmed=${String(confirmed)} ${w}x${h}: full frame`);
        }
      }
    }
  }
});

test('movie, menu, world, minigame and unknown never crop', () => {
  for (const m of ['movie', 'menu', 'world', 'minigame', 'unknown']) assert.equal(cropFor(m, true, 320, 240), null);
});

test('labels outside the table, and inherited keys, never crop', () => {
  for (const m of ['', 'Field', 'toString', '__proto__', 'constructor', undefined, null, 1]) {
    assert.equal(cropFor(m, true, 320, 240), null, String(m));
  }
});

test('a missing or bad display size never crops', () => {
  for (const [w, h] of [[0, 240], [320, 0], [-1, 240], [320.5, 240], [NaN, 240], [undefined, undefined]]) {
    assert.equal(cropFor('field', true, w, h), null, `${w}x${h}`);
  }
});

test('table insets are used as given when under the cap', () => {
  assert.deepEqual(cropFor('field', true, 320, 240).maxInsets, CROP_REGIONS.field.maxInsets);
  assert.deepEqual(cropFor('battle', true, 320, 240).maxInsets, CROP_REGIONS.battle.maxInsets);
  // A small frame caps them: 64x32 -> 16 px sides, 8 px top and bottom.
  assert.deepEqual(cropFor('field', true, 64, 32).maxInsets, { top: 8, right: 16, bottom: 8, left: 16 });
});

test('results are fresh objects: callers cannot change the table', () => {
  const r = cropFor('field', true, 320, 240);
  r.maxInsets.top = 999;
  assert.equal(CROP_REGIONS.field.maxInsets.top, 48);
  assert.ok(Object.isFrozen(CROP_REGIONS) && Object.isFrozen(CROP_REGIONS.field.maxInsets));
});
