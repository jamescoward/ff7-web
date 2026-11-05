// Screen-space drag -> digital PS1 pad. Distances are CSS pixels.
import { PAD } from './pad.js';

export const DEAD_ZONE = 10;
export const RUN_DISTANCE = 64;
export const SECTOR_HYSTERESIS = 6 * Math.PI / 180;
const STEP = Math.PI / 4;
const DIRECTIONS = [
  PAD.right, PAD.right | PAD.up, PAD.up, PAD.up | PAD.left,
  PAD.left, PAD.left | PAD.down, PAD.down, PAD.down | PAD.right,
];

export function createFieldDrag() {
  let sector = null;
  let mask = 0;
  return {
    move(dx, dy) {
      const distance = Math.hypot(dx, dy);
      if (distance < DEAD_ZONE) return this.release();
      const angle = Math.atan2(-dy, dx);
      // Wrapped angular distance preserves hysteresis across +/- pi too.
      const delta = sector === null ? Infinity
        : Math.abs(Math.atan2(Math.sin(angle - sector * STEP), Math.cos(angle - sector * STEP)));
      if (delta > STEP / 2 + SECTOR_HYSTERESIS) {
        sector = (Math.round(angle / STEP) + 8) % 8;
      }
      mask = DIRECTIONS[sector] | (distance >= RUN_DISTANCE ? PAD.cross : 0);
      return mask;
    },
    release() {
      sector = null;
      mask = 0;
      return mask;
    },
    get mask() { return mask; },
  };
}
