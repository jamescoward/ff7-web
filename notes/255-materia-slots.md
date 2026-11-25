# #255: Materia screen: armor row, columns ≥2, scroll-back, list end

Follow-up to #248 (`notes/248-materia-planner.md`, "Limits").

## Planner additions (`semantic/materia-screen.js`)
- `materiaRowPlan(from, to)`: the slot cursor between the weapon row (0) and the armor row (1), Down/Up, no wrap. #244 25a already read Down → 1 and Up → 0.
- `materiaColumnPlan(from, to, timing, columns)`: an optional slot count for a caller that knows the item's slots, from 1 to `MATERIA_MAX_COLUMNS` (8, the savemap's materia words per weapon or armor). The default stays `MATERIA_CONFIRMED_COLUMNS` (2) until Tier 2 shows more.
- `materiaListStep` already plans Up at row 0 with offset > 0 as a scroll back. 30c runs it.

## Save
`harness/saves/disc1-md1stin-materia-slots.json` is `disc1-md1stin-materia-plan` with these changes:
- Cloud's weapon is 4 and his armor 8. These numbers are author-chosen. That they have 8 and at least 1 materia slots is a **source claim** from general knowledge of the game, not from any data;
- materia 49 sits in inventory slots 2, 7, 13 and 199, with AP = slot.

## Scenarios (`runner/test/unit/materia-slots-scenarios.js`)
| scenario | what | hypothesis |
|---|---|---|
| 30a columns-measure | 8 blind Rights on the weapon row; reports `col`, `srow` | measures H3 |
| 30b column-far | `materiaColumnPlan(0, 7, columns 8)`, then list plan to slot 7, then Circle → weapon slot 7 holds 0x731 | H3: 8 columns, no wrap |
| 30c armor-scroll-back | `materiaRowPlan(0, 1)`, list plan to slot 13 then back to slot 2 (the last two Ups scroll back at row 0), Circle → armor slot 0 holds 0x231 | H4 (armor list fills armor materia), H2b (scroll-back) |
| 30d list-end | list plan to slot 199 (199 Downs, each checked), one more Down; reports `l_row`, `l_off` | measurement: stop (9, 190) or wrap (0, 0) |

How to read the results:
- **30a `col`:** 7 means 8 columns and a stop at the last. n − 1 means n columns. A smaller value after 8 Rights means a wrap.
- **30b pass:** H3 holds. Raise `MATERIA_CONFIRMED_COLUMNS`? No: slot counts differ per item and no reader exists. Instead, record that the cursor walks every slot an item has. Then `materiaColumnPlan` with a known count is confirmed up to 8.
- **30b fail and 30a `col` < 7:** weapon 4 has fewer slots. Use that count, or pick another weapon.
- **30c pass:** H4 and H2b hold.
- **30d:** record the measured end behaviour in `materiaListStep`'s comment. Plans already stop at 199.
