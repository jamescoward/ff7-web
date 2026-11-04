# #50: flaky WebKit audio resume test

Test: `web/test/browser.test.js`, "audio: asks for a playback session, and a later tap resumes a suspended context".

## Cause (hypothesis, consistent with the measurements)
1. The test toggled sound on, then waited only for `audio.context !== null`.
2. `ctx` is assigned in `setup()` before `audioWorklet.addModule()` finishes.
3. So `unlock()`'s start-up `starting.then(() => ctx.resume())` was usually still pending at that point.
4. The test then called `ctx.suspend()` to simulate iOS. If the start-up resume ran during that `await`, before the test wrapped `ctx.resume`, it went through the original method and so was not counted.
5. If WebKit applied that resume after the test had read `needsResume` (true), the context was running again by the tap. `needsResume` was then false, the tap handler called nothing, and the test timed out waiting for a resume.

The page itself is not wrong. A late start-up resume is harmless on a phone: it only means audio starts.

## Fix (test only)
- An init script wraps `AudioContext.prototype.resume` from page load. It counts calls (`__resumes`) and settled promises (`__settled`).
- After the unlock tap, the test waits until at least one resume was called and all have settled. Only then does it simulate the suspend.
- The timeout is unchanged and nothing is skipped.

**Mutation check:** with the page's tap-to-resume handler disabled (`main.js`, the `touchend`/`click`/`keydown` listener), the fixed test fails with `timed out waiting for a resume on tap`. It still checks what it should.

## Measurements
A temporary `web/test/audio-repeat.test.js` ran the test's steps 50 times per browser in CI's `web` job. Each run used a new browser context and the same browser.

| Commit | Test logic | Chromium | WebKit |
|---|---|---|---|
| `2bdd418` | before the fix | 0/50 failed | **1/50 failed** (run 0, the first page in a freshly launched browser: `timed out waiting for a resume on tap`) |
| fix | after the fix | see PR #53 | see PR #53 |

**Local (Chromium only):**
- holding the worklet and releasing it 0–40 ms before the suspend: 48/48 passed;
- 50-run loop: 50/50 before and after the fix.

The race did not reproduce on Chromium.

WebKit can't be installed in agent sessions (environment rule: no `playwright install`), so WebKit numbers come from CI only.
