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
  // The battle command menu (#116): the acting party slot's command list.
  // The cursor is battleCommandRow<slot> for the slot battleInput() reports
  // (only slot 0's row is confirmed, #110; slots 1 and 2 are #171), and only
  // its row is read: a menu with more than one column (numColumns) is planned
  // within the column the cursor is in. 4 rows and wrapping are SOURCE CLAIMS
  // (Xeeynamo/ff7-decomp@2c9239a, src/battle/battle3.c
  // BattleMenuWidgetCommandReset: numTotalRows = 4, numRowsPerPage = 4,
  // wrapModeY = 1); Tier 2 has seen only rows 0 and 1 (Down, Up; #110,
  // reactor-mode-4f). So plans never cross an end (wraps stays unconfirmed),
  // and a row the game skips or lacks stops the plan executor ('moved' or
  // 'stuck') before anything is selected.
  battleCommand: Object.freeze({
    name: 'battleCommand',
    meaning: 'the battle command menu of the acting party slot (Attack at row 0)',
    cursor: 'battleCommandRow0',
    cursorPerSlot: true,
    axis: 'vertical',
    rows: 4,
    rowsStatus: 'hypothesis',
    wraps: true,
    wrapsStatus: 'hypothesis',
    // Generic labels: command names depend on the character's materia and are
    // game data; they are never committed (#116 contract).
    labels: Object.freeze(['Command 1', 'Command 2', 'Command 3', 'Command 4']),
    labelsStatus: 'generic',
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
