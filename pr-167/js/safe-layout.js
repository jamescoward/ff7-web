// Safe-area layout (#152), behind the off-by-default Labs flag `safe-layout`.
// With the flag on, <html data-safe-layout> switches on the rules in
// css/app.css that keep the pad and the field controls inside
// env(safe-area-inset-*) and fit short viewports (Safari with its toolbars).
// This module only sets the attribute and the top bar's height; the layout
// itself is CSS. With the flag off nothing changes.
import { isOn, onChange, registerFlag } from './labs.js';

export const FLAG = 'safe-layout';

registerFlag(FLAG, {
  label: 'Safe-area layout',
  description: 'Keeps the pad clear of the notch and home bar, and fits it on short screens.',
});

/** Apply the flag to `root` now and on every toggle; publishes the bar height as --bar-h. */
export function initSafeLayout({ root = document.documentElement, bar = document.querySelector('.bar') } = {}) {
  const setBar = () => { if (bar) root.style.setProperty('--bar-h', `${Math.ceil(bar.getBoundingClientRect().height)}px`); };
  const apply = () => {
    const on = isOn(FLAG);
    root.toggleAttribute('data-safe-layout', on);
    if (on) setBar();
  };
  apply();
  onChange((name) => { if (name === FLAG) apply(); });
  // The bar wraps to two rows on narrow screens; the picture's height budget follows it.
  if (bar && typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (isOn(FLAG)) setBar(); }).observe(bar);
}
