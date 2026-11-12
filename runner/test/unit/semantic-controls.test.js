// Unit: semantic/controls.js (#114): tap meaning as plain data, no platform deps.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { DIALOGUE_ACTIONS, dialogueTapButton } from '../../../semantic/controls.js';
import { PAD } from '../../pad.js';

const sample = (open, waiting, confirmed = true) => ({ value: { open, waiting, choice: null }, confirmed });

describe('DIALOGUE_ACTIONS', () => {
  test('is frozen data naming real pad buttons', () => {
    assert.ok(Object.isFrozen(DIALOGUE_ACTIONS) && Object.isFrozen(DIALOGUE_ACTIONS.advance));
    assert.deepEqual(DIALOGUE_ACTIONS.advance, { id: 'advance', button: 'circle', when: 'waiting' });
    for (const a of Object.values(DIALOGUE_ACTIONS)) assert.ok(a.button in PAD, a.button);
  });
});

describe('dialogueTapButton', () => {
  test('waiting and confirmed gives circle', () => {
    assert.equal(dialogueTapButton(sample(true, true)), 'circle');
  });
  test('everything else gives null', () => {
    assert.equal(dialogueTapButton(sample(true, false)), null, 'typing');
    assert.equal(dialogueTapButton(sample(false, false)), null, 'closed');
    assert.equal(dialogueTapButton(sample(true, true, false)), null, 'unconfirmed');
    assert.equal(dialogueTapButton({ value: null, confirmed: false, reason: 'read failed' }), null);
    assert.equal(dialogueTapButton(null), null);
    assert.equal(dialogueTapButton(undefined), null);
    assert.equal(dialogueTapButton({ value: { waiting: 'yes' }, confirmed: true }), null);
  });
});

test('controls.js has no DOM, Worker, Node or timer references', () => {
  const src = readFileSync(new URL('../../../semantic/controls.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  for (const word of ['document', 'window', 'Worker', 'require(', 'process', 'setTimeout', 'setInterval', 'import']) {
    assert.ok(!new RegExp(`\\b${word.replace('(', '\\(')}`).test(src), `references ${word}`);
  }
});
