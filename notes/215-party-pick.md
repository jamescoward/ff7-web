# #215: main-menu party-pick cursor

## Sources (facts only, no code copied)
- **Xeeynamo/ff7-decomp @ `33ce78c`** (reference only, AGPL): `config/symbols.main.us.txt` names `g_PartyMenuTables` at 0x8009A0C8 (three tables); `include/game.h` gives `MenuTable` as 0x12 bytes with the row at +0x0B. Table 0's row (0x8009A0D3) is the confirmed `menuCursor` (#78). #78 saw tables 1 and 2 stay 0, but never opened a party pick.
- Hypothesis: table 1's row, **0x8009A0E5**, is the party pick. Table 2's row (0x8009A0F7) is read alongside.

## Attempt 1: Tier 2 scenarios
- `harness/saves/disc1-md1stin-party3.json`: party Cloud, Barret, Tifa (party slot k = record k), baseline equipment, and one each of spare weapons 1, 17, 33 in inventory slots 0-2. Author-chosen.
  - Weapon 1 is Cloud's (#121, 15c). That 17 and 33 are Barret's and Tifa's (in some order) is a **hypothesis**: blocks of 16 weapons per character after Cloud's. The Equip list shows only what a member can equip, so each member's list should hold one entry.
- `runner/test/unit/party-pick-scenarios.js` generates four scenarios; `party-pick.test.js` checks the committed files.
  - `save-boot-16a-party-pick-down` (diagnostic): planned move to Equip, Circle, Down once, then raw `pick`, `t2row`, `row0`, `menu_ovl`, `game_state`. No check can stop it early.
  - `save-boot-16b/c/d-party-pick-slot<k>` (acceptance, k = 0, 1, 2): Down ×k, wait until `pick` reads k (`pick_wait`, the script stops if not), Circle until `menu_ovl` 4, 120 frames, mark, Circle, 60, Circle, 60. Checks: still overlay 4 in the menu; record k's weapon changed since the mark (`w_chg`); the other two unchanged; rerun match. Reports the raw `weapon<k>` to see which spare the member took.

## Results
### Attempt 1: `552e4e9`, tier2 check 135985755287 (86 pass, 0 fail)
| scenario | metrics |
|---|---|
| 16a party-pick-down | row_wait 1, pick 1, t2row 0, row0 3, menu_ovl 0, game_state 5, frames 1115 |
| 16b party-pick-slot0 | pick_wait 1, ovl_wait 1, w_chg 1, weapon0 1, pick 0, match 1 |
| 16c party-pick-slot1 | pick_wait 1, ovl_wait 1, w_chg 1, weapon1 33, pick 1, match 1 |
| 16d party-pick-slot2 | pick_wait 1, ovl_wait 1, w_chg 1, weapon2 17, pick 2, match 1 |

What this shows:
- **The candidate is the party pick.** One Down reads 1 (16a); Down 0, 1, 2 read 0, 1, 2 on the first frame checked (`pick_wait` 1), while the main cursor stays on Equip (row0 3) and table 2's row stays 0.
- **Circle then opens Equip for that slot's member.** The first press of the `every` loop asks for overlay 4 (`ovl_wait` 1). Circle, Circle changes that member's weapon (`w_chg` 1) and leaves the other two unchanged (checked), and a rerun matches.
- **The pick still reads the slot on the Equip screen** (the end-state `pick` metric, after the weapon change).
- **Weapon blocks:** Barret (record 1) took weapon 33 and Tifa (record 2) weapon 17, the only spares each could take. So with this save's baseline, weapons 17 and 33 are Tifa's and Barret's. This is observed for these two numbers only, not a claim about whole blocks.
- **The list holds only the member's weapons:** Barret's first list entry was inventory slot 2, not slot 0. So for a larger party, "the first spare weapon in inventory order" is not the first list entry. That is why the native tap stays one-member only.

## Part 2: wiring (same PR)
- `semantic/addresses.js`: `partyPick` (0x8009A0E5, s8), confirmed by 16a–16d.
- `semantic/layer.js`: `partyPick()` reader, read only in a confirmed menu mode, 0–2 or null.
- `semantic/equip-screen.js`: `equipChosenSlot(members, pick)` for display. The tap rule (`equipMemberSlot`, `equipTapAllowed`) is unchanged.
- `web/js/native-equip.js` (Labs `native-equip`, off by default): reads `partyPick()` while the Equip screen is open and marks that member's row (`data-chosen`). The reason text for a larger party now says the weapon list is not read.

## Follow-ups
- The Equip list's contents for a member (which spares they can equip) need the kernel's equip masks, which are game data. A tap for a larger party could instead plan from the list cursor once #216 finds it.
