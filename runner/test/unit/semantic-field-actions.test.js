// Unit: the field buttons' meanings as plain data in semantic/controls.js (#146).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { FIELD_ACTIONS } from '../../../semantic/controls.js';
import { PAD } from '../../pad.js';

test('FIELD_ACTIONS: Interact ○ circle, Menu △ triangle, Back ✕ cross, in that order, frozen', () => {
  assert.ok(Object.isFrozen(FIELD_ACTIONS) && FIELD_ACTIONS.every(Object.isFrozen));
  assert.deepEqual(FIELD_ACTIONS.map((a) => [a.id, a.label, a.button, a.kind]), [
    ['interact', 'Interact ○', 'circle', 'action'],
    ['menu', 'Menu △', 'triangle', 'action'],
    ['back', 'Back ✕', 'cross', 'back'],
  ]);
  for (const a of FIELD_ACTIONS) assert.ok(a.button in PAD, a.button);
});

test('field-controls.js holds no field button facts of its own', () => {
  const src = readFileSync(new URL('../../../web/js/field-controls.js', import.meta.url), 'utf8');
  for (const fact of ['Interact', 'Menu', 'Back', '○', '△', '✕', "'circle'", "'triangle'", "'cross'", '"circle"', '"triangle"', '"cross"']) {
    assert.ok(!src.includes(fact), `field-controls.js mentions ${fact}`);
  }
});
