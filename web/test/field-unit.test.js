import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFieldDrag, DEAD_ZONE, RUN_DISTANCE } from '../js/field-drag.js';
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

test('field drag: running starts at the threshold and ends on retreat or release', () => {
  const drag = createFieldDrag();
  assert.equal(drag.move(0, -(RUN_DISTANCE - 0.01)), PAD.up);
  assert.equal(drag.move(0, -RUN_DISTANCE), PAD.up | PAD.cross);
  assert.equal(drag.move(-100, 100), PAD.down | PAD.left | PAD.cross);
  assert.equal(drag.move(0, 30), PAD.down);
  assert.equal(drag.move(0, 0), 0);
  drag.move(100, 0);
  assert.equal(drag.release(), 0);
});
