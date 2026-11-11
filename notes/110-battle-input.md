# #110: battle command state (active slot, command cursor, targeting)

Source for candidates: Xeeynamo/ff7-decomp@d4db3de3c3aaf61269e048cf3f6a458996290de0, used as a reference
for addresses and layouts only. No code is copied (AGPL; see CLAUDE.md).

## Candidates (attempt 1)

| Name (planned) | Address | Type | Decomp source |
|---|---|---|---|
| widget id | 0x800F3896 | s16 | `g_BattleMenuModalWidgetId`, config/symbols.battle.txt. src/battle/battle3.c: `BattleMenuInit` sets -1; Cancel from a sub-menu sets 1 (the command menu); `BattleMenuUpdate` runs the targeting code when it reads 0. |
| `battleActor` | 0x800F38A0 | u8 | `g_BattleMenuPartySlot`, config/symbols.battle.txt. `BattleMenuWidgetCommandReset` indexes `g_ActiveCharacters` and `D_800F90B4` with it. |
| `battleCommandRow` (slot i) | 0x800F90B4 + i·0x240 + 0x0B | u8 | `D_800F90B4[slot].table00.row` (src/battle/battle_private.h `BattleMenuSlot`, 0x240 bytes; include/game.h `MenuTable`, row at +0x0B). The column is at +0x0A. |
| target cursor | 0x800F38A7 or 0x800F38A9 | u8 | Both are unit bit indexes in battle3.c (`1 << D_800F38A7` in `BattleMenuFindTargetCharacterIndex`; `D_800F38A9` in the targeting draw and the Circle check). Which one the cursor moves is not known; attempt 1 reads both. |

## Tier 2, attempt 1 (four scenarios, batched; run on `37df5b2`: 53 pass, 1 fail)
- `reactor-mode-4f-battle-command-right`: first guard battle, from `battle`. Widget 1, slot 0, row 0 → 1 (Down) → 0 (Up), Circle → widget 0, then Right; t7/t9 signs.
- `reactor-mode-4g-battle-command-down`: the same with Down for the target move, in case Right does not move between the enemies.
- `reactor-mode-4h-battle-command-taken`: Circle twice (Attack, default target) → widget 0xFFFF.
- `save-boot-11c-battle-actor-slots`: party Cloud, Barret, Tifa (`stats-battle`): after the first menu's command is taken, the next menu's slot differs.

Results (metrics as the validated summary reports them):

| Scenario | Status | Metrics |
|---|---|---|
| 4f (Right) | pass | open_wait 60, actor_wait 1, down_wait 1, up_wait 1, target_wait 1, t7_dir −1, t9_dir −1, match 1 |
| 4g (Down) | **fail** | open_wait 60, actor_wait 1, down_wait 1, up_wait 1, target_wait 1, t7_dir 0, t9_dir 0, match 1 |
| 4h (taken) | pass | open_wait 60, target_wait 31, closed_wait 1, none 1, match 1 |
| 11c (slots) | pass | open_wait 549, target_wait 1, closed_wait 1, next_wait 43, actor_dir −1, actor 1, match 1 |

Reading:
- **Widget id** 0x800F3896: 1 when the command menu opens, 0 one frame after Circle on Attack, −1 one frame after Circle in targeting takes the command, and still −1 10 frames later. Confirmed for −1, 0 and 1. Sub-menu values were not read.
- **Slot** 0x800F38A0: 0 for Cloud alone (4f). In 11c it reads 1 at the second menu and changed from the first, so the first was 2 (Tifa). Attempt 2 (11d) checks 2 and 1 directly.
- **Row of slot 0** 0x800F90BF: 0 → 1 (Down) → 0 (Up), one frame after each press.
- **Target**: Right lowers **both** 0x800F38A7 and 0x800F38A9. Down moves neither: with two guards, Down does not change the target. That makes 4g a failed diagnostic, and it is removed. `battleTarget` uses 0x800F38A9, the byte the decomp's targeting draw and Circle check use. Which unit each value names is not read.
- 4h's target_wait of 31 means the first Circle, on the frame the menu opened, did not register; the second one, 30 frames later, did. 4f waits 30 frames before pressing and enters targeting on the first press.

## Tier 2, attempt 2
- `save-boot-11d-battle-command-rows`: `stats-battle` again. The slot must read 2 at the first menu; slot 2's row goes 0 → 1 → 0. After Attack is taken, the slot must read 1, and slot 1's row goes 0 → 1.

Results: pending.
