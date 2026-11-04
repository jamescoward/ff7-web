# #50: flaky WebKit audio resume test

Test: `web/test/browser.test.js`, "audio: asks for a playback session, and a later tap resumes a suspended context".

## Cause (hypothesis, consistent with the measurements)
1. The test toggled sound on, then waited only for `audio.context !== null`.
2. `ctx` is assigned in `setup()` before `audioWorklet.addModule()` finishes.
3. So `unlock()`'s start-up `starting.then(() => ctx.resume())` was usually still pending at that point.
4. The test then called `ctx.suspend()` to simulate iOS. If the start-up resume ran during that `await`, before the test wrapped `ctx.resume`, it went through the original method and so was not counted.
5. If WebKit applied that resume after the test had read `needsResume` (true), the context was running again by the tap. `needsResume` was then false, the tap handler called nothing, and the test timed out waiting for a resume.

The page itself is not wrong. A late start-up resume is harmless on a phone: it only means audio starts.

## Fix
**First attempt (`db59f7b`, rejected in review).** The test waited until every `resume()` call so far had settled. But `unlock()` calls `resume()` twice:
1. synchronously inside the tap (`ctx` already exists then, because `setup()` assigns it before its first `await`);
2. again after the worklet loads.

The wait was met by the first call alone. A reviewer probe with the worklet slowed (Chromium) showed the second resume landing during the simulated suspend (30 ms) or after the counter reset (150 ms). At 150 ms that gives a false pass, with no tap needed.

**Fix (attempt 2):**
- `web/js/audio.js` keeps the promise of the latest `unlock()` and exposes it as `audio.unlocking`. It settles after the resume that follows start-up. Page behaviour is unchanged.
- The test awaits `audio.unlocking` before simulating the suspend.
- The test runs twice: with the worklet as served, and with the worklet held back 150 ms (`page.route`). The second forces the slow start-up path in every browser.
- Before the tap, the test waits past the worklet delay and asserts that the count of `resume()` calls is still 0 and the context still `suspended`. A leftover start-up resume now fails the test instead of passing it falsely.
- The timeout is unchanged and nothing is skipped.

**Regression check:** the slowed variant fails with the first attempt's test logic (Chromium, deterministic) and passes with the fix.

**Mutation check:** with the page's tap-to-resume handler disabled (`main.js`, the `touchend`/`click`/`keydown` listener), both variants fail with `timed out waiting for a resume on tap`.

## Measurements
A temporary `web/test/audio-repeat.test.js` ran the test's steps 50 times per browser in CI's `web` job. Each run used a new browser context and the same browser.

| Commit | Test logic | Chromium | WebKit |
|---|---|---|---|
| `2bdd418` | before the fix | 0/50 failed | **1/50 failed** (run 0, the first page in a freshly launched browser: `timed out waiting for a resume on tap`) |
| `707068f` | first attempt (still racy, see Fix) | 0/50 failed | **0/50 failed** (run 0, the cold start that failed before, passed) |

**Local (Chromium only):**
- holding the worklet and releasing it 0–40 ms before the suspend: 48/48 passed;
- 50-run loop: 50/50 before and after the fix.

The race did not reproduce on Chromium.

**How strong this is:** the CI loop numbers are weak on their own: 0/50 after a 1/50 rate. They also measured the first attempt, which still had a race. The evidence for the final fix is the deterministic slowed-worklet variant: without the fix it fails, and with it it passes. That variant runs in CI on Chromium and WebKit on every PR. If the test flakes again, reopen #50 with the CI job link.

The temporary loop was removed before merge. Its last version is in commit `707068f`.

WebKit can't be installed in agent sessions (environment rule: no `playwright install`), so WebKit numbers come from CI only.
