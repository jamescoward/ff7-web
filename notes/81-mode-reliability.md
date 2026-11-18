# #81: the M2 exit mode-detection set

Original project notes, GPL-2.0-or-later.

## Method (owner decision on #81, 2026-11-18)
- Tier 2 scenarios check the raw inputs `mode()` reads (`gameState`, `prevGameState`, `movieFrame`); `semantic/` does not enter the sandbox.
- `runner/test/unit/mode-reliability.test.js` lists the set (`MODE_SET`). For each point it reads the committed scenario, takes the values from that scenario's own checks, replays them into `mode()` over synthetic RAM (polled every 15 frames over one `MOVIE_SPAN_FRAMES` window) and checks the answer. A field-state point must also check `movieFrame` (a `change` over ≥ 60 frames, or the held value 1790), since that is all that tells field from movie.
- Existing scenarios are reused where they already check the mode; new ones fill the gaps.

## The set (17 points)
| Mode | Settled | Just after a transition |
|---|---|---|
| field | reactor-mode-1-field | reactor-mode-3a (menu → field), reactor-mode-5a (battle → field), movie-3a (movie end) |
| menu | reactor-mode-2-menu-open, reactor-mode-2e-party-menu | reactor-mode-2a (field → menu) |
| battle | reactor-mode-4-battle, save-boot-11-party-stats-battle | reactor-mode-4i (field → battle) |
| world | save-boot-7-world-kalm, save-boot-8-world-midgar | save-boot-7a (title load → world) |
| minigame | save-boot-9-highway | save-boot-9a (title load → highway) |
| movie | movie-2a-playing-window | movie-1a (movie start) |

"Just after" = the script waits for the first frame of the new mode (or the movie's first/last frame), marks it, waits 60 frames with no input, then checks the value, that `gameState` did not change since the mark (`held`), and for field points that `movieFrame` did not change (`no_movie`).

## Known limits
- Checks are at the end of each script, not every frame: a one-frame flicker between the mark and the end would not be seen. `mode()` itself polls at 4 Hz.
- After a movie ends, `mode()` keeps reporting movie for up to 60 frames (its window); movie-3a checks the state at the end of that window.
- `prevGameState` after a load from the title (world, minigame) is reported, not checked: its value there is unconfirmed.

## Results
- Run 1 (`1bd8544`, tier2 check 135123491395): 73/73 pass. Shown metrics: movie-1a and movie-2a `advancing` 1; movie-3a `still` 0, `movie_end` 6564, `movie_frame` 1790; reactor-mode-2a `held` 0, `prev_ok` 1, `menu_wait` 1 (the menu opens on the first Triangle). The check summary is cut off past reactor-mode-3, so the other new scenarios' metrics weren't read; they pass.
- Run 2: on the docs commit (scenarios unchanged), see PR #210.
