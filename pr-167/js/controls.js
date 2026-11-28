import { createFieldControls } from './field-controls.js';
import { createVirtualGamepad } from './gamepad.js';

const STORAGE_KEY = 'ff7-web-control-mode';

export function createControls({ padRoot, fieldRoot, toggle, mixer }) {
  const pad = createVirtualGamepad(padRoot, { onChange: (m) => mixer.set('touch', m) });
  const field = createFieldControls(fieldRoot, { onChange: (m) => mixer.set('field', m) });
  let mode = 'gamepad';
  try {
    if (window.localStorage.getItem(STORAGE_KEY) === 'field') mode = 'field';
  } catch { /* Storage may be disabled; the toggle still works. */ }

  function releaseAll() {
    pad.releaseAll();
    field.releaseAll();
  }
  function render() {
    padRoot.hidden = mode !== 'gamepad';
    fieldRoot.hidden = mode !== 'field';
    toggle.textContent = mode === 'field' ? 'Gamepad' : 'Drag to walk';
    toggle.setAttribute('aria-label', mode === 'field' ? 'Switch to classic gamepad' : 'Switch to drag to walk');
    toggle.setAttribute('aria-pressed', String(mode === 'field'));
  }
  toggle.addEventListener('click', () => {
    releaseAll();
    mode = mode === 'field' ? 'gamepad' : 'field';
    render();
    try { window.localStorage.setItem(STORAGE_KEY, mode); } catch { /* Optional preference. */ }
  });
  // A resize/orientation change invalidates the finger's origin.
  window.addEventListener('resize', releaseAll);
  window.addEventListener('blur', releaseAll);
  render();
  return {
    releaseAll,
    /** Automatic switch (#113): the shown layout changes, the saved preference does not. */
    setAuto(target) {
      if (target !== 'field' && target !== 'gamepad') return;
      if (target === mode) return;
      releaseAll();
      mode = target;
      render();
    },
    get mode() { return mode; },
  };
}
