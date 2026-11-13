# #181: the web frontends pass the frame number to the semantic layer

Follow-up to #146 (`notes/146-semantic-frames.md`). Since #146, `mode()` counts its movie window in game frames when `backend.frame` is an integer ≥ 0. The web frontends wrapped the backend as `{ readMem }` only, so they kept the per-call window. Now every wrapper also has a `frame` getter:

| Frontend | File | `frame` is |
|---|---|---|
| Debug overlay | `web/js/emu-worker.js` | the worker's core frame counter (`frame += 1` after each `_fe_run_frame`) |
| Automatic controls (#113) | `web/js/auto-controls.js` | `backend.frame`: the last frame the worker posted |
| Battle status strip (#133) | `web/js/battle-hud.js` | the same |
| Dialogue taps (#114) | `web/js/dialogue-taps.js` | the same (it calls `dialogue()`, not `mode()`, today) |

The wrappers stay read-only: `readMem` plus `frame`, nothing else of the backend (checked by a unit test).

## Behaviour
- The movie report no longer depends on the polling rate. At 4 Hz it covers the same 60 frames as before.
- At 2× or 3× speed (#118) the window is still 60 **core** frames, which is 1/2 or 1/3 s of wall time instead of 1 s. A 4 Hz poll is then 30 or 45 core frames apart, so the window holds 3 samples (2×) or 2 (3×) instead of 5. `movieAdvancing` needs two non-zero samples that rise, so a movie is still reported at both speeds, and its end is noticed sooner in wall time. The cost: at 3× a single stray 0 read of `movieFrame` (#76) leaves one usable sample, so that one poll reads `field` mid-movie. Both Labs flags that read `mode()` (`auto-controls`, `battle-hud`) act on a change only, so this can flip the controls to drag-to-walk for one poll during a movie at 3×, where no input does anything. Reasoned from the code, not measured; recorded as a known limit.
- On the main thread `backend.frame` is the last frame the worker **posted**, so it lags the core by up to one tick plus message latency, and at speed > 1 it moves in steps of `speed`. The window only needs frame numbers that rise with game time, so this is fine.
- While paused, `frame` does not move: repeated polls replace the one sample for that frame, so a paused movie is not reported as a movie (the counter is not advancing anyway).

## Evidence (Tier 1)
`web/test/semantic-frame-unit.test.js`, synthetic RAM (the same model as `runner/test/unit/semantic-movie-frames.test.js`: movieFrame advancing every 4 frames from 100 to 400):
- each main-thread wrapper's keys are exactly `frame` and `readMem`, and `frame` follows the backend's (0, 1, 15, 600, 12345);
- `auto-controls` and `battle-hud`, polled through their own intervals every 15 frames (4 Hz) and every 3 frames (20 Hz), give the same mode at every frame both sample, `movie` at 180 and 300, `field` at 0 and 540;
- mutation check: with the getter removed from `auto-controls.js`, the wrapper test fails and the rate test fails at frame 420 (the 20 Hz per-call window ends the movie earlier);
- the worker can't open its semantic gate in Tier 1 (USA disc only), so its wrapper is checked in the source: `createSemantic({ backend: { readMem: peek, get frame() { return frame; } } … })`, and `frame` is the counter advanced after each core frame. Not run end to end.
