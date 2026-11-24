# #254: native Equip v2

## Decision (agent default, Trip mode rule 11)
Option (a) from the issue: the panel offers the game's list rows **by index** (one row per spare of that kind in the inventory, an upper bound) and reads the savemap after the press to say what was equipped. Equip masks are kernel data and are not read. A plan past the real end of the list stops at the first press that does not move the cursor.

The member is the one the game opened Equip for (`partyPick`, confirmed on the Equip screen by #215). Switching member means Back and a pick in the game's menu; no in-screen member switch is planned.

## Semantic (`semantic/equip-screen.js`)
- `EQUIP_SLOT_KINDS` (0 weapon, 1 armor, 2 accessory), `equipSlotPlan(from, to)` (Up/Down, no wrap).
- `EQUIP_LIST_PAGE` = 8, `equipListIndex`, `equipListStep`, `equipListPlan(from, to)`: as the Materia list (#248), over index = offset + row. `equipListPlan({0,0}, 9)` gives exactly the path #216 18b observed.
- `equipListRows`, `equipV2TapAllowed`, `equipV2Outcome`, labels.

## Tier 2 (`runner/test/unit/equip-plan-scenarios.js`)
Save `harness/saves/disc1-md1stin-party3-gear.json`: #215's party3 save plus armor 1-3 (slots 3-5) and accessories 0-2 (slots 6-8), author-chosen.

- **H1:** slot cursor 1 is Armor, 2 is Accessory.
- **H2:** those lists open at row 0, offset 0 and follow `equipListStep`, for members other than Cloud.
- **H3 (reported as `e_idx`):** the Armor and Accessory lists hold every spare of that kind in inventory order.

- `save-boot-28a-equip-plan-armor`: pick party slot 1 (Barret), `equipSlotPlan(0, 1)`, Circle, `equipListPlan({0,0}, 2)`, Circle. Barret's armor changes (H3: to 3), nothing else does.
- `save-boot-28b-equip-plan-accessory`: pick party slot 2 (Tifa), `equipSlotPlan(0, 2)`, Circle, `equipListPlan({0,0}, 1)`, Circle. Tifa's accessory changes (H3: to 1).

## Results
_Pending: first Tier 2 run._
