// Keyboard input, for desktop testing and hardware keyboards on iPad/iPhone.

import { PAD } from './pad.js';

// KeyboardEvent.code -> button. Codes follow key position, not layout.
export const KEY_MAP = Object.freeze({
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyX: 'cross',
  KeyC: 'circle',
  KeyZ: 'square',
  KeyS: 'triangle',
  KeyQ: 'l1',
  KeyW: 'r1',
  Digit1: 'l2',
  Digit2: 'r2',
  Enter: 'start',
  ShiftRight: 'select',
  Backspace: 'select',
});

/**
 * Listen on `target` (window by default) and report a mask via onChange.
 * Keys typed into form fields are ignored.
 */
export function createKeyboard({ onChange, target = globalThis }) {
  const held = new Set();
  let mask = 0;

  const report = () => {
    let next = 0;
    for (const code of held) next |= PAD[KEY_MAP[code]];
    if (next !== mask) {
      mask = next;
      onChange(mask);
    }
  };

  const typing = (e) => e.target?.closest?.('input, textarea, select, [contenteditable]');

  const onDown = (e) => {
    if (!(e.code in KEY_MAP) || typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    held.add(e.code);
    report();
  };
  const onUp = (e) => {
    if (!held.delete(e.code)) return;
    e.preventDefault();
    report();
  };
  const onBlur = () => {
    held.clear();
    report();
  };

  target.addEventListener('keydown', onDown);
  target.addEventListener('keyup', onUp);
  target.addEventListener('blur', onBlur);
  return {
    get mask() {
      return mask;
    },
    releaseAll: onBlur,
    dispose() {
      target.removeEventListener('keydown', onDown);
      target.removeEventListener('keyup', onUp);
      target.removeEventListener('blur', onBlur);
    },
  };
}
