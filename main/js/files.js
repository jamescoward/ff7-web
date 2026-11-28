// Which of the player's chosen files the core boots.

// A .cue names its .bin tracks, so it wins when both are chosen.
export const BOOT_ORDER = Object.freeze(['.cue', '.exe', '.pbp', '.chd', '.iso', '.img', '.bin']);

/** The file to boot from a multi-file pick, or null. */
export function pickBootFile(names) {
  for (const ext of BOOT_ORDER) {
    const hit = names.find((n) => n.toLowerCase().endsWith(ext));
    if (hit) return hit;
  }
  return null;
}

/** The file picker's accept list. */
export const ACCEPT = BOOT_ORDER.join(',');
