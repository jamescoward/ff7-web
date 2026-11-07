# #101: party slot 1 (Barret) and partyHp1

Status (2026-11-07): attempt 2 pushed, waiting for Tier 2.

## Sources (reference only; no code copied)
- **Xeeynamo/ff7-decomp @ `9411173034bde2ae4c9b0312167e79c3645ca1be`**: `config/symbols.main.us.txt` (g_ActiveCharacters 0x8009D84C), `include/game.h` (ActiveCharacterData size 0x440, id +0x000, hp +0x010, max HP +0x012; SaveWork partyID +0x4F8).
- **ff7-mods/ff7-flat-wiki @ `638936503b1c`**: `docs/FF7/Savemap.md` (character IDs 0x00 Cloud, 0x01 Barret, 0x02 Tifa, 0xFF none), `docs/FF7/Battle/Battle_Mechanics.md` ("Active Character Data").

## Boot point
#78 found Cloud alone at reactor-entrance and the first guard battle, so no played-to state has Barret yet. #38 gives generated saves: `harness/saves/disc1-md1stin-barret.json` is #38's md1stin boot point (field 116, triangle 12, progress 6) with party `[0, 1, 255]`. #99's attempt 2 already loaded md1stin with Barret in the party (leading), so the game accepts such a save there.

## Attempt 1 plan (one push)
| scenario | what it checks |
|---|---|
| save-boot-4-party-barret-menu | after the load, Triangle until the menu (as #78's 2e): partyID = 0x00, 0x01, 0xFF; g_ActiveCharacters[1].id = 0x01; its HP and max HP in 1..9999 |
| save-boot-5-party-barret-battle | hold Up+Left until a battle (#77: up-left leaves md1stin for md1_1; #78 attempt 3 met a random battle in md1_1 that way), 600 frames, then at the mark: slot 1 and g_ActiveCharacters[1].id = Barret, HP in 1..9999; 2400 frames with no input: hp1 decreased since the mark, max HP unchanged, still in battle |
| save-boot-6-party-tifa-battle | the same with party `[0, 1, 2]` (`disc1-md1stin-tifa.json`) for slot 2 (Tifa, 0x02), 3000 frames. Extra evidence for partySlot2/partyHp2, which the outcome mentions "by the same layout"; diagnostic if it fails |

Every scenario has a rerun (`match`). Only 1/0, signs, frame counts and the field ID leave the sandbox.

Risks: the random battle might not come within 9000 frames (battle_wait 0; the run stops); the enemies might not hit Barret in 2400 frames (hp1_dir 0); with Tifa, a third member spreads the hits further.

### Attempt 1 (`0f3df7d`/`d5ce11d`, tier2: 33 pass, 3 fail: the three new scenarios)
| scenario | metrics |
|---|---|
| save-boot-4-party-barret-menu | load_done 371, menu_wait 1, **s1_barret 1**, s2_empty 1, **a1_barret 0**, hp1_ok 1, max1_ok 1, match 1 |
| save-boot-5-party-barret-battle | load_done 371, **battle_wait 5236**, map_cur 117 (md1_1), a1_barret 0 (the run stopped here), hp1_ok 0, hp1_dir 0, max1_dir 0, match 0 |
| save-boot-6-party-tifa-battle | load_done 371, battle_wait 5236, map_cur 117, a2_tifa 0 (stopped), the rest 0 |

Every earlier scenario passed unchanged.

Reading:
- **The generated save puts Barret in party slot 1** (Savemap partyID[1] = 0x01, slot 2 empty), and the field menu shows slot 1's current and max HP (g_ActiveCharacters[1] + 0x10/+0x12) in 1..9999.
- **Holding Up+Left from md1stin reaches a random battle in md1_1** after 5236 frames, with Barret (and Tifa) in the party, as with Cloud alone in #78.
- **g_ActiveCharacters[i] + 0x000 is not the party member's character ID**: it does not read 0x01 for Barret in slot 1 (nor 0x02 for Tifa in slot 2). #78's `a0_cloud` (slot 0 reads 0x00) was probably a coincidence with a zero byte. The battle scenarios checked it before the mark with a 1-frame wait, so the scenario stopped there and the HP checks never ran.

### Attempt 2 plan (one push)
The id byte is no longer a check. Each scenario reports it raw (`act_id1`, `act_id2`: one byte) to find out what it holds, and the battle scenarios check slot 1 (2) through Savemap partyID only, then HP in range at the mark, HP falling and max HP unchanged since the mark, as planned. Nothing else changes.
