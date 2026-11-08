# #129: replace the a0_cloud checks

Status (2026-11-08): attempt 1 pushed, waiting for Tier 2.

## Why
#101 (`notes/101-barret-party.md`) showed that `g_ActiveCharacters[i] + 0x000` (documented as the character id) reads 0 for Barret in slot 1 and Tifa in slot 2, as well as for Cloud. #78's `a0_cloud` checks in `reactor-mode-2e-party-menu` and `reactor-mode-4a-party-slots` passed only because Cloud is 0x00: they never proved what the metric name says. Which character a slot holds is already checked through Savemap partyID (`s0_cloud`).

## Sources (reference only; no code copied)
- **Xeeynamo/ff7-decomp @ `d4db3de3c3aaf61269e048cf3f6a458996290de0`**, `include/game.h`: ActiveCharacterData (size 0x440) has `weapon` (WeaponRecord, 0x2C bytes) at +0x408; WeaponRecord has `equipMask` (u16) at +0x0E, "equippable-by-character bitmask" with bit0 Cloud, bit1 Barret, bit2 Tifa, …, bit9 Young Cloud, and "Cloud weapons add bit9 = 0x0201" (ArmorRecord comment for the bit list). g_ActiveCharacters at 0x8009D84C (as #101, `config/symbols.main.us.txt` at `9411173`).

## Hypothesis
The equipped weapon's `equipMask` names the character who can hold it, so it tells slots apart: Cloud's weapon 0x0201, Barret's 0x0002, Tifa's 0x0004 (a character-specific weapon has only that character's bit; Cloud's adds Young Cloud). Address: 0x8009D84C + slot × 0x440 + 0x416 (slot 0 0x8009DC62, slot 1 0x8009E0A2, slot 2 0x8009E4E2).

Risk: the weapon record might be filled only in battle (then the menu scenarios fail on it while the battle ones pass), or a starting weapon's mask might carry more bits than its owner's.

## Attempt 1 (one push)
| scenario | change |
|---|---|
| reactor-mode-2e-party-menu (menu, Cloud alone) | `a0_cloud` → `w0_cloud`: slot 0 equipMask = 0x0201 |
| reactor-mode-4a-party-slots (battle, Cloud alone) | `a0_cloud` → `w0_cloud` |
| save-boot-4-party-barret-menu (menu, Cloud + Barret) | raw `act_id1` → `w1_barret`: slot 1 equipMask = 0x0002; plus slot 0 = 0x0201 (assert, no metric: 8-metric limit) |
| save-boot-5-party-barret-battle (battle, Cloud + Barret) | raw `act_id1` → `w1_barret`, plus slot 0 = 0x0201 |
| save-boot-6-party-tifa-battle (battle, Cloud + Barret + Tifa) | raw `act_id2` → `w2_tifa`: slot 2 equipMask = 0x0004, plus slot 0 = 0x0201 |

Every scenario already has a rerun (`match`), and Tier 2 runs each scenario set twice per CI run is not assumed: determinism is shown by two CI runs or the rerun. Only 1/0 leaves.

Why this is not a weakening: the old check could not fail for a wrong character in slot 0 unless that character's id byte became non-zero, and #101 showed the byte is 0 for every character seen. The new check fails if slot 0 holds Barret's or Tifa's weapon, and the save-boot scenarios show the same field reading differently for Barret and Tifa slots.
