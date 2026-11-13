# #116: battle command panel

Labs flag `battle-panel` (off by default). In a confirmed battle, while a
party member's command menu is open, a panel below the picture shows four
command rows ("Command 1" to "Command 4"). A row tap moves the command cursor
there with the menu planner (#111), then presses Circle. In target selection
the panel shows Prev, Next, Confirm and Back instead.

## Design
- **Platform-neutral facts in `semantic/`** (owner amendment, 2026-11-08):
  - `semantic/menus.js` `battleCommand`: 4 rows, wrapping, generic labels. The
    row count and wrapping are **source claims** (Xeeynamo/ff7-decomp@2c9239a,
    `src/battle/battle3.c` `BattleMenuWidgetCommandReset`: `numTotalRows = 4`,
    `numRowsPerPage = 4`, `wrapModeY = 1`), so both are `hypothesis`, and
    `menuPlanArgs` keeps `wraps` false: plans never cross an end. Tier 2 has
    only seen rows 0 and 1 (#110). A blank row the game skips, or a row the
    game does not have, stops the plan executor (`moved` or `stuck`) before
    Circle is pressed. Only the row byte is read: a menu with several columns
    is planned within the cursor's column.
  - `semantic/controls.js` `BATTLE_PANEL_ACTIONS`: select = Circle; Prev =
    Left, Next = Right, Confirm = Circle, **Back = Cross**.
  - `semantic/battle-panel.js`: `battlePanelView(battleInput sample)` (hidden,
    command with the row or null, targeting; null for a failed read),
    `battlePanelPlan(from, to)` and `battlePlanCursor(sample, actor)` (the row,
    null for unread, or `'left'` when a confirmed read shows the menu gone).
- **`web/js/battle-panel.js`** polls `battleInput()` at 4 Hz (flag on, gate
  open). It draws the panel, reads again at each tap, and drives
  `createPlanExecutor` from a 16 ms loop, one game frame per step (the #115
  pattern). Any stop releases everything and sends no Circle. A `'left'` read
  mid-plan (another slot, targeting, or no menu) stops it at once. The panel
  hiding, the gate closing or the flag turning off also cancels it. Taps are
  ignored while a plan or press runs.
- **Slots 1 and 2:** their command rows are hypotheses (#171), so
  `battleInput().row` is null for them. The rows are drawn disabled (greyed)
  and send nothing; the targeting buttons still work. When #171 confirms the
  rows, the panel enables them with no change here.
- **Layout:** two columns of 44 px buttons. Both views are two rows high, so
  switching views does not move the pad. The panel sits below the battle
  status strip (#133) when that flag is on too. Landscape: hidden (#166). In
  portrait the page may scroll while it shows, as with the menu panel.
- Input only: no game memory is written. No decoded command names, no Tier 2
  scenario (light class).

## Deviation from the contract: Back is Cross, not Triangle
The contract (and its owner amendment) maps Back to Triangle. In the
reference decomp, the targeting code (`g_BattleMenuModalWidgetId == 0`)
cancels on `PAD_CROSS` (commented "pressed Cancel/Back"), and so do the
sub-menus. `PAD_TRIANGLE` in battle sets the widget to −1: it leaves the
command menu for the next ready character, which is not "Back". Mapping
Triangle would skip the turn's menu instead of returning to it. This is a
source claim, not checked in Tier 2 or on the device; the Tier 3 checklist
asks for it. If the owner wants Triangle anyway, it is one value in
`semantic/controls.js`.

## Tests
- `node semantic/sync-web.js --check`
- `node --test runner/test/unit/*.test.js` (550 pass; new
  `semantic-battle-panel.test.js`)
- `node --test web/test/battle-panel-unit.test.js` (15 pass)
- `node --test web/test/battle-panel-browser.test.js`: Chromium 9 pass;
  WebKit is not installed in the authoring sandbox (9 skipped); CI runs both.
  The fake source simulates the command cursor (4 rows), target selection
  and the acting slot. It checks show/hide, row taps (Down, Down, Circle; Up,
  Up, Circle without wrapping), Right/Left/Cross in targeting, greyed rows
  for slot 1, and portrait layout (44 px, no overlap, below the picture and
  the battle strip, no horizontal scroll) with `battle-hud` and
  `safe-layout` on and off, in both views. Landscape: hidden.
- The whole `web/test` suite locally: the iPhone-profile test covers the new
  flag (it never reaches battle, so the panel stays hidden there). Five tests
  that need the built Wasm core or real audio fail locally; they fail the
  same way on clean main, and CI builds the core.
- `node tools/asset-guard/check.js`

## Not verified
- Real-game behaviour (Tier 3, deferred to #123): that the planner reaches
  each row in a real battle, at the battle's frame pacing; which rows a
  character's menu actually has (blank rows); that Cross returns from target
  selection; that Circle after the plan opens the right command.
- Row count 4 and wrapping (source claims).
