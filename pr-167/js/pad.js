// Digital pad bitmask, in libretro RETRO_DEVICE_ID_JOYPAD_* bit order, which
// the core maps to the PS1 pad. The same table as runner/pad.js (a unit test
// keeps them equal); it is repeated here because the site is published from
// web/ alone.
export const PAD = Object.freeze({
  cross: 1 << 0,
  square: 1 << 1,
  select: 1 << 2,
  start: 1 << 3,
  up: 1 << 4,
  down: 1 << 5,
  left: 1 << 6,
  right: 1 << 7,
  circle: 1 << 8,
  triangle: 1 << 9,
  l1: 1 << 10,
  r1: 1 << 11,
  l2: 1 << 12,
  r2: 1 << 13,
  l3: 1 << 14,
  r3: 1 << 15,
});

export const PAD_ALL = 0xffff;

/** Normalise a mask number, a name array, or "a,b" to a 16-bit mask. */
export function padMask(state) {
  if (typeof state === 'number') {
    if (!Number.isInteger(state) || state < 0 || state > PAD_ALL) {
      throw new RangeError(`pad mask must be an integer in 0..0xffff, got ${state}`);
    }
    return state;
  }
  const names = typeof state === 'string'
    ? state.split(',').map((s) => s.trim()).filter(Boolean)
    : state;
  if (!Array.isArray(names)) throw new TypeError('pad state must be a mask, name list or string');
  let mask = 0;
  for (const name of names) {
    const bit = PAD[String(name).toLowerCase()];
    if (bit === undefined) throw new RangeError(`unknown pad button: ${name}`);
    mask |= bit;
  }
  return mask;
}

export function padNames(mask) {
  return Object.keys(PAD).filter((k) => mask & PAD[k]);
}

/**
 * Combine several input sources (virtual gamepad, keyboard, ...) into one pad
 * state. Each source sets its own mask; the OR of all of them goes to
 * `setPad`, and only when it changes.
 */
export function createInputMixer(setPad) {
  const sources = new Map();
  let current = 0;
  return {
    set(source, mask) {
      sources.set(source, padMask(mask));
      let next = 0;
      for (const m of sources.values()) next |= m;
      if (next !== current) {
        current = next;
        setPad(next);
      }
      return current;
    },
    get mask() {
      return current;
    },
    releaseAll() {
      sources.clear();
      if (current !== 0) {
        current = 0;
        setPad(0);
      }
    },
  };
}
