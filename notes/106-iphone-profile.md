# iPhone-profile Tier 1 checks (#106)

`web/test/iphone-profile.test.js` runs with the rest of `web/test` (`node --test 'web/test/*.test.js'`;
in CI `WEB_BROWSERS=chromium,webkit`, `WEB_REQUIRE_BROWSERS=1`).

Runs the page with Playwright's `iPhone 14 Pro` and `iPhone 14 Pro landscape`
profiles (touch on) and checks what an owner device check would catch:
no horizontal scroll; the canvas fits the viewport at 4:3; every visible
interactive element is at least 44x44 px; no two overlap; controls and the Labs
and Card panels stay inside the safe area; a synthetic touch drag on the field
layer gives the expected pad bits; the classic pad still sends input. Layout
checks repeat for the classic pad and the field controls, and for each Labs
flag from `window.ff7web.labs.listFlags()` switched on in turn via `?labs=`.

**This is not iOS Safari.** Playwright WebKit shares the engine, not the device:
no real Safari chrome, safe areas, rubber-banding, multi-touch or hit-testing
(`docs/ARCHITECTURE_SURVEY.md` section 7, risk 5). It narrows the gap; it does
not replace the owner's iPhone check (Tier 3).

Safe area: `env(safe-area-inset-*)` is 0 under Playwright, so the test serves
`css/app.css` with each `env()` replaced in memory by the iPhone 14 Pro's inset
(portrait top 59, bottom 34; landscape left/right 59, bottom 21). Those values
are known device figures taken as a hypothesis, not measured here. "standalone"
profiles use the full 393x852 screen (Home Screen app, `viewport-fit=cover`);
"browser" profiles use Playwright's own viewport with zero insets.

Known page defects are listed element by element in `KNOWN_DEFECTS` (profile,
layout, and a pattern over the problem message). A matching problem is printed as
a `known defect:` diagnostic instead of failing; any other problem fails the test,
and so does an entry that no longer matches anything (remove it once the page is
fixed). The current list is under "Page defects" below.

(This text was first drafted as `web/test/README.md`, but the preview build copies `web/`
and allows no `.md` files there, so it lives here.)

## Status of claims
- Demonstrated (Chromium, locally): all checks run; portrait standalone passes for both layouts, with and without each Labs flag; field drag bits and classic-pad tap pass in all profiles.
- Not run locally: WebKit (not installed here). CI runs it; the code uses only WebKit-safe APIs.
- Hypothesis: iPhone 14 Pro insets (portrait 59/0/34/0 top/right/bottom/left; landscape 0/59/21/59) and the standalone viewport (393x852, 852x393).

## Page defects found on main (not fixed here; out of allowed paths)
Listed element by element in `KNOWN_DEFECTS` (26 problems over 8 cases, printed as `known defect:` diagnostics). Any other problem in those cases still fails, and an entry that stops matching fails too, so a fix must remove it. The first draft marked whole cases `todo`, which would have hidden new regressions in them; the Opus review replaced that with the per-element list.
1. Landscape standalone (insets L/R 59): `.pad` is `position:absolute; inset:0` so body padding does not apply. Shoulder buttons at x=12 and the d-pad at x=12 are inside the left inset; Circle (780..840) and the right shoulder (776..840) run past the right inset edge (793); Start/Select at y=337..381 pass the bottom inset (372). Field controls: action buttons (660..840) and Back (764..840) exceed the right inset.
2. Portrait Safari with toolbars (393x660 viewport): Start and Select at y=667..711, below the fold; the page scrolls vertically.
3. Landscape Safari (852x343 viewport): Start and Select at y=316..360, 17 px below the fold.
Follow-up: #152 (safe-area insets for the landscape pad and field overlay; fit the pad in short viewports).
