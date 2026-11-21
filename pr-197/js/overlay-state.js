// The debug overlay's data (#79): sample the semantic layer into display rows,
// and poll it a few times a second. Reads only (the layer has no write path).
// Runs in the emulator worker, next to the core's RAM, so a sample costs a few
// small copies and no message round trip; only changed samples are posted.
// Original project code, GPL-2.0-or-later.

/** Samples per second. Game state changes at human speed; 4 Hz is plenty and costs next to nothing. */
export const OVERLAY_HZ = 4;

const ROWS = [
  ['mode', 'Mode', 'mode', (v) => `${v.mode} (${v.raw}), was ${v.previous}`],
  ['fieldId', 'Field ID', 'fieldId', (v) => String(v)],
  ['position', 'Position', 'playerPosition', (v) => `x ${v.x}, y ${v.y}`],
  ['menuCursor', 'Menu cursor', 'menuCursor', (v) => String(v)],
  ['party', 'Party', 'party', (v) => v.map((id) => (id === null ? 'empty' : `#${id}`)).join(' ')],
  ['partyHp', 'Party HP', 'partyHp', (v) => v.join(' / ')],
];

/**
 * One sample: { rows: [{ key, label, text, confirmed, reason }] }.
 * text is null when the value can't be read; reason then says why
 * ('no address', 'read failed', 'inactive'). confirmed is false for a hypothesis.
 */
export async function sampleState(semantic) {
  const rows = await Promise.all(ROWS.map(async ([key, label, reader, format]) => {
    let r;
    try {
      r = await semantic[reader]();
    } catch {
      r = { value: null, confirmed: false, reason: 'read failed' };
    }
    return r.value === null
      ? { key, label, text: null, confirmed: false, reason: r.reason ?? 'unavailable' }
      : { key, label, text: format(r.value), confirmed: r.confirmed === true, reason: null };
  }));
  return { rows };
}

/**
 * Poll `semantic` at `hz` while started and call `post(sample)` when the
 * sample differs from the last one posted. A slow sample is never overlapped.
 */
export function createStatePoller({ semantic, post, hz = OVERLAY_HZ, timers = globalThis }) {
  let handle = null;
  let busy = false;
  let last = '';

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const sample = await sampleState(semantic);
      const key = JSON.stringify(sample);
      if (handle !== null && key !== last) {
        last = key;
        post(sample);
      }
    } finally {
      busy = false;
    }
  }

  return {
    tick,
    start() {
      if (handle !== null) return;
      last = '';
      // Old movie samples would make the first new ones read as a movie (#107).
      semantic.clearMovieWindow?.();
      handle = timers.setInterval(tick, Math.round(1000 / hz));
      tick();
    },
    stop() {
      if (handle !== null) timers.clearInterval(handle);
      handle = null;
    },
    get running() {
      return handle !== null;
    },
  };
}
