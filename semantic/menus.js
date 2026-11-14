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
  // (every slot's row is confirmed: slot 0 in #110, slots 1 and 2 in #171),
  // and only its row is read: a menu with more than one column (numColumns) is
  // planned within the column the cursor is in. 4 rows and wrapping are SOURCE
  // CLAIMS (Xeeynamo/ff7-decomp@2c9239a, src/battle/battle3.c
  // BattleMenuWidgetCommandReset: numTotalRows = 4, numRowsPerPage = 4,
  // wrapModeY = 1); Tier 2 has seen rows 0 and 1 (Down, Up; #110,
  // reactor-mode-4f) and, with no materia, Down going straight from row 0 to
  // row 3 (the cursor skips rows with no command; #171). So plans never cross
  // an end (wraps stays unconfirmed). A skip towards the target is progress
  // (`skips` below); a row the game skips or lacks stops the plan executor
  // ('moved' past it, or 'stuck' at the last row) before anything is selected.
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
    // The cursor skips rows with no command: with no materia, one Down goes
    // from row 0 to row 3 and one Up comes back to 0, for slots 1 and 2
    // (#171, save-boot-11d and save-boot-11e). Plans therefore count a landing
    // on a later planned row as progress (planner `skips`, #189). Which rows a
    // given member lacks is not read, so a tap on a skipped row stops the
    // executor ('moved') when the cursor lands past it, and nothing is selected.
    skips: true,
    skipsStatus: 'confirmed',
    skipsScenario: SC('save-boot-11d-battle-command-rows'), // and save-boot-11e-battle-command-row-slot1
    // Generic labels: command names depend on the character's materia and are
    // game data; they are never committed (#116 contract).
    labels: Object.freeze(['Command 1', 'Command 2', 'Command 3', 'Command 4']),
    labelsStatus: 'generic',
  }),
});

/**
 * The planner arguments for a menu: { rows, wraps, axis, skips }. `wraps` and
 * `skips` are true only when confirmed, so a plan never relies on a
 * hypothesis about them.
 */
export function menuPlanArgs(name) {
  const m = MENUS[name];
  if (!m) throw new RangeError(`unknown menu: ${name}`);
  return {
    rows: m.rows,
    wraps: m.wrapsStatus === 'confirmed' && m.wraps,
    axis: m.axis,
    skips: m.skipsStatus === 'confirmed' && m.skips === true,
  };
}
