import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFieldDrag, DEAD_ZONE, LEASH, RUN_DISTANCE, RUN_STOP_MS } from '../js/field-drag.js';
import { PAD } from '../js/pad.js';

const polar = (drag, degrees, distance = 30) => drag.move(
  Math.cos(degrees * Math.PI / 180) * distance,
  -Math.sin(degrees * Math.PI / 180) * distance,
);

test('field drag: dead zone, all eight sectors and release', () => {
  const drag = createFieldDrag();
  assert.equal(drag.move(0, 0), 0);
  assert.equal(drag.move(DEAD_ZONE - 0.01, 0), 0);
  assert.equal(drag.move(DEAD_ZONE, 0), PAD.right);
  const expected = [PAD.right, PAD.right | PAD.up, PAD.up, PAD.up | PAD.left,
    PAD.left, PAD.left | PAD.down, PAD.down, PAD.down | PAD.right];
  for (let i = 0; i < 8; i++) assert.equal(polar(drag, i * 45), expected[i]);
  assert.equal(drag.release(), 0);
  assert.equal(drag.mask, 0);
  // Release and returning to the dead zone both forget the previous sector.
  polar(drag, 0);
  drag.release();
  assert.equal(polar(drag, 24), PAD.right | PAD.up);
  assert.equal(drag.move(1, 1), 0);
  assert.equal(polar(drag, 21), PAD.right);
});

test('field drag: sector hysteresis in both directions and across the angle wrap', () => {
  const drag = createFieldDrag();
  for (let i = 0; i < 8; i++) {
    drag.release();
    const start = polar(drag, i * 45);
    assert.equal(polar(drag, i * 45 + 24), start);
    assert.equal(polar(drag, i * 45 + 21), start);
    const next = polar(drag, i * 45 + 30);
    assert.notEqual(next, start);
    assert.equal(polar(drag, i * 45 + 20), next);
    assert.equal(polar(drag, i * 45 + 15), start);
    drag.release();
    polar(drag, i * 45);
    assert.equal(polar(drag, i * 45 - 24), start);
    assert.notEqual(polar(drag, i * 45 - 30), start);
  }
});

test('field drag: running starts at the threshold and holds through a retreat until release', () => {
  const drag = createFieldDrag();
  assert.equal(drag.move(0, -(RUN_DISTANCE - 0.01)), PAD.up);
  assert.equal(drag.move(0, -RUN_DISTANCE), PAD.up | PAD.cross);
  // Pulling back inside the run distance keeps running (owner feedback, PR #63).
  assert.equal(drag.move(0, -30), PAD.up | PAD.cross);
  assert.equal(drag.release(), 0);
  assert.equal(drag.move(0, -30), PAD.up, 'a new touch starts walking');
});

test('field drag: the origin trails the thumb, so reversing is short at any drag length', () => {
  const drag = createFieldDrag();
  assert.equal(drag.move(200, 0), PAD.right | PAD.cross);
  assert.deepEqual(drag.origin, { x: 200 - LEASH, y: 0 });
  // Back past the trailed origin, not the landing point: 80 px of travel, not 200+.
  assert.equal(drag.move(200 - LEASH - DEAD_ZONE + 1, 0), 0);
  assert.equal(drag.move(200 - LEASH - 20, 0), PAD.left | PAD.cross);
  assert.deepEqual(drag.origin, { x: 200 - LEASH, y: 0 }, 'inside the leash the origin stays put');
  drag.release();
  assert.deepEqual(drag.origin, { x: 0, y: 0 });
});

test('field drag: a quick pass through the origin keeps the run; resting there ends it', () => {
  const drag = createFieldDrag();
  drag.move(RUN_DISTANCE, 0, 0);
  assert.equal(drag.move(0, 0, 50), 0, 'no buttons while in the dead zone');
  assert.equal(drag.move(-20, 0, 50 + RUN_STOP_MS - 1), PAD.left | PAD.cross);
  // Rest in the dead zone, then walk off slowly: walking, not running.
  drag.move(0, 0, 1000);
  assert.equal(drag.move(0, 0, 1000 + RUN_STOP_MS), 0);
  assert.equal(drag.move(0, 20, 1100 + RUN_STOP_MS), PAD.down);
  // The rest is also measured when the thumb leaves without a move inside.
  drag.move(RUN_DISTANCE, 0, 2000);
  drag.move(0, 0, 2100);
  assert.equal(drag.move(20, 0, 2100 + RUN_STOP_MS), PAD.right);
  assert.equal(drag.move(RUN_DISTANCE, 0, 3000), PAD.right | PAD.cross, 'and running can start again');
});
