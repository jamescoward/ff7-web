// Unit: the context-aware Interact label (#25), semantic/controls.js
// interactLabel over a nearby() result (#112).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { FIELD_ACTIONS, INTERACT_LABELS, interactLabel } from '../../../semantic/controls.js';
import { nearbyFrom } from '../../../semantic/nearby.js';

const npc = (inRange, distance = 10) => ({ kind: 'npc', model: 1, dx: distance, dy: 0, distance, inRange, near: inRange, facing: true });
const exit = (inRange, distance = 20) => ({ kind: 'exit', gateway: 0, to: 5, dx: 0, dy: distance, distance, inRange });
const ok = (value) => ({ value, confirmed: true });
const PLAIN = FIELD_ACTIONS.find((a) => a.id === 'interact').label;

test('labels: Talk ○ and Exit ○, frozen; the plain label is FIELD_ACTIONS Interact', () => {
  assert.ok(Object.isFrozen(INTERACT_LABELS) && Object.values(INTERACT_LABELS).every(Object.isFrozen));
  assert.equal(INTERACT_LABELS.talk.label, 'Talk ○');
  assert.equal(INTERACT_LABELS.exit.label, 'Exit ○');
  assert.equal(PLAIN, 'Interact ○');
});

test('NPC in range: Talk', () => {
  assert.deepEqual(interactLabel(ok([npc(true)])), { id: 'talk', label: 'Talk ○', dim: false });
});

test('NPC out of range: plain, dimmed', () => {
  assert.deepEqual(interactLabel(ok([npc(false)])), { id: 'interact', label: PLAIN, dim: true });
});

test('exit in range: Exit', () => {
  assert.deepEqual(interactLabel(ok([exit(true)])), { id: 'exit', label: 'Exit ○', dim: false });
});

test('both in range: Talk wins (Circle talks), whichever is nearer', () => {
  assert.equal(interactLabel(ok([npc(true, 30), exit(true, 5)].sort((a, b) => a.distance - b.distance))).id, 'talk');
  assert.equal(interactLabel(ok([npc(true, 5), exit(true, 30)])).id, 'talk');
});

test('NPC out of range, exit in range: Exit; unknown models never count', () => {
  assert.equal(interactLabel(ok([npc(false, 2), exit(true)])).id, 'exit');
  assert.equal(interactLabel(ok([{ kind: 'unknown', model: 2, dx: 0, dy: 0, distance: 0, inRange: true }])).dim, true);
});

test('empty confirmed list: plain, dimmed', () => {
  assert.deepEqual(interactLabel(ok([])), { id: 'interact', label: PLAIN, dim: true });
});

test('unconfirmed result: plain, not dimmed, even with an NPC in range', () => {
  for (const value of [[npc(true)], [exit(true)], []]) {
    assert.deepEqual(interactLabel({ value, confirmed: false }), { id: 'interact', label: PLAIN, dim: false });
  }
});

test('failed reads and not-in-field results: plain, not dimmed', () => {
  for (const s of [null, undefined, {}, { value: null, confirmed: false, reason: 'read failed' },
    { value: null, confirmed: false, reason: 'out of range' }, { value: [], confirmed: true, reason: 'not in field' },
    { value: 'junk', confirmed: true }]) {
    assert.deepEqual(interactLabel(s), { id: 'interact', label: PLAIN, dim: false }, JSON.stringify(s));
  }
});

test('over nearbyFrom: facing an NPC within its talk range gives Talk', () => {
  const player = { x: 0, y: 0, z: 0, dir: 64, solidRange: 20, model: 0 };
  const models = [{ x: 0, y: 0, z: 0, talkOff: false, talkRange: 0 }, { x: 30, y: 0, z: 0, talkOff: false, talkRange: 30 }];
  const list = nearbyFrom({ player, models, gateways: [] });
  assert.equal(list[0].inRange, true);
  assert.equal(interactLabel(ok(list)).id, 'talk');
  // Turned away (dir 192): out of range, so plain and dimmed.
  const away = nearbyFrom({ player: { ...player, dir: 192 }, models, gateways: [] });
  assert.deepEqual(interactLabel(ok(away)), { id: 'interact', label: PLAIN, dim: true });
});

test('interact-label.js holds no label text of its own', () => {
  const src = readFileSync(new URL('../../../web/js/interact-label.js', import.meta.url), 'utf8');
  for (const fact of ['Talk', 'Exit', 'Interact ○', '○']) assert.ok(!src.includes(fact), `interact-label.js mentions ${fact}`);
});
