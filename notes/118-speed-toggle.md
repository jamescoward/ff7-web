# 118: speed toggle (Labs flag `speed`)

Off by default; with the flag off the page behaves as before (no button, 1x).

- Button in the top bar cycles 1x, 2x, 3x. `backend.setSpeed(n)` posts `{type:'speed'}`; the worker sets its time base to `fps * speed`, re-anchors, and runs up to `speed` core frames per tick (catch-up cap is `4 * speed`). One tick still posts one picture, so the page draws at the display rate.
- Audio: muted above 1x. The worker clears the core's audio buffer instead of posting it, so nothing queues in the worklet and 1x resumes from an empty buffer. `backend.audioPushes` counts audio batches (test hook).
- Input: the pad mask is latched when a message arrives and is held for the `speed` frames of a tick. A press shorter than one tick (about 16 ms) can be missed, as at 1x.
- Auto step-down: `createGovernor` in `web/js/speed.js`. The worker notes each tick as behind (due frames above the cap). Over a 2 s window with at least 20 ticks, if at least half were behind, it drops one step and posts `{type:'speed', speed, auto:true}`. A gap over 500 ms between ticks (tab hidden) restarts the window; `start()` and any speed change reset it. The page shows the new label, marks `data-stepped`, and shows a notice.
- Turning the flag off while at 2x/3x sends speed 1 and hides the button.
- Tests: `web/test/speed.test.js` (unit tests for the steps and governor with fake timings; stubbed-backend page tests; Chromium/WebKit core tests on homebrew).
