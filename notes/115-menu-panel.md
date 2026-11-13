# #115 slice: tap-to-select main menu panel

Labs flag `menu-panel` (off by default). In a confirmed menu mode, a panel
below the picture lists the ten main-menu commands plus Back and Close. A row
tap moves the menu cursor there with the planner (#111), then presses Circle.

## Design
- `semantic/menus.js`: `MENUS.main.labels` (Item, Magic, Materia, Equip, Status,
  Order, Limit, Config, PHS, Save) with `labelsStatus: 'hypothesis'`. The row
  count (10, wraps) is confirmed by #111's Tier 2 runs; the label-to-row order
  is a **source claim** (the on-screen order), not checked per row in Tier 2.
  No Quit row. The labels are the project's own words.
- `semantic/controls.js`: `MENU_PANEL_ACTIONS` (a row tap ends with Circle;
  Back and Close press Triangle). `semantic/menu-panel.js` (new, pure):
  `menuPanelRows()` and `menuPanelPlan(from, to)` (planner with the confirmed
  main-menu facts). Copies are in `web/js/semantic/` via `node semantic/sync-web.js`.
- `web/js/menu-panel.js`: polls `mode()` at 4 Hz while flag, gate and backend
  are present; the panel is shown only when mode is `menu` and confirmed (a
  failed read leaves it as it is). A row tap makes a fresh `menuCursor()` read
  (unconfirmed or failed: nothing is sent), plans, and drives
  `createPlanExecutor` from a 16 ms timer loop: each turn reads
  `backend.frame` (skipping a frame it has already stepped) and `menuCursor()`,
  steps the executor and holds its mask on the `menu-panel` mixer source. On
  `done` it presses Circle for 100 ms. On any failure (`start`, `moved`,
  `stuck`, `unread`, `frame`) it releases everything and sends nothing more,
  Circle included. Taps are ignored while a plan or a press runs. Flag off,
  gate closed or leaving menu mode cancels and releases.
- Greyed rows (PHS, Save) are ordinary cursor stops; input is still sent and
  the game ignores it.
- Layout (`web/css/app.css`): two columns of 44 px buttons in `.stage`, between
  the picture and the pad. The picture is never covered. It adds height, so the
  page may scroll in portrait while it shows (as with the debug strip, #93);
  with `safe-layout` on, scrolling is allowed while the panel shows
  (`data-menu-panel-on`). **Landscape: hidden** (no free space beside the
  picture; same decision as #133/#166).
- Input only: no game memory is written. The classic pad is unchanged.

## Tests
- `node semantic/sync-web.js --check`
- `node --test runner/test/unit/*.test.js`
- `node --test web/test/menu-panel-unit.test.js web/test/menu-panel-browser.test.js web/test/iphone-profile.test.js web/test/labs.test.js web/test/field-browser.test.js web/test/browser.test.js`
- `node tools/asset-guard/check.js`
- The browser test uses a fake semantic source with a simulated cursor (10
  rows, wraps) and checks: panel only in menu mode; no panel with the flag off;
  Down, Down, Circle for row 2 and Up x3, Circle for row 9 (wrap); Back/Close
  Triangle; the classic pad still sends bits; portrait layout with the panel
  visible (44 px, no overlap, no horizontal scroll) with `safe-layout` on and
  off; hidden in landscape. `iphone-profile.test.js` loops over every flag
  (it never reaches menu mode, so the panel is hidden there; the visible-panel
  checks are in the browser test).
- WebKit is not installed in the authoring sandbox: only Chromium was run.

## Not verified
- Real-game behaviour (Tier 3, owner's iPhone): that the planner lands on each
  row from a real menu with a real touch loop; the 16 ms timer loop vs. the
  game's frame rate (a loop that samples late holds a press longer, which
  stops the plan as `moved` rather than mis-pressing); that Triangle backs out
  of each sub-screen.
- The label-to-row mapping (source claim, `labelsStatus: 'hypothesis'`).
- Portrait scrolling comfort with the panel up; WebKit results.
