// Per-menu facts the menu planner (#111, semantic/planner.js) needs: which
// address-table entry holds the cursor, how many rows the list has, whether
// the cursor wraps, and which buttons move it. Plain data, no code.
// Original project code, GPL-2.0-or-later.
//
// status follows semantic/addresses.js: "confirmed" with the Tier 2 scenario
// that showed it, or "hypothesis". A planner caller should plan only within
// confirmed facts: a hypothesis about `wraps` is kept false, so no plan
// crosses an end until wrapping is seen in Tier 2.

const SC = (name) => `harness/scenarios/${name}.json`;

export const MENUS = Object.freeze({
  main: Object.freeze({
    name: 'main',
    meaning: 'the field main menu (Triangle in a field): the command list on the right',
    cursor: 'menuCursor',
    axis: 'vertical',
    // 10 rows (Item … Save as on screen; greyed rows are ordinary cursor
    // stops) and the cursor wraps at both ends: from row 0, Up reads 9
    // (reactor-mode-2h-menu-up-from-top) and 11 Downs read 1
    // (reactor-mode-2g-menu-rows-down). Planned moves to rows 3, 0 and 7
    // without wrapping: reactor-mode-2f-planner-rows; with wrapping:
    // reactor-mode-2i-planner-wrap (#111, notes/111-menu-planner.md).
    rows: 10,
    rowsStatus: 'confirmed',
    rowsScenario: SC('reactor-mode-2h-menu-up-from-top'),
    wraps: true,
    wrapsStatus: 'confirmed',
    wrapsScenario: SC('reactor-mode-2g-menu-rows-down'),
    // Plain English labels, row 0 first (#115). The count is confirmed (rows
    // above). The label-to-row order is a SOURCE CLAIM: the order the commands
    // are drawn on screen in the original game; no Tier 2 scenario has checked
    // it row by row. There is no Quit row. Labels are the project's own words.
    labels: Object.freeze(['Item', 'Magic', 'Materia', 'Equip', 'Status', 'Order', 'Limit', 'Config', 'PHS', 'Save']),
    labelsStatus: 'hypothesis',
  }),
});

/**
 * The planner arguments for a menu: { rows, wraps, axis }. `wraps` is true only
 * when wrapping is confirmed, so a plan never relies on a hypothesis about it.
 */
export function menuPlanArgs(name) {
  const m = MENUS[name];
  if (!m) throw new RangeError(`unknown menu: ${name}`);
  return { rows: m.rows, wraps: m.wrapsStatus === 'confirmed' && m.wraps, axis: m.axis };
}
