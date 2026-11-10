# #130: party MP, max HP/MP, limit gauge and ATB gauge

Status (2026-11-10): done. Attempt 2 (`890a5d0`, tier2: 48 pass, 0 fail) confirms everything. Attempts used: 2 of 3.

## Sources (reference only; no code copied)
- **Xeeynamo/ff7-decomp @ `d4db3de3c3aaf61269e048cf3f6a458996290de0`** (2026-11-08):
  - `include/game.h` `ActiveCharacterData` (0x440 bytes; g_ActiveCharacters 0x8009D84C in `config/symbols.main.us.txt`): +0x10 hp, +0x12 baseHp, +0x14 mp, +0x16 baseMp, +0x18 atbTimer ("seeded from BattleWork.turn[].atbGauge"), +0x1A unk1A ("only upper 8 bits seem to be used").
  - `include/game.h` `SavePartyMember` (character record, 0x84 bytes): +0x0F limit_charge, +0x2C curHP, +0x2E hp_base, +0x30 curMP, +0x32 mp_base, +0x38 hp_max, +0x3A mp_max, +0x40 materia (16 × u32).
  - `src/main/1F6B4.c` SysInitPlayerStatFromEquip: g_ActiveCharacters[slot].hp/mp/baseHp/baseMp come from the record's curHP/curMP/hp_base/mp_base. `src/main/17238.c` SysInitPlayerStatFromMateria adjusts baseHp/baseMp by materia, raises them to at least 10, caps hp/mp at them, and stores them into the record's hp_max/mp_max. So `baseHp`/`baseMp` are the **maximums** the menu shows (the wiki calls +0x12 "Max HP" and +0x16 "Max MP").
  - `src/battle/battle.h` `BattleWork` (0x222C bytes): turn[10] (`BattleTurnWork`, 0x44 bytes; +0x04 atbGauge, "saturates/compares at 0xFFFF"), then party[3] at +0x2A8 (`BattlePartyWork`, 0x34 bytes; +0x08 limitBar). `src/battle/batini.c` sets turn[i].atbGauge = 0 and party[i].limitBar = the record's limit_charge at battle start, and unk1A = limitBar << 8; `battle.c` raises limitBar when damage is taken (capped at 255); `batres.c` writes it back to the record when the battle ends.
  - **g_BattleWork's address differs between two files:** `config/symbols.battle.txt` says 0x800F5BB8, `config/sym_export_battle.us.txt` 0x800f5bbc. Attempt 1 tests both.
- **ff7-mods/ff7-flat-wiki @ `6389365`**: `docs/FF7/Savemap.md` "Character Record" (same offsets as the decomp; 0x0F "Current limit bar (0xFF = limit break)"; materia ID 0xFF = empty), `docs/FF7/Battle/Battle_Mechanics.md` "Active Character Data" (+0x12 Max HP, +0x14 Current MP, +0x16 Max MP, +0x18 Timer).

## Generated save with chosen stats
`harness/saves/disc1-md1stin-stats.json`: #101's md1stin boot point with party Cloud, Barret, Tifa and a new optional `characters` list (`harness/schema/save.schema.json`, `runner/savegen/`): for each record, current HP/MP, base = maximum HP/MP, the limit bar, and empty materia slots (so no materia changes the maximums the game computes on load).

| record | HP | max HP | MP | max MP | limit |
|---|---|---|---|---|---|
| 0 Cloud | 271 | 314 | 41 | 54 | 100 |
| 1 Barret | 300 | 333 | 20 | 27 | 50 |
| 2 Tifa | 222 | 250 | 33 | 44 | 200 |

The schema change is outside the issue's "only if a check kind is missing" clause for `harness/schema/`, but the outcome needs it: "a generated save with author-chosen max HP/MP per slot" can't be described without a field for it. It is a new optional field; existing descriptions are unchanged.

