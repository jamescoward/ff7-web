# #117: inventory, materia and equipment layouts

## Sources (facts only, no code copied)
- **ff7-mods/ff7-flat-wiki @ `6389365`**, `docs/FF7/Savemap.md`: "Party Item stock" at savemap 0x04FC (2 bytes per item, 320 slots), "Party Materia stock" at 0x077C (4 bytes per materia, 200 slots), "Character Record" 0x1C equipped weapon, 0x1D armor, 0x1E accessory; "Save Item List" (each word `QQQQQQQXXXXXXXXX`: 9-bit index, 7-bit quantity; indexes 0-127 items, 128-255 weapons, 256-287 armor, 288-319 accessories); "Save Materia List" (byte 0 the ID, bytes 1-3 the AP as an unsigned 24-bit number). Materia ID 0xFF = empty is already used by #130.
- **Xeeynamo/ff7-decomp @ `d4db3de`** (reference only, AGPL; no code copied), `include/game.h`: `SaveWork` inventory `u16[320]` at +0x4FC, materia `s32[200]` at +0x77C; `SavePartyMember` weapon, armor, accessory at +0x1C-0x1E, `materia_weapon[8]` at +0x40, `materia_armor[8]` at +0x60. `Savemap` at 0x8009C6E4 (as #78, #130).

No names (item, materia, weapon) are in the repo: names are game data. Readers return IDs and counts only.

## What changed
- **Generator** (`runner/savegen/`, `harness/schema/save.schema.json`): optional `items` (`slot`, `index`, `quantity` 1-99), `materia` (`slot`, `id` 0-254, `ap` 24-bit) and `equipment` (`record`, `weapon` 0-127, `armor` 0-31, `accessory` 0-31 or 255 = none, optional `materia` in record slots 0-15). Slots not listed keep the baseline. With `characters` for the same record (#130), the record's materia slots that `equipment` doesn't fill are emptied as before, and the listed ones are kept. Overlapping writes are rejected.
- **Boot point** `harness/saves/disc1-md1stin-inventory.json`: #101's md1stin save (party Cloud, Barret) with four item slots (0, 1, 2, 319: one of each kind), three materia slots (0, 1, 199; slot 199 with AP 0xFFFFFF), Cloud's weapon 3 / armor 5 / accessory 7 with materia in weapon slots 0-1 and armor slots 0-1, Barret's weapon 40 / armor 0 / no accessory. All values are author-chosen.
- **Tier 2** `save-boot-13a-inventory-menu` (inventory and materia words) and `save-boot-13b-equipment-menu` (records 0 and 1 equipment, record 0 materia): load the save, open the field menu, check each word with `equals` (1/0 metrics only), rerun match.
- **semantic/**: entries `inventorySlot`, `materiaSlot`, `characterWeapon`, `characterArmor`, `characterAccessory`, `characterWeaponMateria`, `characterArmorMateria`; pure decoders in `semantic/inventory.js` (`decodeItem`, `decodeMateria`, `ITEM_KINDS`); readers `inventory()`, `materia()`, `equipment(slot)` in `semantic/layer.js`. `inventory()` and `materia()` read the whole array in one `readMem`.

## Limits
- The Tier 2 checks show the savemap the game loaded holds the described words at these RAM addresses, read in the field menu. They don't show how the game interprets each field (that the item menu lists index 1 with quantity 7, for example). The native Item and Materia screens (#121, #135) will need that, through the menu.
- Weapon/armor/accessory numbers are taken as `item index − first index of the kind` (wiki ranges). Barret's weapon 40 is not checked to be one of his; nothing here opens the Equip screen or a battle.
- Only slots the description writes are checked; empty-slot encodings (0xFFFF items, 0xFF materia) come from the documentation and #130.

## Results
- **Attempt 1, Tier 2 on `cb9dc5d` (2026-11-12): pass, 55 pass / 0 fail.** `save-boot-13a-inventory-menu` and `save-boot-13b-equipment-menu` pass: every described word reads back at its address in the field menu (inventory slots 0, 1, 2, 319; materia slots 0, 1, 199 including AP 0xFFFFFF; records 0 and 1 weapon/armor/accessory, Barret's 0xFF; record 0's weapon and armor materia slots 0 and 1), and a rerun from the title snapshot matches. The load kept every value unchanged; nothing was sanitised or re-sorted.
- Second run for determinism: the next push's Tier 2 run.
