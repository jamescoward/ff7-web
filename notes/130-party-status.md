# #130: party MP, max HP/MP, limit gauge and ATB gauge

Status (2026-11-10): attempt 1 pushed (Tier 2 probe). Attempts used: 1 of 3.

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
