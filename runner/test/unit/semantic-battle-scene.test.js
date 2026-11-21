// Tier 1: the battle scene crop rectangle (#136, semantic/regions.js). Plain
// data and a pure function; no game data.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MIN_SCENE_SHARE, MODE_LABELS, SCENE_REF, SCENE_REGIONS, sceneRectFor } from '../../../semantic/regions.js';

test('the table has one row per mode() label, and only battle has a scene rectangle', () => {
  assert.deepEqual(Object.keys(SCENE_REGIONS).sort(), [...MODE_LABELS].sort());
  for (const m of MODE_LABELS) {
    if (m === 'battle') assert.ok(SCENE_REGIONS[m]);
    else assert.equal(SCENE_REGIONS[m], null, m);
  }
});

test('the table and its rows are frozen', () => {
  assert.ok(Object.isFrozen(SCENE_REGIONS));
  assert.ok(Object.isFrozen(SCENE_REF));
  for (const r of Object.values(SCENE_REGIONS)) if (r) assert.ok(Object.isFrozen(r));
});

test('the battle rectangle lies inside the reference frame and keeps at least the minimum share', () => {
  const r = SCENE_REGIONS.battle;
  for (const k of ['x', 'y', 'w', 'h']) assert.ok(Number.isInteger(r[k]) && r[k] >= 0, k);
  assert.ok(r.x + r.w <= SCENE_REF.width && r.y + r.h <= SCENE_REF.height);
  assert.ok(r.w >= SCENE_REF.width * MIN_SCENE_SHARE && r.h >= SCENE_REF.height * MIN_SCENE_SHARE);
});

test('a confirmed battle at the reference size gives the table rectangle', () => {
  assert.deepEqual(sceneRectFor('battle', true, 320, 240), { x: 0, y: 0, w: 320, h: 160 });
});

test('the rectangle scales with the frame and stays inside it', () => {
  const sizes = [[256, 240], [320, 224], [368, 240], [512, 240], [640, 240], [640, 480], [320, 256]];
  for (const [w, h] of sizes) {
    const r = sceneRectFor('battle', true, w, h);
    assert.ok(r, `${w}x${h}`);
    for (const k of ['x', 'y', 'w', 'h']) assert.ok(Number.isInteger(r[k]), `${w}x${h} ${k}`);
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h, `${w}x${h} inside`);
    assert.equal(r.w, w, `${w}x${h}: full width`);
    assert.equal(r.h, Math.round((160 * h) / 240), `${w}x${h}: height share`);
  }
});

test('every other mode, an unconfirmed battle and unknown labels give the full frame', () => {
  for (const m of MODE_LABELS) {
    assert.equal(sceneRectFor(m, false, 320, 240), null, `${m} unconfirmed`);
    if (m !== 'battle') assert.equal(sceneRectFor(m, true, 320, 240), null, m);
  }
  for (const c of [undefined, null, 1, 'true']) assert.equal(sceneRectFor('battle', c, 320, 240), null, String(c));
  for (const m of ['', 'Battle', 'toString', '__proto__', 'hasOwnProperty', undefined, null]) {
    assert.equal(sceneRectFor(m, true, 320, 240), null, String(m));
  }
});

test('bad frame sizes give the full frame', () => {
  for (const [w, h] of [[0, 240], [320, 0], [-320, 240], [320.5, 240], [NaN, 240], [undefined, undefined], ['320', '240']]) {
    assert.equal(sceneRectFor('battle', true, w, h), null, `${w}x${h}`);
  }
});

test('a tiny frame still gives a rectangle inside it', () => {
  const r = sceneRectFor('battle', true, 1, 1);
  assert.ok(r === null || (r.w <= 1 && r.h <= 1 && r.w >= 0.5 && r.h >= 0.5));
});
