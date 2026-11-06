# #76: confirm the game mode in Tier 2 (field, menu, battle, movie)

Status: attempt 1 pushed; waiting for its Tier 2 run.

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
(pending)
