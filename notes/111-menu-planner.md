# #111: menu planner

## What it is
- `semantic/planner.js`: `planCursorMove({ from, to, rows, wraps, axis, timing })` → `{ steps: [{ button, mask, expect }], timing }` (pure), `planFrames(plan)`, and `createPlanExecutor(plan)`, a step function driven by frame numbers: each frame the caller passes the frame number and the cursor read through `readMem`, and holds the returned mask. No timers, DOM, Worker or Node (a unit test checks the source).
- `semantic/menus.js`: per-menu facts (cursor entry, rows, wraps, axis) as plain data. `menuPlanArgs(name)` passes `wraps: true` only when wrapping is confirmed.
- Timing (game frames): hold 4 (what #78 used), settle 30 (the executor stops if the cursor does not read the expected row within 30 frames of the release), gap 8 (free frames after the move, before the next press; #78 used 20). In Tier 2 every move landed on the first frame after the release, so a plan of n presses takes 5n + 8(n-1) frames (`planFrames`).
- Executor stop reasons: `start` (cursor not on `from`), `moved` (cursor went to an unexpected row), `stuck` (still on the previous row after settle), `unread` (settle failed reads in a row), `frame` (frames went backwards).

## Tier 2
Generated from the planner by `runner/test/unit/planner-scenarios.js`; `planner.test.js` fails if the committed files differ.
- `reactor-mode-2f-planner-rows` (acceptance): from `menu-open`, plans 0→3, 3→0, 0→7; each press followed by a wait until the cursor reads the planned row (timeout = settle, the executor's stop). Checks: cursor 7, still menu, rerun match.
- `reactor-mode-2g-menu-rows-down` (diagnostic): 11 blind Downs, reports the row (10 rows that stop: 9; wrap: 1; 11 rows that stop: 10).
- `reactor-mode-2h-menu-up-from-top` (diagnostic): one Up from row 0, reports the row (0: stops; last row: wraps).

## Results
### Attempt 1, run 1 (`94f9f0e`, tier2-eval run 43157399452: 56 pass, 0 fail)
| scenario | metrics |
|---|---|
| reactor-mode-2f-planner-rows | w_to3 1, w_to0 1, w_to7 1, cursor_ok 1, menu_ok 1, match 1, frames 182 |
| reactor-mode-2g-menu-rows-down | row0 1, menu_ok 1, frames 241 |
| reactor-mode-2h-menu-up-from-top | row0 9, menu_ok 1, frames 41 |

Reading:
- Every planned press moved the cursor to the planned row by the end of the first frame after the release (each `w_toN` is 1), with an 8-frame gap between presses. 13 presses took 182 frames in all.
- **The main menu has 10 rows and wraps at both ends.** Up from row 0 reads 9, the last row of 10. After 11 Downs from row 0 the cursor reads 1, which is 11 mod 10. If the menu had 10 rows and stopped at the end, it would read 9; with 11 rows it would read 10. Greyed rows (PHS, Save in the reactor) are ordinary cursor stops: the count includes them.
- `semantic/menus.js` now marks rows and wraps as confirmed. `menuPlanArgs('main')` returns `wraps: true`, so plans take the shorter way round.

### Run 2 (`735ad43`, tier2-eval run 43163273485: 57 pass, 0 fail)
| scenario | metrics |
|---|---|
| reactor-mode-2f-planner-rows | w_to3 1, w_to0 1, w_to7 1, cursor_ok 1, menu_ok 1, match 1, frames 182 (identical to run 1) |
| reactor-mode-2g-menu-rows-down | row0 1, wrap_ok 1, menu_ok 1, frames 241 (identical) |
| reactor-mode-2h-menu-up-from-top | row0 9, wrap_ok 1, menu_ok 1, frames 41 (identical) |
| reactor-mode-2i-planner-wrap (new) | w_to9 1, w_to2 1, w_to8 1, cursor_ok 1, menu_ok 1, match 1, frames 117 |

- **The acceptance moves (rows 3, 0, 7) are deterministic over two runs:** the same script gave the same metrics on two pushes, and each run's rerun matched (`match` 1).
- The wrap results repeat. The wrapped plans land too: 8 presses in 117 frames, against 13 presses in 182 frames for the plans that don't wrap. 2i's second run is on the push that records this.

### Run 3 (the next push)
2i's second run, and every other scenario's third.
