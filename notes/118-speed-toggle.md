# 118: speed toggle (Labs flag `speed`)

Off by default; with the flag off the page behaves as before (no button, 1x).

- Button in the top bar cycles 1x, 2x, 3x. `backend.setSpeed(n)` posts `{type:'speed'}`; the worker sets its time base to `fps * speed`, re-anchors, and runs up to `speed` core frames per tick (catch-up cap is `4 * speed`). One tick still posts one picture, so the page draws at the display rate.
- Audio: muted above 1x. The worker clears the core's audio buffer instead of posting it, so nothing queues in the worklet and 1x resumes from an empty buffer. `backend.audioPushes` counts audio batches (test hook).
- Input: the pad mask is latched when a message arrives and is held for the `speed` frames of a tick. A press shorter than one tick (about 16 ms) can be missed, as at 1x.
- Auto step-down: `createGovernor` in `web/js/speed.js`. The worker notes each tick as behind (due frames above the cap). Over a 2 s window with at least 20 ticks, if at least half were behind, it drops one step and posts `{type:'speed', speed, auto:true}`. A gap over 500 ms between ticks (tab hidden) restarts the window; `start()` and any speed change reset it. The page shows the new label, marks `data-stepped`, and shows a notice.
- Turning the flag off while at 2x/3x sends speed 1 and hides the button.
- Tests: `web/test/speed.test.js` (unit tests for the steps and governor with fake timings; stubbed-backend page tests; Chromium/WebKit core tests on homebrew).

## #173: the 2x test measures the time base, not spare CPU
The first version of "2x runs about twice the frames per second" asserted `1.5 < ran(2x) / ran(1x) < 2.5` in wall time. On CI runners that can't run the core much above 60 fps it failed: ratios 1.48, 1.28 and 1.17 (main @ `ea56af5`, PR #172 @ `cb9dc5d`). It measured the host, not the toggle.

Now the worker counts `targetFrames`: every frame its time base asks for (`fps * speed` per second of wall time), whether or not the host runs it. The count is sent with each frame message and exposed as `backend.targetFrames` (a test hook; nothing else reads it). The test (`2x doubles the time base, and runs more frames than 1x`) asserts:
- the 1x target rate is the core's fps within 20%;
- the 2x target rate is 1.7–2.3 times the 1x one (the real check: it reads 1.02 when the worker ignores the speed);
- the speed is still 2 after the measurement (no automatic step-down mixed in);
- a wall-clock lower bound only: 2x runs more frames than 1x.

The 2x window is 1 s, starting 200 ms after the switch, so it ends before the governor's 2 s window could step a slow host down. With a 2 s window, a simulated host that manages ~66 fps at 2x was stepped down mid-measurement (correct governor behaviour, wrong for this test). The step-down path has its own tests.

Measured locally (Chromium, prebuilt `main/core` from `gh-pages`), with a temporary busy-wait per core frame in `runFrames` to simulate slow hosts:

| Host (busy-wait per frame) | 1x target / ran | 2x target / ran | Result |
|---|---|---|---|
| none | 60 / 60 | 119–121 / 119–121 | pass ×2 |
| 1000/110 ms | 58.5–59 / 58.5–59 | 106–111 / 63–64 | pass ×2 |
| 1000/95 ms | 57.5 / 56.5 | 103–104 / 55 | fail ×2 (lower bound) |
| 1000/85 ms | 57–57.5 / 54–55 | 107–109 / 55 | fail 1 of 2 (lower bound) |
| worker ignores speed (`rate = fps`) | 60 / 60 | 61 / 61 | fail (ratio 1.02), as it should |

**Known limit:** the wall-clock lower bound fails on a host that can't hold 1x at full speed (1x ran below about 57 fps). There, 2x runs no more frames than 1x. Every CI run seen so far held 1x at 60 fps and reached 72–89 fps at 2x, so the bound should hold there. If it fails in CI, the 1x "ran" figure in the message shows whether the host was that slow.
