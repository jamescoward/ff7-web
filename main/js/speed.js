// Speed toggle (#118), Labs flag `speed`: the steps, and the rule that drops
// back a step when the device cannot keep up. Pure functions, no DOM, so the
// worker and the unit tests share them.

export const SPEEDS = Object.freeze([1, 2, 3]);

/** The step after `speed`, wrapping 3x back to 1x. Unknown values give 1. */
export function nextSpeed(speed) {
  const i = SPEEDS.indexOf(speed);
  return i < 0 ? 1 : SPEEDS[(i + 1) % SPEEDS.length];
}
/** The step below `speed`, never below 1x. */
export function stepDown(speed) {
  const i = SPEEDS.indexOf(speed);
  return i <= 0 ? 1 : SPEEDS[i - 1];
}
/** Coerce anything to a valid step. */
export function clampSpeed(v) {
  return SPEEDS.includes(v) ? v : 1;
}

/**
 * Decides when the core is too slow for the chosen speed. The worker calls
 * `note(now, behind)` once per tick, where `behind` means the tick was more
 * frames late than the catch-up cap allows. It returns true (once, then the
 * window restarts) when, over a full window, at least `ratio` of the ticks
 * were behind. A single hiccup, or a gap with no ticks (tab hidden), never
 * trips it: a gap longer than `gapMs` restarts the window.
 */
export function createGovernor({ windowMs = 2000, ratio = 0.5, minTicks = 20, gapMs = 500 } = {}) {
  let start = null;
  let last = 0;
  let ticks = 0;
  let behindTicks = 0;
  const reset = () => { start = null; ticks = 0; behindTicks = 0; };
  return {
    reset,
    note(now, behind) {
      if (start === null || now - last > gapMs) {
        reset();
        start = now;
      }
      last = now;
      ticks += 1;
      if (behind) behindTicks += 1;
      if (now - start < windowMs) return false;
      const trip = ticks >= minTicks && behindTicks / ticks >= ratio;
      reset();
      return trip;
    },
  };
}
