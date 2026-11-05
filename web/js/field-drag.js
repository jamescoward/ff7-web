// Screen-space drag -> digital PS1 pad. Distances are CSS pixels, times ms.
import { PAD } from './pad.js';

export const DEAD_ZONE = 10;
export const RUN_DISTANCE = 64;
// The origin trails the thumb so it is never farther away than this. Reversing
// therefore needs at most LEASH + DEAD_ZONE of travel, however far the drag went.
export const LEASH = RUN_DISTANCE;
// Once running, the run holds through direction changes (including a quick pass
// through the origin) until release, or until the thumb rests this long in the
// dead zone.
export const RUN_STOP_MS = 250;
export const SECTOR_HYSTERESIS = 6 * Math.PI / 180;
const STEP = Math.PI / 4;
const DIRECTIONS = [
  PAD.right, PAD.right | PAD.up, PAD.up, PAD.up | PAD.left,
  PAD.left, PAD.left | PAD.down, PAD.down, PAD.down | PAD.right,
];

export function createFieldDrag() {
  let sector = null;
  let mask = 0;
  let running = false;
  let restSince = null;
  let ox = 0;
  let oy = 0;
  return {
    // (x, y): the thumb's offset from where it landed; t: event time in ms.
    move(x, y, t = 0) {
      let dx = x - ox;
      let dy = y - oy;
      let distance = Math.hypot(dx, dy);
      if (distance > LEASH) {
        const pull = (distance - LEASH) / distance;
        ox += dx * pull;
        oy += dy * pull;
        dx = x - ox;
        dy = y - oy;
        distance = LEASH;
      }
      if (distance < DEAD_ZONE) {
        if (restSince === null) restSince = t;
        else if (t - restSince >= RUN_STOP_MS) running = false;
        sector = null;
        mask = 0;
        return mask;
      }
      if (restSince !== null && t - restSince >= RUN_STOP_MS) running = false;
      restSince = null;
      if (distance >= RUN_DISTANCE) running = true;
      const angle = Math.atan2(-dy, dx);
      // Wrapped angular distance preserves hysteresis across +/- pi too.
      const delta = sector === null ? Infinity
        : Math.abs(Math.atan2(Math.sin(angle - sector * STEP), Math.cos(angle - sector * STEP)));
      if (delta > STEP / 2 + SECTOR_HYSTERESIS) {
        sector = (Math.round(angle / STEP) + 8) % 8;
      }
      mask = DIRECTIONS[sector] | (running ? PAD.cross : 0);
      return mask;
    },
    release() {
      sector = null;
      mask = 0;
      running = false;
      restSince = null;
      ox = 0;
      oy = 0;
      return mask;
    },
    get mask() { return mask; },
    // Where the joystick's centre is now, relative to the landing point.
    get origin() { return { x: ox, y: oy }; },
  };
}
