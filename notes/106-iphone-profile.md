# iPhone-profile Tier 1 checks (#106)

`web/test/iphone-profile.test.js`: see `web/test/README.md` for what is checked and
how safe-area insets are emulated. Playwright WebKit is not iOS Safari
(`docs/ARCHITECTURE_SURVEY.md` section 7, risk 5); this does not replace the owner's check.

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