## Attempt 1 plan (one push)
| scenario | what it checks |
|---|---|
| save-boot-10a/b/c-party-stats-menu-slotN | after the load, in the field menu: g_ActiveCharacters[N] +0x10/+0x12/+0x14/+0x16 equal the description's HP, max HP, MP, max MP; the record's limit bar (savemap) equals the description's |
| save-boot-11-party-stats-battle | Up+Left to a random battle (as #101), keeps `stats-battle` at the first battle frame |
| save-boot-11a/11b-stats-battle-limit-b8/bc | wait until party[0].limitBar at base 0x800F5BB8 (a) / 0x800F5BBC (b) reads 100, then party[1] = 50 and party[2] = 200. One of the two is expected to fail |
| save-boot-11c-stats-battle-limit-fixed | 300 frames in: every limit candidate (both bases, unk1A's high byte) holds the described values; MP unchanged in battle |
| save-boot-11d-stats-battle-atb-slots | turn[1], turn[2] atbGauge rise over 60 frames, both bases |
| reactor-mode-4d-atb-command | first guard battle: Cloud's gauge (both bases, and atbTimer +0x18) drops after Attack is taken and rises again |
| reactor-mode-4e-limit-damage | first guard battle, 1800 frames of damage: limitBar rises (both bases), unk1A and the record's bar reported |

Only 1/0, signs and frame counts leave the sandbox.

### Attempt 1 (`00901d8`, tier2: 45 pass, 5 fail)
| scenario | status | metrics |
|---|---|---|
| save-boot-10a-party-stats-menu-slot0 | pass | load_done 371, menu_wait 1, hp0_ok 1, max0_ok 1, mp0_ok 1, maxmp0_ok 1, lim0_ok 1, match 1 |
| save-boot-10b-party-stats-menu-slot1 | pass | the same, all 1, for slot 1 |
| save-boot-10c-party-stats-menu-slot2 | pass | the same, all 1, for slot 2 |
| save-boot-11-party-stats-battle | pass | load_done 371, battle_wait 5236, map_cur 117, match 1 |
| save-boot-11a-stats-battle-limit-b8 | pass | **lim_wait 91**, lim1_ok 1, lim2_ok 1, match 1 |
| save-boot-11b-stats-battle-limit-bc | fail | lim_wait 0 (timed out after 1500 frames), the rest 0 |
| save-boot-11c-stats-battle-limit-fixed | fail | b8_lim 1, **bc_lim 0**, act_lim 1, mp_battle 1, battle_ok 1, match 1 |
| save-boot-11d-stats-battle-atb-slots | fail | b8_rise1 0, b8_rise2 0, bc_rise1 0, bc_rise2 0, match 1 |
| reactor-mode-4d-atb-command | fail | **b8_drop -1, b8_rise 1**, bc_drop 0, bc_rise 0, act_drop -1, act_rise 1, battle_ok 1, match 1 |
| reactor-mode-4e-limit-damage | fail | hp_dir -1, **b8_dir 1**, bc_dir 0, act_dir 1, rec_dir 0, battle_ok 1, match 1 |

Every earlier scenario passed unchanged.

Reading:
- **Max HP (+0x12), MP (+0x14) and max MP (+0x16) of g_ActiveCharacters[0..2]** equal the generated save's values in the field menu, and the character records' limit bars hold them too. MP still equals the described values in battle.
- **g_BattleWork is at 0x800F5BB8** (config/symbols.battle.txt). At that base, party[i].limitBar holds the described limit bars 91 frames after battle mode starts, Cloud's rises while the guards hit him, and turn[0].atbGauge empties after Attack and fills again. At 0x800F5BBC nothing matches or moves.
- g_ActiveCharacters[i].atbTimer (+0x18) moves like the gauge (act_drop -1, act_rise 1), and unk1A's high byte holds the limit bar at battle start and changes with damage. The record's limit bar does not change during the battle (written back at its end, per the decomp).
- 11d: slots 1 and 2's gauges did not change between frames 240 and 300 of the random battle. Both were probably already full: Cloud's was full 900 frames into the guard battle. Attempt 2 measures from battle init instead.

### Attempt 2 plan (one push)
The 0x800F5BBC probes are removed. 11a keeps only the right base, plus unk1A and MP in battle. 11b (new) checks that slots 1 and 2's gauge and atbTimer rise over 240 frames from battle init (detected by limitBar reaching 100, as in 11a). 4d and 4e keep their checks, without the other base.

Confirmed now (attempt 1): partyMaxHp0..2, partyMp0..2, partyMaxMp0..2, characterLimit, partyLimit0..2 and partyAtb0. partyAtb1/2 wait for 11b.

### Attempt 2 (`890a5d0`, tier2: 48 pass, 0 fail)
| scenario | metrics |
|---|---|
| save-boot-10a/b/c | as in attempt 1, all 1 |
| save-boot-11-party-stats-battle | load_done 371, battle_wait 5236, map_cur 117, match 1 |
| save-boot-11a-stats-battle-limit | lim_wait 91, lim1_ok 1, lim2_ok 1, act_lim 1, mp_battle 1, match 1 |
| save-boot-11b-stats-battle-atb-slots | lim_wait 91, **atb1_dir 1, atb2_dir 1, act1_dir 1, act2_dir 1**, match 1 |
| reactor-mode-4d-atb-command | atb_drop -1, atb_rise 1, act_drop -1, act_rise 1, battle_ok 1, match 1 |
| reactor-mode-4e-limit-damage | hp_dir -1, lim_dir 1, act_dir 1, rec_dir 0, battle_ok 1, match 1 |

Every earlier scenario passed unchanged.

## Outcome
- **Confirmed** (`semantic/addresses.js`): partyMaxHp0..2 (+0x12), partyMp0..2 (+0x14), partyMaxMp0..2 (+0x16) of g_ActiveCharacters; partyLimit0..2 (g_BattleWork.party[i].limitBar, 0x800F5BB8 + 0x2A8 + 0x34 i + 8); partyAtb0..2 (g_BattleWork.turn[i].atbGauge, 0x800F5BB8 + 0x44 i + 4); characterLimit (record + 0x0F, records 0-8).
- `partyStatus(slot)` (`semantic/layer.js`) returns `{ hp, maxHp, mp, maxMp, limit, atb }`, with null for an unconfirmed entry. In battle, limit and atb come from g_BattleWork. Elsewhere, limit comes from the character's record and atb is null.
- The acceptance holds: the generated save's values equal RAM (10a-c, 11a); partyAtb0 rises and drops after a command (4d); the limit gauge rises after Cloud takes damage (4e). Every scenario has a matching rerun.

## Limits and follow-ups
- Party IDs 9-11 (Young Cloud, Sephiroth) map to records in a way no scenario checks, so partyStatus gives null limit for them outside battle.
- g_BattleWork is the battle overlay's area: outside battle it holds stale values, which is why partyStatus reads it only when gameState is battle.
- ActiveCharacterData +0x18 (atbTimer) and unk1A's high byte also track the ATB and limit in battle. They are not in the table because nothing needs a second copy.
