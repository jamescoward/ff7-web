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
_Pending the Tier 2 run on the PR._
