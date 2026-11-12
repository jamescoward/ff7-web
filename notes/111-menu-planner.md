# #111: menu planner

## What it is
- `semantic/planner.js`: `planCursorMove({ from, to, rows, wraps, axis, timing })` → `{ steps: [{ button, mask, expect }], timing }` (pure), `planFrames(plan)`, and `createPlanExecutor(plan)`, a step function driven by frame numbers: each frame the caller passes the frame number and the cursor read through `readMem`, and holds the returned mask. No timers, DOM, Worker or Node (a unit test checks the source).
- `semantic/menus.js`: per-menu facts (cursor entry, rows, wraps, axis) as plain data. `menuPlanArgs(name)` passes `wraps: true` only when wrapping is confirmed.
- Timing (game frames): hold 4 (what #78 used), settle 30 (the executor stops if the cursor does not read the expected row within 30 frames of the release), gap 8 (free frames after the move, before the next press; #78 used 20, so 8 is new and checked by the Tier 2 scenario).
- Executor stop reasons: `start` (cursor not on `from`), `moved` (cursor went to an unexpected row), `stuck` (still on the previous row after settle), `unread` (settle failed reads in a row), `frame` (frames went backwards).

## Tier 2
Generated from the planner by `runner/test/unit/planner-scenarios.js`; `planner.test.js` fails if the committed files differ.
- `reactor-mode-2f-planner-rows` (acceptance): from `menu-open`, plans 0→3, 3→0, 0→7; each press followed by a wait until the cursor reads the planned row (timeout = settle, the executor's stop). Checks: cursor 7, still menu, rerun match.
- `reactor-mode-2g-menu-rows-down` (diagnostic): 11 blind Downs, reports the row (10 rows that stop: 9; wrap: 1; 11 rows that stop: 10).
- `reactor-mode-2h-menu-up-from-top` (diagnostic): one Up from row 0, reports the row (0: stops; last row: wraps).

## Hypotheses (until Tier 2 says otherwise)
- The main menu has 10 rows (Item … Save as on screen); greyed rows (PHS, Save in the reactor) are assumed to be ordinary cursor stops.
- Wrapping is unknown; `wraps: false` until confirmed.

## Results
(pending)
