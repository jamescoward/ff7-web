# #121: native Equip screen

Split by PR, following #135:
1. **PR 1 (game state):** tell when the Equip screen is open, and show that a pad sequence changes the equipped weapon, confirmed by reading the savemap.
2. **PR 2 (UI):** the `native-equip` Labs screen on top of it.

## Sources (facts only, no code copied)
- **Xeeynamo/ff7-decomp @ `33ce78c`** (reference only, AGPL): `src/main/1F6B4.c`.
  - `SysMenuLoadMenuFileById` stores the overlay id it is asked for in D_80062DD4 (`menuOverlay`, confirmed for 0 and 1 in #135) and the previous id in D_80062DD0. It does not reload the file when moving between ids 3 and 4.
  - enum `YamadaOvl`: 1 Item, 2 Magic, **3 `YAMA_EQIPMENU_MATERIA`, 4 `YAMA_EQIPMENU_EQUIP`**, … The comment says "ids 1 to 10 follow the order of the main menu entries". So the Equip row (row 3) should ask for id 4.
  - **The EQIPMENU overlay is not decompiled** (there is no `symbols.eqipmenu` and no `src/menu/eqipmenu.c`). Its cursor variables (slot cursor, list cursor, list offset) have no source.
- **ff7-mods/ff7-flat-wiki @ `6389365`**, `docs/FF7/Menu_Module.md`: "Equip and Materia are in the same module" (`/MENU/EQIPMENU.MNU`). `docs/FF7/Weapon_data.md`: each weapon has an equip mask (bit 0 Cloud …). The masks themselves are kernel data and aren't in the repo.

## Attempt 1 (part 1): Tier 2 scenarios
Without cursor addresses, part 1 reads only:
- `menuOverlay`, for the Equip id;
- `characterWeapon` and `inventorySlot` (confirmed in #117), for the result.

The cursor positions on the Equip screen are assumptions (Weapon slot first, the first list entry), stated in the scenario descriptions.

- `harness/saves/disc1-md1stin-equip.json`: Cloud alone (party 0, 255, 255) with weapon 0, armor 0 and no accessory. Inventory slot 0 holds weapon 1 (item index 129) and slot 1 weapon 2 (130), one of each. All values are author-chosen; that Cloud can equip weapons 1 and 2 is a **hypothesis**.
- `runner/test/unit/equip-scenarios.js` generates three scenarios. The main-menu move to Equip is `menuPanelPlan(0, 3)` (planner output). `equip.test.js` checks the committed files.
  - `save-boot-15a-equip-row-circle` (diagnostic): one Circle on the Equip row, then 300 frames. Reports menu_ovl, menu_prev, row0, weapon0 and game_state. #135's 14f (Circle on Materia, row 2) left menu_ovl at 0, which suggests a party pick comes before the overlay loads.
  - `save-boot-15b-equip-screen-open` (diagnostic): Circle every 60 frames until menu_ovl reads 4, then 120 frames. Checks menu_ovl 4, weapon unchanged, menu.
  - `save-boot-15c-equip-weapon-plan` (acceptance): as 15b, then Circle (Weapon slot), 60 frames, Circle (first list entry), and wait until weapon0 reads 1. Checks weapon 1, changed since the mark, still overlay 4 in the menu, rerun match. Reports raw weapon0, inv0 and inv1, to see where the old weapon went.

## Results
### Attempt 1: `a9c90d4`, tier2 check 135347732970 (82 pass, 0 fail)
| scenario | metrics |
|---|---|
| 15a equip-row-circle | row_wait 1, menu_ovl 0, menu_prev 0, row0 3, weapon0 0, game_state 5, frames 1291 |
| 15b equip-screen-open | row_wait 1, ovl_wait 61, menu_ovl 4, menu_prev 0, weapon0 0, game_state 5, frames 1168 |
| 15c equip-weapon-plan | ovl_wait 61, eq_wait 1, weap_ok 1, weapon0 1, inv0 65535 (0xFFFF), inv1 642 (0x282), match 1 |

What this shows:
- **The planned move lands on Equip.** `menuPanelPlan(0, 3)` reaches row 3 (`row_wait` 1).
- **One Circle on Equip doesn't load the overlay.** `menuOverlay` stays 0 after 300 frames (15a), so a party pick comes first. That matches #135's 14f (Materia, row 2).
- **The second Circle, 60 frames later, asks for overlay 4** (15b: `ovl_wait` 61 is the press at frame 60 plus one frame). This matches `YAMA_EQIPMENU_EQUIP` in the decomp's enum. It also checks the label order Item, Magic, Materia, Equip through the overlay id (row 3 → id 4). **`menuOverlay` value 4 is now confirmed.** `menu_prev` reads 0.
- **The acceptance passes.** Two more Circles, 120 and 180 frames after the overlay was asked for, equip weapon 1:
  - `weapon0` reads 1 on the first frame checked (`eq_wait` 1);
  - inventory slot 0 (which held weapon 1) is now empty;
  - slot 1 (weapon 2, ×1) is unchanged;
  - a rerun matches.
  So the Equip screen opens on the Weapon slot, the first list entry is weapon 1, and Cloud can equip it. These are observed for this save only.
- **The old weapon 0 didn't go into slot 0 or 1.** Where it went is not read.

### Run 2 (determinism): `3582897`, tier2 check 135367413475 (82 pass, 0 fail)
The scenario files are unchanged since `a9c90d4`. 15a, 15b and 15c report **identical metrics** to attempt 1, field for field, and 15c's rerun matched (`match` 1). So the planned weapon change is deterministic over two runs.

## Next (part 2)
The `native-equip` Labs screen, off by default:
- **Gate:** a confirmed menu, `menuOverlay` 4, and the time since that value appeared. There is no screen-state variable, so the native screen knows only the opening state (Weapon slot, first entry).
- **View:** the party member's weapon, armor and accessory from `equipment()`, and the spare weapons from `inventory()`.
- **Weapon tap:** a tap on a spare weapon runs Circle, Circle only when it is the first candidate. Otherwise it plans from the opening state, which is not confirmed beyond entry 0. It confirms by reading `characterWeapon`.
- **Follow-ups to file:**
  - the Equip-screen cursor addresses, which have no source (a RAM-diff method needs its own contract);
  - list order beyond the first entry.

## Limits (part 1)
- No Equip-screen cursor is read. A native screen can then only plan from the screen's opening state, and has to confirm each change by reading the savemap.
- Equipability and list order are not read. They are kernel data, and the native screen must not assume them: it should confirm the result after the press.

## Part 2: the `native-equip` Labs screen (PR #214)
Design is the agent default recorded on #121 (Trip mode rule 11). Everything is offered only as far as part 1's Tier 2 results reach.

- **Gate:** `equipScreen()` (semantic/layer.js) is open only in a confirmed menu mode with a confirmed `menuOverlay` of 4. No Equip-screen variable is read.
- **View:** `equipment(slot)` for each party slot (weapon, armor, accessory numbers) and `spareWeapons(inventory())`, the weapons in inventory slot order (semantic/equip-screen.js).
- **Tap rule** (`equipTapAllowed`): only the first spare weapon; only with exactly one party slot occupied (`equipMemberSlot`: the party pick is not read); only after `EQUIP_SETTLE_FRAMES` (120, 15c's first press) since the open screen was first seen; only while *pristine*.
- **Pristine:** set when the screen is first seen open. It ends with any tap or Back from the panel, or any pad input from another source once the opening press is released. The screen sees other input through `createInputMixer().onChange` (web/js/pad.js, additive). A first attempt sampled `mixer.mask` every 16 ms and missed a short classic-pad tap in the browser test, so it was replaced. Without `onChange` the screen is never pristine.
- **Presses:** `EQUIP_FIRST_WEAPON_PRESSES`: Circle at 0, Circle at 60 game frames (15c). Then `equipOutcome` compares the member's weapon before and after: "Equipped", "Changed to weapon #m, not #n", or after 8 polls "No change seen".
- **Not measured:** how long the screen takes to settle on the device after the panel first sees overlay 4 (the 120 frames count from the panel's first poll, which is at or after the overlay was asked for, so it is at least 15c's wait); where Back goes from the Equip screen.

### Follow-ups
- #215: the main-menu party-pick cursor (a hypothesis: `g_PartyMenuTables[1]`'s row, next to the confirmed `menuCursor`), so the panel works for a three-member party.
- #216: the Equip-screen slot and list cursors, and the list order beyond its first entry (no source; a RAM-diff method needs its own contract).
