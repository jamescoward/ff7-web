// Party gauges (#133): what partyStatus(slot) (#130) values mean as bars.
// Pure functions over a partyStatus value; no DOM, no timers, no memory reads,
// so any frontend can draw the same bars.
// Original project code, GPL-2.0-or-later.
//
// Ranges (reference only, no code copied; notes/130-party-status.md):
// - Xeeynamo/ff7-decomp @ d4db3de: BattleTurnWork +0x04 atbGauge "saturates/
//   compares at 0xFFFF"; BattlePartyWork +0x08 limitBar is capped at 255 when
//   damage raises it (src/battle/battle.c).
// - ff7-mods/ff7-flat-wiki @ 6389365, Savemap "Character Record" +0x0F:
//   "Current limit bar (0xFF = limit break)".

export const ATB_MAX = 0xffff;
export const LIMIT_MAX = 0xff;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

/**
 * The bars for one partyStatus value ({ hp, maxHp, mp, maxMp, limit, atb },
 * each a number or null). Returns { hp, mp, atb, limit }, each null when the
 * values it needs are null (unconfirmed or unread), otherwise:
 *   hp, mp: { value, max, fraction }   (null when max is not positive)
 *   atb:    { fraction, full }
 *   limit:  { value, fraction, full }  (full: a limit break is ready)
 * fraction is clamped to 0..1. A null status gives null.
 */
export function partyGauges(status) {
  if (!status || typeof status !== 'object') return null;
  const pair = (value, max) => (isNum(value) && isNum(max) && max > 0 ? { value, max, fraction: clamp01(value / max) } : null);
  return {
    hp: pair(status.hp, status.maxHp),
    mp: pair(status.mp, status.maxMp),
    atb: isNum(status.atb) ? { fraction: clamp01(status.atb / ATB_MAX), full: status.atb >= ATB_MAX } : null,
    limit: isNum(status.limit) ? { value: status.limit, fraction: clamp01(status.limit / LIMIT_MAX), full: status.limit >= LIMIT_MAX } : null,
  };
}
