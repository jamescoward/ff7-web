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
    // The full list
    // (Item, Magic, Materia, Equip, Status, Order, Limit, Config, PHS, Save:
    // 10 rows) and its behaviour at the ends are what
    // reactor-mode-2g-menu-rows-down and -2h-menu-up-from-top look at.
    rows: 10,
    rowsStatus: 'hypothesis',
    rowsSource: 'the PS1 USA main menu as shown on screen (Item … Save, 10 entries); #111 Tier 2 diagnostics',
    // Rows 0..rowsSeen-1 have been read in Tier 2: 0..2 by #78
    // (reactor-mode-2d-cursor-sequence). #111 raises this when its planner
    // scenario passes.
    rowsSeen: 3,
    rowsSeenScenario: SC('reactor-mode-2d-cursor-sequence'),
    wraps: false,
    wrapsStatus: 'hypothesis',
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
