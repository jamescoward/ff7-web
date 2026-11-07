// The debug overlay (#79): a toggle and a read-only panel over the picture.
// Off by default. The toggle is hidden and disabled unless the semantic
// layer's hash gate is on (the disc's boot executable is the USA one).
// The panel ignores pointer events, so it never covers the touch controls.
// While it shows, its container (the picture box) carries data-debug-on, so
// the stylesheet can move it out of the picture in portrait (#93).
// Original project code, GPL-2.0-or-later.

/**
 * @param {object} o
 * @param {HTMLElement} o.panel
 * @param {HTMLButtonElement} o.toggle
 * @param {(on: boolean) => void} [o.onToggle]  start/stop the worker's polling
 */
export function createOverlay({ panel, toggle, onToggle }) {
  let on = false;
  let active = false;

  function render() {
    toggle.hidden = !active;
    toggle.disabled = !active;
    toggle.setAttribute('aria-pressed', String(on));
    panel.hidden = !(active && on);
    panel.parentElement?.toggleAttribute('data-debug-on', !panel.hidden);
  }

  function set(next) {
    next = next && active;
    if (next === on) return;
    on = next;
    if (!on) panel.replaceChildren();
    render();
    onToggle?.(on);
  }

  toggle.addEventListener('click', () => set(!on));
  render();

  return {
    /** The hash gate's verdict ({ active, reason }) for the loaded disc. */
    setGate(gate) {
      active = gate?.active === true;
      if (!active && on) set(false);
      else render();
    },
    /** A sample from the worker (overlay-state.js sampleState). */
    update(sample) {
      if (!active || !on) return;
      const rows = sample.rows.map((r) => {
        const row = document.createElement('div');
        row.className = 'dbg-row';
        row.dataset.key = r.key;
        const label = document.createElement('span');
        label.className = 'dbg-label';
        label.textContent = r.label;
        const val = document.createElement('span');
        val.className = 'dbg-val';
        val.textContent = r.text ?? '—';
        const tag = document.createElement('span');
        if (r.text === null) {
          tag.className = 'dbg-reason';
          tag.textContent = r.reason;
        } else {
          tag.className = 'dbg-badge';
          tag.dataset.status = r.confirmed ? 'confirmed' : 'hypothesis';
          tag.textContent = tag.dataset.status;
        }
        row.append(label, val, tag);
        return row;
      });
      panel.replaceChildren(...rows);
    },
    get on() {
      return on;
    },
    get active() {
      return active;
    },
  };
}
