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

## Tier 2, attempt 1 (four scenarios, batched)
- `reactor-mode-4f-battle-command-right`: first guard battle, from `battle`. Widget 1, slot 0, row 0 → 1 (Down) → 0 (Up), Circle → widget 0, then Right; t7/t9 signs.
- `reactor-mode-4g-battle-command-down`: the same with Down for the target move, in case Right does not move between the enemies.
- `reactor-mode-4h-battle-command-taken`: Circle twice (Attack, default target) → widget 0xFFFF.
- `save-boot-11c-battle-actor-slots`: party Cloud, Barret, Tifa (`stats-battle`): after the first menu's command is taken, the next menu's slot differs.

Results: pending.
