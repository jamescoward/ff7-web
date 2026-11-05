// Floating drag surface and independent action fingers. Input injection only.
import { createFieldDrag } from './field-drag.js';
import { PAD } from './pad.js';

export function createFieldControls(root, { onChange }) {
  root.classList.add('field-controls');
  root.innerHTML = `
    <span class="field-cue" aria-hidden="true"></span>
    <div class="field-actions" role="group" aria-label="Field actions">
      <button type="button" class="btn field-action" data-action="circle">Interact ○</button>
      <button type="button" class="btn field-action" data-action="triangle">Menu △</button>
      <button type="button" class="btn field-back" data-action="cross">Back ✕</button>
    </div>`;
  const doc = root.ownerDocument;
  const cue = root.querySelector('.field-cue');
  const drag = createFieldDrag();
  const pointers = new Map();
  let walker = null;
  let mask = 0;

  function actionAt(x, y) {
    const el = doc.elementFromPoint(x, y)?.closest('[data-action]');
    return el && root.contains(el) ? PAD[el.dataset.action] : 0;
  }
  function update() {
    let next = drag.mask;
    for (const p of pointers.values()) next |= p.mask;
    for (const el of root.querySelectorAll('[data-action]')) {
      el.classList.toggle('field-on', Boolean(next & PAD[el.dataset.action]));
    }
    if (next === mask) return;
    mask = next;
    onChange(mask);
  }
  function down(e) {
    if (root.hidden || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const hit = doc.elementFromPoint(e.clientX, e.clientY);
    if (!hit || !root.contains(hit)) return;
    const action = actionAt(e.clientX, e.clientY);
    if (!action && walker !== null) return;
    e.preventDefault();
    pointers.set(e.pointerId, { mask: action, x: e.clientX, y: e.clientY });
    if (!action) {
      walker = e.pointerId;
      drag.release();
      const r = root.getBoundingClientRect();
      cue.style.left = `${e.clientX - r.left}px`;
      cue.style.top = `${e.clientY - r.top}px`;
      cue.classList.add('field-cue-on');
    }
    try { root.setPointerCapture(e.pointerId); } catch { /* Synthetic test pointer. */ }
    update();
  }
  function move(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    if (e.pointerId === walker) drag.move(e.clientX - p.x, e.clientY - p.y);
    else p.mask = actionAt(e.clientX, e.clientY);
    update();
  }
  function releaseCapture(id) {
    if (root.hasPointerCapture(id)) root.releasePointerCapture(id);
  }
  function up(e) {
    if (!pointers.delete(e.pointerId)) return;
    e.preventDefault();
    if (walker === e.pointerId) {
      walker = null;
      drag.release();
      cue.classList.remove('field-cue-on');
    }
    releaseCapture(e.pointerId);
    update();
  }
  for (const [type, handler] of Object.entries({
    pointerdown: down, pointermove: move, pointerup: up,
    pointercancel: up, lostpointercapture: up,
  })) root.addEventListener(type, handler, { passive: false });
  root.addEventListener('contextmenu', (e) => e.preventDefault());
  root.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });

  return {
    releaseAll() {
      const ids = [...pointers.keys()];
      pointers.clear();
      walker = null;
      drag.release();
      cue.classList.remove('field-cue-on');
      ids.forEach(releaseCapture);
      update();
    },
  };
}
