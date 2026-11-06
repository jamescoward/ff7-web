# #76: confirm the game mode in Tier 2 (field, menu, battle, movie)

Status (2026-11-06): done. Tier 2 passed 13/13 on `93e1388` and on `6b938fe`. Field, menu and battle are confirmed in `g_GameState`; `g_PrevGameState` is confirmed; the movie is confirmed by `Stframe_no` (`movieFrame`). Attempts used: 2 of 3 materially distinct approaches. Approach 1 was the gameState probes plus g_MovieLock as the movie candidate; approach 2 was Stframe_no. `6b938fe` only moved where the movie-start wait begins.

## Candidates (hypotheses, reference only)
All from the symbol list of Xeeynamo/ff7-decomp at `9411173034bde2ae4c9b0312167e79c3645ca1be`, `config/symbols.main.us.txt`. Only names and addresses were read from that one file; no source file was opened and no code was copied (CLAUDE.md, AGPL).

| Name | Address | Size | Used as |
|---|---|---|---|
| `g_GameState` | 0x8009C560 | s16 | the mode: field 1, battle 2, world 3, menu 5 (values from `notes/36-disc-boot.md`) |
| `g_PrevGameState` | 0x800965EC | s16 | the mode before |
| `g_MovieLock` | 0x800716CC | 4 | movie candidate 1: the name suggests it is set while a movie plays (hypothesis) |
| `Stframe_no` | 0x80071740 | 4 | movie candidate 2: the streaming library's frame number (hypothesis) |
| `StSTART_FLAG` | 0x8009C6CC | 4 | diagnostic only: the streaming library's start flag |

FF7 plays its movies from the field module, so the opening movie may well read field (1) in `g_GameState`. That is why the movie case needs its own candidate.

Format 2 reads only `u8`/`u16`/`u32`, so the s16 values are read as u16. The mode values under test are small and positive, so they read the same.

