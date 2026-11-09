# Safe-area layout (#152)

Labs flag `safe-layout` (off by default, Trip mode rule 4). `web/js/safe-layout.js`
registers it and sets `<html data-safe-layout>` plus `--bar-h` (the top bar's
measured height). The layout itself is CSS at the end of `web/css/app.css`, under
`:root[data-safe-layout]`, so with the flag off the page is byte-for-byte the
same layout as before.

## What changes with the flag on
- **Landscape** (`orientation: landscape` and `max-height: 600px`):
  - `.pad` (classic pad and field layer, both `position:absolute`) is inset by
    `env(safe-area-inset-*)`. Before, `inset:0` put the controls under the side
    insets and the home bar.
  - The pad grid's side columns size to their controls (`auto 1fr auto`) instead of
    sharing what is left beside a `133dvh` middle column, so the face cluster no
    longer centres over a too-narrow column and spills past the right inset.
  - Start/Select move from a third row into the bottom of the middle column
    (`align-self: end`), so the pad needs two rows. It then fits Safari's
    343 px landscape viewport. They sat in the middle column before too, over the
    picture, so they cover the same picture area as before.
- **Portrait**: the picture gives up height so the whole pad fits. Its height is
  `min(60dvh, 100dvh − insets − bar − 316 px)` and its width follows at 4:3.
  The body is held to `100dvh` with no page scroll. On the Home Screen app
  (852 px tall) the budget is above the old 4:3 height, so nothing changes there; in
  Safari with toolbars (660 px) the picture is smaller (about 309 px wide, not 393).
  316 px is the classic pad's content height (shoulders 44, face buttons 180, Start/Select 44,
  two 12 px gaps, 12 px padding top and bottom).

## Test
`web/test/iphone-profile.test.js`: `KNOWN_DEFECTS` now applies only to cases
without `safe-layout`; with it on, the cases must show none of them (and the
test fails if the flag is not registered).

Found while doing this: the per-flag cases were declared before the `before()`
hook read the page's flags, so only the fallback `labs-demo` was ever covered.
The flag list is now read at module load (top-level await, first available browser),
and each browser's `before()` asserts it sees the same list.

## Status of claims
- Demonstrated (Chromium, locally): see the PR's test section.
- Not run locally: WebKit (not installed here). CI runs it.
- Not verified: the real iPhone (Tier 3, deferred; checklist on #123).
- Trade-off for the owner's check: in portrait Safari the picture is smaller so the
  pad fits; in landscape the face buttons overlap the picture's edges a little more
  (as before, at 0.8 opacity).
- With the debug strip on (#93) in portrait, the flag steps back to the old sizing
  (`:has(.screen[data-debug-on])`), so the strip is neither clamped nor clipped; the page
  may scroll then, as on main. Covered since #157 by `web/test/safe-layout-debug.test.js`
  (a fake backend passes the gate with synthetic RAM, as in `debug-overlay.test.js`).
- #157 also runs the field drag test with the flag on in all four iPhone profiles, and
  checks that in landscape the field layer is inset by the safe area.