## Design (inside the contract, no runner change)
- Format 2 checks run only at the end of a script. So each transition is its own scenario in a chain of named snapshots (#74). A `wait.until` gives the first frame the value appears (its metric). The `expect` at the end is the 0/1 check, made at a point where the picture says that mode is active (a still picture after the change, or a fixed delay into the battle). `game_state` and `prev_state` are also listed as metrics: they are the small values under test, not game data in the sense of `docs/SECURITY.md`.
- The chain: `new-game-to-reactor-entrance` (#74) keeps `reactor-entrance`. Then, in file name order:
  - `reactor-mode-1-field`: g_GameState reads 1 at reactor-entrance;
  - `reactor-mode-2-menu-open`: Triangle until 5, keeps `menu-open`;
  - `reactor-mode-3-menu-close`: Cross until 1, keeps `field-after-menu`;
  - `reactor-mode-4*-battle-*`: walk until 2, keeps `battle`;
  - `reactor-mode-5-battle-end`: Circle until 1.
- Movie: `movie-probe-1..4` follow the same inputs as `new-game-to-reactor-entrance` from `title-card` and stop at script frames 1920, 4320, 6720 and 8520 (the 5 s still picture began at about 9545). Each reports the raw candidate values and `fps`; #74 saw the speed fall from about 1800 to about 200 fps on the way, consistent with movie decoding.
- Walking to the first battle without a screen: attempt 1 tries all four directions, one scenario each, from the same snapshot. Each holds the direction for 15 of every 20 frames together with Circle, so that dialogue is advanced. The directions that don't reach a battle are diagnostics, removed before merge.
- Determinism: each scenario has `sameState: rerun` (the same snapshot restored again; #88: compare reruns from the same snapshot, not chain vs scratch), and two Tier 2 runs must give the same transition frames.

## Results

### Attempt 1 (`9a01627`, tier2: 14 pass, 3 fail)
The fails are the three walking directions that did not reach a battle; they are diagnostics.

| scenario | status | metrics |
|---|---|---|
| movie-probe-1 (script frame 1920) | pass | game_state 1, prev_state 0, movie_lock 0, movie_frame **0**, st_start 1, fps 303, match 1 |
| movie-probe-2 (4320) | pass | game_state 1, prev 0, movie_lock 0, movie_frame **822**, fps 240, match 1 |
| movie-probe-3 (6720) | pass | game_state 1, prev 0, movie_lock 0, movie_frame **1421**, fps 218, match 1 |
| movie-probe-4 (8520) | pass | game_state 1, prev 0, movie_lock 0, movie_frame **1790**, fps 261, match 1 |
| new-game-to-reactor-entrance | pass | still_wait 5525, frames 9845, match 1 (as in #74) |
| reactor-mode-1-field | pass | field_wait 1, field_ok 1, game_state 1, prev_state 0, movie_frame 1790, movie_lock 0, match 1 |
| reactor-mode-2-menu-open | pass | menu_wait 1, menu_still 130, menu_ok 1, game_state 5, prev_state 1, match 1 |
| reactor-mode-3-menu-close | pass | close_wait 32, field_still 93, field_ok 1, game_state 1, prev_state 5, match 1 |
| reactor-mode-4a/4b/4c (left, down, right) | fail | battle_wait 0 (30 s timeout), game_state 1, prev_state 5 (match 0 only because a timeout fails every check) |
| reactor-mode-4d-battle-up | pass | **battle_wait 839**, battle_ok 1, game_state 2, prev_state 1, match 1 |
| reactor-mode-5-battle-end | pass | **end_wait 1293**, field_still 587, field_ok 1, game_state 1, prev_state 2, match 1 |

Reading:
- **Field, menu and battle are observed as the hypothesis said:** 1 at reactor-entrance (the first frame), 5 one frame after Triangle, 1 32 frames after Cross, 2 after walking up for 839 frames, and 1 again 1293 frames into Circle presses in the battle. Each 0/1 check was made after the picture settled (a still menu or field), or 10 s into the battle.
- **g_PrevGameState follows:** 0 at the first field of a new game, then 1 in the menu, 5 after it, 1 in battle, and 2 after it.
- **Movie:** g_GameState reads field (1) through the whole opening, so it has no movie value. Candidate 1, **g_MovieLock, read 0 at every point: rejected.** Candidate 2, **Stframe_no**, read 0 at 1920, then 822, 1421 and 1790, and was still 1790 at reactor-entrance. From 4320 to 6720 it advanced 599 in 2400 frames, one per 4 frames (15 a second: a PS1 movie stream). It stopped before 8520 and holds its last value. At 1920 it read 0 although extrapolating at 15 a second puts the start earlier, so the first part may run at another rate, or the counter may start late. Attempt 2 measures the start.
- **Walking:** only Up reached the battle within 30 s.

### Attempt 2 (`93e1388`): the scenarios to merge
- Diagnostics removed: `movie-probe-*` and the left, down and right battle scenarios. `reactor-mode-4d-battle-up` became `reactor-mode-4-battle`.
- `movie-1-start`: the chain's inputs to 1920, then Circle until `movie_frame` differs from 0 (`movie_start`). The mode reads 1 there.
- `movie-2-playing`: 10 s later the counter must lie in [30, 400] (`movie_ok`); the mode still reads 1.
- `movie-3-end`: wait until it equals 1790 (`movie_end`), then 5 s later it must still be 1790 (`stopped_ok`).
- `reactor-mode-1-field` also checks `movie_frame` = 1790 after 5 s: no movie plays at the field.
- Each `reactor-mode-*` also checks `prev_state` (0/1 checks with no metric of their own; they count in pass/fail).
- 1790 is a measured constant: the opening's last frame number on this disc and core build. If another build gave another value, `movie-3-end` would time out and report it.
- `semantic/addresses.js`: `gameState` is confirmed, with `confirmedValues` 1, 2 and 5 (world 3 stays a hypothesis). `prevGameState` is confirmed. A new entry, `movieFrame` (Stframe_no), is confirmed. Every source cites #88.

### Attempt 2 results (`93e1388`, tier2: 13 pass, 0 fail)
| scenario | metrics |
|---|---|
| movie-1-start | movie_start 1, movie_frame **223** at script frame 1921, mode_ok 1, game_state 1, prev_state 0, fps 432, match 1 |
| movie-2-playing | movie_ok 1, movie_frame **373** (+150 in 600 frames: 15 a second), mode_ok 1, fps 332, match 1 |
| movie-3-end | movie_end **5675** (snapshot_frames 3771, so script frame 8196 from the title), stopped_ok 1, mode_ok 1, match 1 |
| reactor-mode-1-field | field_wait 1, field_ok 1, no_movie 1, game_state 1, prev_state 0, match 1 |
| reactor-mode-2-menu-open | menu_wait 1, menu_still 130, menu_ok 1, game_state 5, prev_state 1, match 1 |
| reactor-mode-3-menu-close | close_wait 32, field_still 93, field_ok 1, game_state 1, prev_state 5, match 1 |
| reactor-mode-4-battle | battle_wait 839, battle_ok 1, game_state 2, prev_state 1, match 1 |
| reactor-mode-5-battle-end | end_wait 1293, field_still 587, field_ok 1, game_state 1, prev_state 2, match 1 |
| new-game-to-reactor-entrance | still_wait 5525, frames 9845, match 1 |

Reading:
- **Determinism across runs:** every field, menu and battle transition frame equals attempt 1's (1, 1, 130, 32, 93, 839, 1293, 587; still_wait 5525). Each rerun from the same snapshot matched.
- **The movie counter can read 0 mid-movie.** Attempt 1 read 0 at script frame 1920; attempt 2 read 223 at 1921, on the same inputs from the same boot point (both runs were deterministic). So 0 is a transient reading on some frames, and `movie_start 1` here measured nothing. The rates agree: 1790 frames at 15 a second is 7160 game frames, ending at 8196, so the movie started at about script frame 1036. That fits attempt 1's 822 at 4320 ((4320 - 1036) / 4 = 821). The refinement starts the wait right after `title-to-new-game` (frame 720), before the movie, so `movie_start` measures the real start (expected about 316).

### Run 3 (`6b938fe`, tier2: 13 pass, 0 fail)
| scenario | metrics |
|---|---|
| movie-1-start | **movie_start 312** (script frame 1032 from the title; frame 2282 from power-on), movie_frame 1, mode_ok 1, game_state 1, prev_state 0, fps 589, match 1 |
| movie-2-playing | movie_frame 151 (+150 in 600 frames), movie_ok 1, mode_ok 1, fps 348, match 1 |
| movie-3-end | movie_end 6564, snapshot_frames 2882, so the movie ends at frame **9446** from power-on (attempt 2: 3771 + 5675 = 9446), stopped_ok 1, mode_ok 1, match 1 |
| reactor-mode-1..5 | identical to attempts 1 and 2: field_wait 1, menu_wait 1, menu_still 130, close_wait 32, field_still 93, battle_wait 839, end_wait 1293, field_still 587; every check 1, every match 1 |

### Determinism (acceptance)
- **Field, menu and battle:** the same transition frames in three Tier 2 runs (`9a01627`, `93e1388`, `6b938fe`), and every scenario's rerun from the same snapshot matched.
- **Movie:** the end is at frame 9446 from power-on in two runs with different start scripts. The start (312) was measured once, with its rerun matching. Movie length: 9446 - 2282 = 7164 frames for 1790 movie frames, 4.0 per movie frame (15 a second).
- **Caveat (#88):** these are reruns from the same in-memory snapshot, not a run from power-on with no restore. On the disc a restored mid-run snapshot is not byte-identical to running on, so a player who never restored could in principle see slightly different frames.

### What "movie" means now
A movie is playing when `gameState` reads field and `movieFrame` advances (15 per second) over a window of a few frames. A single read can be 0 mid-movie, so there is no single-read movie value. The layer's `mode()` reader (`semantic/layer.js`, outside this issue's paths) doesn't use it yet. A reader that compares two reads belongs to #79 or a follow-up.

### Known limit (fixed in #92)
`semantic/layer.js` used to mark `mode()` as `confirmed` whenever the address was confirmed, so a raw 3 (world) also came back "confirmed". Since #92 (PR #103) a reader is confirmed only for raw values its entries' `confirmedValues` list, and an unlabelled value (`unknown`) is never confirmed. `mode()` also reports `movie` (raw still 1) when `gameState` reads field and `movieFrame` advanced over the last `MOVIE_WINDOW` (5) calls; 0 reads are skipped, so a transient 0 mid-movie still counts and a counter held at 1790 does not. Each call is one sample: at the overlay's 4 Hz, "movie" shows one sample after the counter starts and lingers about 1 s after it stops. Tests: `runner/test/unit/semantic-mode.test.js` (synthetic counters only; no Tier 2 scenario drives `mode()` through a movie).
